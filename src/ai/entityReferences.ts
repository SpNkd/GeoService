import { entityPoints, type Entity, type GeoDocument } from '../domain/model';
import { bounds } from '../geometry';
import type { EntityReference } from './intent';
import type { ExplicitResolutions, ResolutionFailure, ResolvedBoundaryOutput } from './resolver';
export const normalizedEntityName = (name:string) => name.trim().toLowerCase();
const indexes=new WeakMap<GeoDocument['entities'],ReadonlyMap<string,readonly Entity[]>>();
export function entityNameIndex(entities:GeoDocument['entities']) {
  let index=indexes.get(entities);
  if(!index) {const result=new Map<string,Entity[]>();for(const entity of entities) {const key=normalizedEntityName(entity.name);result.set(key,[...(result.get(key)??[]),entity]);} indexes.set(entities,result);index=result;}
  return index;
}
export interface EntityReferenceContext {baseDocument:GeoDocument;projectedDocument:GeoDocument;outputs:ReadonlyMap<number,ResolvedBoundaryOutput>;choices:ExplicitResolutions;selectionEntityIds:readonly string[]}
export function resolveEntityReference(ref:EntityReference,context:EntityReferenceContext,polygonOnly=false):ResolutionFailure|{status:'resolved';entity:Entity;document:GeoDocument} {
  const document=ref.kind==='prior_action_result'?context.projectedDocument:context.baseDocument;
  const compatible=(e:Entity)=>polygonOnly?e.type==='polygon':['point','line','polyline','polygon'].includes(e.type);
  let candidates:Entity[];
  if(ref.kind==='prior_action_result') {
    const output=context.outputs.get(ref.actionIndex);
    if(!output) return {status:'blocked',dependencyIndex:ref.actionIndex,message:`Сначала исправьте Action ${ref.actionIndex+1}`};
    candidates=document.entities.filter(e=>e.id===output.entityId&&compatible(e));
  } else if(ref.kind==='current_selection') {
    candidates=document.entities.filter(e=>context.selectionEntityIds.includes(e.id)&&compatible(e));
    if(candidates.length!==1) return candidates.length?{status:'invalid',message:'Для этой операции должен быть выбран один совместимый объект.'}:{status:'unresolved',issues:[{kind:'missing',name:'current_selection',scope:'entity',displayName:'Выбранный объект'}]};
  } else candidates=[...(entityNameIndex(document.entities).get(normalizedEntityName(ref.name))??[])].filter(compatible);
  const name=ref.kind==='named_entity'?ref.name:'Объект',key=`entity:${normalizedEntityName(name)}`;
  const choice=context.choices.get(key),chosen=choice?candidates.find(e=>e.id===choice):undefined;
  if(choice&&!chosen) return {status:'invalid',message:`Выбранный объект «${name}» больше не соответствует ссылке.`};
  if(!candidates.length) return {status:'unresolved',issues:[{kind:'missing',name:key,scope:'entity',displayName:name}]};
  if(candidates.length>1&&!chosen) return {status:'unresolved',issues:[{kind:'ambiguous',name:key,scope:'entity',displayName:name,candidates:candidates.map(entity=> {
    const geometry=entityPoints(entity,document.vertices),b=bounds(geometry)!;
    return {name:entity.name,entityId:entity.id,vertexId:'',position:{x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2},layer:document.layers.find(l=>l.id===entity.layerId)?.name??entity.layerId,entityType:entity.type,bounds:b};
  })}]};
  return {status:'resolved',entity:chosen??candidates[0]!,document};
}
