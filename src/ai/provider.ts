import { z } from 'zod';
import { AI_LIMITS, aiRequestSchema, readBoundedJson, validateParserResult, type ParserResult } from './intent';

export interface AiIntentRequest { text: string; signal: AbortSignal }
export interface AiIntentProvider { parseIntent(request: AiIntentRequest): Promise<unknown> }
export const providerModeSchema = z.enum(['mock', 'openai', 'disabled']);
export type ProviderMode = z.infer<typeof providerModeSchema>;
export class HttpAiIntentProvider implements AiIntentProvider {
  constructor(private readonly transport: typeof fetch = (...args) => fetch(...args)) {}
  async parseIntent({ text, signal }: AiIntentRequest): Promise<unknown> {
    const request = aiRequestSchema.parse({ text });
    let response: Response;
    try { response = await this.transport('/api/ai/intent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request), signal }); } catch {
      if (signal.aborted) throw new Error('Запрос отменён.');
      throw new Error('Ошибка сети. Проверьте подключение к AI серверу и повторите запрос.');
    }
    if (!response.ok) throw new Error(response.status === 504 ? 'AI не ответил вовремя. Повторите запрос.' : 'AI недоступен. Проверьте настройку провайдера и повторите запрос.');
    return readBoundedJson(response);
  }
}

/** Explicit test/development provider. Programmable fixtures, never a real-provider fallback. */
export class MockAiIntentProvider implements AiIntentProvider {
  constructor(private readonly respond: (request: AiIntentRequest) => unknown | Promise<unknown>) {}
  async parseIntent(request: AiIntentRequest): Promise<unknown> { return this.respond(request); }
}
export type RequestEvent = { type: 'start'; id: string; text: string } | { type: 'result'; id: string; result: ParserResult }
  | { type: 'failure'; id: string; message: string };
/** Latest request wins even when a provider ignores AbortSignal. No store or document access. */
export class AiRequestRunner {
  private active: { id: string; controller: AbortController } | null = null;
  constructor(private readonly provider: AiIntentProvider, private readonly timeoutMs: number = AI_LIMITS.timeoutMs) {}
  cancel() { this.active?.controller.abort(); this.active = null; }
  async run(text: string, emit: (event: RequestEvent) => void): Promise<void> {
    this.cancel();
    const id = crypto.randomUUID(), controller = new AbortController();
    this.active = { id, controller }; emit({ type: 'start', id, text });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const request = aiRequestSchema.safeParse({ text });
      if (!request.success) throw new Error('Введите запрос длиной не более 8 КБ.');
      const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new Error('Запрос отменён.')); controller.signal.addEventListener('abort', abort, { once: true }); });
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error('AI не ответил вовремя. Повторите запрос.')); controller.abort(); }, this.timeoutMs); });
      const raw = await Promise.race([this.provider.parseIntent({ text: request.data.text, signal: controller.signal }), timeout, cancelled]);
      if (this.active?.id === id) emit({ type: 'result', id, result: validateParserResult(raw, request.data.text) });
    } catch (error) {
      if (this.active?.id === id) emit({ type: 'failure', id, message: error instanceof Error ? error.message : 'Ошибка AI провайдера' });
    } finally { clearTimeout(timer); if (abort) controller.signal.removeEventListener('abort', abort); if (this.active?.id === id) this.active = null; }
  }
}
