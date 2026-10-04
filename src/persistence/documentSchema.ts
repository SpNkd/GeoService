import { z } from 'zod';
import { entityVertexIds, type GeoDocument } from '../domain/model';

export const id = z.string().min(1).max(256).refine(value => value === value.trim() && !['__proto__', 'constructor', 'prototype'].includes(value), 'Unsafe or padded ID');
export const finiteNumber = z.number().finite();
export const worldPointSchema = z.object({ x: finiteNumber, y: finiteNumber, z: finiteNumber.optional() });
// Literal paint colours only: the layer swatch also uses this value in CSS background.
const paintColour = z.string().max(100).refine(value => /^(?:[a-z]*|#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|(?:rgb|hsl)a?\([\d\s.,%+\-/]+\))$/i.test(value.trim()), 'Ожидается цвет без URL, CSS variables или внешних ресурсов');
const base = { id, name: z.string().min(1).max(1000), layerId: id, styleId: id.optional() };
export const entitySchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('point'), vertexId: id }),
  z.object({ ...base, type: z.literal('line'), startVertexId: id, endVertexId: id }),
  z.object({ ...base, type: z.literal('dimension'), startVertexId: id, endVertexId: id, offset: finiteNumber, textPosition: finiteNumber.min(0.05).max(0.95).optional() }),
  z.object({ ...base, type: z.literal('polyline'), vertexIds: z.tuple([id, id]).rest(id) }),
  z.object({ ...base, type: z.literal('polygon'), vertexIds: z.tuple([id, id, id]).rest(id) }),
  z.object({ ...base, type: z.literal('text'), vertexId: id, content: z.string().min(1).max(10000), fontSize: finiteNumber.positive().max(1000) }),
  z.object({ ...base, type: z.literal('label'), targetId: id, template: z.string().max(10000), dx: finiteNumber, dy: finiteNumber }),
]);

export const vertexSchema = worldPointSchema.extend({ id });
export const layerSchema = z.object({ id, name: z.string().min(1).max(1000), visible: z.boolean(), locked: z.boolean(), order: finiteNumber.int(), styleId: id });

/** Structure first; referential integrity is checked separately below. Unknown UI fields are stripped. */
export const documentSchema = z.object({
  schemaVersion: z.literal(2),
  metadata: z.object({ id, title: z.string().min(1).max(1000), description: z.string().max(10000) }),
  units: z.object({ length: z.literal('m'), area: z.literal('m2') }),
  coordinateSystem: z.object({ kind: z.enum(['local', 'projected', 'unknown']), name: z.string().max(1000).optional(),
    epsg: finiteNumber.int().positive().optional(), xAxis: z.literal('east'), yAxis: z.literal('north'), zAxis: z.literal('up') }),
  vertices: z.record(id, vertexSchema),
  layers: z.array(layerSchema).min(1).max(1000),
  entities: z.array(entitySchema).max(50000),
  styles: z.array(z.object({ id, stroke: paintColour, fill: paintColour, lineWeight: finiteNumber.positive().max(100), dash: z.string().max(100).optional() })).min(1).max(1000),
  viewport: z.object({ center: worldPointSchema, pixelsPerUnit: finiteNumber.min(0.00001).max(100000) }),
});

export function validateDocument(raw: unknown): GeoDocument {
  const result = documentSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new Error(`Неверный документ: ${issue.path.join('.') || 'GeoDocument'} — ${issue.message}`);
  }
  const document = result.data as GeoDocument;
  for (const [kind, items] of [['layer', document.layers], ['entity', document.entities], ['style', document.styles]] as const) {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.id)) throw new Error(`Duplicate ${kind} ID ${item.id}`);
      seen.add(item.id);
    }
  }
  const layers = new Set(document.layers.map(layer => layer.id));
  const styles = new Set(document.styles.map(style => style.id));
  for (const [key, vertex] of Object.entries(document.vertices)) if (key !== vertex.id) throw new Error(`Vertex key ${key} does not match ID ${vertex.id}`);
  for (const layer of document.layers) if (!styles.has(layer.styleId)) throw new Error(`Layer ${layer.id} references missing style ${layer.styleId}`);
  for (const entity of document.entities) {
    if (!layers.has(entity.layerId)) throw new Error(`Entity ${entity.id} references missing layer ${entity.layerId}`);
    if (entity.styleId && !styles.has(entity.styleId)) throw new Error(`Entity ${entity.id} references missing style ${entity.styleId}`);
    for (const id of entityVertexIds(entity)) if (!Object.hasOwn(document.vertices, id)) throw new Error(`Entity ${entity.id} references missing vertex ${id}`);
    if (entity.type === 'label') {
      const target = document.entities.find(candidate => candidate.id === entity.targetId);
      if (!target || !['point', 'line', 'polyline', 'polygon'].includes(target.type)) throw new Error(`Label ${entity.id} references missing or unsupported target ${entity.targetId}`);
    }
  }
  return document;
}
