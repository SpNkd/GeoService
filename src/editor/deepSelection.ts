import { underlayContains } from '../assets/underlay';
import { connectorRoute } from '../connectors/model';
import type { Entity, GeoDocument, WorldPoint } from '../domain/model';
import type { SourceProvenance, VectorPrimitive } from '../vectors/types';
import { VECTOR_LIMITS } from '../vectors/types';
import { blockAttributeMatrix, blockDefinition, blockMatrix, IDENTITY, multiply, primitiveBounds, textBounds, transformPoint, type Matrix } from '../vectors/geometry';
import { entityBoundsPoints } from '../geometry/entityBounds';
import { entityPoints } from '../domain/model';
import { bounds } from '../geometry';
import { renderItems } from '../renderer/selectors';
import { BoundsIndex } from '../renderer/BoundsIndex';
import { alignedDimension } from '../geometry/survey';
import { formatDistance } from '../geometry/format';
import { resolvedLabelPosition, resolveLabelTemplate } from '../geometry/labels';
import { createVectorStyleResolver, type Paint } from '../renderer/vectorStyle';
export interface DeepSelection {
  ownerEntityId: string; blockPath: string[]; primitivePath: number[];
  attribute?: boolean; attributeTag?: string; sourceType: string;
}
export interface HitCandidate { ownerEntityId: string; selection: DeepSelection | null; hitKind?: 'fill' }
export const NESTED_MOVE_MESSAGE = 'Элемент входит в определение блока и используется его экземплярами. Редактирование определения блока пока не поддерживается.';
const inverse=(m:Matrix):Matrix|null=>{const d=m[0]*m[3]-m[1]*m[2];return d===0?null:[m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];};
const segmentDistance=(p:WorldPoint,a:WorldPoint,b:WorldPoint)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
function inside(p:WorldPoint,points:WorldPoint[]) {let result=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i]!,b=points[j]!;if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)result=!result;}return result;}
const inBounds=(p:WorldPoint,points:WorldPoint[],t:number)=>points.length>0&&p.x>=Math.min(...points.map(p=>p.x))-t&&p.x<=Math.max(...points.map(p=>p.x))+t&&p.y>=Math.min(...points.map(p=>p.y))-t&&p.y<=Math.max(...points.map(p=>p.y))+t;
const ownerIndexes=new WeakMap<GeoDocument,BoundsIndex<{entity:Entity;order:number}>>();
const annotations=new WeakMap<GeoDocument,{entity:Entity;order:number}[]>();
function ownerIndex(document:GeoDocument) {
  let index=ownerIndexes.get(document);
  if(!index){const dynamic:{entity:Entity;order:number}[]=[];index=new BoundsIndex(renderItems(document).flatMap(({entity},order)=>{if(entity.type==='label'||entity.type==='dimension'||entity.type==='text'&&!entity.height){dynamic.push({entity,order});return [];}const box=bounds(entityBoundsPoints(document,entity));return box?[{box,value:{entity,order}}]:[];}));ownerIndexes.set(document,index);annotations.set(document,dynamic);}
  return index;
}
const queryBox=(p:WorldPoint,t:number)=>({minX:p.x-t,minY:p.y-t,maxX:p.x+t,maxY:p.y+t});
/** Broad candidates ordered from foreground to background, independent of DOM paint targets. */
export function topLevelBoundsCandidates(document:GeoDocument,p:WorldPoint,tolerance:number) {
  const index=ownerIndex(document);
  return [...index.query(queryBox(p,tolerance)),...(annotations.get(document)??[]).filter(({entity})=>inBounds(p,entityBoundsPoints(document,entity),tolerance))].sort((a,b)=>b.order-a.order).map(e=>e.entity.id);
}
/** Visible selected bounds are an explicit Move affordance, not an invisible bulk hit surface. */
export function selectedMoveOwner(document:GeoDocument,p:WorldPoint,selected:readonly string[],tolerance:number):string|undefined {
  const ids=new Set(selected);
  return renderItems(document).reverse().find(({entity:e})=>ids.has(e.id)&&['arc','circle','block_instance','imported_graphic'].includes(e.type)&&inBounds(p,entityBoundsPoints(document,e),tolerance))?.entity.id;
}
// Share the immediately preceding geometric query with its normal stack; metadata stays outside GeoDocument.
const lastFillHits=new WeakMap<GeoDocument,{x:number;y:number;ids:Set<string>}>();
const hitMetadata=new WeakMap<GeoDocument,Map<string,{entity:Entity;rank:number;area:number}>>();
function metadata(document:GeoDocument) {
 let map=hitMetadata.get(document);if(map)return map;
 map=new Map(document.entities.map(entity=>{const box=bounds(entityBoundsPoints(document,entity));
 const rank=entity.type==='text'||entity.type==='label'?-2:entity.type==='point'?-1:entity.type==='raster_underlay'?5:entity.type==='imported_graphic'&&entity.source?.originalType==='HATCH'?4:entity.type==='imported_graphic'&&entity.primitives.length===1&&entity.primitives[0]?.kind==='text'?1:entity.type==='block_instance'?2:entity.type==='imported_graphic'?3:0;
 return [entity.id,{entity,rank,area:box?Math.max(0,(box.maxX-box.minX)*(box.maxY-box.minY)):Infinity}];}));hitMetadata.set(document,map);return map;
}
/** A polygon interior is a useful fallback, but cannot steal another object's contour. */
function interiorHit(document:GeoDocument,entity:Entity,world:WorldPoint,tolerance:number){
 if(entity.type!=='polygon')return false;
 const points=entityPoints(entity,document.vertices);
 return points.every((p,i)=>segmentDistance(world,p,points[(i+1)%points.length]!)>tolerance);
}
/** CAD rank: annotations, points, native contours, imported text/ATTRIB, block, imported geometry, fill fallback, HATCH, underlay.
 * Locks restrict edits without altering picking. Tie: smaller extent, then canonical ID; never DOM order. */
