import { describe, expect, it } from 'vitest';
import { createNewDocument } from '../domain/newDocument';
import type { BlockInstanceEntity, GeoDocument } from '../domain/model';
import { blockMatrix, multiply, transformPoint, vectorBoundsMetrics, vectorEntityBounds } from '../vectors/geometry';
import { prepareVectorSet, vectorRenderOrigin } from '../renderer/vectorPreparation';
import { worldToScreen } from '../geometry';
import { renderItems, visibleBounds } from '../renderer/selectors';
import { createHitStack } from '../editor/deepSelection';
import { marqueeEntities } from '../editor/marquee';

function fixture() {
  const d=createNewDocument(),layerId=d.layers[0]!.id,style={layerId,colorMode:'byblock' as const};
  d.blocks=[{id:'child',sourceName:'Child',basePoint:{x:2196000,y:464900},primitives:[{...style,kind:'path',points:[{x:2196000,y:464900},{x:2196010,y:464905}],closed:false},{...style,kind:'text',position:{x:2196002,y:464902},height:1,rotationDeg:0,content:'nested'}]},
    {id:'parent',sourceName:'Parent',basePoint:{x:4,y:5},primitives:[{...style,kind:'block',blockDefinitionId:'child',position:{x:100,y:200},rotationDeg:32,scaleX:-2,scaleY:3}]}];
  const e:BlockInstanceEntity={id:'owner',name:'Owner',layerId,type:'block_instance',blockDefinitionId:'parent',position:{x:2196000,y:464900},rotationDeg:21,scaleX:1.5,scaleY:.8};
  d.entities=[e];return {d,e};
}
describe('camera-independent SVG preparation',()=>{
  it('preserves nested base point -> INSERT -> parent -> world with rotation and negative/nonuniform scale',()=>{
    const {d,e}=fixture(),child=d.blocks![0]!,parent=d.blocks![1]!,nested=parent.primitives[0]!;
    if(nested.kind!=='block')throw Error();
    const childSet=prepareVectorSet(d,child.primitives),parentSet=prepareVectorSet(d,parent.primitives),preparedNested=parentSet.primitives[0]!;
    if(preparedNested.kind!=='block')throw Error();
    const p={x:2196003,y:464903},world=transformPoint(p,multiply(blockMatrix(e,parent.basePoint),blockMatrix(nested,child.basePoint)));
    const local=transformPoint({x:p.x-childSet.origin.x,y:p.y-childSet.origin.y},blockMatrix(preparedNested,{x:0,y:0}));
    const linear=blockMatrix({...e,position:{x:0,y:0}},{x:0,y:0}),origin=vectorRenderOrigin(d,e),offset=transformPoint(local,linear);
    expect(origin.x+offset.x).toBeCloseTo(world.x,8);expect(origin.y+offset.y).toBeCloseTo(world.y,8);
    expect(child.primitives[0]).toMatchObject({points:[{x:2196000,y:464900},{x:2196010,y:464905}]});
  });
  it('reuses prepared geometry and world bounds across camera changes; replaces instance bounds on movement',()=>{
    const {d,e}=fixture(),prepared=prepareVectorSet(d,d.blocks![1]!.primitives),bounds=vectorEntityBounds(d,e),warm=vectorBoundsMetrics(),size={width:900,height:600};
    const a=worldToScreen(vectorRenderOrigin(d,e),{center:{x:2196000,y:464900},pixelsPerUnit:1},size);
    for(const zoom of [.5,1.1,1.25,1.5,2,4,40]){const camera={center:{x:2196000,y:464900},pixelsPerUnit:zoom},next={...d,viewport:camera};expect(prepareVectorSet(next,d.blocks![1]!.primitives)).toBe(prepared);expect(vectorEntityBounds(next,e)).toBe(bounds);expect(renderItems(next).map(i=>i.entity.id)).toEqual(['owner']);expect(worldToScreen(vectorRenderOrigin(d,e),camera,size)).not.toEqual(a);}
    expect(vectorBoundsMetrics()).toEqual(warm);
    const moved={...e,position:{x:e.position.x+10,y:e.position.y-20}},updated=vectorEntityBounds(d,moved);
    expect(updated[0]!.x-bounds[0]!.x).toBeCloseTo(10);expect(updated[0]!.y-bounds[0]!.y).toBeCloseTo(-20);expect(vectorBoundsMetrics().definitionComputations).toBe(warm.definitionComputations);
  });
  it('invalidates prepared ancestors when a child definition is replaced',()=>{
    const {d}=fixture(),parent=d.blocks![1]!,prepared=prepareVectorSet(d,parent.primitives),child=d.blocks![0]!;
    const changed:GeoDocument={...d,blocks:[{...child,primitives:[{kind:'circle',layerId:d.layers[0]!.id,colorMode:'byblock',center:{x:2196010,y:464920},radius:20}]},parent]};
    expect(prepareVectorSet(changed,parent.primitives)).not.toBe(prepared);expect(prepareVectorSet(changed,parent.primitives).origin).not.toEqual(prepared.origin);
  });
  it('keeps arc/circle/proxy bounds canonical while preparing local SVG geometry',()=>{
    const {d}=fixture(),layerId=d.layers[0]!.id;
    const arc={id:'arc',name:'Arc',layerId,type:'arc' as const,center:{x:2196000,y:464900},radius:10,startAngle:0,endAngle:Math.PI/2};
    const circle={...arc,id:'circle',type:'circle' as const};
    expect(vectorEntityBounds(d,arc)[0]).toEqual({x:2196000,y:464900});expect(vectorEntityBounds(d,circle)[0]).toEqual({x:2195990,y:464890});
    const proxy={id:'proxy',name:'Proxy',layerId,type:'imported_graphic' as const,position:{x:10,y:20},primitives:d.blocks![0]!.primitives};
    const before=vectorEntityBounds(d,proxy);expect(vectorRenderOrigin(d,proxy).x).toBeGreaterThan(2196000);expect(vectorEntityBounds(d,proxy)).toBe(before);expect(prepareVectorSet(d,proxy.primitives).primitives[0]).toMatchObject({kind:'path'});
  });
  it('retains nested TEXT hit path, WINDOW/CROSSING and Fit world bounds across cameras',()=>{
    const {d,e}=fixture(),parent=d.blocks![1]!,child=d.blocks![0]!,nested=parent.primitives[0]!;if(nested.kind!=='block')throw Error();
    const p=transformPoint({x:2196002.5,y:464902.4},multiply(blockMatrix(e,parent.basePoint),blockMatrix(nested,child.basePoint))),fit=visibleBounds(d);
    for(const zoom of [.5,2,4]){const camera={center:p,pixelsPerUnit:zoom},size={width:900,height:600};expect(createHitStack(d,['owner'],p,.01).some(h=>h.selection?.primitivePath.join('.')==='0.1')).toBe(true);expect(visibleBounds({...d,viewport:camera})).toEqual(fit);expect(marqueeEntities(d,camera,size,{x:0,y:0},{x:900,y:600})).toContain('owner');expect(marqueeEntities(d,camera,size,{x:900,y:0},{x:0,y:600})).toContain('owner');}
  });
});
