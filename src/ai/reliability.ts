import { z } from 'zod';

export const aiErrorCodeSchema = z.enum(['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT', 'UPSTREAM_5XX', 'AUTH_ERROR', 'BAD_REQUEST', 'INVALID_STRUCTURED_OUTPUT', 'UNSUPPORTED', 'LOCAL_VALIDATION_ERROR']);
export type AiErrorCode = z.infer<typeof aiErrorCodeSchema>;
export const errorMessages: Record<AiErrorCode, string> = {
  NETWORK_ERROR: 'Ошибка сети. AI недоступен. Чертёж не изменён. Повторите запрос.',
  TIMEOUT: 'AI не ответил вовремя. Чертёж не изменён. Повторите запрос.',
  RATE_LIMIT: 'Достигнут лимит AI запросов. Чертёж не изменён. Повторите позже.',
  UPSTREAM_5XX: 'AI недоступен временно. Чертёж не изменён. Повторите запрос.',
  AUTH_ERROR: 'AI не подключён: проверьте серверную авторизацию. Чертёж не изменён.',
  BAD_REQUEST: 'AI отклонил запрос. Проверьте запрос и серверную конфигурацию. Чертёж не изменён.',
  INVALID_STRUCTURED_OUTPUT: 'AI вернул неверный intent. Не удалось проверить структуру ответа. Чертёж не изменён.',
  UNSUPPORTED: 'Эта команда пока не поддерживается.',
  LOCAL_VALIDATION_ERROR: 'Ответ AI не прошёл локальную проверку. Чертёж не изменён.',
};
export interface AiAttempt { attempt: number; requestedModel: string; actualModel?: string | undefined; provider?: string | undefined; httpStatus?: number | undefined; latencyMs: number; responseBytes?: number | undefined; errorCode?: AiErrorCode | undefined; safeErrorBody?: string | undefined }
export interface AiDiagnostic {
  coordinateProvenance?:'LLM_INVENTED'|undefined;localResolution?:unknown;traceId: string; timestamp: string; userText: string; provider: string;
  primaryModel: string; fallbackModels: string[]; routing?: Record<string, unknown> | undefined;
  attempts: AiAttempt[]; latencyMs: number; httpStatus?: number | undefined; responseBytes?: number | undefined;
  actualModel?: string | undefined; actualProvider?: string | undefined; rawResponse?: string | undefined; safeErrorBody?: string | undefined;
  parsedResult?: unknown | undefined; schemaStatus: 'pending' | 'valid' | 'invalid';
  localValidationStatus?: 'pending' | 'valid' | 'invalid' | undefined; resolverStatus: string; actionCount: number; errorCode?: AiErrorCode | undefined; validationDetail?: string | undefined;
}
export class AiProviderError extends Error {
  constructor(readonly code: AiErrorCode, readonly diagnostics?: AiDiagnostic, message = errorMessages[code]) { super(message); this.name = 'AiProviderError'; }
}
export function httpErrorCode(status: number): AiErrorCode {
  return status === 401 || status === 403 ? 'AUTH_ERROR' : status === 429 ? 'RATE_LIMIT' : status >= 500 ? 'UPSTREAM_5XX' : 'BAD_REQUEST';
}
export function newTraceId() { return `ai-${Date.now().toString(36)}-${crypto.randomUUID()}`; }
export const traceIdSchema = z.string().regex(/^ai-[a-zA-Z0-9-]{1,100}$/);
export function createDiagnostic(traceId: string, userText: string, provider = 'mock', primaryModel = 'mock', fallbackModels: string[] = []): AiDiagnostic {
  return { traceId, timestamp: new Date().toISOString(), userText, provider, primaryModel, fallbackModels,
    attempts: [], latencyMs: 0, schemaStatus: 'pending', localValidationStatus: 'pending', resolverStatus: 'not_run', actionCount: 0 };
}
/** Redact before storing, logging, responding AND copying. No header/environment objects are collected. */
export function redact(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === 'string') {
    let safe = value;
    for (const secret of secrets.filter(secret => secret.length > 0)) safe = safe.split(secret).join('[REDACTED]');
    return safe.replace(/\bsk-(?:or-v1-)?[a-zA-Z0-9_-]+/g, '[REDACTED]')
      .replace(/\bBearer\s+[^\s"',;}]+/gi, 'Bearer [REDACTED]')
      .replace(/((?:authorization|cookie|api[_-]?key|[a-z_]*(?:secret|token|password))\s*["']?\s*[:=]\s*)[^\n,;}]+/gi, '$1[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /authorization|cookie|api.?key|secret|token|password/i.test(key) ? '[REDACTED]' : redact(item, secrets)]));
  return value;
}
export function safeDiagnostic(value: AiDiagnostic, secrets: readonly string[] = []): AiDiagnostic { return redact(value, secrets) as AiDiagnostic; }
export function diagnosticRing(records: readonly AiDiagnostic[], record: AiDiagnostic): AiDiagnostic[] {
  return [...records.filter(item => item.traceId !== record.traceId), safeDiagnostic(record)].slice(-20);
}
const attemptSchema = z.object({ attempt: z.number().int().min(1).max(2), requestedModel: z.string(), actualModel: z.string().optional(), provider: z.string().optional(), httpStatus: z.number().optional(), latencyMs: z.number(), responseBytes: z.number().optional(), errorCode: aiErrorCodeSchema.optional(), safeErrorBody: z.string().optional() });
export const diagnosticSchema = z.object({ coordinateProvenance:z.literal('LLM_INVENTED').optional(),localResolution:z.unknown().optional(),traceId: traceIdSchema, timestamp: z.string(), userText: z.string(), provider: z.string(), primaryModel: z.string(), fallbackModels: z.array(z.string()), routing: z.record(z.string(), z.unknown()).optional(),
  attempts: z.array(attemptSchema).max(2), latencyMs: z.number(), httpStatus: z.number().optional(), responseBytes: z.number().optional(), actualModel: z.string().optional(), actualProvider: z.string().optional(), rawResponse: z.string().optional(), safeErrorBody: z.string().optional(), parsedResult: z.unknown().optional(), schemaStatus: z.enum(['pending', 'valid', 'invalid']), localValidationStatus: z.enum(['pending', 'valid', 'invalid']).optional(), resolverStatus: z.string(), actionCount: z.number().int(), errorCode: aiErrorCodeSchema.optional(), validationDetail: z.string().optional() });
