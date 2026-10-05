import { expect, it, vi } from 'vitest';
import { OpenRouterIntentProvider } from '../../server/ai';
import { modelConfig, DEFAULT_PRIMARY_MODEL, DEFAULT_FALLBACK_MODELS, routingConfig } from '../../server/aiConfig';
import { AiRequestRunner, HttpAiIntentProvider, MockAiIntentProvider, validateReliableResult, type RequestEvent } from '../ai/provider';
import { AiProviderError, createDiagnostic, diagnosticRing, redact, type AiDiagnostic } from '../ai/reliability';
import { applicationReducer, type ApplicationState } from '../ai/workflow';
import { initialEditorState, isDocumentDirty } from '../store/editor';
import { createSampleDocument } from '../sample/document';

const text = 'Измерь P1 P2';
const semantic = { actions: [{ type: 'measure_between_named_points', pointNames: ['P1', 'P2'] }] };
const signal = () => new AbortController().signal;
const success = (intent: unknown = semantic, model = 'primary') => new Response(JSON.stringify({ model, provider: 'TestProvider', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ intent }) } }] }));
const provider = (transport: typeof fetch, timeout = 30000) => new OpenRouterIntentProvider('secret-key-for-test', 'primary', transport, ['fallback'], timeout);

it('502 remains UPSTREAM_5XX and cannot become semantic unsupported, even with forged error code', async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{"error":{"code":"UNSUPPORTED"}}', { status: 502 }));
  const events: RequestEvent[] = [];
  await new AiRequestRunner(new HttpAiIntentProvider(transport)).run(text, event => events.push(event));
  expect(events.at(-1)).toMatchObject({ type: 'failure', code: 'UPSTREAM_5XX' });
  expect(events.at(-1)).not.toHaveProperty('result');
  expect(transport).toHaveBeenCalledTimes(1); // Browser never retries; application retry belongs to server adapter.
});
it('503 retries once, keeps both attempts and returns validated success', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('busy', { status: 503 })).mockResolvedValueOnce(success());
  let record!: AiDiagnostic;
  expect(await provider(transport).parseIntent({ text, signal: signal(), onDiagnostic: value => { record = value; } })).toEqual(semantic);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(record.attempts.map(item => item.httpStatus)).toEqual([503, 200]); expect(record.schemaStatus).toBe('valid');
});
it('repeated 502 is bounded to two HTTP calls', async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response('busy', { status: 502 }));
  await expect(provider(transport).parseIntent({ text, signal: signal() })).rejects.toMatchObject({ code: 'UPSTREAM_5XX' });
  expect(transport).toHaveBeenCalledTimes(2);
});
it.each([400, 401, 403])('HTTP %i never retries', async status => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-key-for-test', { status }));
  await expect(provider(transport).parseIntent({ text, signal: signal() })).rejects.toMatchObject({ code: status === 400 ? 'BAD_REQUEST' : 'AUTH_ERROR' });
  expect(transport).toHaveBeenCalledTimes(1);
});
it('429 with long Retry-After does not immediately retry', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('limit', { status: 429, headers: { 'Retry-After': '60' } }));
  await expect(provider(transport).parseIntent({ text, signal: signal() })).rejects.toMatchObject({ code: 'RATE_LIMIT' });
  expect(transport).toHaveBeenCalledTimes(1);
});
it('short Retry-After and network failures can retry once', async () => {
  for (const first of [new Response('limit', { status: 429, headers: { 'Retry-After': '0' } }), new Error('network')]) {
    const transport = vi.fn<typeof fetch>();
    if (first instanceof Error) transport.mockRejectedValueOnce(first); else transport.mockResolvedValueOnce(first);
    transport.mockResolvedValueOnce(success());
    expect(await provider(transport).parseIntent({ text, signal: signal() })).toEqual(semantic); expect(transport).toHaveBeenCalledTimes(2);
  }
});
it('deadline aborts even an ignoring transport and never retries a timeout', async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
  await expect(provider(transport, 5).parseIntent({ text, signal: signal() })).rejects.toMatchObject({ code: 'TIMEOUT' });
  expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true); expect(transport).toHaveBeenCalledTimes(1);
});
it('overall deadline also bounds streaming response body', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } })));
  await expect(provider(transport, 5).parseIntent({ text, signal: signal() })).rejects.toMatchObject({ code: 'TIMEOUT' });
});
it.each(['{broken', JSON.stringify({ choices: [] }), JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{broken' } }] })])('malformed structured output is not retried', async raw => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(raw));
  await expect(provider(transport).parseIntent({ text, signal: signal() })).rejects.toMatchObject({ code: 'INVALID_STRUCTURED_OUTPUT' });
  expect(transport).toHaveBeenCalledTimes(1);
});
it('valid unsupported is a semantic response, never a transport failure', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(success(null)); let record!: AiDiagnostic;
  expect(await provider(transport).parseIntent({ text, signal: signal(), onDiagnostic: value => { record = value; } })).toEqual({ status: 'unsupported' });
  expect(record).toMatchObject({ httpStatus: 200, schemaStatus: 'valid', errorCode: 'UNSUPPORTED' });
});
it('configured fallback and privacy routing are sent; actual model/provider remain visible', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(success(semantic, 'fallback')); let record!: AiDiagnostic;
  await provider(transport).parseIntent({ text, signal: signal(), traceId: 'ai-test-routing', onDiagnostic: value => { record = value; } });
  const init = transport.mock.calls[0]![1]!; const body = JSON.parse(String(init.body));
  expect(body.models).toEqual(['primary', 'fallback']); expect(body.provider).toEqual({ allow_fallbacks: true, require_parameters: true, data_collection: 'deny' });
  expect(body).not.toHaveProperty('reasoning'); // Non-thinking instruct fallback has no reasoning parameter.
  expect(body.provider).not.toHaveProperty('only'); expect(body).not.toHaveProperty('tools');
  expect(record).toMatchObject({ actualModel: 'fallback', actualProvider: 'TestProvider', schemaStatus: 'valid' });
  expect(init.headers).toMatchObject({ 'X-AI-Trace-ID': 'ai-test-routing' });
});
it('trace goes from runner through HTTP, validation and resolver into plan', async () => {
  let app: ApplicationState = { editor: initialEditorState(createSampleDocument()), ai: { status: 'idle' } };
  let sent = '';
  const transport = vi.fn<typeof fetch>().mockImplementation(async (_, init) => {
    sent = new Headers(init?.headers).get('X-AI-Trace-ID')!;
    const record = { ...createDiagnostic(sent, text, 'mock'), schemaStatus: 'valid', parsedResult: semantic };
    return new Response(JSON.stringify({ result: semantic, diagnostics: record }));
  });
  await new AiRequestRunner(new HttpAiIntentProvider(transport)).run(text, event => { app = applicationReducer(app, { type: 'ai-event', event }); });
  expect(app.ai.status).toBe('preview'); if (app.ai.status === 'preview') expect(app.ai.plan.id).toBe(sent);
  expect(JSON.parse(String(transport.mock.calls[0]![1]!.body))).toEqual({ text });
});
it('a mismatched response trace is rejected', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ result: semantic, diagnostics: createDiagnostic('ai-other', text) })));
  await expect(new HttpAiIntentProvider(transport).parseIntent({ text, traceId: 'ai-local', signal: signal() })).rejects.toMatchObject({ code: 'INVALID_STRUCTURED_OUTPUT' });
});
it('local provenance failures are separate from upstream errors', () => {
  expect(() => validateReliableResult(semantic, 'Измерь P1')).toThrow(AiProviderError);
  try { validateReliableResult(semantic, 'Измерь P1'); } catch (error) { expect(error).toMatchObject({ code: 'LOCAL_VALIDATION_ERROR' }); }
});
it('redaction covers keys, authorization, cookies, environment secrets, raw error body and copy', async () => {
  const sensitive = { Authorization: 'Bearer hidden', cookies: 'session=x', OPENROUTER_API_KEY: 'secret', raw: 'sk-or-v1-abc123 Bearer token ABC_ENV_SECRET', error: 'Authorization: Bearer hidden\nCookie: session=x' };
  const copied = JSON.stringify(redact(sensitive, ['ABC_ENV_SECRET']));
  for (const value of ['hidden', 'session=x', 'abc123', 'ABC_ENV_SECRET']) expect(copied).not.toContain(value);
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response('secret-key-for-test sk-or-v1-abc123', { status: 401 }));
  let record!: AiDiagnostic;
  await provider(transport).parseIntent({ text, signal: signal(), onDiagnostic: value => { record = value; } }).catch(() => {});
  expect(JSON.stringify(record)).not.toContain('secret-key-for-test'); expect(JSON.stringify(record)).not.toContain('abc123');
});
it('diagnostic ring has at most 20 requests, updates by ID and does not mutate source', () => {
  let records: AiDiagnostic[] = [];
  for (let i = 0; i < 25; i++) records = diagnosticRing(records, createDiagnostic(`ai-${i}`, text));
  expect(records).toHaveLength(20); expect(records[0]?.traceId).toBe('ai-5'); const source = records;
  records = diagnosticRing(records, { ...createDiagnostic('ai-24', text), resolverStatus: 'ready' });
  expect(records).toHaveLength(20); expect(source.at(-1)?.resolverStatus).toBe('not_run');
});
it.each(['UPSTREAM_5XX', 'TIMEOUT', 'AUTH_ERROR', 'INVALID_STRUCTURED_OUTPUT'] as const)('%s leaves document/history/dirty unchanged', async code => {
  let app: ApplicationState = { editor: initialEditorState(createSampleDocument()), ai: { status: 'idle' } };
  const editor = app.editor;
  await new AiRequestRunner(new MockAiIntentProvider(() => { throw new AiProviderError(code); })).run(text, event => { app = applicationReducer(app, { type: 'ai-event', event }); });
  expect(app.editor).toBe(editor); expect(isDocumentDirty(app.editor)).toBe(false); expect(app.editor.past).toHaveLength(0);
  expect(app.ai).toMatchObject({ status: 'error', code });
});
it('model defaults are centralized and empty fallback env explicitly disables model fallback', () => {
  expect(modelConfig({})).toEqual({ primaryModel: DEFAULT_PRIMARY_MODEL, fallbackModels: DEFAULT_FALLBACK_MODELS });
  expect(modelConfig({ AI_PRIMARY_MODEL: 'local', AI_FALLBACK_MODELS: '' })).toEqual({ primaryModel: 'local', fallbackModels: [] });
});

