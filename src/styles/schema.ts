import { z } from 'zod';
export const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/).transform(s => s.toUpperCase());
const fields = { strokeColor: colorSchema, lineType: z.enum(['continuous', 'dashed', 'dash_dot', 'dotted', 'center']), lineWidth: z.number().finite().positive().max(20), opacity: z.number().finite().min(0).max(1), fillColor: z.union([colorSchema, z.literal('none')]), fillOpacity: z.number().finite().min(0).max(1), textColor: colorSchema, textSize: z.number().finite().positive().max(1000) };
export const layerStyleSchema = z.strictObject(fields).partial();
export const styleOverridesSchema = z.strictObject({ strokeColor: fields.strokeColor.nullable(), lineType: fields.lineType.nullable(), lineWidth: fields.lineWidth.nullable(), opacity: fields.opacity.nullable(), fillColor: fields.fillColor.nullable(), fillOpacity: fields.fillOpacity.nullable(), textColor: fields.textColor.nullable(), textSize: fields.textSize.nullable() }).partial();
