import { getVertex, worldVertex, type Entity, type GeoDocument, type Layer, type WorldPoint } from './model';
import type { DocumentCommand } from './commands';
import { defaultLabelTemplate } from '../geometry/labels';

export interface GeometryAnchor { position: WorldPoint; vertexId?: string }
export type DrawingKind = 'point' | 'line' | 'polyline' | 'polygon' | 'text' | 'dimension';
export const newGeometryId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
/** An explicit vertex ID is the only reason to reuse topology. Coordinates alone never merge it. */
export function createGeometryCommand(document: GeoDocument, kind: DrawingKind, input: GeometryAnchor[],
  options: { offset?: number; content?: string; layerId?: string; newId?: (prefix: string) => string } = {}): DocumentCommand {
  const newId = options.newId ?? newGeometryId;
  const anchors = kind === 'polygon' && input.length > 3 && input[0]!.vertexId && input[0]!.vertexId === input[input.length - 1]!.vertexId ? input.slice(0, -1) : input;
  const minimum = kind === 'polygon' ? 3 : ['line', 'polyline', 'dimension'].includes(kind) ? 2 : 1;
  if (anchors.length < minimum) throw new Error(`Требуется минимум ${minimum} точек`);
  const preferred = (kind !== 'dimension' && options.layerId) || (kind === 'point' ? 'survey-points' : kind === 'text' ? 'annotations' : kind === 'dimension' ? 'dimensions' : 'boundary');
  let layer = document.layers.find(layer => layer.id === preferred);
  let addition: Layer | undefined;
  if (!layer && kind === 'dimension') {
    addition = { id: 'dimensions', name: 'Размеры', visible: true, locked: false, order: Math.max(...document.layers.map(layer => layer.order)) + 1,
      styleId: document.styles.find(style => style.id === 'annotation')?.id ?? document.styles[0]!.id };
    layer = addition;
  }
  layer ??= document.layers.find(layer => !layer.locked) ?? document.layers[0]!;
  if (options.layerId && (!document.layers.includes(layer) || !layer.visible || layer.locked)) throw new Error(`Текущий слой «${layer.name}» скрыт или заблокирован`);
  const vertices = anchors.filter(anchor => kind === 'text' || !anchor.vertexId).map(anchor => worldVertex(newId('v'), anchor.position));
  let index = 0;
  const ids = anchors.map(anchor => { if (kind !== 'text' && anchor.vertexId) { getVertex(document.vertices, anchor.vertexId); return anchor.vertexId; } return vertices[index++]!.id; });
  const labels = { point: 'Точка', line: 'Линия', polyline: 'Полилиния', polygon: 'Полигон', text: 'Текст', dimension: 'Размер' };
  const base = { id: newId(kind), name: `${labels[kind]} ${document.entities.length + 1}`, layerId: layer.id };
  let entity: Entity;
  switch (kind) {
    case 'point': entity = { ...base, type: kind, vertexId: ids[0]! }; break;
    case 'text': entity = { ...base, type: kind, vertexId: ids[0]!, content: options.content ?? '', fontSize: 14 }; break;
    case 'line': entity = { ...base, type: kind, startVertexId: ids[0]!, endVertexId: ids[1]! }; break;
    case 'dimension': entity = { ...base, type: kind, startVertexId: ids[0]!, endVertexId: ids[1]!, offset: options.offset ?? 0 }; break;
    case 'polyline': entity = { ...base, type: kind, vertexIds: ids as [string, string, ...string[]] }; break;
    case 'polygon': entity = { ...base, type: kind, vertexIds: ids as [string, string, string, ...string[]] }; break;
  }
  return { type: 'add-entity', entity, vertices, ...(addition ? { layer: addition } : {}) };
}
export function commandFromOrderedPoints(document: GeoDocument, pointIds: string[], kind: 'polyline' | 'polygon', layerId?: string): DocumentCommand {
  const anchors = pointIds.map(id => {
    const entity = document.entities.find(entity => entity.id === id);
    if (!entity || entity.type !== 'point') throw new Error(`Точка ${id} отсутствует`);
    return { vertexId: entity.vertexId, position: getVertex(document.vertices, entity.vertexId) };
  });
  if (new Set(anchors.map(anchor => anchor.vertexId)).size !== anchors.length) throw new Error('Выбранные точки должны ссылаться на разные вершины');
  const command = createGeometryCommand(document, kind, anchors, { ...(layerId ? { layerId } : {}) });
  if (command.type === 'add-entity' && kind === 'polygon') command.entity.name = `Граница ${document.entities.length + 1}`;
  return command;
}

export function createLabelCommand(document: GeoDocument, targetId: string, newId = newGeometryId): DocumentCommand {
  const target = document.entities.find(entity => entity.id === targetId);
  if (!target || !['point', 'line', 'polyline', 'polygon'].includes(target.type)) throw new Error('Сначала выберите точку, линию, полилинию или полигон');
  let layer = document.layers.find(item => item.id === 'annotations');
  let addition: Layer | undefined;
  if (!layer) {
    if (document.layers.length >= 1000) throw new Error('Документ превышает лимит 1000 слоёв');
    addition = { id: 'annotations', name: 'Аннотации', visible: true, locked: false, order: Math.max(...document.layers.map(item => item.order)) + 1,
      styleId: document.styles.find(style => style.id === 'annotation')?.id ?? document.styles[0]!.id };
    layer = addition;
  }
  if (!layer.visible || layer.locked) throw new Error(`Слой «${layer.name}» скрыт или заблокирован`);
  const entity: Entity = { id: newId('label'), name: `Подпись ${document.entities.length + 1}`, type: 'label', layerId: layer.id,
    targetId, template: defaultLabelTemplate(target), dx: 4, dy: 4 };
  return { type: 'add-entity', entity, vertices: [], ...(addition ? { layer: addition } : {}) };
}
