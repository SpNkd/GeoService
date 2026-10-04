import { z } from 'zod';

export const AI_LIMITS = Object.freeze({ requestBytes: 8192, responseBytes: 96 * 1024, upstreamBytes: 256 * 1024,
  actions: 8, pointsPerAction: 500, clarificationQuestions: 3, clarificationQuestionLength: 240, totalReferences: 1000, generatedCommands: 128, bulkDimensions: 100, pointNames: 500, nameLength: 128, timeoutMs: 30000 });
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;
export const aiRequestSchema = z.strictObject({ text: z.string().trim().min(1).max(AI_LIMITS.requestBytes)
  .refine(text => utf8Bytes(text) <= AI_LIMITS.requestBytes, 'Запрос превышает лимит 8 КБ') });
const names = z.string().trim().min(1).max(AI_LIMITS.nameLength);
export const createBoundaryIntentSchema = z.strictObject({ type: z.literal('create_boundary_from_named_points'),
  pointNames: z.array(names).min(3).max(AI_LIMITS.pointNames) });
export const createPolylineIntentSchema = z.strictObject({ type: z.literal('create_polyline_from_named_points'),
  pointNames: z.array(names).min(2).max(AI_LIMITS.pointNames) });
export const createDimensionIntentSchema = z.strictObject({ type: z.literal('create_dimension_between_named_points'), pointNames: z.array(names).length(2) });
export const measureIntentSchema = z.strictObject({ type: z.literal('measure_between_named_points'), pointNames: z.array(names).length(2) });
export const aiIntentSchema = z.discriminatedUnion('type', [createBoundaryIntentSchema, createPolylineIntentSchema, createDimensionIntentSchema, measureIntentSchema]);
export type AiIntent = z.infer<typeof aiIntentSchema>;
export const bulkDimensionsIntentSchema = z.strictObject({ type: z.literal('create_dimensions_for_boundary_edges'),
  boundaryActionIndex: z.number().int().min(0).max(AI_LIMITS.actions - 1) });
export const createPointsIntentSchema = z.strictObject({ type: z.literal('create_points'), points: z.array(z.strictObject({ name: names, x: z.number().finite(), y: z.number().finite(), z: z.number().finite().optional() })).min(1).max(AI_LIMITS.pointsPerAction) });
export const rectanglePlacementSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('lower_left'), x: z.number().finite(), y: z.number().finite() }),
  z.strictObject({ type: z.literal('center'), x: z.number().finite(), y: z.number().finite() }),
  z.strictObject({ type: z.literal('local_origin') }),
  z.strictObject({ type: z.literal('centered_in_action_result'), polygonActionIndex: z.number().int().min(0).max(AI_LIMITS.actions - 1) }),
]);
export const createRectangleIntentSchema = z.strictObject({ type: z.literal('create_rectangle'), name: names, width: z.number().finite().positive(), height: z.number().finite().positive(), placement: rectanglePlacementSchema });
export const aiActionSchema = z.discriminatedUnion('type', [...aiIntentSchema.options, bulkDimensionsIntentSchema, createPointsIntentSchema, createRectangleIntentSchema]);
export type AiAction = z.infer<typeof aiActionSchema>;
export const requestedPointNames = (action: AiAction): readonly string[] => 'pointNames' in action ? action.pointNames : [];
export const clarificationSchema = z.strictObject({ status: z.literal('needs_clarification'), questions: z.array(z.string().trim().min(1).max(AI_LIMITS.clarificationQuestionLength)).min(1).max(AI_LIMITS.clarificationQuestions) });
export const unsupportedSchema = z.strictObject({ status: z.literal('unsupported') });
export const aiTaskSchema = z.strictObject({ actions: z.array(aiActionSchema).min(1).max(AI_LIMITS.actions) })
  .superRefine((task, ctx) => {
    if (task.actions.reduce((sum, action) => sum + ('points' in action ? action.points.length : requestedPointNames(action).length), 0) > AI_LIMITS.totalReferences)
      ctx.addIssue({ code: 'custom', message: 'Task превышает лимит ссылок' });
    task.actions.forEach((action, index) => {
      if (action.type === 'create_rectangle') {
        const placement = action.placement;
        if (placement.type === 'centered_in_action_result' && (placement.polygonActionIndex >= index || !['create_boundary_from_named_points', 'create_rectangle'].includes(task.actions[placement.polygonActionIndex]?.type ?? ''))) ctx.addIssue({ code: 'custom', message: 'Прямоугольник требует предыдущий polygon output' });
        if (placement.type === 'local_origin' && index !== 0) ctx.addIssue({ code: 'custom', message: 'Уточните положение следующего прямоугольника' });
      }
      if (action.type === 'create_points' && new Set(action.points.map(point => point.name)).size !== action.points.length) ctx.addIssue({ code: 'custom', message: 'Имена создаваемых точек повторяются' });
      if (action.type === 'create_dimensions_for_boundary_edges'  && (action.boundaryActionIndex >= index
        || !['create_boundary_from_named_points', 'create_rectangle'].includes(task.actions[action.boundaryActionIndex]?.type ?? '')))
        ctx.addIssue({ code: 'custom', path: ['actions', index, 'boundaryActionIndex'], message: 'Размеры сторон требуют ссылку на предыдущую boundary action' });
    });
    const signatures = task.actions.map(action => JSON.stringify(action));
    if (new Set(signatures).size !== signatures.length) ctx.addIssue({ code: 'custom', message: 'Task содержит одинаковые actions' });
  });
