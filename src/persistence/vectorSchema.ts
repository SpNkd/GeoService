import { z } from 'zod';
import { VECTOR_LIMITS } from '../vectors/types';
const id = z.string().min(1).max(256).refine(v => v === v.trim() && !['__proto__', 'constructor', 'prototype'].includes(v));
const finite = z.number().finite();
const point = z.strictObject({ x: finite, y: finite, z: finite.optional() });
export const sourceSchema = z.strictObject({ kind: z.literal('dxf'), sourceDocumentId: id, handle: z.string().max(256).optional(), originalType: z.string().min(1).max(256), originalLayer: z.string().max(1000), blockName: z.string().max(1000).optional(), blockPath: z.array(z.string().max(1000)).max(VECTOR_LIMITS.depth).optional() });
export const attributesSchema = z.record(z.string().max(1000).refine(v => !['__proto__', 'constructor', 'prototype'].includes(v)), z.string().max(10000));
const paint = z.string().regex(/^#[\da-f]{6}$/i);
const style = { layerId: id, colorMode: z.enum(['bylayer', 'byblock', 'explicit']), stroke: paint.optional(), lineWeight: finite.positive().max(100).optional(), dash: z.string().max(100).regex(/^[\d .,-]*$/).optional(), visible: z.boolean().optional(), fillGroup: id.optional(), fillOpacity: finite.min(0).max(1).optional(), source: sourceSchema.optional() };
export const blockTransformSchema = { position: point, rotationDeg: finite, scaleX: finite.refine(v => v !== 0), scaleY: finite.refine(v => v !== 0), scaleZ: finite.refine(v => v !== 0).optional() };
export const primitiveSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...style, kind: z.literal('path'), points: z.array(point).min(2).max(50000), closed: z.boolean(), fill: z.boolean().optional() }),
  z.strictObject({ ...style, kind: z.literal('circle'), center: point, radius: finite.positive() }),
  z.strictObject({ ...style, kind: z.literal('arc'), center: point, radius: finite.positive(), startAngle: finite, endAngle: finite }),
  z.strictObject({ ...style, kind: z.literal('text'), position: point, content: z.string().min(1).max(10000), height: finite.positive(), rotationDeg: finite }),
  z.strictObject({ ...style, kind: z.literal('block'), blockDefinitionId: id, ...blockTransformSchema, attributes: attributesSchema.optional() }),
]);
export const primitivesSchema = z.array(primitiveSchema).max(VECTOR_LIMITS.primitives);
export const blockDefinitionSchema = z.strictObject({ id, sourceName: z.string().max(1000), basePoint: point, primitives: primitivesSchema });
export const sourceDocumentSchema = z.strictObject({ id, filename: z.string().min(1).max(1000).refine(v => !/[\\/]/.test(v)), format: z.literal('DXF'), dxfVersion: z.string().max(100), encoding: z.string().max(100), originalUnits: finite.int(), unitScaleToMeters: finite.positive().optional() });
