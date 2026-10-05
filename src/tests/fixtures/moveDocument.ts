import { createNewDocument } from '../../domain/newDocument';
import type { GeoDocument } from '../../domain/model';

/** Shared polygon corner, separate text/path, four associative house dimensions. */
export function moveDocument(): GeoDocument {
  return { ...createNewDocument(), metadata: { id: 'move-fixture', title: 'Move fixture', description: '' },
    viewport: { center: { x: 6, y: 4 }, pixelsPerUnit: 25 },
    vertices: {
      a: { id: 'a', x: 0, y: 0, z: 2 }, b: { id: 'b', x: 6, y: 0 }, c: { id: 'c', x: 6, y: 5 }, d: { id: 'd', x: 0, y: 5 },
      e: { id: 'e', x: -5, y: -3 }, t: { id: 't', x: 9, y: 7 },
      u: { id: 'u', x: 9, y: 0 }, v: { id: 'v', x: 12, y: 2 }, w: { id: 'w', x: 15, y: 0 },
      ca: { id: 'ca', x: -8, y: 10 }, cb: { id: 'cb', x: 12, y: 10 },
    }, entities: [
      { id: 'house', type: 'polygon', name: 'Дом', layerId: 'buildings', vertexIds: ['a', 'b', 'c', 'd'] },
      { id: 'line', type: 'line', name: 'Связанная линия', layerId: 'boundary', startVertexId: 'a', endVertexId: 'e' },
      { id: 'path', type: 'polyline', name: 'Путь', layerId: 'boundary', vertexIds: ['u', 'v', 'w'] },
      { id: 'point', type: 'point', name: 'Точка', layerId: 'survey-points', vertexId: 'e' },
      { id: 'text', type: 'text', name: 'Текст', layerId: 'annotations', vertexId: 't', content: 'TEXT', fontSize: 12 },
      { id: 'label', type: 'label', name: 'Подпись', layerId: 'annotations', targetId: 'house', template: '{name}', dx: 0, dy: 1 },
      { id: 'line-label', type: 'label', name: 'Подпись линии', layerId: 'annotations', targetId: 'line', template: '{length}', dx: 0, dy: 1 },
      { id: 'control-a', type: 'point', name: 'A', layerId: 'survey-points', vertexId: 'ca' },
      { id: 'control-b', type: 'point', name: 'B', layerId: 'survey-points', vertexId: 'cb' },
      ...(['a', 'b', 'c', 'd'] as const).map((id, i) => ({ id: `dim-${i}`, type: 'dimension' as const, name: `Размер ${i}`, layerId: 'dimensions', startVertexId: id, endVertexId: ['b', 'c', 'd', 'a'][i]!, offset: -1, textPosition: 0.4 })),
    ] };
}
