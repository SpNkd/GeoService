import { entityVertexIds, getVertex, vertexPoint, worldVertex, type Entity, type GeoDocument, type Layer, type PointEntity, type Vertex, type WorldPoint } from './model';
import { validateDocument } from '../persistence/documentSchema';
import { encodeDocument } from '../persistence/serialization';
import { distance } from '../geometry';
import { polygonSelfIntersects } from '../geometry/survey';
import { parseCommand } from './commandSchema';

/** The one deterministic mutation boundary shared by canvas, inspector, and future AI adapters. */
export type DocumentCommand =
  | { type: 'import-points'; points: { entity: PointEntity; vertex: Vertex }[]; layer?: Layer }
  | { type: 'add-entity'; entity: Entity; vertices: Vertex[]; layer?: Layer }
  | { type: 'delete-entity'; entityId: string }
  | { type: 'update-layer'; layerId: string; name: string }
  | { type: 'update-vertex'; vertexId: string; position: WorldPoint }
  | { type: 'move-vertex'; vertexId: string; delta: WorldPoint }
  | { type: 'move-text'; entityId: string; vertexId: string; position: WorldPoint }
  | { type: 'update-entity'; entityId: string; patch: { name?: string; content?: string; template?: string; fontSize?: number; dx?: number; dy?: number; offset?: number } }
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
interface AdditionIndex { ids: Set<string>; layers: Map<string, Layer>; styles: ReadonlySet<string> }
function assertUniqueDocumentEntity(document: GeoDocument, entity: Entity, index?: AdditionIndex) {
  if (!entity.id.trim() || (index ? index.ids.has(entity.id) : document.entities.some(current => current.id === entity.id))) throw new Error('ID объекта пустой или уже используется');
  const layer = index ? index.layers.get(entity.layerId) : document.layers.find(current => current.id === entity.layerId);
  if (!layer) throw new Error('Слой объекта не найден');
  if (layer.locked) throw new Error('Нельзя создать объект в заблокированном слое');
  if (entity.type === 'label') {
    const target = document.entities.find(current => current.id === entity.targetId);
    if (!target || !['point', 'line', 'polyline', 'polygon'].includes(target.type)) throw new Error('Подпись должна ссылаться на существующую точку, линию, полилинию или полигон');
  }
  if (entity.styleId && !(index ? index.styles.has(entity.styleId) : document.styles.some(style => style.id === entity.styleId))) throw new Error('Стиль объекта не найден');
  const ids = entityVertexIds(entity);
  const minimum = entity.type === 'label' ? 0 : entity.type === 'polygon' ? 3 : entity.type === 'polyline' || entity.type === 'line' || entity.type === 'dimension' ? 2 : 1;
  if (ids.length < minimum) throw new Error(`Для объекта типа «${entity.type}» требуется не менее ${minimum} вершин`);
  for (const id of ids) if (!Object.hasOwn(document.vertices, id)) throw new Error(`Вершина ${id} не найдена`);
  if (entity.type === 'dimension' && (!Number.isFinite(entity.offset) || distance(getVertex(document.vertices, ids[0]!), getVertex(document.vertices, ids[1]!)) === 0)) throw new Error('Размер требует две разные позиции XY и конечный offset');
  if (entity.type === 'polygon' && polygonSelfIntersects(ids.map(id => getVertex(document.vertices, id)))) throw new Error('Граница самопересекается. Измените порядок точек.');
  if (entity.type === 'text' && (!entity.content.trim() || !Number.isFinite(entity.fontSize) || entity.fontSize <= 0)) throw new Error('Текст должен иметь содержание и положительный размер');
}
const referencedVertices = (entities: Entity[]) => new Set(entities.flatMap(entityVertexIds));


