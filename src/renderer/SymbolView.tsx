import { projectionOf } from '../view/projection';
import { symbolPresentationPaths } from '../view/geometry';
import { vectorPath } from '../vectors/path';
import type { SymbolEntity, Viewport } from '../domain/model';
import { worldToScreen, type ViewSize } from '../geometry';
import { requireSymbol } from '../symbols/registry';
import { primitivePoints, symbolLocalToWorld, symbolLocalPortToWorld, symbolWorldBounds } from '../symbols/transforms';
export function SymbolView({entity,viewport,size,color='#405d6b',lineWeight=1.6,selected=false,ghost=false}:{entity:SymbolEntity;viewport:Viewport;size:ViewSize;color?:string;lineWeight?:number;selected?:boolean;ghost?:boolean}) {
  const projection=projectionOf(viewport);
  if(projection){const paths=symbolPresentationPaths(entity,viewport.pixelsPerUnit);return <g data-testid={ghost?'symbol-ghost':undefined} opacity={ghost?.55:1} stroke={color} strokeWidth={selected?2.2:lineWeight} fill="none">{paths.map((p,i)=><path key={i} data-symbol-hit="" d={vectorPath(p.points.map(q=>worldToScreen(q,viewport,size)),p.closed)} fill={selected?'#277ec110':'transparent'}/>)}{selected&&<g data-testid="passive-ports">{requireSymbol(entity.libraryId,entity.symbolId).ports.map(port=>{const p=worldToScreen(symbolLocalPortToWorld(entity,port),viewport,size);return <circle key={port.id} data-port-id={port.id} cx={p.x} cy={p.y} r={3.5} fill="white"/>;})}</g>}</g>;}
  const definition=requireSymbol(entity.libraryId,entity.symbolId,entity.libraryVersion),b=symbolWorldBounds(entity),tl=worldToScreen({x:b.minX,y:b.maxY},viewport,size);
  const screen=(p:{x:number;y:number})=>worldToScreen(symbolLocalToWorld(entity,p,definition),viewport,size);
  return <g data-testid={ghost?'symbol-ghost':undefined} opacity={ghost?.55:1}>
    {!ghost&&<rect data-symbol-hit="" x={tl.x-7} y={tl.y-7} width={(b.maxX-b.minX)*viewport.pixelsPerUnit+14} height={(b.maxY-b.minY)*viewport.pixelsPerUnit+14} fill={selected?'#277ec110':'transparent'} stroke={selected?color:'none'} strokeDasharray="3 3" pointerEvents="all"/>}
    <g pointerEvents="none" stroke={color} strokeWidth={selected?2.2:lineWeight} strokeLinejoin="round" fill="none">{definition.geometry.map((primitive,i)=>{
      if(primitive.type==='circle'){const p=screen(primitive.center);return <circle key={i} cx={p.x} cy={p.y} r={primitive.radius*definition.defaultSize*entity.scale*viewport.pixelsPerUnit}/>;}
      const points=primitivePoints(primitive).map(screen),d=vectorPath(points,primitive.type==='rect'||primitive.type==='polygon');
      return <path key={i} d={d}/>;
    })}</g>
    {selected&&<g pointerEvents="none" data-testid="passive-ports">{definition.ports.map(port=>{const p=worldToScreen(symbolLocalPortToWorld(entity,port,definition),viewport,size);return <circle key={port.id} data-port-id={port.id} cx={p.x} cy={p.y} r={3.5} fill="white" stroke="#b77922" strokeDasharray="2 2"><title>{`${port.label??port.id} · ${port.kind}`}</title></circle>;})}</g>}
  </g>;
}
