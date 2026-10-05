import type { SymbolEntity } from '../domain/model';
import { bounds } from '../geometry';
import { requireSymbol } from './registry';
import { normalizeSymbolRotation, type SymbolDefinition, type SymbolPoint, type SymbolPort, type SymbolPrimitive } from './types';
export function symbolLocalToWorld(instance:SymbolEntity, point:SymbolPoint, definition:SymbolDefinition=requireSymbol(instance.libraryId,instance.symbolId)):SymbolPoint {
  const theta=instance.rotationDeg*Math.PI/180, scale=instance.scale*definition.defaultSize;
  return {x:instance.position.x+scale*(point.x*Math.cos(theta)-point.y*Math.sin(theta)),y:instance.position.y+scale*(point.x*Math.sin(theta)+point.y*Math.cos(theta))};
}
export function symbolLocalPortToWorld(instance:SymbolEntity,port:SymbolPort,definition?:SymbolDefinition) {
  return {...symbolLocalToWorld(instance,port.position,definition),directionDeg:normalizeSymbolRotation(port.directionDeg+instance.rotationDeg)};
}
export function primitivePoints(primitive:Exclude<SymbolPrimitive,{type:'circle'}>):SymbolPoint[] {
  if(primitive.type==='line') return [primitive.start,primitive.end];
  if(primitive.type==='rect') { const {position:p,width:w,height:h}=primitive; return [p,{x:p.x+w,y:p.y},{x:p.x+w,y:p.y+h},{x:p.x,y:p.y+h}]; }
  return primitive.points;
}
/** Axis-aligned MODEL bounds, including exact circle extrema; ports are passive metadata. */
export function symbolWorldBounds(instance:SymbolEntity) {
  const definition=requireSymbol(instance.libraryId,instance.symbolId);
  return bounds(definition.geometry.flatMap(primitive=>{
    if(primitive.type!=='circle') return primitivePoints(primitive).map(point=>symbolLocalToWorld(instance,point,definition));
    const center=symbolLocalToWorld(instance,primitive.center,definition),r=primitive.radius*definition.defaultSize*instance.scale;
    return [{x:center.x-r,y:center.y-r},{x:center.x+r,y:center.y+r}];
  }))!;
}
export const symbolBoundsPoints=(instance:SymbolEntity)=>{
  const b=symbolWorldBounds(instance); return [{x:b.minX,y:b.minY},{x:b.maxX,y:b.minY},{x:b.maxX,y:b.maxY},{x:b.minX,y:b.maxY}];
};
