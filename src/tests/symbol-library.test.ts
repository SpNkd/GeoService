import { describe, expect, it } from 'vitest';
import { getLibrary, getSymbol, listLibraries, registerSymbolLibrary, requireSymbol } from '../symbols/registry';
import { gasProcessDemo } from '../symbols/gasProcessDemo';
import type { SymbolLibrary } from '../symbols/types';
import { symbolLocalToWorld, symbolLocalPortToWorld, symbolWorldBounds } from '../symbols/transforms';
import { symbolDocument, symbolInstance } from './fixtures/symbolDocument';
import { applyCommand } from '../domain/commands';
import { createLabelCommand } from '../domain/geometryIntent';
import { absoluteMoveCommand, selectionModelAnchor } from '../domain/exactMove';
import { editorReducer, initialEditorState } from '../store/editor';
import { resolvedLabelPosition, resolveLabelTemplate } from '../geometry/labels';
import { deserializeDocument, serializeDocument } from '../persistence/serialization';
import { marqueeEntities } from '../editor/marquee';
import { renderItems } from '../renderer/selectors';
import { worldToScreen } from '../geometry';
import { symbolLibrarySchema } from '../symbols/schema';
function custom(id:string):SymbolLibrary {return {...structuredClone(gasProcessDemo),id};}
describe('immutable validated central registry',()=>{
  it('18 demo symbols, four categories, stable IDs, no normative claim',()=>{
    const library=getLibrary('gas-process-demo')!;expect(library.symbols).toHaveLength(18);expect(library.categories).toHaveLength(4);expect(library.description).toContain('не подтверждено');expect(listLibraries()).toContain(library);expect(getSymbol('none','x')).toBeUndefined();
    expect(()=>requireSymbol('missing','unknown')).toThrow(/Неизвестное обозначение/);expect(Object.isFrozen(library.symbols[0]!.geometry)).toBe(true);
  });
  it('owns payload, rejects duplicate library and symbol IDs atomically',()=>{
    const raw=custom('owned-pack');registerSymbolLibrary(raw);raw.symbols[0]!.name='Modified';expect(getSymbol(raw.id,'shutoff-valve')!.name).toBe('Запорный кран');expect(()=>registerSymbolLibrary(raw)).toThrow(/уже/);
    const duplicate=custom('bad-dupe');duplicate.symbols.push(duplicate.symbols[0]!);expect(()=>registerSymbolLibrary(duplicate)).toThrow(/Повторяющийся символ/);expect(getLibrary('bad-dupe')).toBeUndefined();
  });
  it.each(['unsafe-geometry','unsafe-attribute','bad-port','duplicate-port','category','size','rotation'])('rejects %s without registering',kind=>{
    const raw=custom(`bad-${kind}`),s=raw.symbols[0]!;
    if(kind==='unsafe-geometry')s.geometry=[{type:'svg',html:'<script/>'} as never];
    if(kind==='unsafe-attribute')s.geometry=[{type:'circle',center:{x:0,y:0},radius:1,onClick:'evil'} as never];
    if(kind==='bad-port')s.ports[0]!.position.x=Infinity;
    if(kind==='duplicate-port')s.ports.push(s.ports[0]!);
    if(kind==='category')s.category='missing';if(kind==='size')s.defaultSize=0;if(kind==='rotation')s.allowedRotations=[-90];
    expect(()=>registerSymbolLibrary(raw)).toThrow();expect(getLibrary(raw.id)).toBeUndefined();
  });
  it('all five primitive types accepted; raw markup and metadata objects refused',()=>{
    expect(symbolLibrarySchema.parse(gasProcessDemo).symbols).toHaveLength(18);
    const raw=custom('all-primitives');raw.symbols[0]!.geometry=[{type:'line',start:{x:0,y:0},end:{x:1,y:1}},{type:'polyline',points:[{x:0,y:0},{x:1,y:1}]},{type:'polygon',points:[{x:0,y:0},{x:1,y:0},{x:0,y:1}]},{type:'circle',center:{x:0,y:0},radius:1},{type:'rect',position:{x:0,y:0},width:1,height:2}];registerSymbolLibrary(raw);
    raw.symbols[0]!.metadata={nested:{} as never};expect(symbolLibrarySchema.safeParse(raw).success).toBe(false);
  });
});
describe('local → size × scale → rotation → MODEL translation, passive ports',()=>{
  it.each([{r:0,s:1,x:11,y:8},{r:90,s:1,x:10,y:9},{r:45,s:1,x:10+Math.SQRT1_2,y:8+Math.SQRT1_2},{r:0,s:2,x:12,y:8},{r:90,s:2,x:10,y:10}])('transforms $r degrees at scale $s',({r,s,x,y})=>{
    const instance={...symbolInstance(),rotationDeg:r,scale:s},p=symbolLocalToWorld(instance,{x:.5,y:0});expect(p.x).toBeCloseTo(x,12);expect(p.y).toBeCloseTo(y,12);
    const port=symbolLocalPortToWorld(instance,requireSymbol(instance.libraryId,instance.symbolId).ports[1]!);expect(port.x).toBeCloseTo(x,12);expect(port.y).toBeCloseTo(y,12);expect(port.directionDeg).toBe(r);
  });
  it('bounds cover rotated polygons, rects and exact circle extrema',()=>{
    const instance={...symbolInstance(),rotationDeg:90,scale:2};expect(symbolWorldBounds(instance)).toMatchObject({minX:9,maxX:11,minY:6,maxY:10});
    const meter={...symbolInstance('meter','pressure-gauge'),rotationDeg:45};const b=symbolWorldBounds(meter);expect(b.minX).toBeCloseTo(9.3);expect(b.maxX).toBeCloseTo(10.707106781186548);
  });
});
describe('instance operations, history, selection, annotations and persistence',()=>{
  it('insert instance, one Undo/Redo, delete with label atomically',()=>{
    const d=symbolDocument();let state=initialEditorState(d);const entity=symbolInstance('new-valve');state=editorReducer(state,{type:'execute',command:{type:'add-entity',entity,vertices:[]}});
    expect(state.past).toHaveLength(1);expect(state.document.vertices).toBe(d.vertices);const after=state.document;state=editorReducer(state,{type:'undo'});expect(state.document).toBe(d);expect(editorReducer(state,{type:'redo'}).document).toBe(after);
    state=editorReducer(initialEditorState(after),{type:'execute',command:createLabelCommand(after,entity.id,p=>'id-'+p)});expect(resolveLabelTemplate(state.document,state.document.entities.at(-1)! as never)).toBe('new-valve');
    const labeled=state.document;state=editorReducer(state,{type:'execute',command:{type:'delete-entity',entityId:entity.id}});expect(state.document.entities.some(e=>e.id===entity.id||e.type==='label'&&e.targetId===entity.id)).toBe(false);
    expect(editorReducer(state,{type:'undo'}).document).toBe(labeled);
  });
  it('Relative and Absolute change position only, Label follows once, group includes symbol bounds',()=>{
    let d=symbolDocument();d=applyCommand(d,createLabelCommand(d,'valve',p=>'symbol-'+p));const label=d.entities.at(-1)! as Extract<typeof d.entities[number],{type:'label'}>,p=resolvedLabelPosition(d,label)!;
    const after=applyCommand(d,{type:'move-entities',entityIds:['valve',label.id,'house'],delta:{x:5,y:-2}});
    expect(after.entities.find(e=>e.id==='valve')).toEqual({...symbolInstance(),position:{x:15,y:6}});expect(resolvedLabelPosition(after,label)).toEqual({x:p.x+5,y:p.y-2});expect(after.entities.at(-1)).toBe(label);
    const absolute=applyCommand(d,absoluteMoveCommand(d,['valve'],{x:50,y:30},'top-right'));expect(selectionModelAnchor(absolute,['valve'])).toEqual({x:50,y:30});expect(absolute.vertices).toBe(d.vertices);
    const group=applyCommand(d,absoluteMoveCommand(d,['house','valve','filter'],{x:100,y:200},'bottom-left'));expect(selectionModelAnchor(group,['house','valve','filter'],'bottom-left')).toEqual({x:100,y:200});
  });
  it('Label alone moves offset even with locked Symbol target (no vacuous vertex shortcut)',()=>{
    let d=symbolDocument();d=applyCommand(d,createLabelCommand(d,'valve',p=>'offset-'+p));d.layers.find(l=>l.id==='buildings')!.locked=true;
    const label=d.entities.at(-1)! as Extract<typeof d.entities[number],{type:'label'}>;const after=applyCommand(d,{type:'move-entities',entityIds:[label.id],delta:{x:5,y:-2}});
    expect(after.entities.at(-1)).toMatchObject({dx:9,dy:2});expect(after.entities.find(e=>e.id==='valve')).toBe(d.entities.find(e=>e.id==='valve'));
  });
  it.each(['buildings','annotations'])('Symbol move/delete blocked by locked %s including dependent Label',layerId=>{
    let d=symbolDocument();d=applyCommand(d,createLabelCommand(d,'valve',p=>'locked-'+p));d.layers.find(l=>l.id===layerId)!.locked=true;
    expect(()=>applyCommand(d,{type:'move-entities',entityIds:['valve'],delta:{x:1,y:1}})).toThrow(/заблокирован/);expect(()=>applyCommand(d,{type:'delete-entity',entityId:'valve'})).toThrow(/заблокирован/);
  });
  it('hidden/locked current layer blocks insert; hidden Symbol and linked Label absent from render',()=>{
    let d=symbolDocument();d=applyCommand(d,createLabelCommand(d,'valve',p=>'visible-'+p));d.layers.find(l=>l.id==='buildings')!.visible=false;
    expect(()=>applyCommand(d,{type:'add-entity',entity:symbolInstance('new'),vertices:[]})).toThrow(/скрыт/);expect(renderItems(d).some(i=>i.entity.id==='valve'||i.entity.id==='visible-label')).toBe(false);
    d.layers.find(l=>l.id==='buildings')!.locked=true;expect(()=>applyCommand(d,{type:'add-entity',entity:symbolInstance('new'),vertices:[]})).toThrow(/заблокирован/);
  });
  it('click/Shift selection, WINDOW contains and CROSSING intersects MODEL symbol bounds',()=>{
    const d=symbolDocument();let s=editorReducer(initialEditorState(d),{type:'select',entityId:'valve'});s=editorReducer(s,{type:'select',entityId:'filter',toggle:true});expect(s.selectedEntityIds).toEqual(['valve','filter']);
    const viewport={center:{x:15,y:8},pixelsPerUnit:30},size={width:900,height:600};const select=(x:number,y:number,X:number,Y:number)=>marqueeEntities(d,viewport,size,worldToScreen({x,y},viewport,size),worldToScreen({x:X,y:Y},viewport,size));
    expect(select(8,10,17,6).filter(id=>['valve','filter','regulator'].includes(id))).toEqual(['valve','filter']);expect(select(8,9,9.5,7)).not.toContain('valve');expect(select(9.5,9,8,7)).toContain('valve');
  });
  it('rotation normalized, bounded scale, Undo/Redo and transient R cancel',()=>{
    const d=symbolDocument();let s=editorReducer(initialEditorState(d),{type:'execute',command:{type:'update-entity',entityId:'valve',patch:{rotationDeg:-90,scale:2}}});expect(s.document.entities.find(e=>e.id==='valve')).toMatchObject({rotationDeg:270,scale:2});expect(s.past).toHaveLength(1);
    expect(editorReducer(s,{type:'undo'}).document).toBe(d);for(const scale of [0,-1,101,Infinity])expect(()=>applyCommand(d,{type:'update-entity',entityId:'valve',patch:{scale}})).toThrow();
    expect(()=>applyCommand(d,{type:'update-entity',entityId:'house',patch:{rotationDeg:90}})).toThrow(/только/);
    s=editorReducer(initialEditorState(d),{type:'choose-symbol',libraryId:'gas-process-demo',symbolId:'filter'});s=editorReducer(s,{type:'rotate-symbol'});expect(s.symbolPlacement!.rotationDeg).toBe(90);expect(s.document).toBe(d);expect(s.past).toHaveLength(0);expect(editorReducer(s,{type:'tool',tool:'select'}).symbolPlacement).toBeNull();
  });
  it('Save/Open v2 instance only, metadata preserved; unknown definitions semantic error before swap',()=>{
    const d=symbolDocument(),entity=d.entities.find(e=>e.id==='valve')! as ReturnType<typeof symbolInstance>;entity.properties={tag:'К-1',number:2,verified:false,note:null};entity.rotationDeg=45;entity.scale=1.25;
    const text=serializeDocument(d);expect(deserializeDocument(text)).toEqual(d);expect(text).not.toContain('geometry');expect(text).not.toContain('ports');expect(d.schemaVersion).toBe(2);
    for(const patch of [{libraryId:'missing'},{symbolId:'missing'}]){const bad={...d,entities:[{...entity,...patch}]};expect(()=>deserializeDocument(JSON.stringify(bad))).toThrow(/Неизвестное обозначение/);const state=editorReducer(initialEditorState(d),{type:'load-json',text:JSON.stringify(bad),size:{width:900,height:600}});expect(state.document).toBe(d);expect(state.error).toContain('Неизвестное обозначение');expect(state.past).toHaveLength(0);}
  });
});
it('definition allowed rotations govern placement and selected R; invalid Open/edits are rejected',()=>{
  const library=custom('limited-rotations');library.symbols[0]!.allowedRotations=[0,180];registerSymbolLibrary(library);
  const entity={...symbolInstance('restricted'),libraryId:library.id};const d=symbolDocument();d.entities.push(entity);
  let state=editorReducer(initialEditorState(d),{type:'choose-symbol',libraryId:library.id,symbolId:entity.symbolId});state=editorReducer(state,{type:'rotate-symbol'});expect(state.symbolPlacement!.rotationDeg).toBe(180);expect(state.past).toHaveLength(0);
  state=editorReducer(state,{type:'tool',tool:'select'});state=editorReducer(state,{type:'select',entityId:entity.id});state=editorReducer(state,{type:'rotate-symbol'});expect(state.document.entities.at(-1)).toMatchObject({rotationDeg:180});expect(state.past).toHaveLength(1);
  expect(()=>applyCommand(d,{type:'update-entity',entityId:entity.id,patch:{rotationDeg:90}})).toThrow(/не разрешён/);
  expect(()=>deserializeDocument(JSON.stringify({...d,entities:[{...entity,rotationDeg:90}]}))).toThrow(/не разрешён/);
  expect(applyCommand(d,{type:'update-entity',entityId:entity.id,patch:{rotationDeg:360,scale:1}})).toBe(d);
});
