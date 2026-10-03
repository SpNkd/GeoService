import { createSampleDocument } from '../sample/document';
import type { GeoDocument } from './model';

export function createNewDocument(): GeoDocument {
  const base = createSampleDocument();
  return { ...base, metadata: { id: `document-${crypto.randomUUID()}`, title: 'Новая схема', description: '' },
    coordinateSystem: { kind: 'unknown', xAxis: 'east', yAxis: 'north', zAxis: 'up' },
    vertices: {}, entities: [], viewport: { center: { x: 0, y: 0 }, pixelsPerUnit: 10 } };
}
