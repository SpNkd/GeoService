import { projectSelectionTransform, resolveSelectionTransform } from './selectionTransform';
import { styleKeysFor } from '../styles/model';
import { connectorRoute, connectivityIndex, validateConnector } from '../connectors/model';
import type { ConnectorEndpoint } from './model';
import { entityVertexIds, getVertex, vertexPoint, worldVertex, type Entity, type GeoDocument, type Layer, type PointEntity, type Vertex, type WorldPoint, type SurveyXY, type VerticalReference } from './model';
import { entitySchema, validateDocumentSemantics, validateDocument } from '../persistence/documentSchema';
import { encodeDocument } from '../persistence/serialization';
import { distance } from '../geometry';
import { polygonSelfIntersects } from '../geometry/survey';
import { createHorizontalReference, documentModelFrame, surveyToModelXY } from '../geometry/georeferencing';
import { resolveSelectionMove, projectSelectionMove, type Translation } from './selectionMove';
import { requireSymbol } from '../symbols/registry';
import { normalizeSymbolRotation } from '../symbols/types';
import { parseCommand } from './commandSchema';
import { blockAttributeLocalPosition } from '../vectors/geometry';

/** The one deterministic mutation boundary shared by canvas, inspector, and future AI adapters. */
export type DocumentCommand =
  | {type:'reset-entity-style';entityIds:string[]}
  | {type:'reset-layer-style';layerId:string}
  | {type:'transform-selection';entityIds:string[];transform:import('./selectionTransform').SelectionTransform}
  | {type:'set-entity-style';entityIds:string[];patch:import('../styles/model').StyleOverrides}
  | {type:'set-layer-style';layerId:string;patch:import('../styles/model').LayerStyle}

  | {type:'update-underlay';entityId:string;patch:Partial<Pick<import('./model').RasterUnderlayEntity,'position'|'width'|'height'|'rotationDeg'|'opacity'|'locked'|'assetId'|'assetMetadata'|'imageCalibration'>>}
  | {type:'set-symbol-position';entityId:string;position:WorldPoint}
  | {type:'retarget-connector';entityId:string;endpoint:'start'|'end';target:ConnectorEndpoint}
  | {type:'set-connector-routing';entityId:string;routing:'direct'|'orthogonal'}
  | { type: 'set-entities-layer'; entityIds: string[]; layerId: string }
  | { type: 'move-entities'; entityIds: string[]; delta: Translation }
  | { type: 'set-model-frame'; frame: 'local' | 'projected' }
  | { type: 'set-horizontal-reference'; pairs: [{ pointEntityId: string; survey: SurveyXY }, { pointEntityId: string; survey: SurveyXY }] | null }
  | { type: 'set-vertical-reference'; reference: VerticalReference | null }
  | { type: 'import-points'; coordinateSpace?: 'model' | 'survey'; points: { entity: PointEntity; vertex: Vertex }[]; layer?: Layer }
  | { type: 'add-entity'; entity: Entity; vertices: Vertex[]; layer?: Layer }
  | { type: 'delete-entity'; entityId: string }
  | { type: 'create-layer'; layer: Layer }
  | { type: 'delete-layer'; layerId: string }
  | { type: 'move-layer'; layerId: string; direction: -1 | 1 }
  | { type: 'update-layer'; layerId: string; name: string }
  | { type: 'update-dimension-reference'; dimensionId: string; endpoint: 'start' | 'end'; vertexId: string }
  | { type: 'update-vertex'; vertexId: string; position: WorldPoint }
  | { type: 'move-vertex'; vertexId: string; delta: WorldPoint }
  | { type: 'move-text'; entityId: string; vertexId: string; position: WorldPoint }
  | { type: 'update-block-attribute'; entityId: string; tag: string; attributeIndex: number; sourceHandle?: string; patch: { value?: string; position?: WorldPoint } }
  | { type: 'update-entity'; entityId: string; patch: { name?: string; content?: string; template?: string; fontSize?: number; dx?: number; dy?: number; offset?: number; textPosition?: number; rotationDeg?: number; scale?: number } }
  | { type: 'set-entity-layer'; entityId: string; layerId: string }
  | { type: 'set-layer-visibility'; layerId: string; visible: boolean }
  | { type: 'set-layer-lock'; layerId: string; locked: boolean };

