import type { GeoDocument, Layer } from '../domain/model';
import { applyCommandsAtomically, type DocumentCommand } from '../domain/commands';
import { editorReducer, type EditorState } from '../store/editor';
import type { ViewSize } from '../geometry';
import { normalizeQuery } from './aliases';
import { defaultExcludedGroups, resolveDocumentQuery, selectionFingerprint, type ResolvedEntitySet } from './query';
import { documentActionSchema, type DocumentAction } from './schema';
export interface ResolvedDocumentAction {intent:DocumentAction;result:ResolvedEntitySet|null;excludedGroups:Set<string>;layerNames:string[];blocked:string[];blockedCount:number}
export interface DocumentOperationsPlan {id:string;text:string;basedOnDocument:GeoDocument;selectionIds:readonly string[];actions:ResolvedDocumentAction[];commands:DocumentCommand[];error:string|null;matchedEntityIds:string[]}
export const isDocumentPlanStale=(plan:DocumentOperationsPlan,editor:EditorState)=>plan.basedOnDocument!==editor.document||plan.actions.some(a=>a.result?.selectionFingerprint!==null&&a.result?.selectionFingerprint!==undefined&&a.result.selectionFingerprint!==selectionFingerprint(editor.selectedEntityIds));
/** Resolve and preflight entirely locally. No commands or result IDs cross the provider boundary. */
export function resolveDocumentPlan(actions:readonly DocumentAction[],document:GeoDocument,selectionIds:readonly string[],id:string,text:string,choices?:ReadonlyMap<number,ReadonlySet<string>>):DocumentOperationsPlan {
  const plan:DocumentOperationsPlan={id,text,basedOnDocument:document,selectionIds:[...selectionIds],actions:[],commands:[],error:null,matchedEntityIds:[]};
  if(!actions.length||actions.length>8||actions.some(a=>!documentActionSchema.safeParse(a).success)){plan.error='Неверный набор операций';return plan;}
  let layers=[...document.layers];const created=new Map<number,Layer>();
  for(const [ordinal,intent] of actions.entries()) {
    let result='query'in intent?resolveDocumentQuery(intent.query,document,selectionIds):null;
    const excludedGroups=new Set(choices?.get(ordinal)??(result?defaultExcludedGroups(result):[]));
    if(result)result=resolveDocumentQuery(result.query,document,selectionIds,excludedGroups);
    const action:ResolvedDocumentAction={intent,result,excludedGroups,layerNames:[],blocked:[],blockedCount:0};plan.actions.push(action);
    if(result?.error)action.blocked.push(result.error);
    if(result&&!result.entityIds.length)action.blocked.push('Нет включённых объектов. Уточните запрос или включите группу.');
    if(intent.type==='create_layer') {
      if(layers.some(l=>normalizeQuery(l.name)===normalizeQuery(intent.name)))action.blocked.push(`Слой «${intent.name}» уже существует; используйте перенос в существующий слой.`);
      else {const layer:Layer={id:`doc-${id}-layer-${ordinal}`,name:intent.name,visible:true,locked:false,order:Math.max(-1,...layers.map(l=>l.order))+1,styleId:document.layers[0]!.styleId};created.set(ordinal,layer);layers=[...layers,layer];action.layerNames=[layer.name];plan.commands.push({type:'create-layer',layer});}
    }
    if(intent.type==='move_entities_to_layer'&&result) {
      const candidates=intent.target.kind==='existing_layer'?layers.filter(l=>normalizeQuery(l.name)===normalizeQuery(intent.target.kind==='existing_layer'?intent.target.name:'')):[created.get(intent.target.actionIndex)].filter((l):l is Layer=>!!l);
      if(candidates.length!==1)action.blocked.push('Целевой слой отсутствует или его имя неоднозначно.');
      const target=candidates[0];if(target){action.layerNames=[target.name];if(target.locked)action.blocked.push(`Целевой слой «${target.name}» заблокирован.`);}
      const ids=new Set(result.entityIds),owners=document.entities.filter(e=>ids.has(e.id));
      action.blockedCount=owners.filter(e=>document.layers.find(l=>l.id===e.layerId)?.locked!==false).length;
      if(action.blockedCount)action.blocked.push(`${action.blockedCount} объектов на заблокированных исходных слоях.`);
      if(target&&!action.blocked.length)plan.commands.push({type:'set-entities-layer',entityIds:result.entityIds,layerId:target.id});
    }
    if(intent.type==='set_layer_visibility'&&result) {
      // Hide/show whole layers only when the result owns the whole layer; no silent collateral changes.
      const ids=new Set(result.entityIds),affected=new Set(document.entities.filter(e=>ids.has(e.id)).map(e=>e.layerId));
      if(intent.query.kind==='geoservice_layer')for(const l of document.layers)if(normalizeQuery(l.name)===normalizeQuery(intent.query.name))affected.add(l.id);
      for(const layer of document.layers.filter(l=>affected.has(l.id))) {
        action.layerNames.push(layer.name);
        const unrelated=document.entities.filter(e=>e.layerId===layer.id&&!ids.has(e.id));
        if(unrelated.length)action.blocked.push(`Слой «${layer.name}» содержит ещё ${unrelated.length} объектов вне результата. Используйте изоляцию или точный запрос слоя.`);
        else plan.commands.push({type:'set-layer-visibility',layerId:layer.id,visible:intent.visible});
      }
    }
    if(action.blocked.length&&plan.error===null)plan.error=action.blocked.join(' ');
  }
  if(!plan.error&&plan.commands.length)try{applyCommandsAtomically(document,plan.commands);}catch(error){plan.error=error instanceof Error?error.message:'Ошибка проверки команд';}
  if(plan.error)plan.commands=[];
  plan.matchedEntityIds=[...new Set(plan.actions.flatMap(a=>a.result?.entityIds??[]))];return plan;
}
export function applyDocumentPlan(plan:DocumentOperationsPlan,editor:EditorState,size:ViewSize):EditorState {
  if(editor.transactionBefore)return {...editor,error:'Завершите текущее редактирование.'};
  if(isDocumentPlanStale(plan,editor))return {...editor,error:'Документ или выделение изменились. Обновите preview.'};
  if(plan.error)return {...editor,error:plan.error};
  // Revalidate the task/choices at the execution boundary; do not trust externally mutated plan arrays.
  const checked=resolveDocumentPlan(plan.actions.map(a=>a.intent),editor.document,editor.selectedEntityIds,plan.id,plan.text,new Map(plan.actions.map((a,i)=>[i,a.excludedGroups])));
  if(checked.error)return {...editor,error:checked.error};
  let next=checked.commands.length?editorReducer({...editor,deepSelection:null,hitStackStatus:null},{type:'execute-batch',commands:checked.commands,expectedDocument:editor.document}):{...editor,error:null};
  if(next.error)return next;
  for(const action of checked.actions)if(action.result) {
    const entityIds=action.result.entityIds;
    if(action.intent.type==='select_entities')next=editorReducer(next,{type:'select-entities',entityIds});
    if(action.intent.type==='fit_result'||action.intent.type==='find_entities')next=editorReducer(next,{type:'fit-entities',entityIds,size});
    if(action.intent.type==='isolate_result'){next=editorReducer(next,{type:'isolate-entities',entityIds,label:action.result.querySummary});next=editorReducer(next,{type:'fit-entities',entityIds,size});}
  }
  return next;
}
