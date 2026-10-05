import { z } from 'zod';
import { entitySchema, finiteNumber, id, layerSchema, vertexSchema, worldPointSchema, surveyXYSchema, verticalReferenceSchema } from '../persistence/documentSchema';
import type { DocumentCommand } from './commands';

// Resolved editor commands only. Intent/name resolution belongs above this boundary.
const entity = z.discriminatedUnion('type', [entitySchema.options[0].strict(), ...entitySchema.options.slice(1).map(option => option.strict())])
  .refine(value => !('vertexIds' in value) || value.vertexIds.length <= 50000, 'Объект превышает лимит 50 000 ссылок на вершины');
const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('set-model-frame'), frame: z.enum(['local', 'projected']) }),
  z.strictObject({ type: z.literal('set-horizontal-reference'), pairs: z.tuple([z.strictObject({ pointEntityId: id, survey: surveyXYSchema }), z.strictObject({ pointEntityId: id, survey: surveyXYSchema })]).nullable() }),
  z.strictObject({ type: z.literal('set-vertical-reference'), reference: verticalReferenceSchema.nullable() }),
  z.strictObject({ type: z.literal('import-points'), coordinateSpace: z.enum(['model', 'survey']).optional(), points: z.array(z.strictObject({ entity: entitySchema.options[0].strict(), vertex: vertexSchema.strict() })).min(1).max(50000), layer: layerSchema.strict().optional() }),
  z.strictObject({ type: z.literal('add-entity'), entity, vertices: z.array(vertexSchema.strict()).max(50000), layer: layerSchema.strict().optional() }),
  z.strictObject({ type: z.literal('delete-entity'), entityId: id }),
  z.strictObject({ type: z.literal('create-layer'), layer: layerSchema.strict() }),
  z.strictObject({ type: z.literal('delete-layer'), layerId: id }),
  z.strictObject({ type: z.literal('move-layer'), layerId: id, direction: z.union([z.literal(-1), z.literal(1)]) }),
  z.strictObject({ type: z.literal('update-layer'), layerId: id, name: z.string().min(1).max(1000).refine(value => Boolean(value.trim())) }),
  z.strictObject({ type: z.literal('update-dimension-reference'), dimensionId: id, endpoint: z.enum(['start', 'end']), vertexId: id }),
  z.strictObject({ type: z.literal('update-vertex'), vertexId: id, position: worldPointSchema.strict() }),
  z.strictObject({ type: z.literal('move-vertex'), vertexId: id, delta: worldPointSchema.strict() }),
  z.strictObject({ type: z.literal('move-text'), entityId: id, vertexId: id, position: worldPointSchema.strict() }),
  z.strictObject({ type: z.literal('update-entity'), entityId: id, patch: z.strictObject({ name: z.string().min(1).max(1000).refine(value => Boolean(value.trim()), 'Имя объекта не может быть пустым').optional(), content: z.string().min(1).max(10000).optional(), template: z.string().max(10000).optional(), dx: finiteNumber.optional(), dy: finiteNumber.optional(), offset: finiteNumber.optional(), textPosition: finiteNumber.min(0.05).max(0.95).optional(), fontSize: finiteNumber.positive().max(1000).optional() }) }),
  z.strictObject({ type: z.literal('set-entity-layer'), entityId: id, layerId: id }),
  z.strictObject({ type: z.literal('set-layer-visibility'), layerId: id, visible: z.boolean() }),
  z.strictObject({ type: z.literal('set-layer-lock'), layerId: id, locked: z.boolean() }),
]);

/** Validate and own the payload; use parsed data, never re-read untrusted caller properties. */
export function parseCommand(raw: unknown): DocumentCommand {
  const result = commandSchema.safeParse(raw);
  if (result.success) return result.data as DocumentCommand;
  const issue = result.error.issues[0]!;
  if (issue.path.includes('fontSize')) throw new Error('Размер текста должен быть положительным конечным числом, не более 1000');
  if (issue.path.some(part => part === 'x' || part === 'y' || part === 'z')) throw new Error('Координаты должны быть конечными числами');
  throw new Error(`Неверная команда: ${issue.path.join('.') || 'type'} — ${issue.message}`);
}
