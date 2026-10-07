import { connectorRoute, portTargetError, samePort } from '../connectors/model';
import { applyCommandsAtomically, type DocumentCommand } from '../domain/commands';
import { newGeometryId } from '../domain/geometryIntent';
import { entityVertexIds, type ConnectorEntity, type GeoDocument } from '../domain/model';
import type { Point, RouteCandidate, RouteReview, TopologyGraph } from './types';
import { distance } from './spatial';
function simplify(points:Point[],tolerance:number){const result:Point[]=[];for(const p of points){if(result.length&&distance(p,result.at(-1)!)<=tolerance)continue;result.push(p);while(result.length>2){const a=result.at(-3)!,b=result.at(-2)!,c=result.at(-1)!,dx=c.x-a.x,dy=c.y-a.y,l=Math.hypot(dx,dy),t=((b.x-a.x)*dx+(b.y-a.y)*dy)/(l*l||1);if(t<0||t>1||Math.abs(dx*(b.y-a.y)-dy*(b.x-a.x))/(l||1)>tolerance)break;result.splice(result.length-2,1);}}return result;}
export function resolvedRoute(document:GeoDocument,graph:TopologyGraph,route:RouteCandidate,review:RouteReview):{entity?:ConnectorEntity;reason?:string} {
 if(review.status!=='confirmed')return {reason:'Связь не подтверждена.'};
 const start=review.start??(route.startOptions.length===1?route.startOptions[0]!.endpoint:undefined),end=review.end??(route.endOptions.length===1?route.endOptions[0]!.endpoint:undefined);
 if(!start||!end)return {reason:'Выберите порты обоих концов.'};
 if(!route.startOptions.some(p=>samePort(p.endpoint,start))||!route.endOptions.some(p=>samePort(p.endpoint,end)))return {reason:'Выбранный порт не принадлежит кандидатам этого пути.'};
 if(start.symbolEntityId===end.symbolEntityId)return {reason:'Путь внутри одного символа оставлен геометрией.'};
 const error=portTargetError(document,start,end)??portTargetError(document,end,start);if(error)return {reason:error};
 if(route.branched)return {reason:'Ветвление требует будущей модели узлов. Исходная геометрия сохранена.'};
 if(graph.findings.some(f=>f.kind==='crossing'&&f.classification==='REJECTED'&&f.sourceGeometryIds.some(id=>route.sourceGeometryIds.includes(id))))return {reason:'Наложение путей или несовместимые категории. Геометрия сохранена.'};
 if(graph.findings.some(f=>f.kind==='crossing'&&f.sourceGeometryIds.some(id=>route.sourceGeometryIds.includes(id))&&!f.reviewed))return {reason:'Сначала уточните пересечения этого пути.'};
 const ids=new Set(route.sourceGeometryIds),sources=document.entities.filter(e=>ids.has(e.id));
 if(sources.length!==ids.size||sources.some(e=>e.type!=='line'&&e.type!=='polyline'))return {reason:'Исходная геометрия недоступна.'};
 const layerId=sources[0]!.layerId;
 if(sources.some(e=>e.layerId!==layerId)||!document.layers.some(l=>l.id===layerId&&l.visible&&!l.locked))return {reason:'Для замены нужен один видимый незаблокированный слой.'};
 const used=new Set(route.edgeIds);
 if(graph.edges.some(e=>e.sourceGeometryIds.some(id=>ids.has(id))&&!used.has(e.id)))return {reason:'Маршрут использует только часть исходного объекта. Геометрия сохранена.'};
 const vertexIds=new Set(sources.flatMap(entityVertexIds));
 if(document.entities.some(e=>!ids.has(e.id)&&(e.type==='label'&&ids.has(e.targetId)||entityVertexIds(e).some(v=>vertexIds.has(v)))))return {reason:'Исходная геометрия имеет общие вершины или связанные подписи. Геометрия сохранена.'};
 if(sources.some(e=>JSON.stringify([e.styleId,e.style])!==JSON.stringify([sources[0]!.styleId,sources[0]!.style])))return {reason:'Участки имеют разные стили. Геометрия сохранена.'};
 const original=sources[0]!;const base={...(original.styleId?{styleId:original.styleId}:{}),...(original.style?{style:original.style}:{}),id:'topology-preview',type:'connector' as const,name:'Восстановленная связь',layerId,start,end},tolerance=graph.diagnostics.tolerances.port,shape=simplify(route.points,tolerance);
 for(const routing of ['direct','orthogonal'] as const){const entity:ConnectorEntity={...base,routing},candidate=simplify(connectorRoute(document,entity),tolerance);if(shape.length===candidate.length&&shape.every((p,i)=>distance(p,candidate[i]!)<=tolerance))return {entity};}
 return {reason:'Текущая маршрутизация Connector не сохраняет форму пути. Line / Polyline оставлены без изменения.'};
}
/** Explicit product policy: replace complete faithful unbranched owners atomically; never hide duplicates. */
export function topologyCommands(document:GeoDocument,graph:TopologyGraph,reviews:Record<string,RouteReview>):DocumentCommand[]{
 const commands:DocumentCommand[]=[],replaced=new Set<string>(),annotationTransfers:{entityId:string;conceptId:string;polarity:'positive';source:'user-explicit'}[]=[];
 for(const route of graph.routes){const review=reviews[route.id];if(!review||review.status!=='confirmed')continue;const working=commands.length?applyCommandsAtomically(document,commands):document,result=resolvedRoute(working,graph,route,review);if(!result.entity){if(resolvedRoute(document,graph,route,review).entity)throw new Error('Подтверждённые связи конфликтуют за порт или исходную геометрию. Оставьте одну связь.');continue;}
 if(route.sourceGeometryIds.some(id=>replaced.has(id)))throw new Error('Два подтверждённых пути используют одну геометрию. Оставьте один путь.');
 const id=newGeometryId('topology-connector'),runs=[...new Set(document.entities.filter(e=>route.sourceGeometryIds.includes(e.id)).flatMap(e=>e.imageSource?[e.imageSource.vectorizationRunId]:[]))];
 const entity:ConnectorEntity={...result.entity,id,topologySource:{source:'topology-reconstruction',sourceGeometryIds:route.sourceGeometryIds,resolution:'user-confirmed',...(runs.length===1?{sourceImageRunId:runs[0]!}:{})}};
 for(const sourceId of route.sourceGeometryIds){commands.push({type:'delete-entity',entityId:sourceId});replaced.add(sourceId);}
 commands.push({type:'add-entity',entity,vertices:[]});
 const concepts=new Set(document.semantics?.annotations.filter(a=>a.polarity==='positive'&&route.sourceGeometryIds.includes(a.entityId)).map(a=>a.conceptId));
 for(const conceptId of concepts)if(route.sourceGeometryIds.every(sourceId=>document.semantics!.annotations.some(a=>a.entityId===sourceId&&a.conceptId===conceptId&&a.polarity==='positive')))annotationTransfers.push({entityId:id,conceptId,polarity:'positive',source:'user-explicit'});
 }
 if(!commands.length)throw new Error('Нет подтверждённых связей, которые можно точно представить Connector. Геометрия сохранена.');
 if(annotationTransfers.length){const current=applyCommandsAtomically(document,commands);commands.push({type:'set-semantic-knowledge',knowledge:{...current.semantics!,annotations:[...current.semantics!.annotations,...annotationTransfers]}});}
 applyCommandsAtomically(document,commands);return commands;
}
