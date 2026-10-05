import type { GeoDocument, Viewport } from '../domain/model';
import { worldToScreen, type ViewSize } from '../geometry';
import { primitiveBounds, transformPoint } from '../vectors/geometry';
import { prepareVectorSet } from './vectorPreparation';
import { useMemo } from 'react';
import { resolveDeepSelection, type DeepSelection } from '../editor/deepSelection';
import { PrimitiveSet } from './VectorView';
export function DeepSelectionView({document,selection,viewport,size}:{document:GeoDocument;selection:DeepSelection;viewport:Viewport;size:ViewSize}) {
  const resolved=resolveDeepSelection(document,selection);
  const primitive=resolved?.primitive;
  const prepared=useMemo(()=>primitive ? prepareVectorSet(document,[{...primitive,colorMode:'explicit',stroke:'#e37b13',lineWeight:3}]) : null,[document,primitive]);
  if(!resolved||!prepared)return null;
  if(primitive?.kind==='block') {
    const points=primitiveBounds(document,[primitive]).map(p=>worldToScreen(transformPoint(p,resolved.matrix),viewport,size)),xs=points.map(p=>p.x),ys=points.map(p=>p.y);
    return <rect data-testid="deep-selection-highlight" pointerEvents="none" x={Math.min(...xs)} y={Math.min(...ys)} width={Math.max(...xs)-Math.min(...xs)} height={Math.max(...ys)-Math.min(...ys)} fill="none" stroke="#e37b13" strokeWidth={3} />;
  }
  const pp=viewport.pixelsPerUnit,anchor=worldToScreen(transformPoint(prepared.origin,resolved.matrix),viewport,size);
  return <g data-testid="deep-selection-highlight" pointerEvents="none" color="#e37b13" strokeWidth={3} transform={`translate(${anchor.x} ${anchor.y}) scale(${pp} ${-pp})`}>
    <g transform={`matrix(${[...resolved.matrix.slice(0,4),0,0].join(' ')})`}><PrimitiveSet document={document} primitives={prepared.primitives} inheritAll /></g>
  </g>;
}
