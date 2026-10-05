import type { GeoDocument, Viewport } from '../domain/model';
import type { ViewSize } from '../geometry';
import { resolveDeepSelection, type DeepSelection } from '../editor/deepSelection';
import { PrimitiveSet } from './VectorView';
export function DeepSelectionView({document,selection,viewport,size}:{document:GeoDocument;selection:DeepSelection;viewport:Viewport;size:ViewSize}) {
  const resolved=resolveDeepSelection(document,selection);if(!resolved)return null;
  const pp=viewport.pixelsPerUnit;
  return <g data-testid="deep-selection-highlight" pointerEvents="none" color="#e37b13" strokeWidth={3} transform={`translate(${size.width/2-viewport.center.x*pp} ${size.height/2+viewport.center.y*pp}) scale(${pp} ${-pp})`}>
    <g transform={`matrix(${resolved.matrix.join(' ')})`}><PrimitiveSet document={document} primitives={[{...resolved.primitive,colorMode:'explicit',stroke:'#e37b13',lineWeight:3}]} inheritAll /></g>
  </g>;
}
