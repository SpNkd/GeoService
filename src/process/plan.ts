import type { ConnectorEndpoint, ConnectorEntity, GeoDocument, SymbolEntity } from '../domain/model';
import { applyCommandsAtomically, type DocumentCommand } from '../domain/commands';
import { portTargetError, resolvePort, validateConnectivity, connectivityIndex } from '../connectors/model';
import { getLibrary, requireSymbol } from '../symbols/registry';
import { symbolWorldBounds, symbolLocalPortToWorld } from '../symbols/transforms';
import { entityNameIndex, normalizedEntityName } from '../ai/entityReferences';
import { PROCESS_CONCEPTS, PROCESS_LIBRARY, processKindForAlias, VALVE_CHOICES, normalizeProcessName } from './semantics';
import { processActionSchema, validateProcessActions, type ProcessAction, type ProcessItem, type ProcessReference } from './schema';

export const PROCESS_LAYOUT_POLICY=Object.freeze({symbolGap:3,rowGap:6,branchGap:6,routing:'orthogonal' as const});
export interface ProcessChoice {key:string;label:string;options:{value:string;label:string}[]}
export interface ProcessPlan {
  id:string;text:string;actions:ProcessAction[];basedOnDocument:GeoDocument;selectionIds:readonly string[];targetLayerId:string;origin:{x:number;y:number};choices:ReadonlyMap<string,string>;
  status:'ready'|'unresolved'|'invalid';message:string|null;issues:ProcessChoice[];commands:DocumentCommand[];symbols:SymbolEntity[];connectors:ConnectorEntity[];removedConnectorIds:string[];projectedDocument:GeoDocument|null;
}
class NeedChoice extends Error {constructor(readonly issue:ProcessChoice){super(issue.label);}}
function choose(key:string,label:string,options:ProcessChoice['options'],choices:ReadonlyMap<string,string>):string {
  const selected=choices.get(key);if(selected){if(!options.some(o=>o.value===selected))throw new Error('Выбор больше не соответствует плану');return selected;}
  if(options.length===1)return options[0]!.value;
  if(!options.length)throw new Error(`${label}: нет совместимого объекта/порта`);
  throw new NeedChoice({key,label,options});
}
function resolveDefinition(item:ProcessItem,key:string,choices:ReadonlyMap<string,string>) {
  const concept=PROCESS_CONCEPTS[item.symbolKind];if(!concept)throw new Error('Неизвестный semantic symbol kind');
  const definitionId=concept.definition??choose(key,`${concept.label} · ${item.ref}`,VALVE_CHOICES.map(value=>({value,label:requireSymbol(PROCESS_LIBRARY,value).name})),choices);
  return requireSymbol(PROCESS_LIBRARY,definitionId);
}
export function processTag(prefix:string,names:Set<string>) {let i=1;while(names.has(normalizeProcessName(`${prefix}-${i}`)))i++;const tag=`${prefix}-${i}`;names.add(normalizeProcessName(tag));return tag;}
function symbolReference(ref:ProcessReference,document:GeoDocument,selection:readonly string[],choices:ReadonlyMap<string,string>):SymbolEntity {
  let candidates:SymbolEntity[];
  if(ref.kind==='current_selection'){
    if(selection.length!==1)throw new Error('Выберите ровно один Symbol для операции');
    candidates=document.entities.filter((e):e is SymbolEntity=>e.type==='symbol'&&selection.includes(e.id));
  }else{
    candidates=(entityNameIndex(document.entities).get(normalizedEntityName(ref.name))??[]).filter((e):e is SymbolEntity=>e.type==='symbol');
    // Unnamed concept references use the same centralized semantic aliases, never fuzzy text matching.
    if(!candidates.length){const kind=processKindForAlias(ref.name);if(kind){const ids=kind==='valve'?VALVE_CHOICES:[PROCESS_CONCEPTS[kind].definition];candidates=document.entities.filter((e):e is SymbolEntity=>e.type==='symbol'&&e.libraryId===PROCESS_LIBRARY&&ids.some(id=>id===e.symbolId));}}
  }
  const key=ref.kind==='current_selection'?'reference:selection':`reference:${normalizedEntityName(ref.name)}`;
  const id=choose(key,ref.kind==='current_selection'?'Выбранный Symbol':`Объект ${ref.name}`,candidates.map(e=>({value:e.id,label:`${e.name} · ${e.id}`})),choices);
  const entity=candidates.find(e=>e.id===id)!;const layer=document.layers.find(l=>l.id===entity.layerId);
  if(!layer||!layer.visible||layer.locked)throw new Error('Опорный Symbol находится на скрытом/заблокированном слое');
  requireSymbol(entity.libraryId,entity.symbolId,entity.libraryVersion);return entity;
}
function endpoint(entity:SymbolEntity,portId:string):ConnectorEndpoint{return {kind:'symbol_port',symbolEntityId:entity.id,portId};}
/** Prefer semantic flow role, then facing direction. Occupied best downstream port blocks, never reverses flow silently. */
function pickPort(document:GeoDocument,entity:SymbolEntity,side:'in'|'out',key:string,choices:ReadonlyMap<string,string>):ConnectorEndpoint {
  const definition=requireSymbol(entity.libraryId,entity.symbolId,entity.libraryVersion),desired=side==='out'?'outlet':'inlet';
  const ports=definition.ports.filter(p=>p.kind==='process'&&(!p.role||p.role==='bidirectional'||p.role===desired));
  const ranked=ports.map(p=>({p,score:(p.role===desired?10:0)+(side==='out'?1:-1)*Math.cos(symbolLocalPortToWorld(entity,p,definition).directionDeg*Math.PI/180)}));
  const max=Math.max(...ranked.map(p=>p.score)),best=ranked.filter(p=>Math.abs(p.score-max)<1e-7);
  const portId=choose(key,`${entity.name}: ${side==='out'?'выход':'вход'}`,best.map(({p})=>({value:p.id,label:`${p.label??p.id} · ${p.role??p.kind}`})),choices);
  const target=endpoint(entity,portId),error=portTargetError(document,target);if(error)throw new Error(`${entity.name}: ${error}`);return target;
}
function nextPosition(previous:SymbolEntity,next:SymbolEntity):{x:number;y:number}{const a=symbolWorldBounds(previous),b=symbolWorldBounds(next);return {x:a.maxX+PROCESS_LAYOUT_POLICY.symbolGap-b.minX+next.position.x,y:previous.position.y};}
function localDocument(base:GeoDocument,symbols:SymbolEntity[],connectors:ConnectorEntity[],removed:string[]):GeoDocument{return {...base,entities:[...base.entities.filter(e=>!removed.includes(e.id)),...symbols,...connectors]};}
export function processUsesSelection(plan:ProcessPlan){return plan.actions.some(a=>a.type==='append_process_symbols'?a.reference.kind==='current_selection':a.type==='insert_symbol_between'&&(a.from.kind==='current_selection'||a.to.kind==='current_selection'));}
export function processPlanStale(plan:ProcessPlan,editor:{document:GeoDocument;selectedEntityIds:readonly string[]}){return plan.basedOnDocument!==editor.document||(processUsesSelection(plan)&&(plan.selectionIds.length!==editor.selectedEntityIds.length||plan.selectionIds.some((id,i)=>id!==editor.selectedEntityIds[i])));}
export function resolveProcessPlan(actions:ProcessAction[],document:GeoDocument,options:{id:string;text:string;targetLayerId:string;origin:{x:number;y:number};selectionIds?:readonly string[];choices?:ReadonlyMap<string,string>}):ProcessPlan {
  const plan:ProcessPlan={...options,actions,basedOnDocument:document,origin:{...options.origin},selectionIds:[...options.selectionIds??[]],choices:new Map(options.choices),status:'invalid',message:null,issues:[],commands:[],symbols:[],connectors:[],removedConnectorIds:[],projectedDocument:null};
  try {
    plan.actions=actions.map(a=>processActionSchema.parse(a));validateProcessActions(plan.actions);
    const layer=document.layers.find(l=>l.id===plan.targetLayerId);if(!layer||layer.locked||!layer.visible)throw new Error('Выберите доступный видимый слой');
    if(!Number.isFinite(plan.origin.x)||!Number.isFinite(plan.origin.y))throw new Error('Неверный viewport origin');
    const names=new Set(document.entities.map(e=>normalizeProcessName(e.name)));let projected=document;
    for(const [index,a]of plan.actions.entries()){
      const items=a.type==='insert_symbol_between'?[a.item]:a.items;
      const fresh=items.map(item=>{const definition=resolveDefinition(item,`definition:${index}:${item.ref}`,plan.choices);
        const name=item.name??processTag(PROCESS_CONCEPTS[item.symbolKind].prefix,names);if(item.name){if(names.has(normalizeProcessName(name)))throw new Error(`Имя ${name} уже занято`);names.add(normalizeProcessName(name));}
        return {id:`${plan.id}:process:${index}:${item.ref}`,type:'symbol' as const,name,layerId:plan.targetLayerId,libraryId:PROCESS_LIBRARY,libraryVersion:getLibrary(PROCESS_LIBRARY)!.version,symbolId:definition.id,position:{x:0,y:0},rotationDeg:0,scale:1};});
      let anchor:SymbolEntity|undefined,previous:SymbolEntity|null=null,old:ConnectorEntity|undefined,from:SymbolEntity|undefined,to:SymbolEntity|undefined;
      if(a.type==='append_process_symbols'){anchor=symbolReference(a.reference,projected,plan.selectionIds,plan.choices);previous=anchor;}
      if(a.type==='insert_symbol_between'){
        from=symbolReference(a.from,projected,plan.selectionIds,plan.choices);to=symbolReference(a.to,projected,plan.selectionIds,plan.choices);
        if(from.id===to.id)throw new Error('Insert требует два разных Symbol');
        const matches=[...connectivityIndex(projected).bySymbol.get(from.id)??[]].map(id=>connectivityIndex(projected).entities.get(id) as ConnectorEntity).filter(e=>(e.start.symbolEntityId===from!.id&&e.end.symbolEntityId===to!.id)||(e.end.symbolEntityId===from!.id&&e.start.symbolEntityId===to!.id));
        const edgeId=choose(`edge:${index}`,'Соединение между опорными Symbol',matches.map(e=>({value:e.id,label:e.name})),plan.choices);old=matches.find(e=>e.id===edgeId)!;
        const edgeLayer=projected.layers.find(l=>l.id===old!.layerId);if(!edgeLayer?.visible||edgeLayer.locked)throw new Error('Слой заменяемого Connector заблокирован/скрыт');
        const start=resolvePort(projected,old.start).world,end=resolvePort(projected,old.end).world;fresh[0]!.position={x:(start.x+end.x)/2,y:(start.y+end.y)/2};
        plan.removedConnectorIds.push(old.id);plan.commands.push({type:'delete-entity',entityId:old.id});
      }else{
        fresh.forEach((e,i)=>{e.position=previous?nextPosition(previous,e):{x:0,y:plan.origin.y+index*PROCESS_LAYOUT_POLICY.rowGap};previous=e;if(i===0&&a.type==='append_process_symbols'){
          const port=pickPort(projected,anchor!,'out',`port:${index}:anchor`,plan.choices),world=resolvePort(projected,port).world;
          // Oriented outlets are placed downstream; new chain remains horizontal.
          const theta=world.directionDeg*Math.PI/180,step=Math.max(symbolWorldBounds(anchor!).maxX-symbolWorldBounds(anchor!).minX,2)+PROCESS_LAYOUT_POLICY.symbolGap;
          e.position={x:anchor!.position.x+step*Math.cos(theta),y:anchor!.position.y+step*Math.sin(theta)};
        }});
        if(a.type==='create_process_chain'){const first=symbolWorldBounds(fresh[0]!),last=symbolWorldBounds(fresh.at(-1)!);const dx=plan.origin.x-(first.minX+last.maxX)/2;fresh.forEach(e=>{e.position.x+=dx;});}
      }
      plan.symbols.push(...fresh);fresh.forEach(entity=>plan.commands.push({type:'add-entity',entity,vertices:[]}));
      projected=localDocument(document,plan.symbols,plan.connectors,plan.removedConnectorIds);
      const pairs:[SymbolEntity,SymbolEntity][] = a.type==='insert_symbol_between'?[[from!,fresh[0]!],[fresh[0]!,to!]]:a.type==='append_process_symbols'?[[anchor!,fresh[0]!],...fresh.slice(1).map((e,i)=>[fresh[i]!,e] as [SymbolEntity,SymbolEntity])]:fresh.slice(1).map((e,i)=>[fresh[i]!,e]);
      for(const [i,[left,right]]of pairs.entries()){
        let start:ConnectorEndpoint,end:ConnectorEndpoint;
        if(old&&i===0)start=old.start.symbolEntityId===from!.id?old.start:old.end;else start=pickPort(projected,left,'out',a.type==='append_process_symbols'&&i===0?`port:${index}:anchor`:`port:${index}:${i}:start`,plan.choices);
        if(old&&i===1)end=old.end.symbolEntityId===to!.id?old.end:old.start;else end=pickPort(projected,right,'in',`port:${index}:${i}:end`,plan.choices);
        const error=portTargetError(projected,end,start);if(error)throw new Error(error);
        const connection:ConnectorEntity={id:`${plan.id}:process:${index}:connection:${i}`,name:`${left.name} → ${right.name}`,type:'connector',layerId:old?.layerId??plan.targetLayerId,start,end,routing:old?.routing??PROCESS_LAYOUT_POLICY.routing,...(old?.styleId?{styleId:old.styleId}:{})};
        plan.connectors.push(connection);plan.commands.push({type:'add-entity',entity:connection,vertices:[]});projected=localDocument(document,plan.symbols,plan.connectors,plan.removedConnectorIds);
      }
    }
    // Canonical preflight owns compatibility/capacity/layer/duplicate checks; no parallel AI policy.
    plan.projectedDocument=applyCommandsAtomically(document,plan.commands);validateConnectivity(plan.projectedDocument);plan.status='ready';
  }catch(e){plan.commands=[];plan.symbols=[];plan.connectors=[];plan.removedConnectorIds=[];plan.projectedDocument=null;plan.status=e instanceof NeedChoice?'unresolved':'invalid';plan.message=(e as Error).message;if(e instanceof NeedChoice)plan.issues=[e.issue];}
  return plan;
}
export function refreshProcessPlan(plan:ProcessPlan,document:GeoDocument,selectionIds=plan.selectionIds){return resolveProcessPlan(plan.actions,document,{...plan,selectionIds});}
export function processDiagnostics(plan:ProcessPlan){return {semanticActions:plan.actions,status:plan.status,message:plan.message,commandCount:plan.commands.length,removedConnectorCount:plan.removedConnectorIds.length,symbols:plan.symbols.map(e=>({name:e.name,libraryId:e.libraryId,version:e.libraryVersion,definition:e.symbolId,position:e.position})),connections:plan.connectors.map(e=>({from:e.start,to:e.end,routing:e.routing,layerId:e.layerId,roles:[resolvePort(plan.projectedDocument!,e.start).port.role,resolvePort(plan.projectedDocument!,e.end).port.role]}))};}