export function prioritizeHitOwners(document:GeoDocument,ids:readonly string[],pointer?:{world:WorldPoint;tolerance:number}):string[] {
 const map=metadata(document),filled=lastFillHits.get(document);
 const candidates=[...new Set(ids)].flatMap(id=>{const m=map.get(id);if(!m)return [];const fill=!!pointer&&(interiorHit(document,m.entity,pointer.world,pointer.tolerance)||filled?.x===pointer.world.x&&filled.y===pointer.world.y&&filled.ids.has(id));return [{id,rank:fill?Math.max(3.5,m.rank):m.rank,area:m.area}];});
 return candidates.sort((a,b)=>a.rank-b.rank||a.area-b.area||(a.id<b.id?-1:a.id>b.id?1:0)).map(c=>c.id);
}
export function hitCandidateOrder(document:GeoDocument,candidate:HitCandidate){const m=metadata(document).get(candidate.ownerEntityId)!;return {rank:candidate.hitKind==='fill'?Math.max(3.5,m.rank):candidate.selection?1:m.rank,area:m.area};}
/** Primitive-first inspection: painted leaf, deepest nested context, then explicit parent.
 * Native annotations/contours retain their established CAD rank. Fill interiors remain fallback. */
export function normalHitStack(document:GeoDocument,ids:readonly string[],world:WorldPoint,tolerance:number):HitCandidate[] {
 const candidates=createHitStack(document,ids,world,tolerance);
 return candidates.sort((a,b)=>{
  const rank=(c:HitCandidate)=>{const order=hitCandidateOrder(document,c);if(!c.selection)return order.rank;
   const resolved=resolveDeepSelection(document,c.selection),p=resolved?.primitive;if(!p)return 9;
   if(p.kind==='block')return 2.1;
   if(c.hitKind==='fill')return order.rank;
   return p.kind==='text'?.5:1;
  };
  return rank(a)-rank(b)||(b.selection?.primitivePath.length??0)-(a.selection?.primitivePath.length??0)||hitCandidateOrder(document,a).area-hitCandidateOrder(document,b).area;
 });
}

