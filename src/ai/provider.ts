import { z } from 'zod';
import { AI_LIMITS, aiRequestSchema, readBoundedJson, validateParserResult, type ParserResult } from './intent';
import { AiProviderError, aiErrorCodeSchema, createDiagnostic, diagnosticSchema, httpErrorCode, newTraceId, redact, safeDiagnostic, type AiDiagnostic, type AiErrorCode } from './reliability';

export interface AiIntentRequest { text: string; signal: AbortSignal; traceId?: string; onDiagnostic?: (record: AiDiagnostic) => void }
export interface AiIntentProvider { parseIntent(request: AiIntentRequest): Promise<unknown> }
export const providerModeSchema = z.enum(['mock', 'openai', 'openrouter', 'disabled']);
export type ProviderMode = z.infer<typeof providerModeSchema>;
/** Preserve strict schema/provenance checks while distinguishing malformed output from local rejection. */
export function validateReliableResult(raw: unknown, text: string): ParserResult {
  try { return validateParserResult(raw, text); } catch (error) {
    if (error instanceof AiProviderError) throw new AiProviderError(error.code, error.diagnostics, String(redact(error.message)));
    throw new AiProviderError('INVALID_STRUCTURED_OUTPUT');
  }
}
export class HttpAiIntentProvider implements AiIntentProvider {
  constructor(private readonly transport: typeof fetch = (...args) => fetch(...args)) {}
  async parseIntent({ text, signal, traceId = newTraceId(), onDiagnostic }: AiIntentRequest): Promise<unknown> {
    const request = aiRequestSchema.parse({ text });
    let response: Response;
    try { response = await this.transport('/api/ai/intent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AI-Trace-ID': traceId },
      body: JSON.stringify(request), signal }); } catch { throw new AiProviderError(signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR'); }
    let raw: unknown;
    try { raw = await readBoundedJson(response, AI_LIMITS.upstreamBytes * 4); }
    catch { throw new AiProviderError(response.ok ? 'INVALID_STRUCTURED_OUTPUT' : httpErrorCode(response.status)); }
    const record = raw && typeof raw === 'object' && 'diagnostics' in raw ? diagnosticSchema.safeParse(raw.diagnostics) : null;
    if (record && !record.success) throw new AiProviderError('INVALID_STRUCTURED_OUTPUT');
    const diagnostics = record?.success ? safeDiagnostic(record.data) : undefined;
    if (diagnostics && diagnostics.traceId !== traceId) throw new AiProviderError('INVALID_STRUCTURED_OUTPUT');
    if (diagnostics) onDiagnostic?.(diagnostics);
    if (!response.ok) {
      const error = raw && typeof raw === 'object' && 'error' in raw ? raw.error : null;
      const code = aiErrorCodeSchema.safeParse(error && typeof error === 'object' && 'code' in error ? error.code : null);
      // Unsupported is ONLY a successful, validated semantic response.
      throw new AiProviderError(code.success && code.data !== 'UNSUPPORTED' ? code.data : response.status === 504 ? 'TIMEOUT' : httpErrorCode(response.status), diagnostics);
    }
    return raw && typeof raw === 'object' && 'result' in raw ? raw.result : raw;
  }
}

/** Explicit test/development provider. Programmable fixtures, never a real-provider fallback. */
export class MockAiIntentProvider implements AiIntentProvider {
  constructor(private readonly respond: (request: AiIntentRequest) => unknown | Promise<unknown>) {}
  async parseIntent(request: AiIntentRequest): Promise<unknown> { return this.respond(request); }
}
export type RequestEvent = { type: 'start'; id: string; text: string; diagnostics?: AiDiagnostic } | { type: 'result'; id: string; result: ParserResult; diagnostics?: AiDiagnostic }
  | { type: 'failure'; id: string; message: string; code?: AiErrorCode; diagnostics?: AiDiagnostic };
/** Latest request wins even when a provider ignores AbortSignal. No store or document access. */
export class AiRequestRunner {
  private active: { id: string; controller: AbortController } | null = null;
  constructor(private readonly provider: AiIntentProvider, private readonly timeoutMs: number = AI_LIMITS.timeoutMs) {}
  cancel() { this.active?.controller.abort(); this.active = null; }
  async run(text: string, emit: (event: RequestEvent) => void): Promise<void> {
    this.cancel();
    const id = newTraceId(), controller = new AbortController(), start = performance.now();
    let diagnostics = createDiagnostic(id, text, this.provider instanceof MockAiIntentProvider ? 'mock' : 'http');
    this.active = { id, controller }; emit({ type: 'start', id, text, diagnostics: safeDiagnostic(diagnostics) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const request = aiRequestSchema.safeParse({ text });
      if (!request.success) throw new AiProviderError('BAD_REQUEST');
      const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new AiProviderError('TIMEOUT')); controller.signal.addEventListener('abort', abort, { once: true }); });
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new AiProviderError('TIMEOUT')); controller.abort(); }, this.timeoutMs); });
      const raw = await Promise.race([this.provider.parseIntent({ text: request.data.text, signal: controller.signal, traceId: id, onDiagnostic: record => { diagnostics = record; } }), timeout, cancelled]);
      diagnostics.parsedResult = raw;
      if (diagnostics.rawResponse === undefined) diagnostics.rawResponse = JSON.stringify(raw);
      const result = validateReliableResult(raw, request.data.text);
      diagnostics.schemaStatus = 'valid'; diagnostics.localValidationStatus = 'valid'; diagnostics.parsedResult = result; diagnostics.latencyMs = Math.round(performance.now() - start);
      diagnostics.actionCount = 'actions' in result ? result.actions.length : 0;
      if ('status' in result && result.status === 'unsupported') diagnostics.errorCode = 'UNSUPPORTED';
      if (this.active?.id === id) emit({ type: 'result', id, result, diagnostics: safeDiagnostic(diagnostics) });
    } catch (error) {
      const typed = error instanceof AiProviderError ? error : new AiProviderError('NETWORK_ERROR');
      diagnostics.errorCode = typed.code; diagnostics.latencyMs = Math.round(performance.now() - start);
      if (typed.code === 'INVALID_STRUCTURED_OUTPUT') diagnostics.schemaStatus = 'invalid';
      if (typed.code === 'LOCAL_VALIDATION_ERROR') { diagnostics.schemaStatus = 'valid'; diagnostics.localValidationStatus = 'invalid'; diagnostics.validationDetail = typed.message; }
      if (this.active?.id === id) emit({ type: 'failure', id, message: typed.message + (typed.message.includes('Чертёж не изменён') ? '' : ' Чертёж не изменён.'), code: typed.code, diagnostics: safeDiagnostic(diagnostics) });
    } finally { clearTimeout(timer); if (abort) controller.signal.removeEventListener('abort', abort); if (this.active?.id === id) this.active = null; }
  }
}
