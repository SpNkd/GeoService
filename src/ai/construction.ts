import type { DocumentCommand } from '../domain/commands';
import { getVertex, worldVertex, type GeoDocument, type Layer, type WorldPoint } from '../domain/model';
import { labelAnchor } from '../geometry/labels';
import { pathLength, polygonArea } from '../geometry';
import type { AiAction } from './intent';
import type { ResolvedBoundaryOutput, References, ResolutionFailure } from './resolver';

export type PointsReady = References & { status: 'ready'; kind: 'points'; command: DocumentCommand; targetLayer: string };
export type RectangleReady = References & { status: 'ready'; kind: 'rectangle'; command: DocumentCommand; targetLayer: string;
  width: number; height: number; area: number; perimeter: number; output: ResolvedBoundaryOutput; assumptions: string[] };
function targetLayer(document: GeoDocument, id: string, name: string): { layer: Layer; addition?: Layer } | ResolutionFailure {
  const existing = document.layers.find(layer => layer.id === id);
  if (existing && (!existing.visible || existing.locked)) return { status: 'invalid', message: `Слой ${existing.name} скрыт или заблокирован` };
  if (existing) return { layer: existing };
  const layer: Layer = { id, name, visible: true, locked: false, order: Math.max(...document.layers.map(layer => layer.order)) + 1,
    styleId: document.styles.find(style => style.id === (id === 'survey-points' ? 'survey-point' : id === 'buildings' ? 'building' : 'boundary'))?.id ?? document.styles[0]!.id };
  return { layer, addition: layer };
}
export function resolveCreatePoints(intent: Extract<AiAction, { type: 'create_points' }>, document: GeoDocument, actionId: string): PointsReady | ResolutionFailure {
  const names = intent.points.map(point => point.name);
  if (new Set(names).size !== names.length) return { status: 'invalid', message: 'Имена создаваемых точек повторяются' };
  const existing = new Set(document.entities.filter(entity => entity.type === 'point').map(entity => entity.name.trim()));
  const duplicate = names.find(name => existing.has(name));
  if (duplicate) return { status: 'invalid', message: `Точка «${duplicate}» уже существует. Укажите другое имя.` };
  const target = targetLayer(document, 'survey-points', 'Геодезические точки'); if ('status' in target) return target;
  const points = intent.points.map((point, index) => ({ entity: { id: `${actionId}-point-${index + 1}`, type: 'point' as const, name: point.name,
    layerId: target.layer.id, vertexId: `${actionId}-vertex-${index + 1}` }, vertex: worldVertex(`${actionId}-vertex-${index + 1}`, { x: point.x, y: point.y, ...(point.z === undefined ? {} : { z: point.z }) }) }));
  const references = points.map(({ entity, vertex }) => ({ name: entity.name, entityId: entity.id, vertexId: vertex.id, position: { x: vertex.x, y: vertex.y, ...(vertex.z === undefined ? {} : { z: vertex.z }) }, layer: target.layer.name }));
  return { status: 'ready', kind: 'points', references, geometry: references.map(ref => ref.position), warnings: [], targetLayer: target.layer.id,
    command: { type: 'import-points', points, ...(target.addition ? { layer: target.addition } : {}) } };
}
export function resolveCreateRectangle(intent: Extract<AiAction, { type: 'create_rectangle' }>, document: GeoDocument,
  outputs: ReadonlyMap<number, ResolvedBoundaryOutput>, actionId: string): RectangleReady | ResolutionFailure {
  const placement = intent.placement, assumptions: string[] = [];
  let origin: WorldPoint;
  if (placement.type === 'lower_left') origin = { x: placement.x, y: placement.y };
  else if (placement.type === 'local_origin') { origin = { x: 0, y: 0 }; assumptions.push(`${intent.name} создан в локальных координатах от (0,0). Это не геодезическая привязка.`); }
  else {
    let center: WorldPoint;
    if (placement.type === 'center') center = { x: placement.x, y: placement.y };
    else {
      const output = outputs.get(placement.polygonActionIndex);
      if (!output) return { status: 'blocked', dependencyIndex: placement.polygonActionIndex, message: `Сначала исправьте Action ${placement.polygonActionIndex + 1}: положение зависит от polygon output.` };
      const polygon = document.entities.find(entity => entity.id === output.entityId);
      if (!polygon || polygon.type !== 'polygon') return { status: 'invalid', message: 'Предыдущий polygon output не найден' };
      center = labelAnchor(document, polygon);
    }
    origin = { x: center.x - intent.width / 2, y: center.y - intent.height / 2 };
  }
  const geometry = [origin, { x: origin.x + intent.width, y: origin.y }, { x: origin.x + intent.width, y: origin.y + intent.height }, { x: origin.x, y: origin.y + intent.height }];
  if (!geometry.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)) || geometry[1]!.x === origin.x || geometry[3]!.y === origin.y) return { status: 'invalid', message: 'Размеры прямоугольника вне точности/диапазона координат' };
  const target = targetLayer(document, /дом|house/i.test(intent.name) ? 'buildings' : 'boundary', /дом|house/i.test(intent.name) ? 'Здания' : 'Граница участка');
  if ('status' in target) return target;
  const vertices = geometry.map((point, index) => worldVertex(`${actionId}-corner-${index + 1}`, point));
  const entity = { id: `geometry-${actionId}`, type: 'polygon' as const, name: intent.name, layerId: target.layer.id, vertexIds: vertices.map(vertex => vertex.id) as [string, string, string, ...string[]] };
  const references = vertices.map((vertex, index) => ({ name: `${intent.name} · ${index + 1}`, entityId: entity.id, vertexId: vertex.id, position: getVertex(Object.fromEntries(vertices.map(v => [v.id, v])), vertex.id), layer: target.layer.name }));
  const area = polygonArea(geometry), perimeter = pathLength(geometry, true);
  if (!Number.isFinite(area) || !Number.isFinite(perimeter) || area <= 0) return { status: 'invalid', message: 'Неконечные метрики прямоугольника' };
  return { status: 'ready', kind: 'rectangle', width: intent.width, height: intent.height, area, perimeter, geometry, references, warnings: [], assumptions,
    targetLayer: target.layer.id, output: { kind: 'created_polygon', entityId: entity.id, vertexIds: entity.vertexIds, references },
    command: { type: 'add-entity', entity, vertices, ...(target.addition ? { layer: target.addition } : {}) } };
}