export type AiTaskIntent = z.infer<typeof aiTaskSchema>;
export type ParserResult = AiTaskIntent | z.infer<typeof unsupportedSchema> | z.infer<typeof clarificationSchema>;

/** Literal provenance/order check only; this does not interpret natural language or replace a provider. */
export function validateParserResult(raw: unknown, text: string): ParserResult {
  if (utf8Bytes(JSON.stringify(raw) ?? '') > AI_LIMITS.responseBytes) throw new Error('Ответ AI превышает лимит');
  if (unsupportedSchema.safeParse(raw).success) return { status: 'unsupported' };
  const clarification = clarificationSchema.safeParse(raw); if (clarification.success) return clarification.data;
  // Structured output uses null for absent Z; do not strip unknown fields.
  if (raw && typeof raw === 'object' && 'actions' in raw && Array.isArray(raw.actions)) raw = { ...raw, actions: raw.actions.map(action => action && typeof action === 'object' && action.type === 'create_points' && Array.isArray(action.points)
    ? { ...action, points: action.points.map((point: unknown) => { if (point && typeof point === 'object' && 'z' in point && point.z === null) { const { z: _z, ...rest } = point; void _z; return rest; } return point; }) } : action) };
  // Normalize legacy single fixtures at the input boundary; all downstream code uses actions[].
  const parsed = aiTaskSchema.safeParse(aiIntentSchema.safeParse(raw).success ? { actions: [raw] } : raw);
  if (!parsed.success) throw new Error('AI вернул неверный intent. Укажите поддерживаемые операции и явно перечислите имена точек.');
  const created = new Set<string>();
  let cursor = 0;
  const nameCharacter = /[\p{L}\p{N}_-]/u;
  for (const action of parsed.data.actions) {
    if (action.type === 'create_points') {
      for (const point of action.points) {
        const literal = explicitPointCoordinates(text, point.name);
        if (!literal || literal.x !== point.x || literal.y !== point.y || literal.z !== point.z) throw new Error(`Координаты «${point.name}» должны быть явно заданы в запросе.`);
        created.add(point.name);
      }
      continue;
    }
    if (action.type === 'create_rectangle') {
      if (!text.toLocaleLowerCase().includes(action.name.toLocaleLowerCase()) || !explicitSize(text, action.width, action.height)) throw new Error('Имя и размеры прямоугольника должны быть явно заданы.');
      if (action.placement.type === 'lower_left' || action.placement.type === 'center') {
        const placement = action.placement, pair = explicitAxes(text); if (!pair.some(p => p.x === placement.x && p.y === placement.y)) throw new Error('Положение прямоугольника должно быть задано явно.');
      }
      if (action.placement.type === 'centered_in_action_result' && !/центр|center/i.test(text)) throw new Error('Уточните положение дома на участке.');
      continue;
    }
    if (!('pointNames' in action)) continue;
    const pairText = action.pointNames.length === 2 ? action.pointNames.join('-') : null;
    for (const name of action.pointNames) {
      if (created.has(name)) continue;
      let at = text.indexOf(name, cursor);
      while (at >= 0) {
        const before = text.slice(0, at).match(/.$/u)?.[0] ?? '';
        const after = text.slice(at + name.length).match(/^./u)?.[0] ?? '';
        const pairAt = pairText ? text.indexOf(pairText, Math.max(0, at - action.pointNames[0]!.length - 1)) : -1;
        const inPair = pairAt >= 0 && (at === pairAt || at === pairAt + action.pointNames[0]!.length + 1)
          && !nameCharacter.test(text.slice(0, pairAt).match(/.$/u)?.[0] ?? '')
          && !nameCharacter.test(text.slice(pairAt + pairText!.length).match(/^./u)?.[0] ?? '');
        if ((!nameCharacter.test(before) && !nameCharacter.test(after)) || inPair) break;
        at = text.indexOf(name, at + 1);
      }
      if (at < 0) throw new Error(`Имя «${name}» отсутствует в запросе или нарушен порядок. Уточните запрос.`);
      cursor = at + name.length;
    }
  }
  return parsed.data;
}

