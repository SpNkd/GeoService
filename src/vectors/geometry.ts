import type { Entity, GeoDocument, WorldPoint } from '../domain/model';
import type { BlockDefinition, BlockTransform, VectorPrimitive } from './types';
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
interface BoundsContext {
  definitions: Map<string, BlockDefinition>;
  definitionsBounds: Map<string, WorldPoint[]>;
  primitives: WeakMap<VectorPrimitive[], WorldPoint[]>;
  instances: WeakMap<Entity, WorldPoint[]>;
}
const emptyBlocks: BlockDefinition[] = [];
const emptyPrimitives: VectorPrimitive[] = [];
const contexts = new WeakMap<BlockDefinition[], BoundsContext>();
const definitionRevisions = new WeakMap<BlockDefinition, { points: WorldPoint[]; children: WorldPoint[][] }>();
const instanceRevisions = new WeakMap<Entity, {points:WorldPoint[];dependencies:WorldPoint[][]}>();
const metrics = { definitionComputations: 0, primitiveVisits: 0, instanceComputations: 0 };
/** Diagnostic counters for deterministic cache tests and opt-in profiling. */
export const vectorBoundsMetrics = () => ({ ...metrics });
function context(document: GeoDocument): BoundsContext {
  const blocks = document.blocks ?? emptyBlocks;
  let c = contexts.get(blocks);
  if (!c) { c = { definitions: new Map(blocks.map(b => [b.id, b])), definitionsBounds: new Map(), primitives: new WeakMap(), instances: new WeakMap() }; contexts.set(blocks, c); }
  return c;
}
export const blockDefinition = (document: GeoDocument, id: string) => context(document).definitions.get(id);
function definitionBounds(document: GeoDocument, id: string, stack: string[]): WorldPoint[] {
  if (stack.includes(id) || stack.length >= VECTOR_LIMITS.depth) return [];
  const c = context(document), block = c.definitions.get(id);
  if (!block) return [];
  const cached = c.definitionsBounds.get(id);
  if (cached) return cached;
  // Object identity is the immutable definition revision. A replaced child invalidates ancestors.
  const next = [...stack, id], children = block.primitives.filter(p => p.kind === 'block').map(p => definitionBounds(document, p.blockDefinitionId, next));
  const revision = definitionRevisions.get(block);
  let points: WorldPoint[];
  if (revision && children.length === revision.children.length && children.every((p, i) => p === revision.children[i])) points = revision.points;
  else { metrics.definitionComputations++; points = primitiveBounds(document, block.primitives, next); definitionRevisions.set(block, { points, children }); }
  c.definitionsBounds.set(id, points);
  return points;
}
/** Library revision cache survives document edits, pan, hover and instance movement. */
export function primitiveBounds(document: GeoDocument, primitives: VectorPrimitive[], stack: string[] = []): WorldPoint[] {
  const c = context(document), cached = c.primitives.get(primitives);
  if (cached) return cached;
  const points: WorldPoint[] = [];
  for (const p of primitives) {
    metrics.primitiveVisits++;
    if (p.kind === 'path') points.push(...boxPoints(p.points));
    else if (p.kind === 'arc' || p.kind === 'circle') points.push(...boxPoints(arcPoints(p.center, p.radius, p.kind === 'arc' ? p.startAngle : 0, p.kind === 'arc' ? p.endAngle : 2 * Math.PI)));
    else if (p.kind === 'text') { const m = blockMatrix({ position: p.position, rotationDeg: p.rotationDeg, scaleX: 1, scaleY: 1 }, { x: 0, y: 0 }); points.push(...textBounds(p.content, p.height).map(x => transformPoint(x, m))); }
    else { const block = c.definitions.get(p.blockDefinitionId); if (block) points.push(...definitionBounds(document, block.id, stack).map(x => transformPoint(x, blockMatrix(p, block.basePoint)))); }
  }
  const result = boxPoints(points); c.primitives.set(primitives, result); return result;
}
export function vectorEntityBounds(document: GeoDocument, entity: Entity): WorldPoint[] {
  const c = context(document), cached = c.instances.get(entity);
  if (cached) return cached;
  const dependencies:WorldPoint[][]=[];
  if(entity.type==='imported_graphic')dependencies.push(primitiveBounds(document,entity.primitives));
  if(entity.type==='block_instance')dependencies.push(definitionBounds(document,entity.blockDefinitionId,[]),primitiveBounds(document,entity.attributePrimitives??emptyPrimitives));
  const revision=instanceRevisions.get(entity);
  if(revision&&revision.dependencies.length===dependencies.length&&dependencies.every((p,i)=>p===revision.dependencies[i])) {c.instances.set(entity,revision.points);return revision.points;}
  metrics.instanceComputations++;
  let points:WorldPoint[]=[];
  if(entity.type==='arc'||entity.type==='circle')points=boxPoints(arcPoints(entity.center,entity.radius,entity.type==='arc'?entity.startAngle:0,entity.type==='arc'?entity.endAngle:2*Math.PI));
  if(entity.type==='imported_graphic')points=dependencies[0]!.map(p=>({x:p.x+entity.position.x,y:p.y+entity.position.y}));
  if(entity.type==='block_instance') {
    const block=c.definitions.get(entity.blockDefinitionId);
    points=boxPoints([...dependencies[0]!.map(p=>transformPoint(p,blockMatrix(entity,block!.basePoint))),...dependencies[1]!.map(p=>({x:p.x+entity.position.x,y:p.y+entity.position.y}))]);
  }
  instanceRevisions.set(entity,{points,dependencies});
  c.instances.set(entity, points); return points;
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
