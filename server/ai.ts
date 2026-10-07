import { PROCESS_FIXTURES } from '../src/process/fixtures';
/** Server-only Vite development endpoint. Never imported by src/main.tsx or a browser module. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { z } from 'zod';
import { AI_LIMITS, aiRequestSchema, readBoundedJson, unwrapProviderEnvelope, validateParserResult } from '../src/ai/intent';
import { abortable } from './openrouterTransport';
import { validateReliableResult } from '../src/ai/provider';
import { modelConfig, routingConfig, type AiServerConfig } from './aiConfig';
import { AiProviderError, httpErrorCode, createDiagnostic, newTraceId, safeDiagnostic, redact, traceIdSchema, type AiDiagnostic } from '../src/ai/reliability';
import { aiSettingsSchema } from '../src/ai/settings';
import { semanticRequestText, MockAiIntentProvider, providerModeSchema, type AiIntentProvider, type AiIntentRequest } from '../src/ai/provider';

import { PARSER_PROMPT, OPENAI_OUTPUT_SCHEMA } from '../src/ai/parserContract';
export { PARSER_PROMPT, OPENAI_OUTPUT_SCHEMA } from '../src/ai/parserContract';
export class OpenAIIntentProvider implements AiIntentProvider {
  constructor(private readonly key: string, private readonly model: string, private readonly transport: typeof fetch = (...args) => fetch(...args)) {}
  async parseIntent({ text, clarificationAnswers, signal }: AiIntentRequest): Promise<unknown> {
    if (!this.key || !this.model) throw new AiProviderError('AUTH_ERROR', undefined, 'Настройте OPENAI_API_KEY и AI_MODEL в серверном окружении.');
    const input = aiRequestSchema.parse({ text,...(clarificationAnswers?{clarificationAnswers}:{}) });
    const response = await this.transport('https://api.openai.com/v1/responses', { method: 'POST', signal,
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, store: false, instructions: PARSER_PROMPT, input: semanticRequestText(input), max_output_tokens: 12000,
        text: { format: { type: 'json_schema', name: 'boundary_intent', strict: true, schema: OPENAI_OUTPUT_SCHEMA } } }) });
    // Do not reflect upstream bodies, prompts, keys, or internal errors into client/logs.
    if (!response.ok) { await response.body?.cancel(); throw new AiProviderError(httpErrorCode(response.status), undefined, 'OpenAI недоступен. Проверьте серверную конфигурацию.'); }
    try {
      const envelope = z.object({ status: z.literal('completed'), output: z.array(z.object({ type: z.string(),
        content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })) }).parse(await readBoundedJson(response, AI_LIMITS.upstreamBytes));
      const chunks = envelope.output.filter(item => item.type === 'message').flatMap(item => item.content ?? []);
      if (chunks.length !== 1 || chunks[0]?.type !== 'output_text' || !chunks[0].text) throw new AiProviderError('INVALID_STRUCTURED_OUTPUT');
      if (new TextEncoder().encode(chunks[0].text).byteLength > AI_LIMITS.responseBytes) throw new AiProviderError('INVALID_STRUCTURED_OUTPUT');
      return validateParserResult(unwrapProviderEnvelope(JSON.parse(chunks[0].text) as unknown), semanticRequestText(input));
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      throw new AiProviderError(signal.aborted ? 'TIMEOUT' : 'INVALID_STRUCTURED_OUTPUT');
    }
  }
}
import { OpenRouterIntentProvider } from '../src/ai/openrouter';
export { OpenRouterIntentProvider } from '../src/ai/openrouter';
const boundary = (...pointNames: string[]) => ({ type: 'create_boundary_from_named_points', pointNames });
const fixture = (type: string, ...pointNames: string[]) => ({ type, pointNames });
/** Named fixtures only; no hidden NLP fallback. */
export function developmentMockProvider(): MockAiIntentProvider {
  const fixtures = new Map<string, unknown>([
    ...PROCESS_FIXTURES,
    ['Выбери все здания',{actions:[{type:'select_entities',query:{kind:'semantic_concept',concepts:['buildings']}}]}],
    ['Создай слой Здания и перенеси туда все здания',{actions:[{type:'create_layer',name:'Здания'},{type:'move_entities_to_layer',query:{kind:'semantic_concept',concepts:['buildings']},target:{kind:'created_layer',actionIndex:0}}]}],
    ['Скрой дороги и откосы',{actions:[{type:'set_layer_visibility',query:{kind:'semantic_concept',concepts:['roads','slopes']},visible:false}]}],
    ['Выбери все блоки VOLUME',{actions:[{type:'select_entities',query:{kind:'block_name',name:'VOLUME'}}]}],
    ['Найди все надписи со словом грунт',{actions:[{type:'find_entities',query:{kind:'text_contains',text:'грунт',sourceType:null}}]}],
    ['Выбери все мультивыноски',{actions:[{type:'select_entities',query:{kind:'source_type',sourceType:'MULTILEADER'}}]}],
    ['Покажи только здания',{actions:[{type:'isolate_result',query:{kind:'semantic_concept',concepts:['buildings']}}]}],
    ['Перенеси выбранные объекты в слой Архив',{actions:[{type:'move_entities_to_layer',query:{kind:'current_selection'},target:{kind:'existing_layer',name:'Архив'}}]}],

    ['Создай границу по точкам P1 P2 P3 P4', boundary('P1', 'P2', 'P3', 'P4')],
    ['Создай границу по точкам P1, P2, P3 и P4', boundary('P1', 'P2', 'P3', 'P4')],
    ['Создай границу по точкам P1, P4, P8 и P12', boundary('P1', 'P4', 'P8', 'P12')],
    ['Создай границу по точкам P1, P2, P999', boundary('P1', 'P2', 'P999')],
    ['Создай границу P1 P2 P999', boundary('P1', 'P2', 'P999')],
    ['Создай границу P1 P2 P3 P4', boundary('P1', 'P2', 'P3', 'P4')],
    ['Создай границу по P1 P2 P3', boundary('P1', 'P2', 'P3')],
    ['Построй контур через точки Т1, Т2, Т3', boundary('Т1', 'Т2', 'Т3')],
    ['Соедини P1 P2 P3 полилинией', fixture('create_polyline_from_named_points', 'P1', 'P2', 'P3')],
    ['Соедини P1, P2 и P3 полилинией', fixture('create_polyline_from_named_points', 'P1', 'P2', 'P3')],
    ['Соедини P1, P4 и P8 полилинией', fixture('create_polyline_from_named_points', 'P1', 'P4', 'P8')],
    ['Проведи ломаную через КН-1 КН-2 КН-7', fixture('create_polyline_from_named_points', 'КН-1', 'КН-2', 'КН-7')],
    ['Поставь размер между P1 и P2', fixture('create_dimension_between_named_points', 'P1', 'P2')],
    ['Проставь расстояние размером между Т4 и Т8', fixture('create_dimension_between_named_points', 'Т4', 'Т8')],
    ['Какое расстояние между P1 и P3?', fixture('measure_between_named_points', 'P1', 'P3')],
    ['Какое расстояние между P1 и P4?', fixture('measure_between_named_points', 'P1', 'P4')],
    ['Какое расстояние между P1 и P7?', fixture('measure_between_named_points', 'P1', 'P7')],
    ['Измерь от КН-1 до КН-4', fixture('measure_between_named_points', 'КН-1', 'КН-4')],
  ]);
  const multi = (...actions: unknown[]) => ({ actions });
  fixtures.set('Создай границу по P1 P2 P3 P4 и поставь размер между P1 и P2', multi(boundary('P1', 'P2', 'P3', 'P4'), fixture('create_dimension_between_named_points', 'P1', 'P2')));
  fixtures.set('Измерь P1-P2 и P3-P4', multi(fixture('measure_between_named_points', 'P1', 'P2'), fixture('measure_between_named_points', 'P3', 'P4')));
  fixtures.set('Измерь расстояние P1-P2 и P3-P4', fixtures.get('Измерь P1-P2 и P3-P4'));
  fixtures.set('Соедини P1 P2 P3 полилинией и измерь расстояние P1-P4', multi(fixture('create_polyline_from_named_points', 'P1', 'P2', 'P3'), fixture('measure_between_named_points', 'P1', 'P4')));
  fixtures.set('Соедини P1 P2 P3 полилинией и измерь расстояние от P1 до P4', fixtures.get('Соедини P1 P2 P3 полилинией и измерь расстояние P1-P4'));
  fixtures.set('Поставь размер между P1 и P2 и измерь расстояние от P1 до P3', multi(fixture('create_dimension_between_named_points', 'P1', 'P2'), fixture('measure_between_named_points', 'P1', 'P3')));
  fixtures.set('Создай границу по P1 P2 P3 P4, поставь размер между P1 и P2 и измерь расстояние от P1 до КН-7', multi(boundary('P1', 'P2', 'P3', 'P4'), fixture('create_dimension_between_named_points', 'P1', 'P2'), fixture('measure_between_named_points', 'P1', 'КН-7')));
  const bulk = { type: 'create_dimensions_for_boundary_edges', boundaryActionIndex: 0 };
  for (const phrase of ['Построй границу по P1 P2 P3 P4 и проставь размеры всех её сторон',
    'Построй границу P1 P2 P3 P4 и проставь размеры всех сторон', 'Создай границу P1 P2 P3 P4 с размерами сторон'])
    fixtures.set(phrase, multi(boundary('P1', 'P2', 'P3', 'P4'), bulk));
  fixtures.set('Создай контур через Т1 Т2 Т3 и добавь размеры всех сторон', multi(boundary('Т1', 'Т2', 'Т3'), bulk));
  fixtures.set('Построй границу P1 P2 P3 и проставь размеры всех сторон', multi(boundary('P1', 'P2', 'P3'), bulk));
  fixtures.set('Построй границу P1 P2 P3, проставь размеры всех сторон и измерь P1-P3', multi(boundary('P1', 'P2', 'P3'), bulk, fixture('measure_between_named_points', 'P1', 'P3')));
  fixtures.set('Создай границу P1 P2 P3 P4, проставь размеры всех сторон и измерь P1 P4', multi(boundary('P1', 'P2', 'P3', 'P4'), bulk, fixture('measure_between_named_points', 'P1', 'P4')));
  fixtures.set('Построй границу по P1 P2 P3 P4, проставь размеры всех её сторон и измерь расстояние P1-КН-7', multi(boundary('P1', 'P2', 'P3', 'P4'), bulk, fixture('measure_between_named_points', 'P1', 'КН-7')));
  const pointTask = (width: number, height: number) => multi({ type: 'create_points', points: [{ name: 'P1', x: 0, y: 0 }, { name: 'P2', x: width, y: 0 }, { name: 'P3', x: width, y: height }, { name: 'P4', x: 0, y: height }] }, boundary('P1', 'P2', 'P3', 'P4'));
  for (const phrase of ['Создай P1 (0,0), P2 (30,0), P3 (30,20), P4 (0,20) и построй по ним границу', 'Создай P1 (0,0), P2 (30,0), P3 (30,20), P4 (0,20) и построй границу']) fixtures.set(phrase, pointTask(30, 20));
  fixtures.set('Создай P1 (0,0), P2 (20,0), P3 (20,10), P4 (0,10) и построй границу', pointTask(20, 10));
  const site = { type: 'create_rectangle', name: 'Участок', width: 20, height: 30, placement: { type: 'local_origin' } };
  const house = { type: 'create_rectangle', name: 'Дом', width: 6, height: 4, placement: { type: 'centered_in_action_result', polygonActionIndex: 0 } };
  fixtures.set('Нарисуй участок 20 на 30 метров', multi(site));
  for (const phrase of ['Нарисуй участок 20 на 30, в центре дом 6 на 4', 'Нарисуй участок 20×30 м, в центре дом 6×4 м']) fixtures.set(phrase, multi(site, house));
  for (const phrase of ['Нарисуй участок 20 на 30, в центре дом 6 на 4 и проставь размеры дома', 'Нарисуй участок 20×30 м, в центре дом 6×4 м и проставь размеры дома']) fixtures.set(phrase, multi(site, house, { ...bulk, boundaryActionIndex: 1 }));
  fixtures.set('Создай точки P1 и P2', { status: 'needs_clarification', questions: ['Укажите X/Y для P1 и P2; Z при необходимости.'] });
  fixtures.set('Создай точки P1 и P2\nУточнение пользователя: P1 (0,0), P2 (30,0)', multi({ type: 'create_points', points: [{ name: 'P1', x: 0, y: 0 }, { name: 'P2', x: 30, y: 0 }] }));
  for (const phrase of ['Нарисуй участок, дом 6×4, грядки и газовую трубу с запада', 'Нарисуй участок, на нем дом 6×4, грядки и газовую трубу с запада']) fixtures.set(phrase, { status: 'needs_clarification', questions: ['Какого размера участок?', 'Сколько грядок и какого они размера?', 'Где проходит газовая труба и каков её отступ от границы?'] });
  return new MockAiIntentProvider(({ text,clarificationAnswers }) => {
    const result = fixtures.get(semanticRequestText({text,...(clarificationAnswers?{clarificationAnswers}:{})}).trim().replace(/[.!]$/, ''));
    return result ? (typeof result === 'object' && ('actions' in result || 'status' in result) ? result : { actions: [result] }) : { status: 'unsupported' };
  });
}

