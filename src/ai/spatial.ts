import { entityPoints, worldVertex, type GeoDocument } from '../domain/model';
import { bounds, pathLength } from '../geometry';
import { autoLayoutGap, offsetPolygonSide, relativeCenter, spatialFrame } from '../geometry/spatialLayout';
import type { AiAction } from './intent';
import type { ResolutionFailure, PolylineReady, References } from './resolver';
import { resolveEntityReference, type EntityReferenceContext } from './entityReferences';
import { resolveCreateRectangle, type RectangleReady } from './construction';
import type { LayoutAssumption } from './assumptions';
export type ArrayReady = References & {status:'ready';kind:'array';rectangles:RectangleReady[];assumptions:LayoutAssumption[];targetLayer:string};
export function resolveSpatialAction(intent:Extract<AiAction,{type:'create_rectangle_array'|'create_line_along_polygon_edge'}>,document:GeoDocument,context:EntityReferenceContext,actionId:string,targetLayerId:string): ArrayReady|PolylineReady|ResolutionFailure {
  const ref=resolveEntityReference(intent.reference,context,intent.type==='create_line_along_polygon_edge');
  if(ref.status!=='resolved') return ref;
  const layer=document.layers.find(l=>l.id===targetLayerId);
  if(!layer||!layer.visible||layer.locked) return {status:'invalid',message:'Выберите видимый незаблокированный слой новых объектов.'};
  const geometry=entityPoints(ref.entity,ref.document.vertices),frame=spatialFrame(context.baseDocument);
  const frameMessage=`Объект: «${ref.entity.name}». Направления: ${frame.name}.${frame.stale?' Геопривязка устарела; используем MODEL.':''}`;
  if(intent.type==='create_line_along_polygon_edge') {
    const offset=offsetPolygonSide(geometry,intent.side,intent.offsetMeters,intent.offsetSide==='outside',frame);
    if(offset.status!=='ready') return offset;
    const vertices=offset.geometry.map((p,i)=>worldVertex(`${actionId}-vertex-${i+1}`,p));
    const entity={id:`geometry-${actionId}`,type:'polyline' as const,name:intent.name,layerId:targetLayerId,vertexIds:vertices.map(v=>v.id) as [string,string,...string[]]};
    return {status:'ready',kind:'polyline',geometry:offset.geometry,references:[],length:pathLength(offset.geometry),segments:vertices.length-1,targetLayer:targetLayerId,
      warnings:[`${frameMessage} Сторона: ${intent.side}. Offset: ${intent.offsetMeters.toFixed(3)} м, ${intent.offsetSide}. Эскизный отступ; при отсутствии указания inside/outside используется outside, это не норматив проектирования.`],command:{type:'add-entity',entity,vertices}};
  }
  const b=bounds(geometry.map(frame.to))!;
  const size=frame.footprint(intent.width,intent.height),horizontal=intent.direction==='north'||intent.direction==='south';
  const group={width:horizontal?size.width*intent.count+intent.itemGap*(intent.count-1):size.width,height:horizontal?size.height:size.height*intent.count+intent.itemGap*(intent.count-1)};
  const gap=intent.gapFromReference??autoLayoutGap(b),center=relativeCenter(b,group,intent.direction,gap);
  const rectangles:RectangleReady[]=[];
  for(let i=0;i<intent.count;i++) {
    const displacement=(i-(intent.count-1)/2)*((horizontal?size.width:size.height)+intent.itemGap);
    const world=frame.from({x:center.x+(horizontal?displacement:0),y:center.y+(horizontal?0:displacement)});
    const rectangle=resolveCreateRectangle({type:'create_rectangle',name:`${intent.nameBase} ${i+1}`,width:intent.width,height:intent.height,placement:{type:'center',x:world.x,y:world.y}},document,context.outputs,`${actionId}-item-${i+1}`,{targetLayerId});
    if(rectangle.status!=='ready') return rectangle;
    rectangles.push(rectangle);
  }
  return {status:'ready',kind:'array',rectangles,geometry:[],references:[],warnings:[],targetLayer:targetLayerId,
    assumptions:[{type:'spatial',message:`${frameMessage} Направление: ${intent.direction}. ${intent.count} × ${intent.width}×${intent.height} м. Между bounding extents: ${intent.itemGap.toFixed(3)} м. Gap от объекта: ${gap.toFixed(3)} м (${intent.gapFromReference==null?'Auto, эскизный':'явный'}). Вся группа центрирована, распределение по перпендикулярной оси. Ориентация прямоугольников MODEL.`}]};
}
