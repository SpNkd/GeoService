import { createSampleDocument } from '../sample/document';
import type { GeoDocument } from './model';

export function createNewDocument(): GeoDocument {
  const base = createSampleDocument();
  return { ...base, metadata: { id: `document-${crypto.randomUUID()}`, title: 'Новая схема', description: '' },
    modelFrame: 'local', coordinateSystem: { kind: 'local', xAxis: 'east', yAxis: 'north', zAxis: 'up' },
    layers: [...base.layers, { id: 'dimensions', name: 'Размеры', visible: true, locked: false, order: 4, styleId: 'annotation' }],
    vertices: {}, entities: [], viewport: { center: { x: 0, y: 0 }, pixelsPerUnit: 10 } };
}
