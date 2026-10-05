import { entityVertexIds, getVertex, type GeoDocument, type WorldPoint } from './model';
import { resolvedLabelPosition } from '../geometry/labels';

export interface Translation { x: number; y: number }
export interface ResolvedSelectionMove {
  entityIds: string[];
  vertexIds: string[];
  labelOffsetIds: string[];
  independentEntityIds: string[];
  affectedEntityIds: string[];
}
/** Resolve once for a drag; a committed command always resolves again against its own document. */
export function resolveSelectionMove(document: GeoDocument, entityIds: readonly string[]): ResolvedSelectionMove {
  const selected = new Set(entityIds), entities = new Map(document.entities.map(entity => [entity.id, entity]));
  if (!selected.size) throw new Error('Выберите объекты для перемещения.');
  for (const id of selected) if (!entities.has(id)) throw new Error('Объект перемещения не найден.');
  const unlockedLayers = new Set(document.layers.filter(layer => !layer.locked).map(layer => layer.id));
  const selectedEntities = document.entities.filter(entity => selected.has(entity.id));
  if (selectedEntities.some(entity => !unlockedLayers.has(entity.layerId))) throw new Error('Выбор содержит объекты на заблокированном слое.');
  // Dimensions consume geometry but never own a translation of their source vertices.
  const vertices = new Set(selectedEntities.filter(entity => entity.type !== 'dimension').flatMap(entityVertexIds));
  for (const id of vertices) getVertex(document.vertices, id);
  const affected = new Set(document.entities.filter(entity => entityVertexIds(entity).some(id => vertices.has(id))).map(entity => entity.id));
  const independentEntityIds = selectedEntities.filter(entity => ['symbol', 'arc', 'circle', 'block_instance', 'imported_graphic'].includes(entity.type)).map(entity => entity.id);
  for (const id of independentEntityIds) affected.add(id);
  const labelOffsetIds: string[] = [];
  for (const entity of document.entities) if (entity.type === 'label') {
    if (affected.has(entity.targetId)) affected.add(entity.id);
    const target = entities.get(entity.targetId);
    if (!target) throw new Error('Цель подписи не найдена.');
    // A selected label follows a fully translated target even if that target moves through shared topology.
    if (selected.has(entity.id) && !selected.has(entity.targetId) && !(target.type === 'symbol' ? selected.has(target.id) : entityVertexIds(target).length > 0 && entityVertexIds(target).every(id => vertices.has(id)))) labelOffsetIds.push(entity.id);
  }
  if (!vertices.size && !labelOffsetIds.length && !independentEntityIds.length) throw new Error('Размер не перемещает исходную геометрию. Выберите геометрию или подпись.');
  const indirectlyLocked = document.entities.find(entity => affected.has(entity.id) && !unlockedLayers.has(entity.layerId));
  if (indirectlyLocked) throw new Error(`Перемещение затронет связанный объект на заблокированном слое «${document.layers.find(layer => layer.id === indirectlyLocked.layerId)?.name ?? indirectlyLocked.layerId}».`);
  return { entityIds: selectedEntities.map(entity => entity.id), vertexIds: [...vertices], labelOffsetIds, independentEntityIds,
    affectedEntityIds: document.entities.filter(entity => affected.has(entity.id) && !selected.has(entity.id)).map(entity => entity.id) };
}

/** Pure projection from the base snapshot, never from the previous pointer frame. Z and IDs are preserved. */
export function projectSelectionMove(document: GeoDocument, resolved: ResolvedSelectionMove, delta: Translation): GeoDocument {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw new Error('Смещение должно быть конечным числом.');
  if (delta.x === 0 && delta.y === 0) return document;
  let changed = false;
  const vertices = { ...document.vertices };
  for (const id of resolved.vertexIds) {
    const before = getVertex(document.vertices, id), x = before.x + delta.x, y = before.y + delta.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Перемещение выходит за диапазон координат.');
    if (x !== before.x || y !== before.y) { vertices[id] = { ...before, x, y }; changed = true; }
  }
  const independent = new Set(resolved.independentEntityIds);
  const translatedEntities = independent.size ? document.entities.map(entity => {
    if (!independent.has(entity.id) || !('position' in entity || 'center' in entity)) return entity;
    const key = 'center' in entity ? 'center' : 'position';
    const before = 'center' in entity ? entity.center : entity.position;
    const position = { ...before, x: before.x + delta.x, y: before.y + delta.y };
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error('Перемещение выходит за диапазон координат.');
    if (position.x === before.x && position.y === before.y) return entity;
    changed = true; return { ...entity, [key]: position };
  }) : document.entities;
  const projected = changed ? { ...document, vertices: resolved.vertexIds.length ? vertices : document.vertices, entities: translatedEntities } : document;
  const labelIds = new Set(resolved.labelOffsetIds);
  const entities = projected.entities.map(entity => {
    if (entity.type !== 'label' || !labelIds.has(entity.id)) return entity;
    const before = resolvedLabelPosition(document, entity), after = resolvedLabelPosition(projected, entity);
    if (!before || !after) throw new Error('Цель подписи не найдена.');
    // Compensate partial target motion through shared vertices: the selected label still travels by exactly delta.
    const dx = entity.dx + delta.x - (after.x - before.x), dy = entity.dy + delta.y - (after.y - before.y);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('Перемещение подписи выходит за диапазон координат.');
    if (dx === entity.dx && dy === entity.dy) return entity;
    changed = true; return { ...entity, dx, dy };
  });
  return changed ? { ...projected, entities: labelIds.size ? entities : projected.entities } : document;
}

export function selectionTranslation(start: WorldPoint, current: WorldPoint, shift = false): Translation {
  const x = current.x - start.x, y = current.y - start.y;
  return shift ? Math.abs(x) > Math.abs(y) ? { x, y: 0 } : { x: 0, y } : { x, y };
}
