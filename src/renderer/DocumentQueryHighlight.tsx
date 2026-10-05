import { memo, useMemo } from 'react';
import type { GeoDocument, Viewport } from '../domain/model';
import { worldToScreen, type ViewSize } from '../geometry';
import { ownerBounds } from './hybridScene';
/** Owner bounds only: no shared block geometry traversal/materialized SVG, no selection handles. */
export const DocumentQueryHighlight=memo(function DocumentQueryHighlight({document,entityIds,viewport,size}:{document:GeoDocument;entityIds:readonly string[];viewport:Viewport;size:ViewSize}) {
  const owners=useMemo(()=>{const ids=new Set(entityIds);return document.entities.filter(e=>ids.has(e.id)).map(e=>({id:e.id,box:ownerBounds(document,e)}));},[document,entityIds]);
  return <g data-testid="document-query-highlight" pointerEvents="none" fill="#e8a93518" stroke="#b77922" strokeWidth={2}>{owners.map(({id,box})=>{if(!box)return null;const p=worldToScreen({x:box.minX,y:box.maxY},viewport,size);return <rect key={id} data-query-owner={id} x={p.x-3} y={p.y-3} width={Math.max(6,(box.maxX-box.minX)*viewport.pixelsPerUnit+6)} height={Math.max(6,(box.maxY-box.minY)*viewport.pixelsPerUnit+6)}/>;})}</g>;
});