it('transient primary failure uses explicit instruct fallback within the same two-call budget, without incompatible reasoning parameter', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('busy', { status: 503 })).mockResolvedValueOnce(success(semantic, DEFAULT_FALLBACK_MODELS[0]));
  let record!: AiDiagnostic;
  await new OpenRouterIntentProvider('fake-key', DEFAULT_PRIMARY_MODEL, transport, DEFAULT_FALLBACK_MODELS).parseIntent({ text, traceId: 'ai-compatible-fallback', signal: signal(), onDiagnostic: value => { record = value; } });
  const bodies = transport.mock.calls.map(([, init]) => JSON.parse(String(init!.body)));
  expect(bodies[0].reasoning).toEqual({ enabled: false }); expect(bodies[0]).not.toHaveProperty('models');
  expect(bodies[1]).not.toHaveProperty('reasoning'); expect(bodies[1].models).toEqual(DEFAULT_FALLBACK_MODELS);
  expect(bodies[1].model).toBe(DEFAULT_FALLBACK_MODELS[0]); expect(bodies[1].provider.require_parameters).toBe(true);
  expect(record.attempts.map(item => item.requestedModel)).toEqual([DEFAULT_PRIMARY_MODEL, DEFAULT_FALLBACK_MODELS[0]]);
  expect(record.actualModel).toBe(DEFAULT_FALLBACK_MODELS[0]); expect(transport).toHaveBeenCalledTimes(2);
});
it('explicit ignored providers are routing configuration, with failover still enabled and no pin', () => {
  const routing = routingConfig({ AI_IGNORED_PROVIDERS: 'siliconflow, atlas-cloud' });
  expect(routing).toMatchObject({ ignore: ['siliconflow', 'atlas-cloud'], allow_fallbacks: true, require_parameters: true });
  expect(routing).not.toHaveProperty('only'); expect(routing).not.toHaveProperty('order');
});
it('large non-JSON upstream error body stays an HTTP error and is a bounded redacted preview', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-key-for-test'+ 'x'.repeat(300000), { status: 401 }));
  let record!: AiDiagnostic;
  await provider(transport).parseIntent({ text, signal: signal(), onDiagnostic: value => { record = value; } }).catch(() => {});
  expect(record.errorCode).toBe('AUTH_ERROR'); expect(record.safeErrorBody!.length).toBeLessThanOrEqual(16384); expect(record.safeErrorBody).not.toContain('secret-key-for-test');
});

it('schema-shaped hallucinated names show successful Zod parse and failed provenance separately', async () => {
  const events: RequestEvent[] = [];
  await new AiRequestRunner(new MockAiIntentProvider(() => semantic)).run('Измерь P1', event => events.push(event));
  expect(events.at(-1)).toMatchObject({ type: 'failure', code: 'LOCAL_VALIDATION_ERROR', diagnostics: { schemaStatus: 'valid', localValidationStatus: 'invalid', parsedResult: semantic } });
});
