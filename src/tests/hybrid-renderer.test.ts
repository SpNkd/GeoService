import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewDocument } from '../domain/newDocument';
import type { GeoDocument } from '../domain/model';
import type { VectorPrimitive } from '../vectors/types';
import { appendPrimitive, canvasMetrics, canvasTransform, CanvasSceneRenderer } from '../renderer/CanvasSceneRenderer';
import { composeScene, intersects, ownerBounds, viewportBounds } from '../renderer/hybridScene';
import { renderItems } from '../renderer/selectors';
import { createVectorStyleResolver } from '../renderer/vectorStyle';
import { createHitStack, hitOwners, resolveDeepSelection, selectedMoveOwner } from '../editor/deepSelection';
import { blockMatrix, multiply, transformPoint } from '../vectors/geometry';
import { prepareVectorSet, vectorRenderOrigin } from '../renderer/vectorPreparation';
import { worldToScreen } from '../geometry';
import { projectSelectionMove, resolveSelectionMove } from '../domain/selectionMove';
import { BoundsIndex } from '../renderer/BoundsIndex';

function fixture():GeoDocument {
  const d=createNewDocument(),layerId=d.layers[0]!.id,s={layerId,colorMode:'byblock' as const};
  d.layers[0]!.name='0';
  d.blocks=[{id:'child',sourceName:'Child',basePoint:{x:6190000,y:2196000},primitives:[{...s,kind:'path',points:[{x:6190000,y:2196000},{x:6190010,y:2196000}],closed:false},{...s,kind:'text',content:'Газ',position:{x:6190001,y:2196000},height:1,rotationDeg:0}]},
    {id:'parent',sourceName:'Parent',basePoint:{x:2,y:3},primitives:[{...s,kind:'block',blockDefinitionId:'child',position:{x:10,y:20},rotationDeg:35,scaleX:-2,scaleY:3}]}];
  d.entities=[{id:'owner',name:'Owner',layerId,type:'block_instance',blockDefinitionId:'parent',position:{x:6190000,y:2196000},rotationDeg:15,scaleX:1.2,scaleY:.8,source:{kind:'dxf',sourceDocumentId:'source',originalType:'INSERT',originalLayer:'0'}}];
  d.viewport={center:{x:6190000,y:2196000},pixelsPerUnit:3};return d;
}
class FakePath {
  calls:unknown[][]=[];
  moveTo(...p:number[]){this.calls.push(['move',...p]);} lineTo(...p:number[]){this.calls.push(['line',...p]);}
  arc(...p:Parameters<Path2D['arc']>){this.calls.push(['arc',...p]);} closePath(){this.calls.push(['close']);}
  addPath(...p:unknown[]){this.calls.push(['add',...p]);}
}
const size={width:900,height:600};
let frames:Map<number,FrameRequestCallback>,sequence:number;
function harness() {
  const ctx={lineWidth:1,setTransform:vi.fn(),clearRect:vi.fn(),translate:vi.fn(),rotate:vi.fn(),scale:vi.fn(),fillText:vi.fn(),fill:vi.fn(),stroke:vi.fn(),setLineDash:vi.fn()};
  const canvas={width:0,height:0,dataset:{},getContext:()=>ctx} as unknown as HTMLCanvasElement;
  const renderer=new CanvasSceneRenderer(canvas);
  const flush=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(cb=>cb(0));};
  const draw=(d:GeoDocument)=>{renderer.schedule(d,renderItems(d),d.viewport,size,2);flush();};
  return {ctx,canvas,renderer,draw,flush};
}
beforeEach(()=>{frames=new Map();sequence=0;vi.stubGlobal('Path2D',FakePath);vi.stubGlobal('DOMMatrix',class{constructor(public values:number[]) {}});vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{frames.set(++sequence,cb);return sequence;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));});
afterEach(()=>vi.unstubAllGlobals());

