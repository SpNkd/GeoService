import type { GeoDocument, Viewport } from '../domain/model';
import { worldToScreen, type ViewSize } from '../geometry';
import { transformPoint } from '../vectors/geometry';
import { prepareVectorSet } from './vectorPreparation';
import { useMemo } from 'react';
import { resolveDeepSelection, type DeepSelection } from '../editor/deepSelection';
import { PrimitiveSet } from './VectorView';
export function DeepSelectionView({document,selection,viewport,size}:{document:GeoDocument;selection:DeepSelection;viewport:Viewport;size:ViewSize}) {
  const resolved=resolveDeepSelection(document,selection);
  const primitive=resolved?.primitive;
  const prepared=useMemo(()=>primitive ? prepareVectorSet(document,[{...primitive,colorMode:'explicit',stroke:'#e37b13',lineWeight:3}]) : null,[document,primitive]);
  if(!resolved||!prepared)return null;
  const pp=viewport.pixelsPerUnit,anchor=worldToScreen(transformPoint(prepared.origin,resolved.matrix),viewport,size);
  return <g data-testid="deep-selection-highlight" pointerEvents="none" color="#e37b13" strokeWidth={3} transform={`translate(${anchor.x} ${anchor.y}) scale(${pp} ${-pp})`}>
    <g transform={`matrix(${[...resolved.matrix.slice(0,4),0,0].join(' ')})`}><PrimitiveSet document={document} primitives={prepared.primitives} inheritAll /></g>
  </g>;
}
