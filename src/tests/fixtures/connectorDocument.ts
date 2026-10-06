import { createNewDocument } from '../../domain/newDocument';
import type { ConnectorEndpoint, ConnectorEntity, GeoDocument, SymbolEntity } from '../../domain/model';
export const endpoint=(symbolEntityId:string,portId:string):ConnectorEndpoint=>({kind:'symbol_port',symbolEntityId,portId});
export const connector=(id='connection',start=endpoint('valve','out'),end=endpoint('filter','in')):ConnectorEntity=>({id,name:id,type:'connector',layerId:'annotations',start,end,routing:'orthogonal'});
export const symbol=(id:string,symbolId:string,x:number,y=0):SymbolEntity=>({id,name:id,type:'symbol',layerId:'buildings',libraryId:'gas-process-demo',symbolId,position:{x,y},rotationDeg:0,scale:1});
export function connectorDocument(connected=true):GeoDocument {
  const d=createNewDocument();d.metadata.id='connector-fixture';d.entities=[symbol('valve','shutoff-valve',0),symbol('filter','filter',8),symbol('regulator','pressure-regulator',16),symbol('instrument','pressure-gauge',8,5),symbol('instrument2','instrument-point',16,5)];
  if(connected)d.entities.push(connector());return d;
}
/** 300 distinct ports, 150 explicit links; no junction entity or multi-use port required. */
export function connectorBenchmarkDocument():GeoDocument {
  const d=createNewDocument();d.metadata.id='connector-benchmark';
  d.entities=Array.from({length:100},(_,i)=>symbol(`s${i}`,'tee',(i%10)*6,Math.floor(i/10)*6));
  for(let i=0;i<100;i++)d.entities.push(connector(`c${i}`,endpoint(`s${i}`,'out'),endpoint(`s${(i+1)%100}`,'in')));
  for(let i=0;i<50;i++)d.entities.push(connector(`b${i}`,endpoint(`s${i*2}`,'branch'),endpoint(`s${i*2+1}`,'branch')));
  return d;
}