const hitContext=new WeakMap<GeoDocument,{layers:Map<string,GeoDocument['layers'][number]>;styles:Map<string,GeoDocument['styles'][number]>;resolve:ReturnType<typeof createVectorStyleResolver>}>();
function context(document:GeoDocument){let c=hitContext.get(document);if(!c){c={layers:new Map(document.layers.map(l=>[l.id,l])),styles:new Map(document.styles.map(s=>[s.id,s])),resolve:createVectorStyleResolver(document)};hitContext.set(document,c);}return c;}
function primitiveHit(document:GeoDocument,p:VectorPrimitive,matrix:Matrix,world:WorldPoint,tolerance:number,includeFill=true):boolean {
  const inv=inverse(matrix);if(!inv)return false;
  const local=transformPoint(world,inv),t=tolerance*Math.max(Math.hypot(inv[0],inv[1]),Math.hypot(inv[2],inv[3]));
  if(!inBounds(local,primitiveBounds(document,singleton(p)),t))return false;
  if(p.kind==='block')return true;
  if(p.kind==='text'){const textMatrix=blockMatrix({position:p.position,rotationDeg:p.rotationDeg,scaleX:1,scaleY:1},{x:0,y:0}),textInverse=inverse(textMatrix);return !!textInverse&&inBounds(transformPoint(local,textInverse),textBounds(p.content,p.height),t);}
  if(p.kind==='path') {
    // Bulges are already tessellated by the importer. Filled HATCH holes use even/odd below.
    for(let i=0;i<p.points.length-(p.closed?0:1);i++)if(segmentDistance(local,p.points[i]!,p.points[(i+1)%p.points.length]!)<=t)return true;
    return includeFill&&!!p.fill&&inside(local,p.points);
  }
  if(Math.abs(Math.hypot(local.x-p.center.x,local.y-p.center.y)-p.radius)>t)return false;
  if(p.kind==='circle')return true;
  const tau=2*Math.PI,sweep=((p.endAngle-p.startAngle)%tau+tau)%tau||tau,angle=((Math.atan2(local.y-p.center.y,local.x-p.center.x)-p.startAngle)%tau+tau)%tau;
  return angle<=sweep+t/p.radius;
}
const emptyLibrary:NonNullable<GeoDocument['blocks']>=[];
const primitiveIndexes=new WeakMap<NonNullable<GeoDocument['blocks']>,WeakMap<VectorPrimitive[],BoundsIndex<number>>>();
function primitiveCandidates(document:GeoDocument,primitives:VectorPrimitive[],matrix:Matrix,world:WorldPoint,tolerance:number):number[] {
  const inv=inverse(matrix);if(!inv)return [];
  const local=transformPoint(world,inv),t=tolerance*Math.max(Math.hypot(inv[0],inv[1]),Math.hypot(inv[2],inv[3]));
  let cache=primitiveIndexes.get(document.blocks??emptyLibrary);if(!cache){cache=new WeakMap();primitiveIndexes.set(document.blocks??emptyLibrary,cache);}
  let index=cache.get(primitives);if(!index){index=new BoundsIndex(primitives.flatMap((p,i)=>{const box=bounds(primitiveBounds(document,singleton(p)));return box?[{box,value:i}]:[];}));cache.set(primitives,index);}
  return index.query(queryBox(local,t)).sort((a,b)=>b-a);
}
/** Same compiled broad phase for normal click, hover and Alt. No pixels or SVG nodes. */
export function hitOwners(document:GeoDocument,world:WorldPoint,tolerance:number,pixelsPerUnit=document.viewport.pixelsPerUnit,paintedOnly=false):string[] {
  const {layers,styles,resolve}=context(document),fillOwners=new Set<string>();
  const hitSet=(ps:VectorPrimitive[],matrix:Matrix,inheritAll:boolean,stack:string[],parent:Paint,foreground:boolean):boolean=>{
    if(stack.length>VECTOR_LIMITS.depth)return false;
    const fills=new Map<string,boolean>();
    for(const i of primitiveCandidates(document,ps,matrix,world,tolerance)){
      const p=ps[i]!,paint=resolve(p,parent,inheritAll);if(!paint.visible||foreground&&p.source?.originalType==='HATCH')continue;
      // CAD pick band is screen-scaled, even for thin source strokes.
      const hitTolerance=paintedOnly?Math.min(tolerance,(paint.lineWeight/2+1)/pixelsPerUnit):tolerance;
      if(p.kind==='path'&&p.fill&&p.fillGroup){
        const inv=inverse(matrix);if(!inv)continue;const local=transformPoint(world,inv),t=hitTolerance*Math.max(Math.hypot(inv[0],inv[1]),Math.hypot(inv[2],inv[3]));
        for(let j=0;j<p.points.length;j++)if(segmentDistance(local,p.points[j]!,p.points[(j+1)%p.points.length]!)<=t)return true;
        if(!foreground&&inside(local,p.points))fills.set(p.fillGroup,!fills.get(p.fillGroup));continue;
      }
      if(!primitiveHit(document,p,matrix,world,p.kind==='block'?tolerance:hitTolerance,!foreground))continue;
      if(p.kind!=='block')return true;
      const block=blockDefinition(document,p.blockDefinitionId);
      if(block&&!stack.includes(block.id)&&stack.length<VECTOR_LIMITS.depth&&hitSet(block.primitives,multiply(matrix,blockMatrix(p,block.basePoint)),false,[...stack,block.id],paint,foreground))return true;
    }
    return [...fills.values()].some(Boolean);
  };
  const index=ownerIndex(document),candidates=[...index.query(queryBox(world,tolerance*2)),...(annotations.get(document)??[])].sort((a,b)=>b.order-a.order);
  const ids=candidates.filter(({entity:e})=>{
    const style=styles.get(e.styleId??layers.get(e.layerId)?.styleId??''),paint:Paint={stroke:style?.stroke??'#546675',lineWeight:style?.lineWeight??1.5,dash:style?.dash};
    if(e.type==='raster_underlay')return !e.locked&&underlayContains(e,world);
    if(e.type==='block_instance'){const b=blockDefinition(document,e.blockDefinitionId);if(!b)return false;const hit=(foreground:boolean)=>hitSet(b.primitives,blockMatrix(e,b.basePoint),false,[b.id],paint,foreground)||hitSet(e.attributePrimitives??[],blockAttributeMatrix(e,b),true,[],paint,foreground);if(hit(true))return true;if(hit(false)){fillOwners.add(e.id);return true;}return false;}
    if(e.type==='imported_graphic'){const hit=(foreground:boolean)=>hitSet(e.primitives,[1,0,0,1,e.position.x,e.position.y],true,[],paint,foreground);if(hit(true))return true;if(hit(false)){fillOwners.add(e.id);return true;}return false;}
    if(e.type==='arc')return primitiveHit(document,{...e,kind:'arc',colorMode:'byblock'},IDENTITY,world,tolerance);
    if(e.type==='circle')return primitiveHit(document,{...e,kind:'circle',colorMode:'byblock'},IDENTITY,world,tolerance);
    return nativeHit(document,e,world,e.type==='point'?tolerance*2:tolerance,pixelsPerUnit);
  }).map(e=>e.entity.id);lastFillHits.set(document,{x:world.x,y:world.y,ids:fillOwners});return prioritizeHitOwners(document,ids,{world,tolerance});
}
const singletonPrimitives=new WeakMap<VectorPrimitive,VectorPrimitive[]>();
const singleton=(p:VectorPrimitive)=>{let ps=singletonPrimitives.get(p);if(!ps){ps=[p];singletonPrimitives.set(p,ps);}return ps;};
let deepWalks=0;
export const deepSelectionMetrics=()=>({walks:deepWalks});
/** Indexed primitive hit hierarchy, shared by hover/normal click and explicit Alt cycling. Owner first, then depth-first nested INSERT and painted primitives. */
export function createHitStack(document:GeoDocument,ownerIds:readonly string[],world:WorldPoint,tolerance:number):HitCandidate[] {
  deepWalks++;
  const result:HitCandidate[]=[],layers=new Map(document.layers.map(l=>[l.id,l]));
  const walk=(ownerEntityId:string,primitives:VectorPrimitive[],matrix:Matrix,blockPath:string[],path:number[],stack:string[],attribute=false,inheritAll=false):HitCandidate[]=>{
    if(stack.length>VECTOR_LIMITS.depth)return [];
    const hits:HitCandidate[]=[];
    for(const i of primitiveCandidates(document,primitives,matrix,world,tolerance)){const p=primitives[i]!,layer=layers.get(p.layerId);if(p.visible===false||!inheritAll&&layer?.name!=='0'&&!layer?.visible)continue;
      if(!primitiveHit(document,p,matrix,world,tolerance))continue;
      const primitivePath=[...path,i],sourceType=p.source?.originalType??(p.kind==='path'?'LINE':p.kind.toUpperCase());
      if(p.kind==='block') {
        const block=blockDefinition(document,p.blockDefinitionId);if(!block||stack.includes(block.id)||stack.length>=VECTOR_LIMITS.depth)continue;
        const nextPath=[...blockPath,block.sourceName],nested=walk(ownerEntityId,block.primitives,multiply(matrix,blockMatrix(p,block.basePoint)),nextPath,primitivePath,[...stack,block.id],attribute);
        if(nested.length){hits.push({ownerEntityId,selection:{ownerEntityId,blockPath:nextPath,primitivePath,sourceType,attribute}},...nested);}
      }else hits.push({ownerEntityId,...(!primitiveHit(document,p,matrix,world,tolerance,false)?{hitKind:'fill' as const}:{}),selection:{ownerEntityId,blockPath,primitivePath,sourceType,attribute,...(attribute&&p.kind==='text'&&p.attributeTag?{attributeTag:p.attributeTag}:{})}});
    }
    return hits;
  };
  for(const id of prioritizeHitOwners(document,ownerIds)){
    const entity=document.entities.find(e=>e.id===id);if(!entity)continue;
    result.push({ownerEntityId:id,selection:null,...(interiorHit(document,entity,world,tolerance)||lastFillHits.get(document)?.ids.has(id)?{hitKind:'fill' as const}:{})});
    if(entity.type==='block_instance') {
      const block=blockDefinition(document,entity.blockDefinitionId);if(!block)continue;
      result.push(...walk(id,block.primitives,blockMatrix(entity,block.basePoint),[block.sourceName],[],[block.id]));
      result.push(...walk(id,entity.attributePrimitives??[],blockAttributeMatrix(entity,block),[block.sourceName,'ATTRIB'],[],[],true,true));
    }
    if(entity.type==='imported_graphic')result.push(...walk(id,entity.primitives,[1,0,0,1,entity.position.x,entity.position.y],[],[],[],false,true));
  }
  return result;
}
export function resolveDeepSelection(document:GeoDocument,selection:DeepSelection):{primitive:VectorPrimitive;matrix:Matrix;source?:SourceProvenance}|null {
  const owner=document.entities.find(e=>e.id===selection.ownerEntityId);if(!owner)return null;
  let primitives:VectorPrimitive[],matrix:Matrix=IDENTITY;
  if(owner.type==='block_instance'){
    const definition=blockDefinition(document,owner.blockDefinitionId);if(!definition)return null;
    primitives=selection.attribute?owner.attributePrimitives??[]:definition.primitives;
    matrix=selection.attribute?blockAttributeMatrix(owner,definition):blockMatrix(owner,definition.basePoint);
  }else if(owner.type==='imported_graphic'){primitives=owner.primitives;matrix=[1,0,0,1,owner.position.x,owner.position.y];}else return null;
  if(selection.primitivePath.length>VECTOR_LIMITS.depth+1)return null;
  for(const [i,index] of selection.primitivePath.entries()){
    const primitive=primitives[index];if(!primitive)return null;
    if(i===selection.primitivePath.length-1)return {primitive,matrix,...(primitive.source?{source:primitive.source}:{})};
    if(primitive.kind!=='block')return null;
    const definition=blockDefinition(document,primitive.blockDefinitionId);if(!definition)return null;
    matrix=multiply(matrix,blockMatrix(primitive,definition.basePoint));primitives=definition.primitives;
  }
  return null;
}
/** Native geometry plus camera-scaled annotation bounds; never a browser event target. */
export function nativeHit(document:GeoDocument,entity:Entity,world:WorldPoint,tolerance:number,pixelsPerUnit=document.viewport.pixelsPerUnit) {
  const points=entity.type==='connector'?connectorRoute(document,entity):entityPoints(entity,document.vertices);
  if(entity.type==='text') {
    const inv=inverse(blockMatrix({position:points[0]!,rotationDeg:entity.rotationDeg??0,scaleX:1,scaleY:1},{x:0,y:0}));if(!inv)return false;
    const p=transformPoint(world,inv),h=entity.height??entity.fontSize/pixelsPerUnit,lines=entity.content.split('\n');
    return p.x>=-7/pixelsPerUnit&&p.x<=Math.max(21/pixelsPerUnit,Math.max(...lines.map(l=>l.length))*h*.7+7/pixelsPerUnit)&&p.y>=-(lines.length-1)*h*1.2-7/pixelsPerUnit&&p.y<=h+7/pixelsPerUnit;
  }
  if(entity.type==='label') {const p=resolvedLabelPosition(document,entity);if(!p)return false;const width=Math.max(32,resolveLabelTemplate(document,entity).length*7.4+16);return world.x>=p.x-6/pixelsPerUnit&&world.x<=p.x+(width-6)/pixelsPerUnit&&world.y>=p.y-7/pixelsPerUnit&&world.y<=p.y+17/pixelsPerUnit;}
  if(entity.type==='dimension') {
    const a=points[0]!,b=points[1]!,d=alignedDimension(a,b,entity.offset,entity.textPosition),half=Math.max(28,formatDistance(d.length).length*3.7)/pixelsPerUnit;
    if(world.x>=d.label.x-half&&world.x<=d.label.x+half&&world.y>=d.label.y+2/pixelsPerUnit&&world.y<=d.label.y+24/pixelsPerUnit)return true;
    if(segmentDistance(world,d.start,d.end)<=tolerance)return true;
    return ([[a,d.start],[b,d.end]] as const).some(([a,b])=>{const length=Math.hypot(b.x-a.x,b.y-a.y),t=length?Math.min(1,14/pixelsPerUnit/length):1;return t<1&&segmentDistance(world,{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},b)<=tolerance;});
  }
  if(entity.type==='connector'||entity.type==='line'||entity.type==='polyline'||entity.type==='polygon') {
    for(let i=0;i<points.length-(entity.type==='polygon'?0:1);i++)if(segmentDistance(world,points[i]!,points[(i+1)%points.length]!)<=tolerance)return true;
    return entity.type==='polygon'&&inside(world,points);
  }
  return inBounds(world,entityBoundsPoints(document,entity),tolerance);
}
