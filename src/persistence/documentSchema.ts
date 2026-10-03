import { z } from 'zod';
import { entityVertexIds, type GeoDocument } from '../domain/model';

const id = z.string().min(1).max(256).refine(value => value === value.trim() && !['__proto__', 'constructor', 'prototype'].includes(value), 'Unsafe or padded ID');
const number = z.number().finite();
const point = z.object({ x: number, y: number, z: number.optional() });
const base = { id, name: z.string().min(1).max(1000), layerId: id, styleId: id.optional() };
const entity = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('point'), vertexId: id }),
  z.object({ ...base, type: z.literal('line'), startVertexId: id, endVertexId: id }),
  z.object({ ...base, type: z.literal('polyline'), vertexIds: z.tuple([id, id]).rest(id) }),
  z.object({ ...base, type: z.literal('polygon'), vertexIds: z.tuple([id, id, id]).rest(id) }),
  z.object({ ...base, type: z.literal('text'), vertexId: id, content: z.string().min(1).max(10000), fontSize: number.positive().max(1000) }),
]);

/** Structure first; referential integrity is checked separately below. Unknown UI fields are stripped. */
export const documentSchema = z.object({
  schemaVersion: z.literal(2),
  metadata: z.object({ id, title: z.string().min(1).max(1000), description: z.string().max(10000) }),
  units: z.object({ length: z.literal('m'), area: z.literal('m2') }),
  coordinateSystem: z.object({ kind: z.enum(['local', 'projected', 'unknown']), name: z.string().max(1000).optional(),
    epsg: number.int().positive().optional(), xAxis: z.literal('east'), yAxis: z.literal('north'), zAxis: z.literal('up') }),
  vertices: z.record(id, point.extend({ id })),
  layers: z.array(z.object({ id, name: z.string().min(1).max(1000), visible: z.boolean(), locked: z.boolean(), order: number.int(), styleId: id })).min(1).max(1000),
  entities: z.array(entity).max(50000),
  styles: z.array(z.object({ id, stroke: z.string().max(100), fill: z.string().max(100), lineWeight: number.positive().max(100), dash: z.string().max(100).optional() })).min(1).max(1000),
  viewport: z.object({ center: point, pixelsPerUnit: number.min(0.00001).max(100000) }),
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
  }
  return document;
}
