import { z } from 'zod';
import { quadError } from './transform';
const finite = z.number().finite(), point = z.strictObject({ x: finite.min(0).max(16384), y: finite.min(0).max(16384) }), id = z.string().min(1).max(256).refine(v => v === v.trim() && !['__proto__','constructor','prototype'].includes(v));
export const imageCalibrationSchema = z.strictObject({
  analysisRotationDeg: finite.min(-180).max(180).optional(), perspectiveWidth:finite.int().min(2).max(16384).optional(), perspectiveHeight:finite.int().min(2).max(16384).optional(),
  quad: z.tuple([point, point, point, point]).refine(q => !quadError(q, Math.max(2, ...q.map(p => p.x)), Math.max(2, ...q.map(p => p.y))), 'Некорректные углы перспективы'),
  rectifiedWidth: finite.int().min(2).max(16384), rectifiedHeight: finite.int().min(2).max(16384),
  reference: z.strictObject({ a: point, b: point, distanceMeters: finite.positive().max(1e9) }).refine(r => Math.hypot(r.a.x - r.b.x, r.a.y - r.b.y) > 1e-6, 'Нулевая длина калибровки').optional(),
}).refine(c => c.rectifiedWidth * c.rectifiedHeight <= 70_000_000 && (!c.reference || [c.reference.a, c.reference.b].every(p => p.x <= c.rectifiedWidth && p.y <= c.rectifiedHeight)), 'Превышен размер изображения или точки калибровки за пределами');
export const imageProvenanceSchema = z.strictObject({ source: z.enum(['image-vectorization','image-ocr','image-symbol-match','pdf-vector']), sourceAssetId: id, vectorizationRunId: id, candidateType: z.enum(['line', 'polyline', 'contour', 'circle', 'arc', 'text', 'symbol']), confidence: finite.min(0).max(1).optional(), originalText:z.string().max(10000).optional(), candidateGroupId:id.optional(), libraryId:id.optional(), symbolId:id.optional(), matchClass:z.enum(['strong','possible']).optional() });
