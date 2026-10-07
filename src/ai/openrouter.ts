import { z } from 'zod';
import { AI_LIMITS, aiRequestSchema, unwrapProviderEnvelope } from './intent';
import { semanticRequestText, validateReliableResult, type AiIntentProvider, type AiIntentRequest } from './provider';
import { PARSER_PROMPT, OPENAI_OUTPUT_SCHEMA } from './parserContract';
import { OPENROUTER_ROUTING, hasReasoningSwitch } from './config';
import { routerResponse } from './openrouterTransport';
import { AiProviderError, createDiagnostic, newTraceId, safeDiagnostic } from './reliability';
/** OpenAI-compatible Chat Completions adapter; transport is injectable for local stands/tests. */
export class OpenRouterIntentProvider implements AiIntentProvider {
  constructor(private readonly key: string, private readonly model: string,
    private readonly transport: typeof fetch = (...args) => fetch(...args), private readonly fallbackModels: string[] = [],
    private readonly timeoutMs: number = AI_LIMITS.timeoutMs, private readonly routing: Record<string, unknown> = OPENROUTER_ROUTING) {}
  async parseIntent({ text, clarificationAnswers, signal, traceId = newTraceId(), onDiagnostic }: AiIntentRequest): Promise<unknown> {
    const diagnostics = createDiagnostic(traceId, text, 'openrouter', this.model, this.fallbackModels);
    diagnostics.routing = { ...this.routing, primaryReasoningDisabled: hasReasoningSwitch(this.model), fallbackStrategy: 'at-most-one-additional-HTTP-call' };
    const started = performance.now(), controller = new AbortController();
    const cancel = () => controller.abort(); signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) controller.abort();
    const timer = setTimeout(cancel, this.timeoutMs);
    try {
      if (!this.key || !this.model) throw new AiProviderError('AUTH_ERROR');
      const input = aiRequestSchema.parse({ text,...(clarificationAnswers?{clarificationAnswers}:{}) });
      const shared = {
        messages: [{ role: 'system', content: PARSER_PROMPT }, { role: 'user', content: semanticRequestText(input) }],
        max_tokens: 12000, temperature: 0, provider: this.routing,
        response_format: { type: 'json_schema', json_schema: { name: 'geoservice_intent', strict: true, schema: OPENAI_OUTPUT_SCHEMA } },
      };
      // Parameter compatibility is part of routing: never exclude the non-thinking instruct fallback with a reasoning switch.
      const nativeFallbacks = hasReasoningSwitch(this.model) ? this.fallbackModels.filter(hasReasoningSwitch) : this.fallbackModels;
      const body = { ...shared, model: this.model, ...(nativeFallbacks.length ? { models: [this.model, ...nativeFallbacks.filter(model => model !== this.model)] } : {}),
        ...(hasReasoningSwitch(this.model) ? { reasoning: { enabled: false } } : {}) };
      const fallbackBody = this.fallbackModels.length ? { ...shared, model: this.fallbackModels[0]!, models: this.fallbackModels } : undefined;
      const raw = await routerResponse(this.transport, this.key, body, controller.signal, diagnostics, fallbackBody);
      diagnostics.rawResponse = raw;
      let parsed: unknown;
      try {
        const envelope = z.object({ model: z.string().optional(), provider: z.string().optional(), choices: z.array(z.object({ finish_reason: z.literal('stop'),
          message: z.object({ content: z.string(), refusal: z.null().optional() }) })).length(1) }).parse(JSON.parse(raw) as unknown);
        if (envelope.model) diagnostics.actualModel = envelope.model;
        if (envelope.provider) diagnostics.actualProvider = envelope.provider;
        const last = diagnostics.attempts.at(-1);
        if (last) Object.assign(last, { ...(envelope.model ? { actualModel: envelope.model } : {}), ...(envelope.provider ? { provider: envelope.provider } : {}) });
        const content = envelope.choices[0]!.message.content;
        diagnostics.rawResponse = content;
        if (new TextEncoder().encode(content).byteLength > AI_LIMITS.responseBytes) throw new Error('Response exceeds limit');
        parsed = unwrapProviderEnvelope(JSON.parse(content) as unknown);
        diagnostics.parsedResult = parsed;
      } catch { throw new AiProviderError('INVALID_STRUCTURED_OUTPUT'); }
      const result = validateReliableResult(parsed, semanticRequestText(input));
      diagnostics.schemaStatus = 'valid'; diagnostics.localValidationStatus = 'valid'; diagnostics.parsedResult = result;
      diagnostics.actionCount = 'actions' in result ? result.actions.length : 0;
      if ('status' in result && result.status === 'unsupported') diagnostics.errorCode = 'UNSUPPORTED';
      return result;
    } catch (error) {
      const code = error instanceof AiProviderError ? error.code : controller.signal.aborted ? 'TIMEOUT' : 'BAD_REQUEST';
      diagnostics.errorCode = code;
      if (code === 'INVALID_STRUCTURED_OUTPUT') diagnostics.schemaStatus = 'invalid';
      if (code === 'LOCAL_VALIDATION_ERROR') { diagnostics.schemaStatus = 'valid'; diagnostics.localValidationStatus = 'invalid'; }
      if (error instanceof AiProviderError && error.code === 'LOCAL_VALIDATION_ERROR') {diagnostics.validationDetail = error.message;if(error.message.includes('Координаты'))diagnostics.coordinateProvenance='LLM_INVENTED';}
      diagnostics.latencyMs = Math.round(performance.now() - started);
      throw new AiProviderError(code, safeDiagnostic(diagnostics, [this.key]));
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', cancel);
      diagnostics.latencyMs = Math.round(performance.now() - started);
      onDiagnostic?.(safeDiagnostic(diagnostics, [this.key]));
    }
  }
}
