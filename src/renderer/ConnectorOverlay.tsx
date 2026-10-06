import type { ConnectorEndpoint, ConnectorEntity, GeoDocument, Viewport, WorldPoint } from '../domain/model';
import type { ConnectorInteraction } from '../store/editor';
import { connectorRoute, connectivityIndex, portKey, portTargetError, resolvePort, samePort } from '../connectors/model';
import { visibleSymbolPorts } from '../connectors/ports';
import { worldToScreen, type ViewSize } from '../geometry';
import { vectorPath } from '../vectors/path';
function connectorOther(document:GeoDocument,interaction:ConnectorInteraction|null):ConnectorEndpoint|undefined {
  if(interaction?.kind==='create')return interaction.start;
  if(interaction?.kind==='retarget'){const e=connectivityIndex(document).entities.get(interaction.entityId);if(e?.type==='connector')return e[interaction.endpoint==='start'?'end':'start'];}
}
export function ConnectorOverlay({document,viewport,size,interaction,cursor,hover}:{document:GeoDocument;viewport:Viewport;size:ViewSize;interaction:ConnectorInteraction|null;cursor:WorldPoint|null;hover:ConnectorEndpoint|null}) {
  const other=connectorOther(document,interaction),exclude=interaction?.kind==='retarget'?interaction.entityId:undefined;
  const hoverError=hover?portTargetError(document,hover,other,exclude):null;
  let route:WorldPoint[]=[];
  if(other){
    const anchor=resolvePort(document,other).world;
    if(hover&&!hoverError){
      const existing=exclude?connectivityIndex(document).entities.get(exclude):undefined;
      const connector:ConnectorEntity=existing?.type==='connector'?{...existing,[interaction!.kind==='retarget'?interaction!.endpoint:'end']:hover}:{id:'ghost',name:'Preview',type:'connector',layerId:document.layers[0]!.id,start:other,end:hover,routing:'orthogonal'};
      route=connectorRoute(document,connector);
    } else if(cursor)route=[anchor,cursor];
  }
  const points=route.map(p=>worldToScreen(p,viewport,size));
  return <g>
    {points.length>1&&<path data-testid="connector-ghost" d={vectorPath(points,false)} fill="none" stroke={hoverError?'#c94242':'#18865b'} strokeWidth={2} strokeDasharray="5 4" pointerEvents="none"/>}
    {visibleSymbolPorts(document).map(({endpoint,port,world,symbolName})=>{
      const p=worldToScreen(world,viewport,size),error=portTargetError(document,endpoint,other,exclude),active=hover&&samePort(hover,endpoint),start=interaction?.kind==='create'&&samePort(endpoint,interaction.start);
      const color=error?'#c94242':active||start?'#18865b':'#b77922';
      return <g key={portKey(endpoint)} data-symbol-port={endpoint.symbolEntityId} data-port-id={endpoint.portId} data-port-valid={!error} aria-label={`${symbolName} · ${port.label??port.id}`}>
        <circle cx={p.x} cy={p.y} r={7} fill="transparent" pointerEvents="all"/>
        <circle data-port-marker="" cx={p.x} cy={p.y} r={active||start?5:3.5} fill={active?'#e6fff1':'white'} stroke={color} strokeWidth={active?2:1.5} pointerEvents="none"/>
        <title>{`${symbolName} · ${port.label??port.id} · ${port.kind==='process'?'Process':'Instrument'}${error?` · ${error}`:''}`}</title>
        {active&&<text data-testid="connector-port-feedback" x={p.x+12} y={p.y-12} fill={color} fontSize={12} pointerEvents="none">{error??`${port.label??port.id} · ${port.kind}`}</text>}
      </g>;
    })}
  </g>;
}