/** Addition runs allocate/index the document once, rather than once per generated entity. */
function applyEntityAdditions(document: GeoDocument, commands: readonly Extract<DocumentCommand, { type: 'add-entity' }>[]): GeoDocument {
  const entities = [...document.entities], layers = [...document.layers];
  let vertices = document.vertices;
  const index: AdditionIndex = { ids: new Set(entities.map(entity => entity.id)), layers: new Map(layers.map(layer => [layer.id, layer])), styles: new Set(document.styles.map(style => style.id)) };
  for (const command of commands) {
    if (entities.length >= 50000) throw new Error('Документ превышает лимит 50 000 объектов');
    if (command.layer && layers.length >= 1000) throw new Error('Документ превышает лимит 1000 слоёв');
    if (command.layer && (command.layer.id !== command.entity.layerId || index.layers.has(command.layer.id))) throw new Error('Неверный или повторяющийся слой нового объекта');
    if (command.layer && (!index.styles.has(command.layer.styleId) || command.layer.locked)) throw new Error('Новый слой должен иметь существующий стиль и быть доступен для редактирования');
    const requiredNewIds = new Set(entityVertexIds(command.entity).filter(id => !Object.hasOwn(vertices, id)));
    const additions = new Map<string, Vertex>();
    for (const vertex of command.vertices) {
      if (!vertex.id.trim() || vertices[vertex.id] || additions.has(vertex.id)) throw new Error(`ID вершины ${vertex.id} пустой или уже используется`);
      if (!finitePoint(vertexPoint(vertex))) throw new Error(`Координаты вершины ${vertex.id} должны быть конечными числами`);
      additions.set(vertex.id, { ...vertex });
    }
    for (const id of requiredNewIds) if (!additions.has(id)) throw new Error(`Для новой вершины ${id} не заданы координаты`);
    for (const id of additions.keys()) if (!requiredNewIds.has(id)) throw new Error(`Новая вершина ${id} не используется объектом`);
    if (command.layer) { const layer = { ...command.layer }; layers.push(layer); index.layers.set(layer.id, layer); }
    if (additions.size) { if (vertices === document.vertices) vertices = { ...vertices }; for (const [id, vertex] of additions) vertices[id] = vertex; }
    const candidate = { ...document, layers, vertices, entities };
    assertUniqueDocumentEntity(candidate, command.entity, index);
    entities.push(cloneEntity(command.entity)); index.ids.add(command.entity.id);
  }
  return { ...document, entities, layers: layers.length === document.layers.length ? document.layers : layers, vertices };
}

export function applyCommand(document: GeoDocument, raw: unknown): GeoDocument {
  const command = parseCommand(raw);
  if ((command.type === 'add-entity' || command.type === 'import-points') && document.entities.length + (command.type === 'add-entity' ? 1 : command.points.length) > 50000) throw new Error('Документ превышает лимит 50 000 объектов');
  if ((command.type === 'add-entity' || command.type === 'import-points') && command.layer && document.layers.length >= 1000) throw new Error('Документ превышает лимит 1000 слоёв');
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
    encodeDocument(candidate);
    return candidate;
  }
  if (command.type === 'set-layer-visibility' || command.type === 'set-layer-lock') {
    if (!document.layers.some(layer => layer.id === command.layerId)) throw new Error('Слой не найден');
    return { ...document, layers: document.layers.map(layer => layer.id !== command.layerId ? layer : {
      ...layer, ...(command.type === 'set-layer-visibility' ? { visible: command.visible } : { locked: command.locked }),
    }) };
  }
  if (command.type === 'update-layer') {
    if (!command.name.trim()) throw new Error('Имя слоя не может быть пустым');
    if (!document.layers.some(layer => layer.id === command.layerId)) throw new Error('Слой не найден');
    return { ...document, layers: document.layers.map(layer => layer.id === command.layerId ? { ...layer, name: command.name } : layer) };
  }
  if (command.type === 'add-entity') return applyEntityAdditions(document, [command]);
  if (command.type === 'delete-entity') {
    const entity = document.entities.find(item => item.id === command.entityId);
    if (!entity) throw new Error('Объект не найден');
    const layer = document.layers.find(item => item.id === entity.layerId);
    if (!layer || layer.locked) throw new Error('Нельзя удалить объект на заблокированном слое');
    const attached = entity.type === 'label' ? [] : document.entities.filter(item => item.type === 'label' && item.targetId === entity.id);
    for (const label of attached) {
      const labelLayer = document.layers.find(item => item.id === label.layerId);
      if (!labelLayer || labelLayer.locked) throw new Error('Нельзя удалить объект: связанная подпись находится на заблокированном слое');
    }
    const removedIds = new Set([entity.id, ...attached.map(label => label.id)]);
    const entities = document.entities.filter(item => !removedIds.has(item.id));
    const referenced = referencedVertices(entities);
    const vertices: Record<string, Vertex> = {};
    for (const [id, vertex] of Object.entries(document.vertices)) if (referenced.has(id)) vertices[id] = vertex;
    return { ...document, entities, vertices };
  }
  if (command.type === 'move-text') {
    const text = document.entities.find(item => item.id === command.entityId);
    if (!text || text.type !== 'text') throw new Error('Текстовый объект не найден');
    if (isLayerLocked(document, text)) throw new Error('Нельзя перемещать текст на заблокированном слое');
    if (!finitePoint(command.position)) throw new Error('Координаты должны быть конечными числами');
    const old = getVertex(document.vertices, text.vertexId);
    const shared = document.entities.some(item => item.id !== text.id && entityVertexIds(item).includes(text.vertexId));
    if (shared && (command.vertexId === text.vertexId || Object.hasOwn(document.vertices, command.vertexId))) throw new Error('Для перемещения общего текста требуется новый ID вершины');
    const vertexId = shared ? command.vertexId : text.vertexId;
    const vertices = { ...document.vertices, [vertexId]: worldVertex(vertexId, command.position) };
    const entities = document.entities.map(item => item.id === text.id ? { ...item, vertexId } : item);
    if (shared && !entities.some(item => item.id !== text.id && entityVertexIds(item).includes(old.id))) delete vertices[old.id];
    return { ...document, vertices, entities };
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
  if (command.type !== 'update-entity') { const exhaustive: never = command; throw new Error(`Неизвестная команда: ${String(exhaustive)}`); }
  if (command.patch.content !== undefined && entity.type !== 'text') throw new Error('Только у текстовой аннотации есть содержание');
  if (command.patch.template !== undefined && entity.type !== 'label') throw new Error('Шаблон доступен только у связанной подписи');
  if ((command.patch.dx !== undefined || command.patch.dy !== undefined) && entity.type !== 'label') throw new Error('Смещение доступно только у связанной подписи');
  if (command.patch.offset !== undefined && entity.type !== 'dimension') throw new Error('Offset доступен только у размера');
  if (command.patch.fontSize !== undefined && (entity.type !== 'text' || !Number.isFinite(command.patch.fontSize) || command.patch.fontSize <= 0)) throw new Error('Размер текста должен быть положительным конечным числом');
  if (command.patch.name !== undefined && !command.patch.name.trim()) throw new Error('Имя объекта не может быть пустым');
  if (command.patch.template !== undefined && command.patch.template.length > 10000) throw new Error('Шаблон подписи слишком длинный');
  if ((command.patch.dx !== undefined && !Number.isFinite(command.patch.dx)) || (command.patch.dy !== undefined && !Number.isFinite(command.patch.dy)) || (command.patch.offset !== undefined && !Number.isFinite(command.patch.offset))) throw new Error('Смещение должно быть конечным числом');
  // Copy only mutable properties; runtime callers cannot replace type/IDs/references.
  const patch = { ...(command.patch.name === undefined ? {} : { name: command.patch.name }),
    ...(command.patch.content === undefined ? {} : { content: command.patch.content }),
    ...(command.patch.template === undefined ? {} : { template: command.patch.template }),
    ...(command.patch.fontSize === undefined ? {} : { fontSize: command.patch.fontSize }),
    ...(command.patch.dx === undefined ? {} : { dx: command.patch.dx }), ...(command.patch.dy === undefined ? {} : { dy: command.patch.dy }),
    ...(command.patch.offset === undefined ? {} : { offset: command.patch.offset }) };
  return { ...document, entities: document.entities.map(item => item.id === entity.id ? cloneEntity({ ...entity, ...patch } as Entity) : item) };
}

