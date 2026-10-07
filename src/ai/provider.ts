import { aiRuntime, aiSettingsHeaders, browserAiSettings } from './settings';
import { z } from 'zod';
import { AI_LIMITS, aiRequestSchema, readBoundedJson, validateParserResult, type ParserResult } from './intent';
import { AiProviderError, aiErrorCodeSchema, createDiagnostic, diagnosticSchema, httpErrorCode, newTraceId, redact, safeDiagnostic, type AiDiagnostic, type AiErrorCode } from './reliability';

export interface AiIntentRequest { clarificationAnswers?:{questionId:string;answer:string}[]|undefined; text: string; signal: AbortSignal; traceId?: string; onDiagnostic?: (record: AiDiagnostic) => void }
export function semanticRequestText(request:Pick<AiIntentRequest,'text'|'clarificationAnswers'>):string {return request.clarificationAnswers?.length?`${request.text}\nУточнение пользователя: ${request.clarificationAnswers.map(a=>a.answer).join('\n')}`:request.text;}
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
  async parseIntent({ text, clarificationAnswers, signal, traceId = newTraceId(), onDiagnostic }: AiIntentRequest): Promise<unknown> {
    const request = aiRequestSchema.parse({ text,...(clarificationAnswers?{clarificationAnswers}:{}) });
    let response: Response;
    let attempt=0;
    while(true){try { response = await this.transport('/api/ai/intent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AI-Trace-ID': traceId, ...aiSettingsHeaders() },
      body: JSON.stringify(request), signal }); ;break;} catch { if(!signal.aborted&&attempt++<aiRuntime().retryCount)continue;throw new AiProviderError(signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR'); }}
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

/** Production static hosting uses the visitor's key; development keeps the local API. */
export const browserAiTransport = Boolean(import.meta.env?.PROD);
export class BrowserAiIntentProvider implements AiIntentProvider {
  constructor(private readonly transport: typeof fetch = (...args) => fetch(...args)) {}
  async parseIntent(request: AiIntentRequest): Promise<unknown> {
    const settings=browserAiSettings();
    if(!settings?.enabled)throw new AiProviderError('AUTH_ERROR',undefined,'Введите свой OpenRouter API key в Настройках → AI. Чертёж не изменён.');
    if(settings.provider!=='openrouter')throw new AiProviderError('BAD_REQUEST',undefined,'На статическом сайте выберите OpenRouter. OpenAI и mock доступны через локальный dev-server.');
    if(!settings.apiKey)throw new AiProviderError('AUTH_ERROR',undefined,'Введите свой OpenRouter API key в Настройках → AI. Чертёж не изменён.');
    const {OpenRouterIntentProvider}=await import('./openrouter');
    return new OpenRouterIntentProvider(settings.apiKey,settings.primaryModel,this.transport,settings.fallbackModel?[settings.fallbackModel]:[],aiRuntime().timeoutMs).parseIntent(request);
  }
}
export const createAiIntentProvider=():AiIntentProvider=>browserAiTransport?new BrowserAiIntentProvider():new HttpAiIntentProvider();

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
  async run(text: string, emit: (event: RequestEvent) => void,clarificationAnswers?:AiIntentRequest['clarificationAnswers']): Promise<void> {
    this.cancel();
    const id = newTraceId(), controller = new AbortController(), start = performance.now();
    let diagnostics = createDiagnostic(id, text, this.provider instanceof MockAiIntentProvider ? 'mock' : 'http');
    this.active = { id, controller }; emit({ type: 'start', id, text, diagnostics: safeDiagnostic(diagnostics) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const request = aiRequestSchema.safeParse({ text,...(clarificationAnswers?{clarificationAnswers}:{}) });
      if (!request.success) throw new AiProviderError('BAD_REQUEST');
      const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new AiProviderError('TIMEOUT')); controller.signal.addEventListener('abort', abort, { once: true }); });
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new AiProviderError('TIMEOUT')); controller.abort(); }, this.timeoutMs===AI_LIMITS.timeoutMs?aiRuntime().timeoutMs:this.timeoutMs); });
      const raw = await Promise.race([this.provider.parseIntent({ text: request.data.text,...(clarificationAnswers?{clarificationAnswers}:{}), signal: controller.signal, traceId: id, onDiagnostic: record => { diagnostics = record; } }), timeout, cancelled]);
      diagnostics.parsedResult = raw;
      if (diagnostics.rawResponse === undefined) diagnostics.rawResponse = JSON.stringify(raw);
      const result = validateReliableResult(raw, semanticRequestText({text:request.data.text,...(clarificationAnswers?{clarificationAnswers}:{})}));
      diagnostics.schemaStatus = 'valid'; diagnostics.localValidationStatus = 'valid'; diagnostics.parsedResult = result; diagnostics.latencyMs = Math.round(performance.now() - start);
      diagnostics.actionCount = 'actions' in result ? result.actions.length : 0;
      if ('status' in result && result.status === 'unsupported') diagnostics.errorCode = 'UNSUPPORTED';
      if (this.active?.id === id) emit({ type: 'result', id, result, diagnostics: safeDiagnostic(diagnostics) });
    } catch (error) {
      const typed = error instanceof AiProviderError ? error : new AiProviderError('NETWORK_ERROR');
      diagnostics.errorCode = typed.code; diagnostics.latencyMs = Math.round(performance.now() - start);
      if (typed.code === 'INVALID_STRUCTURED_OUTPUT') diagnostics.schemaStatus = 'invalid';
      if (typed.code === 'LOCAL_VALIDATION_ERROR') { diagnostics.schemaStatus = 'valid'; diagnostics.localValidationStatus = 'invalid'; diagnostics.validationDetail = typed.diagnostics?.validationDetail??typed.message;if(diagnostics.validationDetail.includes('Координаты'))diagnostics.coordinateProvenance='LLM_INVENTED'; }
      if (this.active?.id === id) emit({ type: 'failure', id, message: typed.message + (typed.message.includes('Чертёж не изменён') ? '' : ' Чертёж не изменён.'), code: typed.code, diagnostics: safeDiagnostic(diagnostics) });
    } finally { clearTimeout(timer); if (abort) controller.signal.removeEventListener('abort', abort); if (this.active?.id === id) this.active = null; }
  }
}
