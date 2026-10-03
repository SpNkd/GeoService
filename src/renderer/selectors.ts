import { entityPoints, type Entity, type EntityStyle, type GeoDocument, type Layer } from '../domain/model';
import { bounds } from '../geometry';

export interface RenderItem { entity: Entity; layer: Layer; style: EntityStyle }
const fallbackStyle: EntityStyle = { id: 'fallback', stroke: '#546675', fill: 'none', lineWeight: 1.5 };

export function renderItems(document: GeoDocument): RenderItem[] {
  const styles = new Map(document.styles.map(style => [style.id, style]));
  return [...document.layers].sort((a, b) => a.order - b.order).flatMap(layer =>
    layer.visible ? document.entities.filter(entity => entity.layerId === layer.id).map(entity => ({
      entity, layer, style: styles.get(entity.styleId ?? layer.styleId) ?? fallbackStyle,
    })) : [],
  );
}
export function visibleBounds(document: GeoDocument) {
  return bounds(renderItems(document).flatMap(({ entity }) => entityPoints(entity)));
}
