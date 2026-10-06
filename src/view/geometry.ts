import { entityPoints, type ConnectorEntity, type Entity, type GeoDocument, type WorldPoint } from '../domain/model';
import { connectorRoute, resolvePort } from '../connectors/model';
import { bounds, screenToWorld, worldToScreen, type Bounds, type ScreenPoint, type ViewSize } from '../geometry';
import { alignedDimension } from '../geometry/survey';
import { resolvedLabelPosition, resolveLabelTemplate } from '../geometry/labels';
import { requireSymbol } from '../symbols/registry';
import { primitivePoints, symbolLocalToWorld, symbolBoundsPoints, symbolLocalPortToWorld } from '../symbols/transforms';
import { arcSweep, blockAttributeMatrix, blockDefinition, blockMatrix, multiply, transformPoint, textBounds, type Matrix } from '../vectors/geometry';
import { VECTOR_LIMITS, type VectorPrimitive } from '../vectors/types';
import { createVectorStyleResolver, type Paint } from '../renderer/vectorStyle';
import { renderItems, type RenderItem } from '../renderer/selectors';
import { BoundsIndex } from '../renderer/BoundsIndex';
import { axonometricDepth, boxXYZCorners, modelXYZBounds, presentationArc, presentationZ, projectXYZToAxonometric, type Bounds3D, type ProjectionContext, type RenderCamera } from './projection';