export function isLayerLocked(document: GeoDocument, entity: Entity): boolean {
  return document.layers.find(layer => layer.id === entity.layerId)?.locked ?? true;
}
/** Bulk read policy for selected path handles; missing layers are locked as in isLayerLocked. */
export function lockedVertexIds(document: GeoDocument): ReadonlySet<string> {
  const editableLayers = new Set(document.layers.filter(layer => !layer.locked).map(layer => layer.id));
  const locked = new Set<string>();
  for (const entity of document.entities) if (!editableLayers.has(entity.layerId)) for (const id of entityVertexIds(entity)) locked.add(id);
  return locked;
}
export function canEditVertex(document: GeoDocument, vertexId: string): boolean {
  return Object.hasOwn(document.vertices, vertexId) && document.entities.filter(entity => entityVertexIds(entity).includes(vertexId))
    .every(entity => !isLayerLocked(document, entity));
}
export function entityPosition(document: GeoDocument, entity: Entity): WorldPoint {
  const id = entityVertexIds(entity)[0]!;
  const vertex = getVertex(document.vertices, id);
  return vertexPoint(vertex);
}

/** General transaction boundary: candidates remain private until every command and the final document validate. */
export function applyCommandsAtomically(document: GeoDocument, commands: readonly unknown[]): GeoDocument {
  if (!commands.length) return document;
  if (commands.length > 1000) throw new Error('Слишком большой пакет команд');
  const validated = commands.map(parseCommand);
  let candidate = document;
  for (let index = 0; index < validated.length;) {
    const additions: Extract<DocumentCommand, { type: 'add-entity' }>[] = [];
    while (validated[index]?.type === 'add-entity') additions.push(validated[index++]! as Extract<DocumentCommand, { type: 'add-entity' }>);
    if (additions.length) candidate = applyEntityAdditions(candidate, additions);
    else candidate = applyCommand(candidate, validated[index++]!);
  }
  validateDocument(candidate);
  encodeDocument(candidate);
  return candidate;
}
