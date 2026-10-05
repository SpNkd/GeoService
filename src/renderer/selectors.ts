import { symbolBoundsPoints } from '../symbols/transforms';
import { entityBoundsPoints, modelSelectionBounds } from '../geometry/entityBounds';
import { entityPoints, getVertex, type Entity, type EntityStyle, type GeoDocument, type Layer, type Vertex } from '../domain/model';
import { bounds } from '../geometry';
import { alignedDimension } from '../geometry/survey';
import { resolvedLabelPosition } from '../geometry/labels';

export interface RenderItem { entity: Entity; layer: Layer; style: EntityStyle }
const fallbackStyle: EntityStyle = { id: 'fallback', stroke: '#546675', fill: 'none', lineWeight: 1.5 };

export function renderItems(document: GeoDocument): RenderItem[] {
  const styles = new Map(document.styles.map(style => [style.id, style]));
  const visible = new Set(document.layers.filter(layer => layer.visible).map(layer => layer.id));
  const groups = new Map<string, Entity[]>(), entities = new Map(document.entities.map(e => [e.id, e]));
  for (const entity of document.entities) {
    if (!visible.has(entity.layerId) || entity.visible === false || entity.type === 'label' && !visible.has(entities.get(entity.targetId)?.layerId ?? '')) continue;
    const group = groups.get(entity.layerId) ?? []; group.push(entity); groups.set(entity.layerId, group);
  }
  const items = [...document.layers].sort((a,b) => a.order-b.order).flatMap(layer =>
    (groups.get(layer.id) ?? []).sort((a,b) => Number(a.type==='text'||a.type==='label')-Number(b.type==='text'||b.type==='label')).map(entity => ({entity, layer, style:styles.get(entity.styleId ?? layer.styleId) ?? fallbackStyle})));
  return items;
}
export function visibleBounds(document: GeoDocument) {
  return bounds(renderItems(document).flatMap(({ entity }) => {
    if (['arc','circle','block_instance','imported_graphic'].includes(entity.type) || entity.type === 'text' && entity.height) return entityBoundsPoints(document,entity);
    if (entity.type === 'symbol') return symbolBoundsPoints(entity);
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

/** View-level selection bounds include derived labels/dimensions, never become domain geometry. */
export function selectionBounds(document: GeoDocument, entityIds: readonly string[]) {
  return modelSelectionBounds(document, entityIds);
}
