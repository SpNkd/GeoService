import type { ConnectorEndpoint, ConnectorEntity, Entity, GeoDocument, SymbolEntity, WorldPoint } from '../domain/model';
import { requireSymbol } from '../symbols/registry';
import { symbolLocalPortToWorld } from '../symbols/transforms';
import type { SymbolPort } from '../symbols/types';

export const portKey = (endpoint:ConnectorEndpoint) => JSON.stringify([endpoint.symbolEntityId,endpoint.portId]);
export const samePort = (a:ConnectorEndpoint,b:ConnectorEndpoint) => a.symbolEntityId===b.symbolEntityId && a.portId===b.portId;
export const compatiblePorts = (a:SymbolPort,b:SymbolPort) => a.kind===b.kind;
export const portCapacity = (port:SymbolPort) => port.maxConnections??1;
export interface ConnectivityIndex {
  entities:ReadonlyMap<string,Entity>;
  bySymbol:ReadonlyMap<string,readonly string[]>;
  byPort:ReadonlyMap<string,readonly string[]>;
  byConnector:ReadonlyMap<string,{start:ConnectorEndpoint;end:ConnectorEndpoint}>;
}
const indexes=new WeakMap<GeoDocument,ConnectivityIndex>();
/** Derived from an immutable document; never persisted or sent to providers. */
export function connectivityIndex(document:GeoDocument):ConnectivityIndex {
  const cached=indexes.get(document);if(cached)return cached;
  const bySymbol=new Map<string,string[]>(),byPort=new Map<string,string[]>(),byConnector=new Map<string,{start:ConnectorEndpoint;end:ConnectorEndpoint}>();
  const append=(map:Map<string,string[]>,key:string,id:string)=>{const ids=map.get(key)??[];if(!ids.includes(id))ids.push(id);map.set(key,ids);};
  for(const e of document.entities)if(e.type==='connector'){
    byConnector.set(e.id,{start:e.start,end:e.end});
    for(const endpoint of [e.start,e.end]){append(bySymbol,endpoint.symbolEntityId,e.id);append(byPort,portKey(endpoint),e.id);}
  }
  const result={entities:new Map(document.entities.map(e=>[e.id,e])),bySymbol,byPort,byConnector};indexes.set(document,result);return result;
}
export function resolvePort(document:GeoDocument,endpoint:ConnectorEndpoint) {
  if(endpoint.kind!=='symbol_port')throw new Error('Конец соединения должен ссылаться на порт символа.');
  const entity=connectivityIndex(document).entities.get(endpoint.symbolEntityId);
  if(!entity||entity.type!=='symbol')throw new Error('Символ подключения не найден.');
  const definition=requireSymbol(entity.libraryId,entity.symbolId,entity.libraryVersion),port=definition.ports.find(p=>p.id===endpoint.portId);
  if(!port)throw new Error(`Порт «${endpoint.portId}» символа «${entity.name}» не найден.`);
  if(!document.layers.some(l=>l.id===entity.layerId))throw new Error('Слой символа подключения не найден.');
  const world=symbolLocalPortToWorld(entity,port,definition);
  if(!Number.isFinite(world.x)||!Number.isFinite(world.y))throw new Error('Позиция порта выходит за диапазон координат.');
  return {entity,definition,port,world};
}
/** Central policy shared by hover, create, retarget and JSON semantic validation. */
export function portTargetError(document:GeoDocument,target:ConnectorEndpoint,other?:ConnectorEndpoint,excludeConnectorId?:string):string|null {
  try {
    const resolved=resolvePort(document,target);
    if(other){if(samePort(target,other))return 'Нельзя соединить порт с самим собой.';if(!compatiblePorts(resolved.port,resolvePort(document,other).port))return 'Несовместимые типы портов.';}
    const occupied=(connectivityIndex(document).byPort.get(portKey(target))??[]).filter(id=>id!==excludeConnectorId).length;
    if(occupied>=portCapacity(resolved.port))return 'Порт уже подключён.';
    return null;
  }catch(error){return error instanceof Error?error.message:'Неверный порт.';}
}
export function validateConnector(document:GeoDocument,connector:ConnectorEntity) {
  if(!document.layers.some(l=>l.id===connector.layerId))throw new Error('Слой соединения не найден.');
  for(const [endpoint,other] of [[connector.start,connector.end],[connector.end,connector.start]]){
    const error=portTargetError(document,endpoint!,other!,connector.id);if(error)throw new Error(error);
  }
}
export function validateConnectivity(document:GeoDocument) {
  for(const e of document.entities)if(e.type==='connector')validateConnector(document,e);
}
export function symbolVisible(document:GeoDocument,symbol:SymbolEntity) {return symbol.visible!==false&&document.layers.some(l=>l.id===symbol.layerId&&l.visible);}
export function connectorVisible(document:GeoDocument,connector:ConnectorEntity) {
  const index=connectivityIndex(document);
  return [connector.start,connector.end].every(endpoint=>{const symbol=index.entities.get(endpoint.symbolEntityId);return symbol?.type==='symbol'&&symbolVisible(document,symbol);});
}
const axisDirection=(deg:number)=>{const a=deg*Math.PI/180;return Math.abs(Math.cos(a))>=Math.abs(Math.sin(a))?{x:Math.cos(a)>=0?1:-1,y:0}:{x:0,y:Math.sin(a)>=0?1:-1};};
/** Planar MODEL XY. Arbitrary rotated directions prefer the nearest Manhattan axis. No obstacles. */
export function connectorRoute(document:GeoDocument,connector:ConnectorEntity):WorldPoint[] {
  const a=resolvePort(document,connector.start),b=resolvePort(document,connector.end),start={x:a.world.x,y:a.world.y},end={x:b.world.x,y:b.world.y};
  if(connector.routing==='direct')return [start,...(connector.waypoints??[]),end];
  const da=axisDirection(a.world.directionDeg),db=axisDirection(b.world.directionDeg);
  const exit=Math.max(.1,Math.min(a.definition.defaultSize*a.entity.scale,b.definition.defaultSize*b.entity.scale)*.25);
  const first={x:start.x+da.x*exit,y:start.y+da.y*exit},last={x:end.x+db.x*exit,y:end.y+db.y*exit};
  const route:WorldPoint[]=[start,first];
  if(connector.waypoints?.length){for(const target of [...connector.waypoints,last]){const previous=route.at(-1)!;route.push({x:target.x,y:previous.y},target);}}
  else if(da.x&&db.x){const x=(first.x+last.x)/2;route.push({x,y:first.y},{x,y:last.y},last);}
  else if(da.y&&db.y){const y=(first.y+last.y)/2;route.push({x:first.x,y},{x:last.x,y},last);}
  else route.push(da.x?{x:last.x,y:first.y}:{x:first.x,y:last.y},last);
  route.push(end);
  // Remove only duplicate adjacent positions: don't discard preferred exit segments or reverse bends.
  return route.filter((p,i)=>!i||p.x!==route[i-1]!.x||p.y!==route[i-1]!.y);
}
export function connectorLength(document:GeoDocument,connector:ConnectorEntity) {const route=connectorRoute(document,connector);return route.slice(1).reduce((length,p,i)=>length+Math.hypot(p.x-route[i]!.x,p.y-route[i]!.y),0);}
