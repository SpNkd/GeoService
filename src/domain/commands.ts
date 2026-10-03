import { entityVertexIds, getVertex, vertexPoint, worldVertex, type Entity, type GeoDocument, type Layer, type PointEntity, type Vertex, type WorldPoint } from './model';
import { validateDocument } from '../persistence/documentSchema';
import { assertDocumentSize } from '../persistence/serialization';

/** The one deterministic mutation boundary shared by canvas, inspector, and future AI adapters. */
export type DocumentCommand =
  | { type: 'import-points'; points: { entity: PointEntity; vertex: Vertex }[]; layer?: Layer }
  | { type: 'add-entity'; entity: Entity; vertices: Vertex[] }
  | { type: 'delete-entity'; entityId: string }
  | { type: 'update-vertex'; vertexId: string; position: WorldPoint }
  | { type: 'move-vertex'; vertexId: string; delta: WorldPoint }
  | { type: 'update-entity'; entityId: string; patch: { name?: string; content?: string; fontSize?: number } }
  | { type: 'set-entity-layer'; entityId: string; layerId: string }
  | { type: 'set-layer-visibility'; layerId: string; visible: boolean }
  | { type: 'set-layer-lock'; layerId: string; locked: boolean };

const finitePoint = (point: WorldPoint) => Number.isFinite(point.x) && Number.isFinite(point.y) && (point.z === undefined || Number.isFinite(point.z));
function cloneEntity(entity: Entity): Entity {
  return 'vertexIds' in entity ? { ...entity, vertexIds: [...entity.vertexIds] } as Entity : { ...entity };
}
function assertVertexEditable(document: GeoDocument, vertexId: string) {
  getVertex(document.vertices, vertexId);
  for (const entity of document.entities) if (entityVertexIds(entity).includes(vertexId)) {
    const layer = document.layers.find(item => item.id === entity.layerId);
    if (!layer || layer.locked) throw new Error(`Вершина принадлежит заблокированному слою «${layer?.name ?? entity.layerId}»`);
  }
}
function assertUniqueDocumentEntity(document: GeoDocument, entity: Entity) {
  if (!entity.id.trim() || document.entities.some(current => current.id === entity.id)) throw new Error('ID объекта пустой или уже используется');
  const layer = document.layers.find(current => current.id === entity.layerId);
  if (!layer) throw new Error('Слой объекта не найден');
  if (layer.locked) throw new Error('Нельзя создать объект в заблокированном слое');
  if (entity.styleId && !document.styles.some(style => style.id === entity.styleId)) throw new Error('Стиль объекта не найден');
  const ids = entityVertexIds(entity);
  const minimum = entity.type === 'polygon' ? 3 : entity.type === 'polyline' || entity.type === 'line' ? 2 : 1;
  if (ids.length < minimum) throw new Error(`Для объекта типа «${entity.type}» требуется не менее ${minimum} вершин`);
  for (const id of ids) if (!Object.hasOwn(document.vertices, id)) throw new Error(`Вершина ${id} не найдена`);
  if (entity.type === 'text' && (!entity.content.trim() || !Number.isFinite(entity.fontSize) || entity.fontSize <= 0)) throw new Error('Текст должен иметь содержание и положительный размер');
}
const referencedVertices = (entities: Entity[]) => new Set(entities.flatMap(entityVertexIds));