describe('hybrid camera and geometry',()=>{
  it('camera transform matches worldToScreen at DPR 1/2/3 and projected coordinates through 100 px/m',()=>{
    for(const dpr of [1,2,3])for(const z of [.1,63,100]){const view={center:{x:6190000,y:2196000},pixelsPerUnit:z},origin={x:6190003,y:2195998},local={x:2,y:4};const actual=transformPoint(local,canvasTransform(view,size,origin,dpr)),expected=worldToScreen({x:origin.x+local.x,y:origin.y+local.y},view,size);expect(actual.x/dpr).toBeCloseTo(expected.x,8);expect(actual.y/dpr).toBeCloseTo(expected.y,8);}
  });
  it('nested INSERT/base-point/negative/nonuniform transforms agree with canonical world geometry',()=>{
    const d=fixture(),e=d.entities[0]!;if(e.type!=='block_instance')throw Error();
    const child=d.blocks![0]!,parent=d.blocks![1]!,nested=parent.primitives[0]!;if(nested.kind!=='block')throw Error();
    const prepared=prepareVectorSet(d,parent.primitives).primitives[0]!;if(prepared.kind!=='block')throw Error();
    const original={x:6190002,y:2196000},localOrigin=prepareVectorSet(d,child.primitives).origin,local={x:original.x-localOrigin.x,y:original.y-localOrigin.y};
    const linear=blockMatrix({...e,position:{x:0,y:0}},{x:0,y:0});
    const screen=transformPoint(local,multiply(canvasTransform(d.viewport,size,vectorRenderOrigin(d,e)),multiply(linear,blockMatrix(prepared,{x:0,y:0}))));
    const world=transformPoint(original,multiply(blockMatrix(e,parent.basePoint),blockMatrix(nested,child.basePoint)));
    expect(screen.x).toBeCloseTo(worldToScreen(world,d.viewport,size).x,7);expect(screen.y).toBeCloseTo(worldToScreen(world,d.viewport,size).y,7);
  });
  it('generates correct CCW arcs/full circles and separate subpaths without joining unrelated lines',()=>{
    const p=new FakePath(),s={layerId:'l',colorMode:'byblock' as const};appendPrimitive(p,{...s,kind:'arc',center:{x:2,y:3},radius:4,startAngle:Math.PI*1.5,endAngle:0});appendPrimitive(p,{...s,kind:'circle',center:{x:0,y:0},radius:2});appendPrimitive(p,{...s,kind:'path',points:[{x:1,y:1},{x:3,y:1}],closed:true});
    expect(p.calls[1]).toEqual(['arc',2,3,4,Math.PI*1.5,Math.PI*2]);expect(p.calls[3]).toEqual(['arc',0,0,2,0,Math.PI*2]);expect(p.calls.at(-1)).toEqual(['close']);expect(p.calls.filter(c=>c[0]==='move')).toHaveLength(3);
  });
  it('recomputes viewport bounds across pan/zoom and culls using independent world owner bounds',()=>{const d=fixture(),box=ownerBounds(d,d.entities[0]!)!;expect(ownerBounds(d,d.entities[0]!)).toBe(box);expect(intersects(box,viewportBounds(d.viewport,size))).toBe(true);expect(intersects(box,viewportBounds({center:{x:0,y:0},pixelsPerUnit:63},size))).toBe(false);const h=harness();h.draw({...d,viewport:{center:{x:0,y:0},pixelsPerUnit:63}});expect(h.ctx.stroke).not.toHaveBeenCalled();});
  it('preserves world text orientation under SVG-equivalent Y inversion',()=>{const d=fixture();d.blocks=[d.blocks![0]!];d.entities=[{...d.entities[0]!,type:'block_instance',blockDefinitionId:'child',position:{x:6190000,y:2196000},rotationDeg:0,scaleX:1,scaleY:1}];const h=harness();h.draw(d);expect(h.ctx.fillText).toHaveBeenCalledWith('Газ',0,0);expect(h.ctx.scale).toHaveBeenCalledWith(1,-1);expect(h.ctx.rotate).toHaveBeenCalledWith(0);});
});
describe('layer composition and shared paint',()=>{
  it('shares explicit/BYLAYER/BYBLOCK inheritance, visibility, dash and screen lineweight rules',()=>{const d=fixture(),resolve=createVectorStyleResolver(d),parent={stroke:'#123456',lineWeight:3,dash:'5 2'},s={layerId:d.layers[0]!.id};expect(resolve({...s,colorMode:'bylayer'},parent)).toMatchObject({...parent,visible:true});expect(resolve({...s,colorMode:'explicit',stroke:'#ff0000',lineWeight:2,dash:'1 3'},parent)).toMatchObject({stroke:'#ff0000',lineWeight:2,dash:'1 3',visible:true});const other={...d.layers[0]!,id:'other',name:'Other',visible:false};d.layers=[other];const r=createVectorStyleResolver(d);expect(r({...s,layerId:'other',colorMode:'bylayer'},parent).visible).toBe(false);expect(r({...s,layerId:'other',colorMode:'byblock'},parent,true)).toMatchObject({...parent,visible:true});});
  it('keeps exact mixed layer/entity order with bounded Canvas strata and deterministic SVG fallback',()=>{const d=fixture(),base=d.entities[0]!;d.entities=[base,{...base,id:'native',source:undefined} as unknown as typeof base,{...base,id:'next'}];const items=renderItems(d),scene=composeScene(items,'canvas');expect(scene.strata.map(s=>s.kind)).toEqual(['canvas','svg','canvas']);expect(scene.strata.flatMap(s=>s.items.map(i=>i.entity.id))).toEqual(items.map(i=>i.entity.id));d.entities=Array.from({length:18},(_,i)=>i%2?{...base,id:String(i),source:undefined} as unknown as typeof base:{...base,id:String(i)});expect(composeScene(renderItems(d),'canvas')).toMatchObject({fallback:true,strata:[{kind:'svg'}]});});
  it('filters hidden owners and honors layer order before renderer partition',()=>{const d=fixture(),l=d.layers[0]!;d.layers=[{...l,id:'upper',name:'Upper',order:9},l];d.entities=[{...d.entities[0]!,id:'upper',layerId:'upper'},d.entities[0]!];expect(renderItems(d).map(i=>i.entity.id)).toEqual(['owner','upper']);d.layers=[{...d.layers[0]!,visible:false},l];expect(composeScene(renderItems(d),'canvas').strata[0]!.items.map(i=>i.entity.id)).toEqual(['owner']);});
  it('uses screen-space strokes and dashes including nonuniform INSERT projections',()=>{const d=fixture(),h=harness();d.styles[0]!.dash='5 2';h.draw(d);expect(h.ctx.stroke).toHaveBeenCalled();expect(h.ctx.setTransform.mock.calls.some(c=>c[0]===2&&c[3]===2)).toBe(true);expect(h.ctx.stroke.mock.calls[0]![0].calls[0]![0]).toBe('add');expect(h.ctx.lineWidth).toBe(d.styles[0]!.lineWeight);expect(h.ctx.setLineDash).toHaveBeenCalledWith([5,2]);});
  it('keeps HATCH holes as one compound even/odd fill, with separate contour strokes',()=>{const d=fixture(),s={layerId:d.layers[0]!.id,colorMode:'byblock' as const};const square=(a:number,b:number):VectorPrimitive=>({...s,kind:'path',points:[{x:a,y:a},{x:b,y:a},{x:b,y:b},{x:a,y:b}],closed:true,fill:true,fillGroup:'hatch',fillOpacity:.2});d.entities=[{id:'h',name:'H',type:'imported_graphic',layerId:s.layerId,position:{x:6190000,y:2196000},primitives:[square(0,10),{...square(3,7),colorMode:'explicit',stroke:'#f00'}]}];const h=harness();h.draw(d);expect(h.ctx.fill).toHaveBeenCalledTimes(1);expect(h.ctx.fill.mock.calls[0]![1]).toBe('evenodd');expect((h.ctx.fill.mock.calls[0]![0] as FakePath).calls.filter(c=>c[0]==='add')).toHaveLength(2);expect(hitOwners(d,{x:6190001,y:2196001},.01)).toEqual(['h']);expect(hitOwners(d,{x:6190005,y:2196005},.01)).toEqual([]);});
});
describe('renderer-independent interaction and invalidation',()=>{
  it('uses spatial candidates and exact geometry instead of owner bounding boxes',()=>{const d=fixture();d.blocks![0]!.primitives=d.blocks![0]!.primitives.slice(0,1);d.entities=[{...d.entities[0]!,type:'block_instance',blockDefinitionId:'child',position:{x:6190000,y:2196000},rotationDeg:0,scaleX:1,scaleY:1}];expect(hitOwners(d,{x:6190004,y:2196000},.01)).toEqual(['owner']);expect(hitOwners(d,{x:6190004,y:2196002},.01)).toEqual([]);const index=new BoundsIndex([{box:{minX:0,minY:0,maxX:1,maxY:1},value:'a'},{box:{minX:10,minY:10,maxX:11,maxY:11},value:'b'}]);expect(index.query({minX:.5,minY:.5,maxX:2,maxY:2})).toEqual(['a']);});
  it('normal and Alt queries preserve nested paths without a DOM',()=>{const d=fixture(),e=d.entities[0]!;if(e.type!=='block_instance')throw Error();const p=d.blocks![1]!.primitives[0]!;if(p.kind!=='block')throw Error();const world=transformPoint({x:6190001.5,y:2196000.4},multiply(blockMatrix(e,d.blocks![1]!.basePoint),blockMatrix(p,d.blocks![0]!.basePoint)));expect(hitOwners(d,world,.01)).toEqual(['owner']);const selection=createHitStack(d,['owner'],world,.01).find(h=>h.selection?.sourceType==='TEXT')!.selection!;expect(selection.primitivePath).toEqual([0,1]);expect(resolveDeepSelection(d,selection)?.primitive).toMatchObject({kind:'text',content:'Газ'});});
  it('coalesces multiple camera updates into one draw and cancels disposed work',()=>{const d=fixture(),h=harness(),before=canvasMetrics();for(let i=0;i<4;i++)h.renderer.schedule(d,renderItems(d),{...d.viewport,pixelsPerUnit:i+1},size,2);expect(frames.size).toBe(1);h.flush();expect(canvasMetrics().draws-before.draws).toBe(1);h.renderer.schedule(d,renderItems(d),d.viewport,size,2);h.renderer.dispose();expect(frames.size).toBe(0);});
  it('reuses compiled geometry for camera/selection/layer changes; unreachable definitions remain uncompiled',()=>{const d=fixture(),h=harness(),before=canvasMetrics();d.blocks!.push({id:'unused',sourceName:'Unused',basePoint:{x:0,y:0},primitives:[{kind:'circle',layerId:d.layers[0]!.id,colorMode:'byblock',center:{x:0,y:0},radius:50}]});h.draw(d);const first=canvasMetrics();expect(first.compilations-before.compilations).toBe(2);h.draw({...d,viewport:{...d.viewport,pixelsPerUnit:63}});h.draw({...d,layers:[{...d.layers[0]!,locked:true}]});expect(canvasMetrics().compilations).toBe(first.compilations);expect(prepareVectorSet({...d,blocks:[...d.blocks!]},d.blocks![0]!.primitives)).toBe(prepareVectorSet(d,d.blocks![0]!.primitives));});
  it('recompiles only the changed instance ATTRIB list and reuses its shared BlockDefinition Path2D',()=>{
    const d=fixture(),owner=d.entities[0]!;if(owner.type!=='block_instance')throw Error();const layerId=d.layers[0]!.id,primitive:VectorPrimitive={kind:'text',layerId,colorMode:'byblock',position:{x:6190001,y:2196000},content:'27.89',height:1,rotationDeg:0,attributeTag:'ELEV',source:{kind:'dxf',sourceDocumentId:'source',originalType:'ATTRIB',originalLayer:'0',handle:'4980'}};
    const withAttribute={...owner,attributes:{ELEV:'27.89'},attributePrimitives:[primitive],attributeCoordinateSpace:'block-local' as const},initial={...d,entities:[withAttribute]},h=harness();h.draw(initial);const compiled=canvasMetrics();const edited={...withAttribute,attributes:{ELEV:'27.95'},attributePrimitives:[{...primitive,content:'27.95'}]};h.draw({...initial,entities:[edited]});const after=canvasMetrics();expect(after.compilations-compiled.compilations).toBe(1);expect(after.paths).toBe(compiled.paths);expect(h.ctx.fillText).toHaveBeenLastCalledWith('27.95',0,0);
  });
  it('updates replaced descendants while retaining unrelated compiled geometry',()=>{const d=fixture(),h=harness();h.draw(d);const before=canvasMetrics();const child=d.blocks![0]!;h.draw({...d,blocks:[{...child,primitives:[{kind:'circle',layerId:d.layers[0]!.id,colorMode:'byblock',center:{x:6190000,y:2196000},radius:5}]},d.blocks![1]!]});expect(canvasMetrics().compilations-before.compilations).toBe(2);});
  it('projects transient Move through the current document without mutating committed geometry or rebuilding definitions',()=>{const d=fixture(),h=harness();h.draw(d);const before=canvasMetrics(),original=JSON.stringify(d),moved=projectSelectionMove(d,resolveSelectionMove(d,['owner']),{x:10,y:20});h.draw(moved);expect(JSON.stringify(d)).toBe(original);expect(canvasMetrics().compilations).toBe(before.compilations);expect(ownerBounds(moved,moved.entities[0]!)!.minX-ownerBounds(d,d.entities[0]!)!.minX).toBeCloseTo(10,8);});
  it('allocates DPR backing pixels and preserves visibility after large pan/zoom',()=>{const d=fixture(),h=harness();h.draw(d);expect(h.canvas.width).toBe(1800);expect(h.canvas.height).toBe(1200);expect(h.renderer.drawnOwners()).toEqual(['owner']);h.draw({...d,viewport:{center:vectorRenderOrigin(d,d.entities[0]!),pixelsPerUnit:100}});expect(h.renderer.drawnOwners()).toEqual(['owner']);});
  it('screen-sized native text hits follow current zoom rather than saved viewport',()=>{const d=fixture();d.vertices={a:{id:'a',x:0,y:0}};d.entities=[{id:'text',name:'Text',type:'text',layerId:d.layers[0]!.id,vertexId:'a',content:'LONG TEXT',fontSize:12}];expect(hitOwners(d,{x:30,y:5},7,1)).toEqual(['text']);expect(hitOwners(d,{x:30,y:5},.07,100)).toEqual([]);});
  it('selected vector bounds offer Move only for visible selected owners, without replacing normal geometry hits',()=>{const d=fixture(),box=ownerBounds(d,d.entities[0]!)!,p={x:box.maxX,y:box.maxY};expect(selectedMoveOwner(d,p,[],0)).toBeUndefined();expect(selectedMoveOwner(d,p,['owner'],0)).toBe('owner');expect(selectedMoveOwner({...d,layers:[{...d.layers[0]!,visible:false}]},p,['owner'],0)).toBeUndefined();});
  it('Canvas retains cycle guards for defensive unvalidated render inputs',()=>{const d=fixture(),s={layerId:d.layers[0]!.id,colorMode:'byblock' as const};d.blocks=[{id:'cycle',sourceName:'Cycle',basePoint:{x:0,y:0},primitives:[{...s,kind:'path',points:[{x:6190000,y:2196000},{x:6190010,y:2196000}],closed:false},{...s,kind:'block',blockDefinitionId:'cycle',position:{x:0,y:0},rotationDeg:0,scaleX:1,scaleY:1}]}];d.entities=[{...d.entities[0]!,type:'block_instance',blockDefinitionId:'cycle',position:{x:0,y:0},rotationDeg:0,scaleX:1,scaleY:1}];const h=harness();expect(()=>h.draw(d)).not.toThrow();expect(h.ctx.stroke).toHaveBeenCalledTimes(1);});
});
