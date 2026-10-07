import {routeLabels} from './constraintSchema';
import { entityPoints, worldVertex, type Entity, type GeoDocument, type WorldPoint } from '../domain/model';
import { bounds, pathLength } from '../geometry';
import type { AiAction } from './intent';
import type { ConstraintReference, LocalAnswers, LocalQuestion } from './constraintSchema';
import type { ResolutionFailure, PolylineReady } from './resolver';
import { resolveCreatePoints, type PointsReady } from './construction';
import { resolveEntityReference, type EntityReferenceContext } from './entityReferences';
import { boundaryRoute, distance, insetPlacement, nearestOnContour, segmentInside, shortestInside } from './constraintGeometry';
export interface ConstraintContext extends EntityReferenceContext { results:ReadonlyMap<number,{entity:Entity;document:GeoDocument}>;answers:LocalAnswers }
export function resolveConstraintReference(ref:ConstraintReference,context:ConstraintContext):ResolutionFailure|{status:'resolved';entity:Entity;document:GeoDocument} {
  if(ref.kind!=='action')return resolveEntityReference(ref,context);
  const result=context.results.get(ref.actionIndex);
  if(!result)return {status:'blocked',dependencyIndex:ref.actionIndex,message:`Сначала разрешите действие ${ref.actionIndex+1}.`};
  if(ref.result==='point'&&result.entity.type!=='point'||ref.result==='boundary'&&result.entity.type!=='polygon')return {status:'invalid',message:'Тип результата не соответствует ссылке на точку или границу.'};
  return {status:'resolved',...result};
}
export const orientationQuestion=(id:string,name:string,width:number,height:number):LocalQuestion=>({questionId:`${id}:orientation`,kind:'single_choice',prompt:`Как ориентировать «${name}»?`,context:'Размеры и размещение сохранены; ответ применяется локально.',options:[{value:'MODEL',label:`${width} м по X, ${height} м по Y`},{value:'SWAPPED',label:`${height} м по X, ${width} м по Y`}]});
export const routingQuestion=(id:string):LocalQuestion=>({questionId:`${id}:route`,kind:'single_choice',prompt:'Как провести маршрут?',context:'Концы маршрута сохранены; ответ применяется локально.',options:[{value:'DIRECT',label:'Прямо'},{value:'FOLLOW_BOUNDARY',label:'По границе'},{value:'ORTHOGONAL',label:'Под прямым углом'},{value:'SHORTEST_INSIDE',label:'Кратчайший внутри'}]});
export function resolveConstraintAction(intent:Extract<AiAction,{type:'create_spatial_point'|'create_route'}>,document:GeoDocument,context:ConstraintContext,actionId:string,targetLayerId:string):PointsReady|PolylineReady|ResolutionFailure {
  if(intent.type==='create_spatial_point'){
    const p=intent.placement;let point:WorldPoint,explanation:string;
    if(p.type==='between'){
      const a=resolveConstraintReference(p.from,context),b=resolveConstraintReference(p.to,context);if(a.status!=='resolved')return a;if(b.status!=='resolved')return b;
      if(a.entity.type!=='point'||b.entity.type!=='point')return {status:'invalid',message:'Середина между точками требует две ссылки типа point.'};
      const x=entityPoints(a.entity,a.document.vertices)[0]!,y=entityPoints(b.entity,b.document.vertices)[0]!;point={x:(x.x+y.x)/2,y:(x.y+y.y)/2};explanation='Середина между двумя точками: локальное среднее координат.';
    } else {
      const r=resolveConstraintReference(p.reference,context);if(r.status!=='resolved')return r;
      const geometry=entityPoints(r.entity,r.document.vertices);
      if(p.type==='inside_boundary'){
        if(r.entity.type!=='polygon')return {status:'invalid',message:'Размещение внутри требует замкнутую границу.'};
        const solved=insetPlacement(p,geometry,0,0);if('message'in solved)return solved.unsupported?{status:'unsupported',message:solved.message,alternatives:['Используйте прямоугольную границу MODEL.']}:{status:'invalid',message:solved.message};point=solved.origin;explanation=`${intent.name}: ${solved.explanation}`;
      } else {const b=bounds(geometry);if(!b)return {status:'invalid',message:'У объекта нет геометрии для относительного размещения.'};point={x:p.direction==='east'?b.maxX+p.distance:p.direction==='west'?b.minX-p.distance:(b.minX+b.maxX)/2,y:p.direction==='north'?b.maxY+p.distance:p.direction==='south'?b.minY-p.distance:(b.minY+b.maxY)/2};explanation=`${intent.name}: ${p.distance} м ${p.direction} от внешнего контура «${r.entity.name}».`;}
    }
    const result=resolveCreatePoints({type:'create_points',points:[{name:intent.name,...point}]},document,actionId,targetLayerId);
    return result.status==='ready'?{...result,explanation,warnings:['Обозначение — именованная эскизная точка; инженерный тип оборудования не назначается.']}:result;
  }
  const requested=context.answers.get(`${actionId}:route`)??(intent.mode==='ASK'?undefined:intent.mode);
  if(!requested)return {status:'needs_clarification',questions:[routingQuestion(actionId)]};
  if(!['DIRECT','FOLLOW_BOUNDARY','ORTHOGONAL','SHORTEST_INSIDE'].includes(requested))return {status:'invalid',message:'Выберите поддерживаемый способ маршрута.'};
  const source=resolveConstraintReference(intent.source,context),target=resolveConstraintReference(intent.target,context);
  if(source.status!=='resolved')return source;if(target.status!=='resolved')return target;
  const sg=entityPoints(source.entity,source.document.vertices),tg=entityPoints(target.entity,target.document.vertices);
  if(!sg.length||!tg.length)return {status:'invalid',message:'Концы маршрута не имеют доступной геометрии.'};
  // A polygon is an object, never a fictitious named point. Connect to its nearest contour.
  const tb=bounds(tg)!,sc=source.entity.type==='point'?sg[0]!:nearestOnContour({x:(tb.minX+tb.maxX)/2,y:(tb.minY+tb.maxY)/2},sg,source.entity.type==='polygon').point;
  const tc=target.entity.type==='point'?tg[0]!:nearestOnContour(sc,tg,target.entity.type==='polygon').point;
  let poly:WorldPoint[]|null=null;
  if(intent.boundary){const r=resolveConstraintReference(intent.boundary,context);if(r.status!=='resolved')return r;if(r.entity.type!=='polygon')return {status:'invalid',message:'Маршрут по границе требует polygon.'};poly=entityPoints(r.entity,r.document.vertices);
    if(poly.length>128)return {status:'unsupported',message:'Маршрут поддерживает границы до 128 вершин.',alternatives:['Используйте упрощённый контур.']};
    if(intent.boundaryOffset>0){const b=bounds(poly)!;if(poly.length!==4||poly.some(v=>![b.minX,b.maxX].includes(v.x)||![b.minY,b.maxY].includes(v.y)))return {status:'unsupported',message:'Внутренний отступ маршрута поддерживается только для прямоугольной границы MODEL.',alternatives:['Выберите прямоугольную границу или маршрут без отступа.']};const d=intent.boundaryOffset;if(2*d>=Math.min(b.maxX-b.minX,b.maxY-b.minY))return {status:'invalid',message:'Отступ маршрута больше доступного размера границы.'};poly=[{x:b.minX+d,y:b.minY+d},{x:b.maxX-d,y:b.minY+d},{x:b.maxX-d,y:b.maxY-d},{x:b.minX+d,y:b.maxY-d}];}
  }
  let geometry:WorldPoint[]|null;
  if(requested==='FOLLOW_BOUNDARY')geometry=poly?boundaryRoute(sc,tc,poly):null;
  else if(requested==='SHORTEST_INSIDE')geometry=poly?shortestInside(sc,tc,poly):null;
  else if(requested==='ORTHOGONAL'){const paths=[[sc,{x:tc.x,y:sc.y},tc],[sc,{x:sc.x,y:tc.y},tc]];geometry=paths.find(p=>!poly||p.slice(1).every((v,i)=>segmentInside(p[i]!,v,poly!)))??null;}
  else geometry=[sc,tc];
  if(!geometry)return {status:'invalid',message:'Для выбранного маршрута нужна доступная граница и совместимые концы внутри неё.'};
  geometry=geometry.filter((v,i,p)=>!i||distance(v,p[i-1]!)>1e-8);
  if(geometry.length<2||poly&&geometry.slice(1).some((v,i)=>!segmentInside(geometry![i]!,v,poly)))return {status:'invalid',message:'Маршрут выходит за границу или его концы совпадают.'};
  const vertices=geometry.map((v,i)=>worldVertex(`${actionId}-route-${i}`,v)),layer=document.layers.find(l=>l.id===targetLayerId);
  if(!layer||!layer.visible||layer.locked)return {status:'invalid',message:'Выберите доступный слой маршрута.'};
  const explanation=`${intent.name}: ${routeLabels[requested as keyof typeof routeLabels]}; «${source.entity.name}» → ближайшая точка контура «${target.entity.name}». ${requested==='FOLLOW_BOUNDARY'?'Кратчайший из двух обходов границы; ввод и выход внутрь участка.':''}`;
  return {status:'ready',kind:'polyline',geometry,references:[],explanation,warnings:[],length:pathLength(geometry),segments:geometry.length-1,targetLayer:targetLayerId,command:{type:'add-entity',vertices,entity:{type:'polyline',id:`geometry-${actionId}`,name:intent.name,layerId:targetLayerId,vertexIds:vertices.map(v=>v.id) as [string,string,...string[]]}}};
}
