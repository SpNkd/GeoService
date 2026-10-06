import type { ConnectorEndpoint, GeoDocument, Viewport } from '../domain/model';
import { worldToScreen, type ScreenPoint, type ViewSize } from '../geometry';
import { requireSymbol } from '../symbols/registry';
import { symbolLocalPortToWorld } from '../symbols/transforms';
import { symbolVisible } from './model';
const cache=new WeakMap<GeoDocument,ReturnType<typeof buildPorts>>();
function buildPorts(document:GeoDocument) {
  return document.entities.flatMap(entity=>{
    if(entity.type!=='symbol'||!symbolVisible(document,entity))return [];
    const definition=requireSymbol(entity.libraryId,entity.symbolId);
    return definition.ports.map(port=>({endpoint:{kind:'symbol_port' as const,symbolEntityId:entity.id,portId:port.id},port,world:symbolLocalPortToWorld(entity,port,definition),symbolName:entity.name}));
  });
}
export function visibleSymbolPorts(document:GeoDocument) {let ports=cache.get(document);if(!ports){ports=buildPorts(document);cache.set(document,ports);}return ports;}
/** Port-only 12 px diameter target, independent of general grid/vertex snap settings. */
export function hitSymbolPort(document:GeoDocument,point:ScreenPoint,viewport:Viewport,size:ViewSize):ConnectorEndpoint|null {
  let best:ConnectorEndpoint|null=null,distance=7;
  for(const candidate of visibleSymbolPorts(document)){
    const p=worldToScreen(candidate.world,viewport,size),d=Math.hypot(p.x-point.x,p.y-point.y);
    if(d<=distance){best=candidate.endpoint;distance=d;}
  }
  return best;
}
