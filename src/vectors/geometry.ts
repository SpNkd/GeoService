import type { Entity, GeoDocument, WorldPoint } from '../domain/model';
import type { BlockTransform, VectorPrimitive } from './types';
import { VECTOR_LIMITS } from './types';
export type Matrix = readonly [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
export function transformPoint(p: WorldPoint, m: Matrix): WorldPoint { return { x: m[0]*p.x+m[2]*p.y+m[4], y: m[1]*p.x+m[3]*p.y+m[5], ...(p.z === undefined ? {} : { z: p.z }) }; }
export function multiply(a: Matrix,b: Matrix): Matrix { return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]; }
export function blockMatrix(t: BlockTransform, base: WorldPoint): Matrix {
  const r=t.rotationDeg*Math.PI/180,c=Math.cos(r),s=Math.sin(r),a=c*t.scaleX,b=s*t.scaleX,d=c*t.scaleY,e=-s*t.scaleY;
  return [a,b,e,d,t.position.x-a*base.x-e*base.y,t.position.y-b*base.x-d*base.y];
}
export const arcSweep=(start:number,end:number)=>{const tau=2*Math.PI;return ((end-start)%tau+tau)%tau || tau;};
export function arcPoints(center:WorldPoint,radius:number,start=0,end=2*Math.PI):WorldPoint[] {
  const sweep=arcSweep(start,end),angles=[start,start+sweep];
  for(let i=0;i<4;i++){const a=i*Math.PI/2;if(((a-start)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)<=sweep+1e-12)angles.push(a);}
  return angles.map(a=>({x:center.x+radius*Math.cos(a),y:center.y+radius*Math.sin(a)}));
}
const boxPoints=(points:WorldPoint[]):WorldPoint[]=>{if(!points.length)return [];let x=Infinity,y=Infinity,X=-Infinity,Y=-Infinity;for(const p of points){x=Math.min(x,p.x);y=Math.min(y,p.y);X=Math.max(X,p.x);Y=Math.max(Y,p.y);}return [{x,y},{x:X,y},{x:X,y:Y},{x,y:Y}];};
export function textBounds(content:string,height:number):WorldPoint[] {const lines=content.split('\n'),width=Math.max(...lines.map(line=>line.length))*height*.7,bottom=-(lines.length-1)*height*1.2;return [{x:0,y:bottom},{x:width,y:bottom},{x:width,y:height},{x:0,y:height}];}
const caches=new WeakMap<GeoDocument,Map<string,WorldPoint[]>>();
/** Cached definition bounds, shared by every instance. Nested AABBs are conservative. */
export function primitiveBounds(document:GeoDocument,primitives:VectorPrimitive[],stack:string[]=[]):WorldPoint[] {
  const cache=caches.get(document)??new Map<string,WorldPoint[]>();caches.set(document,cache);
  const points:WorldPoint[]=[];
  for(const p of primitives){
    if(p.kind==='path') points.push(...boxPoints(p.points));
    else if(p.kind==='arc'||p.kind==='circle')points.push(...boxPoints(arcPoints(p.center,p.radius,p.kind==='arc'?p.startAngle:0,p.kind==='arc'?p.endAngle:2*Math.PI)));
    else if(p.kind==='text') {const m=blockMatrix({position:p.position,rotationDeg:p.rotationDeg,scaleX:1,scaleY:1},{x:0,y:0});points.push(...textBounds(p.content,p.height).map(x=>transformPoint(x,m)));}
    else {
      if(stack.includes(p.blockDefinitionId)||stack.length>=VECTOR_LIMITS.depth)continue;
      const block=document.blocks?.find(b=>b.id===p.blockDefinitionId);if(!block)continue;
      let local=cache.get(block.id);if(!local){local=boxPoints(primitiveBounds(document,block.primitives,[...stack,block.id]));cache.set(block.id,local);}
      points.push(...local.map(x=>transformPoint(x,blockMatrix(p,block.basePoint))));
    }
  }
  return boxPoints(points);
}
export function vectorEntityBounds(document:GeoDocument,entity:Entity):WorldPoint[] {
  if(entity.type==='arc'||entity.type==='circle')return boxPoints(arcPoints(entity.center,entity.radius,entity.type==='arc'?entity.startAngle:0,entity.type==='arc'?entity.endAngle:2*Math.PI));
  if(entity.type==='imported_graphic')return primitiveBounds(document,entity.primitives).map(p=>({x:p.x+entity.position.x,y:p.y+entity.position.y}));
  if(entity.type==='block_instance') {
    const p:VectorPrimitive={kind:'block',...entity,colorMode:'bylayer'};
    return boxPoints([...primitiveBounds(document,[p]),...primitiveBounds(document,entity.attributePrimitives??[]).map(x=>({x:x.x+entity.position.x,y:x.y+entity.position.y}))]);
  }
  return [];
}
export function validateVectorDocument(document:GeoDocument):void {
  const blocks=new Map((document.blocks??[]).map(b=>[b.id,b])),layers=new Set(document.layers.map(l=>l.id)),sources=new Set((document.sources??[]).map(s=>s.id));
  if(blocks.size!==(document.blocks??[]).length||sources.size!==(document.sources??[]).length)throw new Error('Duplicate block/source ID');
  let count=0,points=0;
  const source=(s:Entity['source'])=>{if(s&&!sources.has(s.sourceDocumentId))throw new Error('Missing source document');};
  const check=(ps:VectorPrimitive[])=>{for(const p of ps){if(!layers.has(p.layerId))throw new Error('Missing primitive layer');source(p.source);count++;if(p.kind==='path')points+=p.points.length;if(p.kind==='block'&&!blocks.has(p.blockDefinitionId))throw new Error('Missing nested block');}};
  for(const layer of document.layers)source(layer.source);
  for(const b of blocks.values())check(b.primitives);
  for(const e of document.entities){source(e.source);if(e.type==='block_instance'){if(!blocks.has(e.blockDefinitionId))throw new Error('Missing block definition');check(e.attributePrimitives??[]);}if(e.type==='imported_graphic')check(e.primitives);}
  if(count>VECTOR_LIMITS.primitives||points>VECTOR_LIMITS.points)throw new Error('Vector geometry budget exceeded');
  const weights=new Map<string,number>(),depths=new Map<string,number>();
  const weight=(id:string,stack:string[]):number=>{
    if(stack.includes(id))throw new Error('Cyclic block reference');if(stack.length>=VECTOR_LIMITS.depth)throw new Error('Block depth budget exceeded');
    const cached=weights.get(id);if(cached!==undefined){if(stack.length+(depths.get(id)??1)>VECTOR_LIMITS.depth)throw new Error('Block depth budget exceeded');return cached;}
    let n=0,depth=1;for(const p of blocks.get(id)!.primitives){n+=p.kind==='block'?weight(p.blockDefinitionId,[...stack,id]):1;if(p.kind==='block')depth=Math.max(depth,1+(depths.get(p.blockDefinitionId)??1));if(n>VECTOR_LIMITS.renderedPrimitives)throw new Error('Block render budget exceeded');}depths.set(id,depth);if(depth>VECTOR_LIMITS.depth)throw new Error('Block depth budget exceeded');weights.set(id,n);return n;
  };
  // Traverse all definitions even unused ones: malformed JSON must not bypass cycle/depth validation.
  for(const id of blocks.keys())weight(id,[]);
  let rendered=0;for(const e of document.entities){rendered+=e.type==='block_instance'?weight(e.blockDefinitionId,[]):e.type==='imported_graphic'?e.primitives.reduce((n,p)=>n+(p.kind==='block'?weight(p.blockDefinitionId,[]):1),0):1;}
  if(rendered>VECTOR_LIMITS.renderedPrimitives)throw new Error('Document render budget exceeded');
}
