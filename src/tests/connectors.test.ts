import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { connector, connectorDocument, endpoint, symbol, connectorBenchmarkDocument } from './fixtures/connectorDocument';
import { compatiblePorts, connectivityIndex, connectorRoute, portCapacity, portKey, portTargetError, resolvePort, validateConnectivity } from '../connectors/model';
import { applyCommand, applyCommandsAtomically } from '../domain/commands';
import { validateDocument } from '../persistence/documentSchema';
import { deserializeDocument, serializeDocument } from '../persistence/serialization';
import { createAutosaveStore } from '../persistence/autosave';
import { editorReducer, initialEditorState, isDocumentDirty } from '../store/editor';
import { getLibrary, registerSymbolLibrary } from '../symbols/registry';
import { gasProcessDemo } from '../symbols/gasProcessDemo';
import { renderItems } from '../renderer/selectors';
import { hitOwners } from '../editor/deepSelection';
import { marqueeEntities } from '../editor/marquee';
import { worldToScreen } from '../geometry';
import { hitSymbolPort } from '../connectors/ports';
import { canvasEntity, composeScene } from '../renderer/hybridScene';
import type { ConnectorEntity } from '../domain/model';

const view={center:{x:8,y:0},pixelsPerUnit:20},size={width:900,height:600};
const add=(d=connectorDocument(false),e=connector())=>applyCommand(d,{type:'add-entity',entity:e,vertices:[]});
const retarget=(d=connectorDocument(),endpointName:'start'|'end'='end',target=endpoint('regulator','in'))=>applyCommand(d,{type:'retarget-connector',entityId:'connection',endpoint:endpointName,target});
describe('canonical connector topology and validation',()=>{
  it('creates owned refs without vertices or derived endpoint coordinates',()=>{
    const d=connectorDocument(false),payload=connector(),after=add(d,payload);payload.end.symbolEntityId='missing';
    expect(after.entities.at(-1)).toEqual(connector());expect(after.vertices).toBe(d.vertices);expect(validateDocument(after)).toEqual(after);
    expect(Object.keys(after.entities.at(-1)!)).not.toContain('position');
  });
  it.each(['missing-symbol','wrong-entity-type','missing-port','missing-definition','missing-layer','free-endpoint'])('Open rejects %s safely',kind=>{
    const d=connectorDocument();const e=d.entities.at(-1)! as ConnectorEntity;
    if(kind==='missing-symbol')e.end.symbolEntityId='missing';
    if(kind==='wrong-entity-type'){d.vertices.p={id:'p',x:1,y:1};d.entities.push({id:'p',type:'point',name:'p',layerId:'buildings',vertexId:'p'});e.end.symbolEntityId='p';}
    if(kind==='missing-port')e.end.portId='missing';
    if(kind==='missing-definition')(d.entities[0] as never as {symbolId:string}).symbolId='missing';
    if(kind==='missing-layer')e.layerId='missing';
    if(kind==='free-endpoint')e.start={kind:'free',x:1,y:1} as never;
    expect(()=>deserializeDocument(JSON.stringify(d))).toThrow();
    const base=initialEditorState(connectorDocument(false)),after=editorReducer(base,{type:'replace-document',document:d,size});expect(after.document).toBe(base.document);expect(after.error).not.toBeNull();
  });
  it('rejects own port, incompatible kinds, duplicate/reversed connection and occupied first endpoint',()=>{
    const d=connectorDocument();
    for(const e of [connector('self',endpoint('regulator','in'),endpoint('regulator','in')),connector('mixed',endpoint('regulator','out'),endpoint('instrument','sense')),connector('dupe'),connector('reverse',endpoint('filter','in'),endpoint('valve','out'))])expect(()=>add(d,e)).toThrow();
    expect(portTargetError(d,endpoint('valve','out'))).toBe('Порт уже подключён.');
  });
  it('instrument ↔ instrument allowed; process does not imply flow direction',()=>{
    const d=connectorDocument(false),a=resolvePort(d,endpoint('valve','in')).port,b=resolvePort(d,endpoint('filter','in')).port;
    expect(compatiblePorts(a,b)).toBe(true);expect(add(d,connector('sense',endpoint('instrument','sense'),endpoint('instrument2','sense'))).entities.at(-1)).toMatchObject({type:'connector'});
  });
  it('default one, explicit maxConnections two and strict capacity on Open',()=>{
    const raw=structuredClone(gasProcessDemo);raw.id='connector-capacity';raw.symbols.forEach(s=>s.ports.forEach(p=>p.maxConnections=2));registerSymbolLibrary(raw);
    let d=connectorDocument(false);d.entities=d.entities.map(e=>e.type==='symbol'?{...e,libraryId:raw.id}:e);
    expect(portCapacity(resolvePort(connectorDocument(false),endpoint('valve','out')).port)).toBe(1);
    d=add(d,connector());d=add(d,connector('second',endpoint('valve','out'),endpoint('regulator','in')));expect(()=>validateDocument(d)).not.toThrow();
    d.entities.push(symbol('third','filter',24));expect(()=>add(d,connector('third-link',endpoint('valve','out'),endpoint('third','in')))).toThrow(/уже подключён/);
    expect(getLibrary(raw.id)!.symbols[0]!.ports[0]!.maxConnections).toBe(2);
  });
  it('whole batch rejects occupied ports without publishing its prefix',()=>{
    const d=connectorDocument(false),base=initialEditorState(d);const after=editorReducer(base,{type:'execute-batch',commands:[{type:'add-entity',entity:connector(),vertices:[]},{type:'add-entity',entity:connector('second',endpoint('valve','out'),endpoint('regulator','in')),vertices:[]}]});
    expect(after.document).toBe(d);expect(after.past).toHaveLength(0);expect(after.error).toContain('уже подключён');
  });
  it('derived index cached per snapshot: symbol, port, connector; updates after retarget',()=>{
    const d=connectorDocument(),index=connectivityIndex(d);expect(connectivityIndex(d)).toBe(index);expect(index.bySymbol.get('valve')).toEqual(['connection']);expect(index.byPort.get(portKey(endpoint('valve','out')))).toEqual(['connection']);expect(index.byConnector.get('connection')).toEqual({start:endpoint('valve','out'),end:endpoint('filter','in')});
    const next=retarget(d);expect(connectivityIndex(next).bySymbol.get('filter')).toBeUndefined();expect(connectivityIndex(next).bySymbol.get('regulator')).toEqual(['connection']);expect(index.bySymbol.get('filter')).toEqual(['connection']);
  });
});
describe('port transforms, associativity and routing',()=>{
  it.each([{rotationDeg:0,scale:1,x:1,y:0,direction:0},{rotationDeg:90,scale:1,x:0,y:1,direction:90},{rotationDeg:270,scale:2,x:0,y:-2,direction:270},{rotationDeg:45,scale:2,x:Math.SQRT2,y:Math.SQRT2,direction:45}])('derived transform $rotationDeg / $scale',({rotationDeg,scale,x,y,direction})=>{
    const d=applyCommand(connectorDocument(),{type:'update-entity',entityId:'valve',patch:{rotationDeg,scale}}),world=resolvePort(d,endpoint('valve','out')).world;
    expect(world.x).toBeCloseTo(x);expect(world.y).toBeCloseTo(y);expect(world.directionDeg).toBe(direction);const route=connectorRoute(d,connector());expect(route[0]!.x).toBeCloseTo(x);expect(route[0]!.y).toBeCloseTo(y);
  });
  it('move symbol updates route and keeps connector identity / topology / vertices',()=>{
    const d=connectorDocument(),e=d.entities.at(-1)!,after=applyCommand(d,{type:'move-entities',entityIds:['filter'],delta:{x:3,y:5}});
    expect(after.entities.at(-1)).toBe(e);expect(connectorRoute(after,e as ConnectorEntity).at(-1)).toEqual({x:10,y:5});expect(after.vertices).toBe(d.vertices);
  });
  it('group move including connector translates endpoints once and keeps full route topology',()=>{
    const d=connectorDocument(),before=connectorRoute(d,connector()),after=applyCommand(d,{type:'move-entities',entityIds:['valve','filter','connection'],delta:{x:5,y:2}});
    expect(connectorRoute(after,connector())).toEqual(before.map(p=>({x:p.x+5,y:p.y+2})));expect(after.entities.at(-1)).toBe(d.entities.at(-1));
  });
  it('moving a symbol follows a locked connector without editing it',()=>{
    const d=applyCommand(connectorDocument(),{type:'set-layer-lock',layerId:'annotations',locked:true});expect(()=>applyCommand(d,{type:'move-entities',entityIds:['filter'],delta:{x:1,y:2}})).not.toThrow();
    expect(()=>applyCommand(d,{type:'move-entities',entityIds:['connection'],delta:{x:1,y:2}})).toThrow();
  });
  it('connector alone never translates or moves symbols',()=>expect(()=>applyCommand(connectorDocument(),{type:'move-entities',entityIds:['connection'],delta:{x:1,y:2}})).toThrow(/не перемещает/));
  it('direct route contains exactly current world endpoints; read-only render',()=>{
    const d=connectorDocument(),e={...connector(),routing:'direct' as const};expect(connectorRoute(d,e)).toEqual([{x:1,y:0},{x:7,y:0}]);expect(d.entities.at(-1)).toEqual(connector());
  });
  it.each([0,45,90,180,270])('orthogonal deterministic route uses preferred exit at %s degrees',rotationDeg=>{
    const d=applyCommand(connectorDocument(),{type:'update-entity',entityId:'filter',patch:{rotationDeg}}),e=connector(),route=connectorRoute(d,e);
    expect(connectorRoute(d,e)).toEqual(route);expect(route[1]!.x).toBeGreaterThan(route[0]!.x);
    for(let i=1;i<route.length;i++)expect(route[i]!.x===route[i-1]!.x||route[i]!.y===route[i-1]!.y).toBe(true);
    expect(route.at(-1)).toMatchObject({x:resolvePort(d,e.end).world.x,y:resolvePort(d,e.end).world.y});
  });
  it('optional MODEL waypoints persist and routing passes through them',()=>{
    const d=connectorDocument(false),e={...connector(),waypoints:[{x:4,y:3}],styleId:d.styles[0]!.id};const next=add(d,e);
    expect(connectorRoute(next,e)).toContainEqual({x:4,y:3});expect(deserializeDocument(serializeDocument(next)).entities.at(-1)).toEqual(e);
  });
});
describe('history, retarget, lifetime and transient tool',()=>{
  it('create/delete/routing each one history action; Undo/Redo topology',()=>{
    let s=editorReducer(initialEditorState(connectorDocument(false)),{type:'execute',command:{type:'add-entity',entity:connector(),vertices:[]}});expect(s.past).toHaveLength(1);const created=s.document;
    s=editorReducer(s,{type:'execute',command:{type:'set-connector-routing',entityId:'connection',routing:'direct'}});expect(s.past).toHaveLength(2);
    s=editorReducer(s,{type:'undo'});expect(s.document).toBe(created);s=editorReducer(s,{type:'redo'});expect(s.document.entities.at(-1)).toMatchObject({routing:'direct'});
    s=editorReducer(s,{type:'execute',command:{type:'delete-entity',entityId:'connection'}});expect(s.past).toHaveLength(3);expect(s.document.entities.filter(e=>e.type==='symbol')).toHaveLength(5);
  });
  it.each(['start','end'] as const)('retarget %s one history entry, symbols unchanged, undo/redo',endpointName=>{
    const d=connectorDocument(),base=initialEditorState(d);let s=editorReducer(base,{type:'begin-connector-retarget',entityId:'connection',endpoint:endpointName});expect(s.document).toBe(d);expect(s.transactionBefore).toBe(d);
    s=editorReducer(s,{type:'preview-connector-port',target:endpoint('regulator','in')});expect(s.document).toBe(d);expect(isDocumentDirty(s)).toBe(false);
    s=editorReducer(s,{type:'finish-connector-retarget',target:endpoint('regulator','in')});expect(s.past).toHaveLength(1);expect(s.document.entities.at(-1)).toMatchObject({[endpointName]:endpoint('regulator','in')});expect(s.document.entities.slice(0,-1)).toEqual(d.entities.slice(0,-1));const after=s.document;
    s=editorReducer(s,{type:'undo'});expect(s.document).toBe(d);expect(editorReducer(s,{type:'redo'}).document).toBe(after);
  });
  it.each(['escape','invalid','no-op','undo'])('retarget %s preserves document/history',kind=>{
    const d=connectorDocument();let s=editorReducer(initialEditorState(d),{type:'begin-connector-retarget',entityId:'connection',endpoint:'end'});
    s=kind==='escape'?editorReducer(s,{type:'cancel-transaction'}):kind==='undo'?editorReducer(s,{type:'undo'}):editorReducer(s,{type:'finish-connector-retarget',target:kind==='no-op'?endpoint('filter','in'):endpoint('instrument','sense')});
    expect(s.document).toBe(d);expect(s.past).toHaveLength(0);expect(s.connectorInteraction).toBeNull();expect(s.transactionBefore).toBeNull();
  });
  it('first port is transient; Escape cancels; second click creates one orthogonal connection',()=>{
    const d=connectorDocument(false);let s=editorReducer(initialEditorState(d),{type:'tool',tool:'connector'});s=editorReducer(s,{type:'pick-connector-port',target:endpoint('valve','out')});expect(s.document).toBe(d);expect(isDocumentDirty(s)).toBe(false);
    const cancelled=editorReducer(s,{type:'tool',tool:'select'});expect(cancelled.document).toBe(d);expect(cancelled.connectorInteraction).toBeNull();expect(cancelled.past).toHaveLength(0);
    const invalid=editorReducer(s,{type:'pick-connector-port',target:endpoint('instrument','sense')});expect(invalid.document).toBe(d);expect(invalid.connectorInteraction).not.toBeNull();
    s=editorReducer(s,{type:'pick-connector-port',target:endpoint('filter','in')});expect(s.error).toBeNull();expect(s.document.entities.at(-1)).toMatchObject({type:'connector',routing:'orthogonal'});expect(s.past).toHaveLength(1);expect(s.transactionBefore).toBeNull();
  });
  it('symbol deletion blocked with connection count; connector removal frees symbol/port',()=>{
    const d=connectorDocument();expect(()=>applyCommand(d,{type:'delete-entity',entityId:'valve'})).toThrow(/Символ имеет 1 подключения/);
    const after=applyCommandsAtomically(d,[{type:'delete-entity',entityId:'connection'},{type:'delete-entity',entityId:'valve'}]);expect(after.entities.some(e=>e.id==='connection'||e.id==='valve')).toBe(false);expect(after.entities.some(e=>e.id==='filter')).toBe(true);
    expect(()=>applyCommand(d,{type:'delete-layer',layerId:'buildings'})).toThrow(/Слой содержит/);
  });
  it('routing and endpoint updates blocked on locked layer, no-op routing no history',()=>{
    const d=applyCommand(connectorDocument(),{type:'set-layer-lock',layerId:'annotations',locked:true});expect(()=>retarget(d)).toThrow(/заблокирован/);expect(()=>applyCommand(d,{type:'delete-entity',entityId:'connection'})).toThrow(/заблокирован/);expect(()=>applyCommand(d,{type:'set-connector-routing',entityId:'connection',routing:'direct'})).toThrow(/заблокирован/);
    const s=editorReducer(initialEditorState(connectorDocument()),{type:'execute',command:{type:'set-connector-routing',entityId:'connection',routing:'orthogonal'}});expect(s.past).toHaveLength(0);
  });
  it.each(['hidden','locked'])('current %s layer prevents tool creation',kind=>{
    const d=connectorDocument(false);d.layers.find(l=>l.id==='boundary')![kind==='hidden'?'visible':'locked']=kind!=='hidden';
    let s=editorReducer(initialEditorState(d),{type:'tool',tool:'connector'});s={...s,currentLayerId:'boundary'};s=editorReducer(s,{type:'pick-connector-port',target:endpoint('valve','out')});expect(s.error).toContain('Текущий слой');expect(s.connectorInteraction).toBeNull();expect(s.document).toBe(d);
  });
});
describe('selection, visibility, persistence and coexistence',()=>{
  it('own layer and both Symbol layers must be visible; hidden selection is reconciled',()=>{
    for(const layerId of ['annotations','buildings']){const d=connectorDocument();const base=editorReducer(initialEditorState(d),{type:'select',entityId:'connection'}),s=editorReducer(base,{type:'execute',command:{type:'set-layer-visibility',layerId,visible:false}});expect(renderItems(s.document).some(i=>i.entity.type==='connector')).toBe(false);expect(s.selectedEntityIds).not.toContain('connection');}
    const d=connectorDocument();d.entities[0]!.visible=false;expect(renderItems(d).some(i=>i.entity.type==='connector')).toBe(false);
  });
  it.each([10,100])('port hit area remains screen based at %s px/m and excludes hidden symbols',pixelsPerUnit=>{
    const d=connectorDocument(),v={...view,pixelsPerUnit},p=worldToScreen(resolvePort(d,endpoint('filter','in')).world,v,size);
    expect(hitSymbolPort(d,{x:p.x+6,y:p.y},v,size)).toEqual(endpoint('filter','in'));expect(hitSymbolPort(d,{x:p.x+8,y:p.y},v,size)).toBeNull();
    const hidden=applyCommand(d,{type:'set-layer-visibility',layerId:'buildings',visible:false});expect(hitSymbolPort(hidden,p,v,size)).toBeNull();
  });
  it('line stroke hit rejects empty route bounds; Shift selection and WINDOW/CROSSING',()=>{
    const d=applyCommand(connectorDocument(),{type:'move-entities',entityIds:['filter'],delta:{x:0,y:4}});
    expect(hitOwners(d,{x:4,y:2},.35,20)).toContain('connection');expect(hitOwners(d,{x:2,y:3},.35,20)).not.toContain('connection');
    const box=(x:number,y:number,X:number,Y:number)=>marqueeEntities(d,view,size,worldToScreen({x,y},view,size),worldToScreen({x:X,y:Y},view,size));
    expect(box(.5,5,7.5,-1)).toContain('connection');expect(box(3,3,5,1)).not.toContain('connection');expect(box(5,3,3,1)).toContain('connection');
    let s=editorReducer(initialEditorState(d),{type:'select',entityId:'connection'});s=editorReducer(s,{type:'select',entityId:'valve',toggle:true});expect(s.selectedEntityIds).toEqual(['connection','valve']);
  });
  it('Save/Open canonical refs and IndexedDB retain network semantics',async()=>{
    const d=connectorDocument(),store=createAutosaveStore({indexedDB:new IDBFactory()});expect(deserializeDocument(serializeDocument(d))).toEqual(d);await store.saveAutosave(d,true);expect((await store.loadAutosave())!.document).toEqual(d);
  });
  it('100 symbols / 150 connectors validates all capacities; native SVG remains separate from DXF',()=>{
    const d=connectorBenchmarkDocument();expect(()=>validateDocument(d)).not.toThrow();validateConnectivity(d);expect(connectivityIndex(d).byConnector.size).toBe(150);expect(canvasEntity(connector())).toBe(false);expect(composeScene(renderItems(d),'canvas').strata.map(s=>s.kind)).toEqual(['svg']);
  });
  it('gas demo 18 definitions retain useful process ports and instrument separation',()=>{
    const library=getLibrary('gas-process-demo')!;expect(library.symbols).toHaveLength(18);
    for(const id of ['shutoff-valve','pressure-regulator','filter','gas-meter','safety-valve','reducer','equipment-block'])expect(library.symbols.find(s=>s.id===id)!.ports.map(p=>p.kind)).toEqual(['process','process']);
  });
});
describe('boundary regression guards',()=>{
  it('Open rejects overloaded network rather than relocating or dropping an endpoint',()=>{
    const d=connectorDocument();d.entities.push(connector('second',endpoint('valve','out'),endpoint('regulator','in')));expect(()=>validateDocument(d)).toThrow(/уже подключён/);
  });
  it('Symbol rotation history contains only the Symbol command; connector refs unchanged',()=>{
    const d=connectorDocument();let s=editorReducer(initialEditorState(d),{type:'execute',command:{type:'update-entity',entityId:'filter',patch:{rotationDeg:90}}});const rotated=connectorRoute(s.document,connector());expect(s.past).toHaveLength(1);expect(s.document.entities.at(-1)).toBe(d.entities.at(-1));s=editorReducer(s,{type:'undo'});expect(connectorRoute(s.document,connector())).not.toEqual(rotated);expect(editorReducer(s,{type:'redo'}).past).toHaveLength(1);
  });
  it('endpoint symbols on independent layers must both be visible, while locked endpoints may be referenced',()=>{
    let d=connectorDocument(false);d.entities[0]!.layerId='boundary';d=applyCommand(d,{type:'set-layer-lock',layerId:'boundary',locked:true});d=add(d);expect(renderItems(d).some(i=>i.entity.type==='connector')).toBe(true);
    for(const layerId of ['boundary','buildings','annotations']){const hidden=applyCommand(d,{type:'set-layer-visibility',layerId,visible:false});expect(renderItems(hidden).some(i=>i.entity.type==='connector')).toBe(false);}
  });
  it('malformed routing/waypoints/capacity payloads fail at strict boundaries',()=>{
    const d=connectorDocument(false);expect(()=>add(d,{...connector(),routing:'script'} as never)).toThrow();expect(()=>add(d,{...connector(),waypoints:[{x:Infinity,y:0}]})).toThrow();
    const raw=structuredClone(gasProcessDemo);raw.id='invalid-capacity';raw.symbols[0]!.ports[0]!.maxConnections=0;expect(()=>registerSymbolLibrary(raw)).toThrow();
  });
  it('pending connector gesture blocks unrelated changes and replacement clears it safely',()=>{
    const d=connectorDocument(false);let s=editorReducer(initialEditorState(d),{type:'tool',tool:'connector'});s=editorReducer(s,{type:'pick-connector-port',target:endpoint('valve','out')});
    expect(editorReducer(s,{type:'execute',command:{type:'delete-entity',entityId:'valve'}}).document).toBe(d);expect(editorReducer(s,{type:'transient',command:{type:'update-entity',entityId:'valve',patch:{scale:2}}}).document).toBe(d);expect(editorReducer(s,{type:'replace-document',document:d,size}).connectorInteraction).toBeNull();
  });
});
