import { z } from 'zod';
import { MAX_SYMBOL_SCALE, MIN_SYMBOL_SCALE } from './types';
export const symbolIdSchema = z.string().min(1).max(256).refine(v => v === v.trim() && !['__proto__','constructor','prototype'].includes(v), 'Небезопасный ID');
const number = z.number().finite();
export const symbolPositionSchema = z.strictObject({ x: number, y: number });
export const symbolScaleSchema = number.min(MIN_SYMBOL_SCALE).max(MAX_SYMBOL_SCALE);
export const symbolPropertiesSchema = z.record(symbolIdSchema, z.union([z.string().max(10000), number, z.boolean(), z.null()])).refine(v => Object.keys(v).length <= 100, 'Не более 100 свойств');
const local = z.strictObject({x:number.min(-100).max(100),y:number.min(-100).max(100)});
const portLocal=local.extend({z:number.optional()});
const primitive = z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('line'),start:local,end:local}),
  z.strictObject({type:z.literal('polyline'),points:z.array(local).min(2).max(1000)}),
  z.strictObject({type:z.literal('polygon'),points:z.array(local).min(3).max(1000)}),
  z.strictObject({type:z.literal('circle'),center:local,radius:number.positive().max(100)}),
  z.strictObject({type:z.literal('rect'),position:local,width:number.positive().max(100),height:number.positive().max(100)}),
]);
const title=z.string().trim().min(1).max(1000);
export const symbolLibrarySchema=z.strictObject({
  id:symbolIdSchema,name:title,version:title,description:z.string().max(10000).optional(),sourceStandards:z.array(title).max(100).optional(),
  categories:z.array(title).min(1).max(100),
  symbols:z.array(z.strictObject({id:symbolIdSchema,name:title,aliases:z.array(title).max(100).optional(),category:title,description:z.string().max(10000).optional(),
    geometry:z.array(primitive).min(1).max(1000),defaultSize:number.positive().max(1000),allowedRotations:z.array(number.min(0).lt(360)).min(1).max(360).refine(v => new Set(v).size === v.length, 'Повторяющиеся повороты').optional(),
    ports:z.array(z.strictObject({id:symbolIdSchema,kind:z.enum(['process','instrument']),position:portLocal,directionDeg:number,role:z.enum(['inlet','outlet','bidirectional','instrument']).optional(),label:title.optional(),maxConnections:number.int().positive().max(1000).optional()})).max(100),metadata:symbolPropertiesSchema.optional(),
  })).min(1).max(1000),
});
