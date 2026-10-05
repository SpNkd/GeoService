import type { SymbolEntity, Viewport } from '../domain/model';
import { worldToScreen, type ViewSize } from '../geometry';
import { requireSymbol } from '../symbols/registry';
import { primitivePoints, symbolLocalToWorld, symbolLocalPortToWorld, symbolWorldBounds } from '../symbols/transforms';
export function SymbolView({entity,viewport,size,color='#405d6b',lineWeight=1.6,selected=false,ghost=false}:{entity:SymbolEntity;viewport:Viewport;size:ViewSize;color?:string;lineWeight?:number;selected?:boolean;ghost?:boolean}) {
  const definition=requireSymbol(entity.libraryId,entity.symbolId),b=symbolWorldBounds(entity),tl=worldToScreen({x:b.minX,y:b.maxY},viewport,size);
  const screen=(p:{x:number;y:number})=>worldToScreen(symbolLocalToWorld(entity,p,definition),viewport,size);
  return <g data-testid={ghost?'symbol-ghost':undefined} opacity={ghost?.55:1}>
    {!ghost&&<rect data-symbol-hit="" x={tl.x-7} y={tl.y-7} width={(b.maxX-b.minX)*viewport.pixelsPerUnit+14} height={(b.maxY-b.minY)*viewport.pixelsPerUnit+14} fill={selected?'#277ec110':'transparent'} stroke={selected?color:'none'} strokeDasharray="3 3" pointerEvents="all"/>}
    <g pointerEvents="none" stroke={color} strokeWidth={selected?2.2:lineWeight} strokeLinejoin="round" fill="none">{definition.geometry.map((primitive,i)=>{
      if(primitive.type==='circle'){const p=screen(primitive.center);return <circle key={i} cx={p.x} cy={p.y} r={primitive.radius*definition.defaultSize*entity.scale*viewport.pixelsPerUnit}/>;}
      const points=primitivePoints(primitive).map(screen),d=`M${points.map(p=>`${p.x},${p.y}`).join('L')}${primitive.type==='rect'||primitive.type==='polygon'?'Z':''}`;
      return <path key={i} d={d}/>;
    })}</g>
    {selected&&<g pointerEvents="none" data-testid="passive-ports">{definition.ports.map(port=>{const p=worldToScreen(symbolLocalPortToWorld(entity,port,definition),viewport,size);return <circle key={port.id} data-port-id={port.id} cx={p.x} cy={p.y} r={3.5} fill="white" stroke="#b77922" strokeDasharray="2 2"><title>{`${port.id} · пассивный порт`}</title></circle>;})}</g>}
  </g>;
}
