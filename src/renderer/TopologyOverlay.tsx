import { memo } from 'react';
import type { Viewport } from '../domain/model';
import { worldToScreen, type ViewSize } from '../geometry';
import type { Classification, Point, PortOption } from '../topology/types';
export interface TopologyPreview {points:Point[];ports:PortOption[];classification:Classification;confirmed?:boolean}
export const TopologyOverlay=memo(function TopologyOverlay({preview,viewport,size}:{preview:TopologyPreview|null;viewport:Viewport;size:ViewSize}){
 if(!preview)return null;const points=preview.points.map(p=>worldToScreen(p,viewport,size)),color=preview.confirmed?'#16845a':preview.classification==='REJECTED'?'#c03434':preview.classification==='AMBIGUOUS'?'#ac6c0d':'#247dbd';
 return <g data-testid="topology-overlay" pointerEvents="none"><polyline points={points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth={4} strokeDasharray={preview.confirmed?undefined:'7 4'}/>{points.length===1&&<circle cx={points[0]!.x} cy={points[0]!.y} r={9} fill="none" stroke={color} strokeWidth={3}/>} {preview.ports.map(p=>{const q=worldToScreen(p.point,viewport,size);return <g key={`${p.endpoint.symbolEntityId}:${p.endpoint.portId}`}><circle cx={q.x} cy={q.y} r={6} fill={p.available?'#fff':'#fedcdc'} stroke={color} strokeWidth={2}/><text x={q.x+9} y={q.y-9} fill={color} fontSize={12} stroke="#fff" strokeWidth={3} paintOrder="stroke">{p.endpoint.portId}</text></g>;})}</g>;
});