export function applyCommand(document: GeoDocument, command: DocumentCommand): GeoDocument {
  if (command.type === 'import-points') {
    if (!command.points.length) throw new Error('Импорт не содержит точек');
    if (command.layer && document.layers.some(layer => layer.id === command.layer!.id)) throw new Error('ID нового слоя уже используется');
    const layers = command.layer ? [...document.layers, { ...command.layer }] : document.layers;
    const vertices = { ...document.vertices };
    const entities = [...document.entities];
    const ids = new Set(entities.map(entity => entity.id));
    for (const { entity, vertex } of command.points) {
      const layer = layers.find(layer => layer.id === entity.layerId);
      if (!layer || layer.locked) throw new Error('Целевой слой заблокирован или отсутствует');
      if (ids.has(entity.id) || Object.hasOwn(vertices, vertex.id)) throw new Error('Импорт содержит повторяющийся внутренний ID');
      if (entity.vertexId !== vertex.id) throw new Error('Точка импорта ссылается на другую вершину');
      ids.add(entity.id); vertices[vertex.id] = { ...vertex }; entities.push({ ...entity });
    }
    const candidate = validateDocument({ ...document, layers, vertices, entities });
    assertDocumentSize(JSON.stringify(candidate, null, 2));
    return candidate;
  }
  if (command.type === 'set-layer-visibility' || command.type === 'set-layer-lock') {
    if (!document.layers.some(layer => layer.id === command.layerId)) throw new Error('Слой не найден');
    return { ...document, layers: document.layers.map(layer => layer.id !== command.layerId ? layer : {
      ...layer, ...(command.type === 'set-layer-visibility' ? { visible: command.visible } : { locked: command.locked }),
    }) };
  }
  if (command.type === 'add-entity') {
    const requiredNewIds = new Set(entityVertexIds(command.entity).filter(id => !Object.hasOwn(document.vertices, id)));
    const additions = new Map<string, Vertex>();
    for (const vertex of command.vertices) {
      if (!vertex.id.trim() || document.vertices[vertex.id] || additions.has(vertex.id)) throw new Error(`ID вершины ${vertex.id} пустой или уже используется`);
      if (!finitePoint(vertexPoint(vertex))) throw new Error(`Координаты вершины ${vertex.id} должны быть конечными числами`);
      additions.set(vertex.id, { ...vertex });
    }
    for (const id of requiredNewIds) if (!additions.has(id)) throw new Error(`Для новой вершины ${id} не заданы координаты`);
    for (const id of additions.keys()) if (!requiredNewIds.has(id)) throw new Error(`Новая вершина ${id} не используется объектом`);
    const candidate = { ...document, vertices: { ...document.vertices, ...Object.fromEntries(additions) } };
    assertUniqueDocumentEntity(candidate, command.entity);
    return { ...candidate, entities: [...document.entities, cloneEntity(command.entity)] };
  }
  if (command.type === 'delete-entity') {
    const entity = document.entities.find(item => item.id === command.entityId);
    if (!entity) throw new Error('Объект не найден');
    const layer = document.layers.find(item => item.id === entity.layerId);
    if (!layer || layer.locked) throw new Error('Нельзя удалить объект на заблокированном слое');
    const entities = document.entities.filter(item => item.id !== entity.id);
    const referenced = referencedVertices(entities);
    const vertices: Record<string, Vertex> = {};
    for (const [id, vertex] of Object.entries(document.vertices)) if (referenced.has(id)) vertices[id] = vertex;
    return { ...document, entities, vertices };
  }
  if (command.type === 'update-vertex' || command.type === 'move-vertex') {
    assertVertexEditable(document, command.vertexId);
    const old = getVertex(document.vertices, command.vertexId);
    const next = command.type === 'move-vertex'
      ? worldVertex(old.id, { x: old.x + command.delta.x, y: old.y + command.delta.y,
        ...(old.z !== undefined || command.delta.z !== undefined ? { z: (old.z ?? 0) + (command.delta.z ?? 0) } : {}) })
      : worldVertex(old.id, command.position);
    if (!finitePoint(vertexPoint(next))) throw new Error('Координаты должны быть конечными числами');
    if (old.x === next.x && old.y === next.y && old.z === next.z) return document;
    return { ...document, vertices: { ...document.vertices, [old.id]: next } };
  }
  const entity = document.entities.find(item => item.id === command.entityId);
  if (!entity) throw new Error('Объект не найден');
  const sourceLayer = document.layers.find(item => item.id === entity.layerId);
  if (!sourceLayer || sourceLayer.locked) throw new Error('Нельзя изменять объект на заблокированном слое');
  if (command.type === 'set-entity-layer') {
    const destination = document.layers.find(item => item.id === command.layerId);
    if (!destination || destination.locked) throw new Error('Целевой слой заблокирован или отсутствует');
    return { ...document, entities: document.entities.map(item => item.id === entity.id ? { ...cloneEntity(entity), layerId: destination.id } : item) };
  }
  if (command.patch.content !== undefined && entity.type !== 'text') throw new Error('Только у текстовой аннотации есть содержание');
  if (command.patch.fontSize !== undefined && (entity.type !== 'text' || !Number.isFinite(command.patch.fontSize) || command.patch.fontSize <= 0)) throw new Error('Размер текста должен быть положительным конечным числом');
  if (command.patch.name !== undefined && !command.patch.name.trim()) throw new Error('Имя объекта не может быть пустым');
  return { ...document, entities: document.entities.map(item => item.id === entity.id ? cloneEntity({ ...entity, ...command.patch } as Entity) : item) };
}

export function isLayerLocked(document: GeoDocument, entity: Entity): boolean {
  return document.layers.find(layer => layer.id === entity.layerId)?.locked ?? true;
}
export function canEditVertex(document: GeoDocument, vertexId: string): boolean {
  return Object.hasOwn(document.vertices, vertexId) && document.entities.filter(entity => entityVertexIds(entity).includes(vertexId))
    .every(entity => !isLayerLocked(document, entity));
}
export function entityPosition(document: GeoDocument, entity: Entity): WorldPoint {
  const id = entity.type === 'line' ? entity.startVertexId : entity.type === 'polyline' || entity.type === 'polygon' ? entity.vertexIds[0] : entity.vertexId;
  const vertex = getVertex(document.vertices, id);
  return vertexPoint(vertex);
}