// Literal extraction is a provenance check, not a replacement natural-language provider.
const numericLiteral = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const escapeLiteral = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function explicitPointCoordinates(text: string, name: string): { x: number; y: number; z?: number } | null {
  if (/X\s*=\s*(?:northing|север)|Y\s*=\s*(?:easting|восток)/i.test(text)) return null;
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}_-])${escapeLiteral(name)}\\s*[:=]?\\s*\\(\\s*(${numericLiteral})\\s*[,;]\\s*(${numericLiteral})(?:\\s*[,;]\\s*(${numericLiteral}))?\\s*\\)`, 'u');
  const match = text.match(pattern);
  if (match) return { x: Number(match[1]), y: Number(match[2]), ...(match[3] === undefined ? {} : { z: Number(match[3]) }) };
  const axes = new RegExp(`(?:^|[^\\p{L}\\p{N}_-])${escapeLiteral(name)}\\s*[:=]?\\s*(?:X|Easting)\\s*=\\s*(${numericLiteral})\\s*[,;]?\\s*(?:Y|Northing)\\s*=\\s*(${numericLiteral})(?:\\s*[,;]?\\s*(?:Z|Height)\\s*=\\s*(${numericLiteral}))?`, 'iu');
  const axis = text.match(axes);
  return axis ? { x: Number(axis[1]), y: Number(axis[2]), ...(axis[3] === undefined ? {} : { z: Number(axis[3]) }) } : null;
}
function explicitSize(text: string, width: number, height: number) {
  return [...text.matchAll(new RegExp(`(${numericLiteral})\\s*(?:на|[×xх*])\\s*(${numericLiteral})`, 'gi'))].some(match => Number(match[1]) === width && Number(match[2]) === height);
}
function explicitAxes(text: string) {
  return [...text.matchAll(new RegExp(`X\\s*=\\s*(${numericLiteral})\\s*[,;]?\\s*Y\\s*=\\s*(${numericLiteral})`, 'gi'))].map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
}

/** Bound the bytes while reading, including responses without Content-Length. */
export async function readBoundedJson(response: Response, limit = AI_LIMITS.responseBytes): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw new Error('Ответ AI превышает лимит');
  }
  if (!response.body) throw new Error('Пустой ответ AI');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new Error('Ответ AI превышает лимит');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    try { return JSON.parse(text) as unknown; } catch { throw new Error('AI вернул невалидный JSON'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