async function requestText(request: IncomingMessage): Promise<string> {
  // JSON escaping can expand an 8 KiB text sixfold. Bound wire bytes before JSON parsing.
  const limit = AI_LIMITS.requestBytes * 6 + 512;
  if (Number(request.headers['content-length']) > limit) throw new Error('Request too large');
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) { const buffer = Buffer.from(chunk as Uint8Array); bytes += buffer.byteLength;
    if (bytes > limit) throw new Error('Request too large'); chunks.push(buffer); }
  return Buffer.concat(chunks).toString('utf8');
}
function sameLocalOrigin(request: IncomingMessage): boolean {
  try {
    const host = new URL(`http://${request.headers.host}`);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) return false;
    return !request.headers.origin || request.headers.origin === host.origin;
  } catch { return false; }
}
export function aiDevelopmentEndpoint(config: AiServerConfig): Plugin {
  const baseMode = providerModeSchema.parse(config.AI_PROVIDER || 'disabled');
  const baseModels = modelConfig(config);
  const secrets = Object.entries({ ...process.env, ...config }).filter(([name, value]) => /key|token|secret|password|credential/i.test(name) && typeof value === 'string' && value.length > 0).map(([, value]) => value!);
  const makeProvider = (mode: typeof baseMode, models: ReturnType<typeof modelConfig>, key?: string) => mode === 'mock' ? developmentMockProvider() : mode === 'openai'
    ? new OpenAIIntentProvider(key || config.OPENAI_API_KEY || '', key === undefined ? config.AI_MODEL ?? '' : models.primaryModel)
    : mode === 'openrouter' ? new OpenRouterIntentProvider(key || config.OPENROUTER_API_KEY || '', models.primaryModel, undefined, models.fallbackModels, AI_LIMITS.timeoutMs, routingConfig(config)) : null;
  const baseProvider = makeProvider(baseMode, baseModels);
  return { name: 'geoservice-local-ai', apply: 'serve', configureServer(server) {
    server.middlewares.use(async (request: IncomingMessage, response: ServerResponse, next) => {
      if (!['/api/ai/config', '/api/ai/settings', '/api/ai/intent', '/api/ai/resolution'].includes(request.url ?? '')) { next(); return; }
      let mode = baseMode, models = baseModels, provider = baseProvider;
      const requestSecrets = [...secrets];
      const reply = (status: number, value: unknown) => { if (response.destroyed) return;
        response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(redact(value, requestSecrets))); };
      if (!sameLocalOrigin(request)) { reply(403, { error: 'Local same-origin access required' }); return; }
      if (request.url === '/api/ai/config' && request.method === 'GET') { reply(200, { mode }); return; }
      if (request.url === '/api/ai/settings' && request.method === 'GET') { reply(200, { provider:mode,hasApiKey:mode==='openrouter'?!!config.OPENROUTER_API_KEY:mode==='openai'?!!config.OPENAI_API_KEY:false,primaryModel: mode === 'openai' ? config.AI_MODEL ?? models.primaryModel : models.primaryModel, fallbackModel: models.fallbackModels[0] ?? '' }); return; }
      if (request.url === '/api/ai/resolution' && request.method === 'POST') {
        try {
          const result = z.strictObject({ traceId: traceIdSchema, status: z.enum(['ready', 'invalid', 'blocked', 'unresolved']), actionCount: z.number().int().min(0).max(AI_LIMITS.actions) }).parse(JSON.parse(await requestText(request)) as unknown);
          console.info(`[AI ${String(redact(result.traceId, secrets))}] ${JSON.stringify(redact({ resolve: result.status, actions: result.actionCount }, secrets))}`);
          reply(200, { ok: true });
        } catch { reply(400, { error: 'Invalid resolver report' }); }
        return;
      }
      if (request.method !== 'POST' || request.url !== '/api/ai/intent' || !request.headers['content-type']?.startsWith('application/json')) {
        reply(405, { error: 'Use JSON POST' }); return;
      }
      if (request.headers['x-ai-provider'] !== undefined) {
        const supplied = aiSettingsSchema.safeParse({ enabled: true, provider: request.headers['x-ai-provider'], apiKey: request.headers['x-ai-api-key'] ?? '', primaryModel: request.headers['x-ai-primary-model'], fallbackModel: request.headers['x-ai-fallback-model'] ?? '' });
        if (!supplied.success) { reply(400, { error: 'Invalid AI settings' }); return; }
        mode = supplied.data.provider;
        models = modelConfig({ AI_PRIMARY_MODEL: supplied.data.primaryModel, AI_FALLBACK_MODELS: supplied.data.fallbackModel });
        if (supplied.data.apiKey) requestSecrets.push(supplied.data.apiKey);
        provider = makeProvider(mode, models, supplied.data.apiKey);
      }
      if (!provider) { reply(503, { error: 'AI disabled' }); return; }
      const suppliedTrace = traceIdSchema.safeParse(request.headers['x-ai-trace-id']);
      const traceId = suppliedTrace.success ? suppliedTrace.data : newTraceId();
      let diagnostics: AiDiagnostic = createDiagnostic(traceId, '', mode, mode === 'mock' ? 'mock' : models.primaryModel, mode === 'mock' ? [] : models.fallbackModels);
      const controller = new AbortController();
      const started = performance.now();
      const disconnect = () => { if (!response.writableEnded) controller.abort(); };
      response.on('close', disconnect);
      const timer = setTimeout(() => controller.abort(), AI_LIMITS.timeoutMs);
      const tracedReply = (status: number, value: unknown) => { if (response.destroyed) return; response.setHeader('X-AI-Trace-ID', traceId); reply(status, value); };
      try {
        let raw: unknown;
        try { raw = JSON.parse(await abortable(requestText(request), controller.signal)) as unknown; } catch { throw new AiProviderError(controller.signal.aborted ? 'TIMEOUT' : 'BAD_REQUEST'); }
        const parsed = aiRequestSchema.safeParse(raw);
        if (!parsed.success) throw new AiProviderError('BAD_REQUEST');
        diagnostics.userText = parsed.data.text;
        const providerResult = await abortable(provider.parseIntent({ text: parsed.data.text,...(parsed.data.clarificationAnswers?{clarificationAnswers:parsed.data.clarificationAnswers}:{}), signal: controller.signal, traceId,
          onDiagnostic: record => { diagnostics = record; } }), controller.signal);
        const result = validateReliableResult(providerResult, semanticRequestText(parsed.data));
        diagnostics.schemaStatus = 'valid'; diagnostics.localValidationStatus = 'valid'; diagnostics.parsedResult = result;
        diagnostics.actionCount = 'actions' in result ? result.actions.length : 0;
        if ('status' in result && result.status === 'unsupported') diagnostics.errorCode = 'UNSUPPORTED';
        diagnostics.latencyMs = Math.round(performance.now() - started);
        tracedReply(200, { result, diagnostics: safeDiagnostic(diagnostics, requestSecrets) });
      } catch (error) {
        const code = error instanceof AiProviderError ? error.code : controller.signal.aborted ? 'TIMEOUT' : 'INVALID_STRUCTURED_OUTPUT';
        diagnostics.errorCode = code; diagnostics.latencyMs = Math.round(performance.now() - started);
        const status = code === 'AUTH_ERROR' ? 401 : code === 'BAD_REQUEST' ? 400 : code === 'RATE_LIMIT' ? 429 : code === 'TIMEOUT' ? 504
          : code === 'INVALID_STRUCTURED_OUTPUT' || code === 'LOCAL_VALIDATION_ERROR' ? 422 : 502;
        tracedReply(status, { error: { code }, diagnostics: safeDiagnostic(diagnostics, requestSecrets) });
      } finally {
        clearTimeout(timer); response.off('close', disconnect);
        console.info(`[AI ${String(redact(traceId, requestSecrets))}] ${JSON.stringify(redact({ model: diagnostics.primaryModel, actualModel: diagnostics.actualModel, provider: diagnostics.actualProvider,
          attempt: diagnostics.attempts.length, status: diagnostics.httpStatus, latency: diagnostics.latencyMs, parse: diagnostics.schemaStatus, validation: diagnostics.localValidationStatus, resolve: diagnostics.resolverStatus, error: diagnostics.errorCode }, requestSecrets))}`);
      }
    });
  } };
}