const finitePoint = (point: WorldPoint) => Number.isFinite(point.x) && Number.isFinite(point.y) && (point.z === undefined || Number.isFinite(point.z));
function cloneEntity(entity: Entity): Entity {
  if (entity.type === 'connector') return {...entity,start:{...entity.start},end:{...entity.end},...(entity.waypoints?{waypoints:entity.waypoints.map(p=>({...p}))}:{})};
  if (entity.type === 'symbol') return { ...entity, position: { ...entity.position }, ...(entity.properties ? { properties: { ...entity.properties } } : {}) };
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
    if (!target || !['point', 'line', 'polyline', 'polygon', 'symbol'].includes(target.type)) throw new Error('Подпись должна ссылаться на существующую точку, линию, полилинию или полигон');
  }
  if (entity.styleId && !(index ? index.styles.has(entity.styleId) : document.styles.some(style => style.id === entity.styleId))) throw new Error('Стиль объекта не найден');
  if (entity.type === 'symbol') {
    const definition = requireSymbol(entity.libraryId, entity.symbolId, entity.libraryVersion);
    if (!layer.visible) throw new Error('Нельзя создать символ в скрытом слое');
    if (definition.allowedRotations && !definition.allowedRotations.includes(entity.rotationDeg)) throw new Error('Поворот не разрешён определением символа');
  }
  if(entity.type==='connector'){if(!layer.visible)throw new Error('Нельзя создать соединение в скрытом слое');validateConnector(document,entity);}
  const ids = entityVertexIds(entity);
  const minimum = ['raster_underlay','connector','label','symbol','arc','circle','block_instance','imported_graphic'].includes(entity.type) ? 0 : entity.type === 'polygon' ? 3 : entity.type === 'polyline' || entity.type === 'line' || entity.type === 'dimension' ? 2 : 1;
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
  if(command.type==='update-underlay'){
      const entity=document.entities.find(e=>e.id===command.entityId);
      if(!entity||entity.type!=='raster_underlay')throw new Error('Подложка не найдена');
      if(document.layers.find(l=>l.id===entity.layerId)?.locked)throw new Error('Слой заблокирован');
      if(entity.locked&&Object.keys(command.patch).some(k=>k!=='locked'))throw new Error('Подложка заблокирована');
      if(Object.entries(command.patch).every(([key,value])=>JSON.stringify(entity[key as keyof typeof entity])===JSON.stringify(value)))return document;
      const updated={...entity,...command.patch};if(command.patch.assetId&&command.patch.assetId!==entity.assetId)delete updated.imageCalibration;
      return {...document,entities:document.entities.map(e=>e.id===entity.id?updated:e)};
    }
  if(command.type==='retarget-connector'||command.type==='set-connector-routing'){
    const entity=document.entities.find(e=>e.id===command.entityId);
    if(!entity||entity.type!=='connector')throw new Error('Соединение не найдено.');
    if(isLayerLocked(document,entity))throw new Error('Нельзя изменять соединение на заблокированном слое.');
    const updated=command.type==='retarget-connector'?{...entity,[command.endpoint]:{...command.target}}:{...entity,routing:command.routing};
    validateConnector(document,updated);
    if(command.type==='set-connector-routing'?entity.routing===command.routing:entity[command.endpoint].symbolEntityId===command.target.symbolEntityId&&entity[command.endpoint].portId===command.target.portId)return document;
    return {...document,entities:document.entities.map(e=>e.id===entity.id?updated:e)};
  }
  if(command.type==='reset-layer-style'){if(!document.layers.some(l=>l.id===command.layerId))throw new Error('Слой не найден');return {...document,layers:document.layers.map(l=>{if(l.id!==command.layerId)return l;const next={...l};delete next.style;return next;})};}
  if(command.type==='reset-entity-style'){const ids=new Set(command.entityIds),owners=document.entities.filter(e=>ids.has(e.id));if(owners.length!==ids.size||owners.some(e=>isLayerLocked(document,e)))throw new Error('Объекты отсутствуют или заблокированы');return {...document,entities:document.entities.map(e=>{if(!ids.has(e.id))return e;const next={...e};delete next.style;return next;})};}
  if(command.type==='transform-selection'){const candidate=projectSelectionTransform(document,resolveSelectionTransform(document,command.entityIds,command.transform.kind),command.transform);if(candidate===document)return document;for(const e of candidate.entities)if(e!==document.entities.find(old=>old.id===e.id)&&!entitySchema.safeParse(e).success)throw new Error('Результат поворота содержит недопустимые значения');validateDocumentSemantics(candidate);return candidate;}
  if(command.type==='set-layer-style'){const layer=document.layers.find(l=>l.id===command.layerId);if(!layer)throw new Error('Слой не найден');return {...document,layers:document.layers.map(l=>l===layer?{...l,style:{...l.style,...command.patch}}:l)};}
  if(command.type==='set-entity-style'){
    const ids=new Set(command.entityIds),owners=document.entities.filter(e=>ids.has(e.id));if(owners.length!==ids.size)throw new Error('Объект не найден');
    for(const e of owners){if(isLayerLocked(document,e)||e.type==='raster_underlay'&&e.locked)throw new Error('Стиль заблокированного объекта нельзя менять');if(Object.keys(command.patch).some(k=>!styleKeysFor(e).includes(k as keyof import('../styles/model').StyleValues)))throw new Error(`Объект «${e.name}» не поддерживает выбранные свойства стиля.`);}
    return {...document,entities:document.entities.map(e=>ids.has(e.id)?{...e,style:{...e.style,...command.patch}}:e)};
  }
  if (command.type === 'move-entities') return projectSelectionMove(document, resolveSelectionMove(document, command.entityIds), command.delta);
  if (command.type === 'update-dimension-reference') {
    const entity = document.entities.find(item => item.id === command.dimensionId);
    if (!entity || entity.type !== 'dimension') throw new Error('Размер не найден');
    if (isLayerLocked(document, entity)) throw new Error('Нельзя изменять размер на заблокированном слое');
    if (!Object.hasOwn(document.vertices, command.vertexId)) throw new Error('Опорная вершина не найдена');
    const other = command.endpoint === 'start' ? entity.endVertexId : entity.startVertexId;
    if (command.vertexId === other) throw new Error('Начало и конец размера должны ссылаться на разные вершины');
    if (distance(document.vertices[command.vertexId]!, document.vertices[other]!) === 0) throw new Error('Начало и конец размера не могут занимать одну позицию');
    const current = command.endpoint === 'start' ? entity.startVertexId : entity.endVertexId;
    if (command.vertexId === current) return document;
    const updated = command.endpoint === 'start' ? { ...entity, startVertexId: command.vertexId } : { ...entity, endVertexId: command.vertexId };
    return { ...document, entities: document.entities.map(item => item.id === entity.id ? updated : item) };
  }
  if (command.type === 'set-model-frame') {
    if (command.frame === 'projected' && document.horizontalReference) throw new Error('Сначала удалите горизонтальную привязку.');
    if (documentModelFrame(document) === command.frame) return document;
    return { ...document, modelFrame: command.frame };
  }
  if (command.type === 'set-horizontal-reference') {
    if (!command.pairs) { if (!document.horizontalReference) return document; const next = { ...document }; delete next.horizontalReference; return next; }
    return { ...document, horizontalReference: createHorizontalReference(document, command.pairs) };
  }
  if (command.type === 'set-vertical-reference') {
    if (!command.reference) { if (!document.verticalReference) return document; const next = { ...document }; delete next.verticalReference; return next; }
    if (document.verticalReference?.absoluteAtModelZero === command.reference.absoluteAtModelZero) return document;
    return { ...document, verticalReference: { ...command.reference } };
  }
  if ((command.type === 'add-entity' || command.type === 'import-points') && document.entities.length + (command.type === 'add-entity' ? 1 : command.points.length) > 50000) throw new Error('Документ превышает лимит 50 000 объектов');
  if ((command.type === 'add-entity' || command.type === 'import-points') && command.layer && document.layers.length >= 1000) throw new Error('Документ превышает лимит 1000 слоёв');
  if (command.type === 'import-points') {
    const isSurvey = command.coordinateSpace === 'survey';
    const empty = !document.entities.length && !Object.keys(document.vertices).length;
    const frame = isSurvey && empty ? 'projected' : documentModelFrame(document);
    if (isSurvey && frame === 'local' && !document.horizontalReference) throw new Error('Для Survey импорта в локальную модель нужна привязка. Выберите MODEL или новый документ.');
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
      ids.add(entity.id); vertices[vertex.id] = isSurvey && frame === 'local' ? { ...vertex, ...surveyToModelXY({ e: vertex.x, n: vertex.y }, document.horizontalReference!.transform) } : { ...vertex }; entities.push({ ...entity });
    }
    const candidate = validateDocument({ ...document, ...(isSurvey && empty ? { modelFrame: 'projected' } : {}), layers, vertices, entities });
    encodeDocument(candidate);
    return candidate;
  }
  if (command.type === 'create-layer') {
    if (document.layers.length >= 1000 || document.layers.some(layer => layer.id === command.layer.id)) throw new Error('Неверный ID или превышен лимит слоёв');
    if (!document.styles.some(style => style.id === command.layer.styleId)) throw new Error('Стиль слоя не найден');
    return { ...document, layers: [...document.layers, { ...command.layer }] };
  }
  if (command.type === 'delete-layer') {
    if (!document.layers.some(layer => layer.id === command.layerId)) throw new Error('Слой не найден');
    const count = document.entities.filter(entity => entity.layerId === command.layerId).length;
    if (count) throw new Error(`Слой содержит ${count} объектов. Перед удалением переместите или удалите их.`);
    const primitives=[...(document.blocks??[]).flatMap(b=>b.primitives),...document.entities.flatMap(e=>e.type==='imported_graphic'?e.primitives:e.type==='block_instance'?e.attributePrimitives??[]:[])];
    if(primitives.some(p=>p.layerId===command.layerId))throw new Error('Слой используется геометрией внутри DXF blocks/proxies. Удаление нарушило бы ссылки.');
    if (document.layers.length === 1) throw new Error('Нельзя удалить последний слой');
    return { ...document, layers: document.layers.filter(layer => layer.id !== command.layerId) };
  }
  if (command.type === 'move-layer') {
    const layers = [...document.layers].sort((a, b) => a.order - b.order), index = layers.findIndex(layer => layer.id === command.layerId);
    if (index < 0) throw new Error('Слой не найден');
    const next = index + command.direction;
    if (next < 0 || next >= layers.length) return document;
    [layers[index], layers[next]] = [layers[next]!, layers[index]!];
    return { ...document, layers: layers.map((layer, order) => ({ ...layer, order })) };
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
    if(entity.type==='symbol'){const connections=connectivityIndex(document).bySymbol.get(entity.id)?.length??0;if(connections)throw new Error(`Символ имеет ${connections} подключения. Сначала удалите или переподключите их.`);}
    if (document.horizontalReference?.controls.some(control => control.pointEntityId === entity.id)) throw new Error(`Точка ${entity.name} используется для привязки координат. Сначала измените или удалите привязку.`);
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
  if(command.type==='set-symbol-position') {
    const entity=document.entities.find(e=>e.id===command.entityId);if(!entity||entity.type!=='symbol')throw new Error('Символ не найден');
    if(isLayerLocked(document,entity))throw new Error('Слой символа заблокирован');
    if(!finitePoint(command.position))throw new Error('Координаты должны быть конечными числами');
    if(entity.position.x===command.position.x&&entity.position.y===command.position.y&&entity.position.z===command.position.z)return document;
    return {...document,entities:document.entities.map(e=>e===entity?{...entity,position:{...command.position}}:e)};
  }
  if(command.type==='update-block-attribute') {
    const owner=document.entities.find(item=>item.id===command.entityId);
    if(!owner||owner.type!=='block_instance')throw new Error('Экземпляр DXF блока не найден');
    if(!Number.isInteger(command.attributeIndex)||command.attributeIndex<0)throw new Error('Путь ATTRIB некорректен');
    if(command.patch.value!==undefined&&command.patch.value.length>10000)throw new Error('Значение ATTRIB слишком длинное');
    if(command.patch.position&&!finitePoint(command.patch.position))throw new Error('Координаты должны быть конечными числами');
    if(command.patch.value===undefined&&command.patch.position===undefined)throw new Error('Команда ATTRIB не содержит изменений');
    const ownerLayer=document.layers.find(layer=>layer.id===owner.layerId);
    if(!ownerLayer||ownerLayer.locked)throw new Error('Нельзя изменять ATTRIB на заблокированном слое вставки');
    const source=document.blocks?.find(block=>block.id===owner.blockDefinitionId);
    if(!source)throw new Error('Определение блока не найдено');
    const raw=owner.attributePrimitives??[],selected=raw[command.attributeIndex];
    if(!selected||selected.kind!=='text'||selected.source?.originalType!=='ATTRIB'||selected.attributeTag!==command.tag||command.sourceHandle!==undefined&&selected.source?.handle!==command.sourceHandle)throw new Error('Выбранный ATTRIB не совпадает с исходной геометрией');
    const initial=owner.attributeCoordinateSpace==='block-local'?raw:raw.map(primitive=>primitive.kind==='text'&&primitive.source?.originalType==='ATTRIB'?{...primitive,position:blockAttributeLocalPosition(owner,source,primitive.position),rotationDeg:primitive.rotationDeg-owner.rotationDeg}:primitive);
    const attributeLayer=document.layers.find(layer=>layer.id===selected.layerId);
    if(!attributeLayer||attributeLayer.locked)throw new Error('Слой исходного ATTRIB заблокирован');
    const attributePrimitives=initial.map((primitive,index)=>index!==command.attributeIndex||primitive.kind!=='text'?primitive:{...primitive,...(command.patch.value===undefined?{}:{content:command.patch.value}),...(command.patch.position===undefined?{}:{position:{...command.patch.position}})});
    const attributes=command.patch.value===undefined||!Object.hasOwn(owner.attributes??{},command.tag)?owner.attributes:{...owner.attributes,[command.tag]:command.patch.value};
    const next={...owner,attributeCoordinateSpace:'block-local' as const,attributePrimitives,...(attributes?{attributes}:{})};
    return {...document,entities:document.entities.map(item=>item.id===owner.id?next:item)};
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
  if (command.type === 'set-entities-layer') {
    const target=document.layers.find(l=>l.id===command.layerId), ids=new Set(command.entityIds);
    if(!target||target.locked)throw new Error('Целевой слой заблокирован или отсутствует');
    const owners=document.entities.filter(e=>ids.has(e.id));
    if(!ids.size||owners.length!==ids.size)throw new Error('Набор объектов пуст или содержит отсутствующие объекты');
    if(owners.some(e=>isLayerLocked(document,e)))throw new Error('Исходный слой заблокирован');
    if(owners.every(e=>e.layerId===target.id))return document;
    return {...document,entities:document.entities.map(e=>ids.has(e.id)&&e.layerId!==target.id?{...e,layerId:target.id}:e)};
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
  if ((command.patch.rotationDeg !== undefined || command.patch.scale !== undefined) && !['symbol','text','block_instance'].includes(entity.type)) throw new Error('Поворот доступен только у текста, символа или блока');
  if(command.patch.scale!==undefined&&entity.type!=='symbol')throw new Error('Масштаб доступен только у символа');
  const rotationDeg = command.patch.rotationDeg === undefined ? undefined : normalizeSymbolRotation(command.patch.rotationDeg);
  if (entity.type === 'symbol' && rotationDeg !== undefined) { const allowed = requireSymbol(entity.libraryId, entity.symbolId, entity.libraryVersion).allowedRotations; if (allowed && !allowed.includes(rotationDeg)) throw new Error('Поворот не разрешён определением символа'); }
  if (command.patch.content !== undefined && entity.type !== 'text') throw new Error('Только у текстовой аннотации есть содержание');
  if (command.patch.template !== undefined && entity.type !== 'label') throw new Error('Шаблон доступен только у связанной подписи');
  if ((command.patch.dx !== undefined || command.patch.dy !== undefined) && entity.type !== 'label') throw new Error('Смещение доступно только у связанной подписи');
  if (command.patch.textPosition !== undefined && entity.type !== 'dimension') throw new Error('Положение числа доступно только у размера');
  if (command.patch.offset !== undefined && entity.type !== 'dimension') throw new Error('Offset доступен только у размера');
  if (command.patch.fontSize !== undefined && (entity.type !== 'text' || !Number.isFinite(command.patch.fontSize) || command.patch.fontSize <= 0)) throw new Error('Размер текста должен быть положительным конечным числом');
  if (command.patch.name !== undefined && !command.patch.name.trim()) throw new Error('Имя объекта не может быть пустым');
  if (command.patch.template !== undefined && command.patch.template.length > 10000) throw new Error('Шаблон подписи слишком длинный');
  if ((command.patch.dx !== undefined && !Number.isFinite(command.patch.dx)) || (command.patch.dy !== undefined && !Number.isFinite(command.patch.dy)) || (command.patch.offset !== undefined && !Number.isFinite(command.patch.offset))) throw new Error('Смещение должно быть конечным числом');
  // Copy only mutable properties; runtime callers cannot replace type/IDs/references.
  const patch = { ...(rotationDeg === undefined ? {} : { rotationDeg }), ...(command.patch.scale === undefined ? {} : { scale: command.patch.scale }), ...(command.patch.name === undefined ? {} : { name: command.patch.name }),
    ...(command.patch.content === undefined ? {} : { content: command.patch.content }),
    ...(command.patch.template === undefined ? {} : { template: command.patch.template }),
    ...(command.patch.fontSize === undefined ? {} : { fontSize: command.patch.fontSize }),
    ...(command.patch.dx === undefined ? {} : { dx: command.patch.dx }), ...(command.patch.dy === undefined ? {} : { dy: command.patch.dy }),
    ...(command.patch.textPosition === undefined ? {} : { textPosition: command.patch.textPosition }), ...(command.patch.offset === undefined ? {} : { offset: command.patch.offset }) };
  if (Object.entries(patch).every(([key, value]) => entity[key as keyof typeof entity] === value)) return document;
  // Intrinsic rotation uses the same topology/lock and legacy ATTRIB policy,
  // with the insertion/anchor as pivot so an absolute orientation does not move it.
  const pivot=entity.type==='text'?vertexPoint(getVertex(document.vertices,entity.vertexId)):entity.type==='symbol'||entity.type==='block_instance'?entity.position:null;
  const intrinsicAngle='rotationDeg' in entity?entity.rotationDeg??0:0;
  const transformed=rotationDeg!==undefined&&pivot?applyCommand(document,{type:'transform-selection',entityIds:[entity.id],transform:{kind:'rotate',pivot,angleDeg:rotationDeg-intrinsicAngle}}):document;
  return { ...transformed, entities: transformed.entities.map(item => item.id === entity.id ? cloneEntity({ ...item, ...patch } as Entity) : item) };
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
  if(entity.type==='connector')return connectorRoute(document,entity)[0]!;
  if ('position' in entity) return { ...entity.position };
  if ('center' in entity) return { ...entity.center };
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