export function connectorPresentationRoute(document:GeoDocument,connector:ConnectorEntity):WorldPoint[]{
  const a=resolvePort(document,connector.start).world,b=resolvePort(document,connector.end).world,za=presentationZ(a),zb=presentationZ(b);
  if(connector.routing==='direct'&&za!==zb)return [{...a,z:za},{...b,z:zb}];
  const route=connectorRoute(document,connector).map(p=>({...p,z:za}));
  if(za!==zb)route.push({...b,z:zb});return route;
}
export function dimensionPresentationPoints(a:WorldPoint,b:WorldPoint,offset:number,t=.5){const d=alignedDimension(a,b,offset,t);return {...d,start:{...d.start,z:presentationZ(a)},end:{...d.end,z:presentationZ(b)},label:{...d.label,z:presentationZ(a)+(presentationZ(b)-presentationZ(a))*t}};}
export interface PresentationPrimitive {primitive:VectorPrimitive;matrix:Matrix;zOffset:number;zScale:number;paint:Paint;fillScope:number}
const distanceToSegment=(p:WorldPoint,a:WorldPoint,b:WorldPoint)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
const identity:Matrix=[1,0,0,1,0,0];
export function primitiveXYZ(part:PresentationPrimitive,p:WorldPoint):WorldPoint{const q=transformPoint(p,part.matrix);return {...q,z:part.zOffset+presentationZ(p)*part.zScale};}
/** Traverses shared definitions, retaining references; no canonical or flattened geometry copy. */
export function visitEntityPrimitives(document:GeoDocument,e:Entity,paint:Paint,visit:(p:PresentationPrimitive)=>void,includeHidden=false){
  const resolve=createVectorStyleResolver(document);let scope=0;
  const walk=(primitives:VectorPrimitive[],matrix:Matrix,zOffset:number,zScale:number,parent:Paint,inherit:boolean,stack:string[])=>{
    const fillScope=scope++;
    for(const p of primitives){const next=resolve(p,parent,inherit);if(!next.visible&&!includeHidden)continue;
      if(p.kind==='block'){const block=blockDefinition(document,p.blockDefinitionId);if(!block||stack.includes(block.id)||stack.length>=VECTOR_LIMITS.depth)continue;
        const scale=p.scaleZ??1;walk(block.primitives,multiply(matrix,blockMatrix(p,block.basePoint)),zOffset+zScale*(presentationZ(p.position)-presentationZ(block.basePoint)*scale),zScale*scale,next,false,[...stack,block.id]);
      }else visit({primitive:p,matrix,zOffset,zScale,paint:next,fillScope});
    }
  };
  if(e.type==='block_instance'){const b=blockDefinition(document,e.blockDefinitionId);if(!b)return;const scale=e.scaleZ??1;
    walk(b.primitives,blockMatrix(e,b.basePoint),presentationZ(e.position)-presentationZ(b.basePoint)*scale,scale,paint,false,[b.id]);
    if(e.attributePrimitives)walk(e.attributePrimitives,blockAttributeMatrix(e,b),e.attributeCoordinateSpace==='block-local'?presentationZ(e.position)-presentationZ(b.basePoint)*scale:presentationZ(e.position),e.attributeCoordinateSpace==='block-local'?scale:1,paint,true,[]);
  }else if(e.type==='imported_graphic')walk(e.primitives,[1,0,0,1,e.position.x,e.position.y],presentationZ(e.position),1,paint,true,[]);
  else if(e.type==='arc'||e.type==='circle')walk([{...e,kind:e.type,colorMode:'byblock'} as VectorPrimitive],identity,0,1,paint,true,[]);
  else if(e.type==='text'){const p=entityPoints(e,document.vertices)[0]!;walk([{kind:'text',layerId:e.layerId,colorMode:'byblock',position:p,content:e.content,height:e.height??e.fontSize/document.viewport.pixelsPerUnit,rotationDeg:e.rotationDeg??0}],identity,0,1,paint,true,[]);}
  else if(e.type==='line'||e.type==='polyline'||e.type==='polygon')walk([{kind:'path',layerId:e.layerId,colorMode:'byblock',points:entityPoints(e,document.vertices),closed:e.type==='polygon',fill:e.type==='polygon'&&document.styles.find(s=>s.id===(e.styleId??document.layers.find(l=>l.id===e.layerId)?.styleId))?.fill!=='none'}],identity,0,1,paint,true,[]);
}
export function primitivePresentationPoints(part:PresentationPrimitive,ppu=100):WorldPoint[]{const p=part.primitive;
  if(p.kind==='path')return p.points.map(q=>primitiveXYZ(part,q));
  if(p.kind==='circle'||p.kind==='arc')return presentationArc(p.center,p.radius,p.kind==='arc'?p.startAngle:0,p.kind==='arc'?arcSweep(p.startAngle,p.endAngle):Math.PI*2,ppu*Math.max(Math.hypot(part.matrix[0],part.matrix[1]),Math.hypot(part.matrix[2],part.matrix[3]))).map(q=>primitiveXYZ(part,q));
  if(p.kind==='text'){const anchor=primitiveXYZ(part,p.position);return textBounds(p.content,p.height).map(q=>({...anchor,x:anchor.x+q.x,y:anchor.y+q.y}));}return [];
}
export function symbolPresentationPaths(e:Extract<Entity,{type:'symbol'}>,ppu=100){const d=requireSymbol(e.libraryId,e.symbolId,e.libraryVersion);return d.geometry.map(p=>{const local=p.type==='circle'?presentationArc(p.center,p.radius,0,Math.PI*2,ppu*d.defaultSize*e.scale):primitivePoints(p);return {points:local.map(q=>symbolLocalToWorld(e,q,d)),closed:p.type==='circle'||p.type==='rect'||p.type==='polygon'};});}
const billboardParts=new WeakMap<GeoDocument,WeakMap<Entity,PresentationPrimitive[]>>();
export function presentationTextMetrics(part:PresentationPrimitive){const p=part.primitive;if(p.kind!=='text')throw new Error('Expected text');return {height:p.height*Math.max(Math.hypot(part.matrix[0],part.matrix[1]),Math.hypot(part.matrix[2],part.matrix[3])),rotation:p.rotationDeg+Math.atan2(part.matrix[1],part.matrix[0])*180/Math.PI};}
export function projectedTextCorners(part:PresentationPrimitive,context:ProjectionContext){const p=part.primitive;if(p.kind!=='text')return [];const anchor=projectXYZToAxonometric(primitiveXYZ(part,p.position),context),metrics=presentationTextMetrics(part),angle=metrics.rotation*Math.PI/180;return textBounds(p.content,metrics.height).map(q=>({x:anchor.x+q.x*Math.cos(angle)-q.y*Math.sin(angle),y:anchor.y+q.x*Math.sin(angle)+q.y*Math.cos(angle)}));}
const modelBoxes=new WeakMap<GeoDocument,WeakMap<Entity,Bounds3D|null>>();
/** Camera/orientation independent conservative XYZ bounds. Curves include exact XY extrema. */
export function entityXYZBounds(document:GeoDocument,e:Entity):Bounds3D|null {
  let cache=modelBoxes.get(document);if(!cache){cache=new WeakMap();modelBoxes.set(document,cache);}if(cache.has(e))return cache.get(e)!;
  const points:WorldPoint[]=[],texts:PresentationPrimitive[]=[];
  if(e.type==='symbol'){const d=requireSymbol(e.libraryId,e.symbolId,e.libraryVersion);points.push(...symbolBoundsPoints(e).map(p=>({...p,z:presentationZ(e.position)})),...d.ports.map(p=>symbolLocalPortToWorld(e,p,d)));}
  else if(e.type==='connector')points.push(...connectorPresentationRoute(document,e));
  else if(e.type==='label'){const p=resolvedLabelPosition(document,e);if(p)points.push(p);}
  else if(e.type==='dimension'){const [a,b]=entityPoints(e,document.vertices),d=dimensionPresentationPoints(a!,b!,e.offset,e.textPosition);points.push(a!,b!,d.start,d.end,d.label);}
  else if(e.type==='point')points.push(...entityPoints(e,document.vertices));
  else visitEntityPrimitives(document,e,{stroke:'#000',lineWeight:1,dash:undefined},part=>{const p=part.primitive;if(p.kind==='text')texts.push(part);if(p.kind==='circle'||p.kind==='arc'){for(const x of [-p.radius,p.radius])for(const y of [-p.radius,p.radius])points.push(primitiveXYZ(part,{...p.center,x:p.center.x+x,y:p.center.y+y}));}else points.push(...primitivePresentationPoints(part));},true);
  let annotations=billboardParts.get(document);if(!annotations){annotations=new WeakMap();billboardParts.set(document,annotations);}annotations.set(e,texts);const box=modelXYZBounds(points);cache.set(e,box);return box;
}
const projectedBoxes=new WeakMap<ProjectionContext,WeakMap<GeoDocument,WeakMap<Entity,Bounds|null>>>();
export function projectedOwnerBounds(document:GeoDocument,e:Entity,context:ProjectionContext){let documents=projectedBoxes.get(context);if(!documents){documents=new WeakMap();projectedBoxes.set(context,documents);}let entities=documents.get(document);if(!entities){entities=new WeakMap();documents.set(document,entities);}if(entities.has(e))return entities.get(e)!;const xyz=entityXYZBounds(document,e),points=xyz?boxXYZCorners(xyz).map(p=>projectXYZToAxonometric(p,context)):[];for(const text of billboardParts.get(document)?.get(e)??[])points.push(...projectedTextCorners(text,context));if(e.type==='label'){const p=resolvedLabelPosition(document,e);if(p){const anchor=projectXYZToAxonometric(p,context),unit=1/document.viewport.pixelsPerUnit;points.push({x:anchor.x-7*unit,y:anchor.y-7*unit},{x:anchor.x+(e.template.length*9+16)*unit,y:anchor.y+20*unit});}}const box=bounds(points);entities.set(e,box);return box;}
export function projectedSceneBounds(document:GeoDocument,context:ProjectionContext,ids?:readonly string[],layerId?:string){const selected=ids?new Set(ids):null;const items=ids||layerId?document.entities.map(entity=>({entity})):renderItems(document);return bounds(items.filter(({entity:e})=>(!selected||selected.has(e.id))&&(!layerId||e.layerId===layerId)).flatMap(({entity:e})=>{const b=projectedOwnerBounds(document,e,context);return b?[{x:b.minX,y:b.minY},{x:b.maxX,y:b.maxY}]:[];}));}
export function projectionOrigin(document:GeoDocument):WorldPoint{const boxes=renderItems(document).flatMap(({entity:e})=>{const b=entityXYZBounds(document,e);return b?boxXYZCorners(b):[];}),b=modelXYZBounds(boxes);return b?{x:b.minX/2+b.maxX/2,y:b.minY/2+b.maxY/2,z:b.minZ/2+b.maxZ/2}:{x:0,y:0,z:0};}
export function sortProjectedItems(items:RenderItem[],document:GeoDocument,context:ProjectionContext){const depth=(e:Entity)=>{const b=entityXYZBounds(document,e);return b?axonometricDepth({x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2,z:(b.minZ+b.maxZ)/2},context):0;};const depths=new Map(items.map(i=>[i.entity,depth(i.entity)]));return [...items].sort((a,b)=>Number(['text','label'].includes(a.entity.type))-Number(['text','label'].includes(b.entity.type))||a.layer.order-b.layer.order||depths.get(a.entity)!-depths.get(b.entity)!||a.entity.id.localeCompare(b.entity.id));}
interface ProjectedIndex {index:BoundsIndex<RenderItem>;ranks:Map<Entity,number>;screenAnnotations:RenderItem[]}
const indexes=new WeakMap<ProjectionContext,WeakMap<GeoDocument,ProjectedIndex>>();
export function hitProjectedEntities(document:GeoDocument,point:ScreenPoint,view:RenderCamera,size:ViewSize):string[]{const context=view.projection;if(!context)return [];let cache=indexes.get(context);if(!cache){cache=new WeakMap();indexes.set(context,cache);}let scene=cache.get(document);if(!scene){const ordered=sortProjectedItems(renderItems(document),document,context);scene={index:new BoundsIndex(ordered.flatMap(item=>{const box=projectedOwnerBounds(document,item.entity,context);return box?[{box,value:item}]:[];})),ranks:new Map(ordered.map((i,n)=>[i.entity,n])),screenAnnotations:ordered.filter(i=>i.entity.type==='label'||i.entity.type==='text'&&!i.entity.height)};cache.set(document,scene);}const q=screenToWorld(point,view,size),tol=14/view.pixelsPerUnit;
  const broad=scene.index.query({minX:q.x-tol,maxX:q.x+tol,minY:q.y-tol,maxY:q.y+tol});const candidates=[...new Set([...broad,...scene.screenAnnotations])].sort((a,b)=>scene!.ranks.get(b.entity)!-scene!.ranks.get(a.entity)!);
  const pathHit=(ps:WorldPoint[],closed=false,fill=false)=>{const ss=ps.map(p=>worldToScreen(p,view,size));for(let i=1;i<ss.length;i++)if(distanceToSegment(point,ss[i-1]!,ss[i]!)<=7)return true;if(closed&&ss.length>1&&distanceToSegment(point,ss.at(-1)!,ss[0]!)<=7)return true;if(fill){let inside=false;for(let i=0,j=ss.length-1;i<ss.length;j=i++){const a=ss[i]!,b=ss[j]!;if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}return false;};
  return candidates.filter(({entity:e})=>{if(e.type==='point'){const p=worldToScreen(entityPoints(e,document.vertices)[0]!,view,size);return Math.hypot(p.x-point.x,p.y-point.y)<=14;}if(e.type==='symbol')return symbolPresentationPaths(e,view.pixelsPerUnit).some(p=>pathHit(p.points,p.closed,true));if(e.type==='connector')return pathHit(connectorPresentationRoute(document,e));if(e.type==='label'||e.type==='text'){const anchor=e.type==='label'?resolvedLabelPosition(document,e):entityPoints(e,document.vertices)[0];if(!anchor)return false;const p=worldToScreen(anchor,view,size),content=e.type==='text'?e.content:resolveLabelTemplate(document,e),font=e.type==='text'?(e.height?e.height*view.pixelsPerUnit:e.fontSize):12;const theta=(e.type==='text'?(e.rotationDeg??0):0)*Math.PI/180,dx=point.x-p.x,dy=point.y-p.y,local={x:dx*Math.cos(theta)-dy*Math.sin(theta),y:dx*Math.sin(theta)+dy*Math.cos(theta)},lines=content.split('\n');return local.x>=-7&&local.x<=Math.max(28,Math.max(...lines.map(l=>l.length))*font*.7+14)&&local.y>=-font-7&&local.y<=(lines.length-1)*font*1.2+7;}
    if(e.type==='dimension'){const [a,b]=entityPoints(e,document.vertices),d=dimensionPresentationPoints(a!,b!,e.offset,e.textPosition);return pathHit([a!,d.start,d.end,b!]);}
    let hit=false;const fillHits=new Map<string,boolean>();visitEntityPrimitives(document,e,{stroke:'#000',lineWeight:1,dash:undefined},part=>{if(hit)return;const p=part.primitive;if(p.kind==='text'){const corners=projectedTextCorners(part,context),flat={center:view.center,pixelsPerUnit:view.pixelsPerUnit},b=bounds(corners.map(q=>worldToScreen(q,flat,size)))!;hit=point.x>=b.minX-7&&point.x<=b.maxX+7&&point.y>=b.minY-7&&point.y<=b.maxY+7;}else {const ps=primitivePresentationPoints(part,view.pixelsPerUnit),closed=p.kind==='path'&&p.closed;if(p.kind==='path'&&p.fill&&p.fillGroup){hit=pathHit(ps,closed,false);const key=`${part.fillScope}:${p.fillGroup}`;fillHits.set(key,(fillHits.get(key)??false)!==pathHit(ps,closed,true));}else hit=pathHit(ps,closed,p.kind==='path'&&!!p.fill);}});return hit||[...fillHits.values()].some(Boolean);}).sort((a,b)=>Number(b.entity.type==='point')-Number(a.entity.type==='point')).map(i=>i.entity.id);
}
export const projectedPoint=(point:WorldPoint,context:ProjectionContext)=>projectXYZToAxonometric(point,context);
