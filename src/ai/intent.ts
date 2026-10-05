import { z } from 'zod';
import { documentActionSchema, isDocumentAction } from '../documentOperations/schema';
import { normalizeQuery } from '../documentOperations/aliases';
import { SPATIAL_ANCHORS } from '../geometry/autoPlacement';
import { AiProviderError } from './reliability';

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
export const spatialAnchorSchema = z.enum(SPATIAL_ANCHORS);
export type SpatialAnchor = z.infer<typeof spatialAnchorSchema>;
export const entityReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind:z.literal('named_entity'),name:names}), z.strictObject({kind:z.literal('current_selection')}),
  z.strictObject({kind:z.literal('prior_action_result'),actionIndex:z.number().int().min(0).max(AI_LIMITS.actions-1)}),
]);
export type EntityReference = z.infer<typeof entityReferenceSchema>;
const gapSchema = z.number().finite().nonnegative().nullish();
export const rectanglePlacementSchema = z.discriminatedUnion('type', [
  z.strictObject({type:z.literal('relative_to_entity'),reference:entityReferenceSchema,direction:spatialAnchorSchema,gapMeters:gapSchema}),
  z.strictObject({type:z.literal('inside_entity'),reference:entityReferenceSchema,anchor:z.enum(['center',...SPATIAL_ANCHORS])}),
  z.strictObject({ type: z.literal('lower_left'), x: z.number().finite(), y: z.number().finite() }),
  z.strictObject({ type: z.literal('center'), x: z.number().finite(), y: z.number().finite() }),
  z.strictObject({ type: z.literal('local_origin') }),
  z.strictObject({ type: z.literal('centered_in_action_result'), polygonActionIndex: z.number().int().min(0).max(AI_LIMITS.actions - 1) }),
  z.strictObject({ type: z.literal('anchored_in_action_result'), polygonActionIndex: z.number().int().min(0).max(AI_LIMITS.actions - 1), anchor: spatialAnchorSchema }),
]);
export const createRectangleIntentSchema = z.strictObject({ type: z.literal('create_rectangle'), name: names, width: z.number().finite().positive(), height: z.number().finite().positive(), sizeSource: z.string().trim().min(1).max(240).optional(), placement: rectanglePlacementSchema });
export const alongEdgeIntentSchema = z.strictObject({type:z.literal('create_line_along_polygon_edge'),name:names,reference:entityReferenceSchema,side:z.enum(['north','south','east','west']),offsetMeters:z.number().finite().nonnegative(),offsetSide:z.enum(['inside','outside'])});
export const rectangleArrayIntentSchema = z.strictObject({type:z.literal('create_rectangle_array'),nameBase:names,count:z.number().int().min(1).max(50),width:z.number().finite().positive(),height:z.number().finite().positive(),sizeSource:z.string().trim().min(1).max(240).nullish(),reference:entityReferenceSchema,direction:z.enum(['north','south','east','west']),gapFromReference:gapSchema,itemGap:z.number().finite().nonnegative()});
export const aiActionSchema = z.discriminatedUnion('type', [...aiIntentSchema.options, bulkDimensionsIntentSchema, createPointsIntentSchema, createRectangleIntentSchema,alongEdgeIntentSchema,rectangleArrayIntentSchema,...documentActionSchema.options]);
export type AiAction = z.infer<typeof aiActionSchema>;
export const requestedPointNames = (action: AiAction): readonly string[] => 'pointNames' in action ? action.pointNames : [];
export const clarificationSchema = z.strictObject({ status: z.literal('needs_clarification'), questions: z.array(z.string().trim().min(1).max(AI_LIMITS.clarificationQuestionLength)).min(1).max(AI_LIMITS.clarificationQuestions) });
export const unsupportedSchema = z.strictObject({ status: z.literal('unsupported') });
export const aiTaskSchema = z.strictObject({ actions: z.array(aiActionSchema).min(1).max(AI_LIMITS.actions) })
  .superRefine((task, ctx) => {
    if (task.actions.reduce((sum, action) => sum + ('points' in action ? action.points.length : requestedPointNames(action).length), 0) > AI_LIMITS.totalReferences)
      ctx.addIssue({ code: 'custom', message: 'Task превышает лимит ссылок' });
    if(task.actions.some(isDocumentAction)&&!task.actions.every(isDocumentAction))ctx.addIssue({code:'custom',message:'Document operations and geometry creation require separate tasks'});
    task.actions.forEach((action, index) => {
      if(action.type==='move_entities_to_layer'&&action.target.kind==='created_layer'&&(action.target.actionIndex>=index||task.actions[action.target.actionIndex]?.type!=='create_layer'))ctx.addIssue({code:'custom',message:'Target requires an earlier create_layer action'});
      if('query'in action&&action.query.kind==='block_attribute'&&!action.query.tag&&!action.query.value)ctx.addIssue({code:'custom',message:'ATTRIB needs tag or value'});
      const ref = 'reference' in action ? action.reference : action.type==='create_rectangle' && 'reference' in action.placement ? action.placement.reference : null;
      if(ref?.kind==='prior_action_result' && (ref.actionIndex>=index || !['create_rectangle','create_boundary_from_named_points'].includes(task.actions[ref.actionIndex]?.type??''))) ctx.addIssue({code:'custom',message:'Spatial reference требует предыдущий polygon output'});
      if (action.type === 'create_rectangle') {
        const placement = action.placement;
        if ((placement.type === 'centered_in_action_result' || placement.type === 'anchored_in_action_result') && (placement.polygonActionIndex >= index || !['create_boundary_from_named_points', 'create_rectangle'].includes(task.actions[placement.polygonActionIndex]?.type ?? ''))) ctx.addIssue({ code: 'custom', message: 'Прямоугольник требует предыдущий polygon output' });
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

/** One shared wire envelope; missing flag is accepted for older {intent}-only clients. */
export function unwrapProviderEnvelope(raw: unknown): unknown {
  const parsed = z.strictObject({ intent: z.unknown(), unsupported: z.boolean().optional() }).safeParse(raw);
  if (!parsed.success || !Object.hasOwn(parsed.data, 'intent')) throw new AiProviderError('INVALID_STRUCTURED_OUTPUT');
  const { intent, unsupported } = parsed.data;
  const isUnsupported = intent === null || unsupportedSchema.safeParse(intent).success;
  if (unsupported !== undefined && unsupported !== isUnsupported) throw new AiProviderError('INVALID_STRUCTURED_OUTPUT');
  return isUnsupported ? { status: 'unsupported' } : intent;
}

/** Literal provenance/order check only; this does not interpret natural language or replace a provider. */
export function validateParserResult(raw: unknown, text: string): ParserResult {
  if (utf8Bytes(JSON.stringify(raw) ?? '') > AI_LIMITS.responseBytes) throw new AiProviderError('INVALID_STRUCTURED_OUTPUT', undefined, 'Ответ AI превышает лимит');
  if (raw && typeof raw === 'object' && ('intent' in raw || 'unsupported' in raw)) raw = unwrapProviderEnvelope(raw);
  if (unsupportedSchema.safeParse(raw).success) return { status: 'unsupported' };
  const clarification = clarificationSchema.safeParse(raw); if (clarification.success) return clarification.data;
  // Structured output uses null for absent Z; do not strip unknown fields.
  if (raw && typeof raw === 'object' && 'actions' in raw && Array.isArray(raw.actions)) raw = { ...raw, actions: raw.actions.map(action => action && typeof action === 'object' && action.type === 'create_points' && Array.isArray(action.points)
    ? { ...action, points: action.points.map((point: unknown) => { if (point && typeof point === 'object' && 'z' in point && point.z === null) { const { z: _z, ...rest } = point; void _z; return rest; } return point; }) } : action && typeof action === 'object' && action.type === 'create_rectangle' && action.sizeSource === null
    ? Object.fromEntries(Object.entries(action).filter(([key]) => key !== 'sizeSource')) : action) };
  // Normalize legacy single fixtures at the input boundary; all downstream code uses actions[].
  const parsed = aiTaskSchema.safeParse(aiIntentSchema.safeParse(raw).success ? { actions: [raw] } : raw);
  if (!parsed.success) throw new AiProviderError('INVALID_STRUCTURED_OUTPUT', undefined, 'AI вернул неверный intent. Укажите поддерживаемые операции и явно перечислите имена точек.');
  const created = new Set<string>();
  let cursor = 0;
  const nameCharacter = /[\p{L}\p{N}_-]/u;
  for (const action of parsed.data.actions) {
    if(isDocumentAction(action)) {
      const literals:string[]=[];
      if(action.type==='create_layer')literals.push(action.name);
      if(action.type==='move_entities_to_layer'&&action.target.kind==='existing_layer')literals.push(action.target.name);
      if('query'in action) {
        const q=action.query;
        if('name'in q)literals.push(q.name);
        if(q.kind==='text_contains')literals.push(q.text);
        if(q.kind==='block_attribute'){if(q.tag)literals.push(q.tag);if(q.value)literals.push(q.value);}
      }
      if(literals.some(literal=>!normalizeQuery(text).includes(normalizeQuery(literal))))throw new AiProviderError('LOCAL_VALIDATION_ERROR',undefined,'Имена слоёв/блоков и значения поиска должны присутствовать в запросе.');
      continue;
    }
    if (action.type === 'create_points') {
      for (const point of action.points) {
        const literal = explicitPointCoordinates(text, point.name);
        if (!literal || literal.x !== point.x || literal.y !== point.y || literal.z !== point.z) throw new AiProviderError('LOCAL_VALIDATION_ERROR', undefined, `Координаты «${point.name}» должны быть явно заданы в запросе.`);
        created.add(point.name);
      }
      continue;
    }
    if (action.type === 'create_rectangle') {
      if (!text.toLocaleLowerCase().includes(action.name.toLocaleLowerCase()) || !explicitSize(text, action.width, action.height, action.sizeSource)) throw new AiProviderError('LOCAL_VALIDATION_ERROR', undefined, 'Имя и размеры прямоугольника должны быть явно заданы.');
      if (action.placement.type === 'lower_left' || action.placement.type === 'center') {
        const placement = action.placement, pair = explicitAxes(text); if (!pair.some(p => p.x === placement.x && p.y === placement.y)) throw new AiProviderError('LOCAL_VALIDATION_ERROR', undefined, 'Положение прямоугольника должно быть задано явно.');
      }
      if (action.placement.type === 'centered_in_action_result' && !/центр|середин|center/i.test(text)) throw new AiProviderError('LOCAL_VALIDATION_ERROR', undefined, 'Уточните положение дома на участке.');
      continue;
    }
    if(action.type==='create_rectangle_array') {
      if(!explicitSize(text,action.width,action.height,action.sizeSource??undefined)) throw new AiProviderError('LOCAL_VALIDATION_ERROR',undefined,'Размеры массива должны быть явно заданы.');
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
      if (at < 0) throw new AiProviderError('LOCAL_VALIDATION_ERROR', undefined, `Имя «${name}» отсутствует в запросе или нарушен порядок. Уточните запрос.`);
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
function explicitSize(text: string, width: number, height: number, source?: string) {
  const pairPattern = new RegExp(`(${numericLiteral})\\s*(?:на|[×xх*])\\s*(${numericLiteral})`, 'gi');
  const matches = [...text.matchAll(pairPattern)];
  if (matches.some(match => Number(match[1]) === width && Number(match[2]) === height)) return true;
  if (source && [...source.matchAll(pairPattern)].length) return false;
  // Lexical evidence only: the model translates word numerals; the application never maps words to numbers.
  // Numeric-only fragments cannot bypass the exact numeric check above.
  return Boolean(source && text.includes(source) && /\p{L}/u.test(source.replace(/на/giu, ''))
    && /^[\p{L}\p{N}\s.,+-]+\s+на\s+[\p{L}\p{N}\s.,+-]+$/u.test(source));
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
