import type { GeoDocument, Viewport } from '../domain/model';
import { worldToScreen, type ViewSize } from '../geometry';
import type { RenderItem } from './selectors';
import { ownerBounds } from './hybridScene';
import { EntityView } from './EntityView';
import { memo } from 'react';
export const CanvasSelectionView=memo(function CanvasSelectionView({ item, document, viewport, size }: { item: RenderItem; document: GeoDocument; viewport: Viewport; size: ViewSize }) {
  if (!['block_instance', 'imported_graphic'].includes(item.entity.type)) return <EntityView item={item} document={document} viewport={viewport} size={size} selected />;
  const box = ownerBounds(document, item.entity); if (!box) return null;
  const p = worldToScreen({ x: box.minX, y: box.maxY }, viewport, size);
  return <g data-entity-id={item.entity.id} data-entity-type={item.entity.type} data-selected="true" data-testid="canvas-selection-overlay">
    <rect data-move-body="" x={p.x - 5} y={p.y - 5} width={Math.max(10, (box.maxX - box.minX) * viewport.pixelsPerUnit + 10)} height={Math.max(10, (box.maxY - box.minY) * viewport.pixelsPerUnit + 10)} fill="none" stroke="#277ec1" strokeWidth={1} strokeDasharray="4 3" pointerEvents="none" />
  </g>;
});
