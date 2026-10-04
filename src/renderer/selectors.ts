import { entityPoints, getVertex, type Entity, type EntityStyle, type GeoDocument, type Layer, type Vertex } from '../domain/model';
import { bounds } from '../geometry';
import { alignedDimension } from '../geometry/survey';
import { resolvedLabelPosition } from '../geometry/labels';

export interface RenderItem { entity: Entity; layer: Layer; style: EntityStyle }
const fallbackStyle: EntityStyle = { id: 'fallback', stroke: '#546675', fill: 'none', lineWeight: 1.5 };

export function renderItems(document: GeoDocument): RenderItem[] {
  const styles = new Map(document.styles.map(style => [style.id, style]));
  const visible = new Set(document.layers.filter(layer => layer.visible).map(layer => layer.id));
  const items = [...document.layers].sort((a, b) => a.order - b.order).flatMap(layer =>
    layer.visible ? document.entities.filter(entity => entity.layerId === layer.id && (entity.type !== 'label' || visible.has(document.entities.find(target => target.id === entity.targetId)?.layerId ?? ''))).map(entity => ({
      entity, layer, style: styles.get(entity.styleId ?? layer.styleId) ?? fallbackStyle,
    })) : [],
  );
  // Text and linked labels remain above geometry so their view-level hit targets win overlaps.
  return [...items.filter(item => item.entity.type !== 'text' && item.entity.type !== 'label'), ...items.filter(item => item.entity.type === 'text' || item.entity.type === 'label')];
}
export function visibleBounds(document: GeoDocument) {
  return bounds(renderItems(document).flatMap(({ entity }) => {
    if (entity.type === 'label') { const anchor = resolvedLabelPosition(document, entity); return anchor ? [anchor] : []; }
    const points = entityPoints(entity, document.vertices);
    if (entity.type !== 'dimension') return points;
    const dimension = alignedDimension(points[0]!, points[1]!, entity.offset);
    return [...points, dimension.start, dimension.end];
  }));
}
export function vertexFor(document: GeoDocument, id: string): Vertex {
  return getVertex(document.vertices, id);
}
