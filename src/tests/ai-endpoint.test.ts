import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import { expect, it, vi } from 'vitest';
import { aiDevelopmentEndpoint } from '../../server/ai';

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void | Promise<void>;
async function request(body: unknown, options: { mode?: string; host?: string; origin?: string; path?: string; method?: string; contentType?: string; raw?: string; traceId?: string } = {}) {
  let handle!: Middleware;
  const server = { middlewares: { use: (callback: Middleware) => { handle = callback; } } };
  const hook = aiDevelopmentEndpoint({ AI_PROVIDER: options.mode ?? 'mock', OPENAI_API_KEY: 'never-exposed-test-secret', OPENROUTER_API_KEY: 'never-exposed-test-secret', AI_MODEL: 'test-model' }).configureServer;
  if (typeof hook !== 'function') throw new Error('Expected server hook');
  await hook.call({} as never, server as ViteDevServer);
  const req = Readable.from([options.raw ?? JSON.stringify(body)]) as unknown as IncomingMessage;
  req.url = options.path ?? '/api/ai/intent'; req.method = options.method ?? 'POST';
  req.headers = { ...(options.traceId ? { 'x-ai-trace-id': options.traceId } : {}), host: options.host ?? '127.0.0.1:5173', 'content-type': options.contentType ?? 'application/json', ...(options.origin ? { origin: options.origin } : {}) };
  const emitter = new EventEmitter(); let status = 0, result = '', next = false;
  const res = Object.assign(emitter, { destroyed: false, writableEnded: false,
    setHeader: () => {}, writeHead: (code: number) => { status = code; }, end: (value: string) => { result = value; } }) as unknown as ServerResponse;
  await handle(req, res, () => { next = true; }); return { status, result, next };
}
const text = 'Создай границу по точкам P1, P2, P3 и P4';
it('local dev endpoint accepts only text and returns validated mock intent', async () => {
  const response = await request({ text }); expect(response.status).toBe(200);
  expect(JSON.parse(response.result).result).toEqual({ actions: [{ type: 'create_boundary_from_named_points', pointNames: ['P1', 'P2', 'P3', 'P4'] }] });
});
it('strict endpoint rejects document, commands, oversized and malformed requests', async () => {
  for (const body of [{ text, document: {} }, { text, command: { type: 'delete-entity' } }, { text: 'Я'.repeat(4097) }]) expect((await request(body)).status).toBe(400);
  expect((await request({}, { raw: '{broken' })).status).toBe(400);
  expect((await request({}, { raw: 'x'.repeat(50000) })).status).toBe(400);
});
it('cross-origin and DNS rebinding host cannot use or inspect the local AI endpoint', async () => {
  expect((await request({ text }, { origin: 'https://malicious.example' })).status).toBe(403);
  expect((await request({ text }, { host: 'malicious.example:5173' })).status).toBe(403);
});
it('only JSON POST is supported; config exposes a mode and no credentials', async () => {
  expect((await request({ text }, { method: 'GET' })).status).toBe(405);
  expect((await request({ text }, { contentType: 'text/plain' })).status).toBe(405);
  const config = await request({}, { method: 'GET', path: '/api/ai/config', mode: 'openai' });
  expect(JSON.parse(config.result)).toEqual({ mode: 'openai' }); expect(config.result).not.toContain('secret');
  expect((await request({}, { mode: 'disabled', method: 'GET', path: '/api/ai/config' })).result).toBe('{"mode":"disabled"}');
});
it('disabled mode never silently falls back, unrelated routes are delegated', async () => {
  expect((await request({ text }, { mode: 'disabled' })).status).toBe(503);
  expect((await request({}, { path: '/some-other-route' })).next).toBe(true);
});

it('trace header is echoed in diagnostic response; mock is explicitly labelled', async () => {
  const response = await request({ text }, { traceId: 'ai-endpoint-test' });
  expect(JSON.parse(response.result).diagnostics).toMatchObject({ traceId: 'ai-endpoint-test', provider: 'mock', primaryModel: 'mock', schemaStatus: 'valid' });
});
it('upstream 502 stays transport failure; local HTTP200 schema rejection gets 422', async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response('temporary outage', { status: 502 }));
  vi.stubGlobal('fetch', transport);
  try {
    const failed = await request({ text }, { mode: 'openrouter' });
    expect(failed.status).toBe(502); expect(JSON.parse(failed.result).error.code).toBe('UPSTREAM_5XX'); expect(transport).toHaveBeenCalledTimes(2);
    transport.mockImplementation(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{broken' } }] })));
    const invalid = await request({ text }, { mode: 'openrouter' });
    expect(invalid.status).toBe(422); expect(JSON.parse(invalid.result)).toMatchObject({ error: { code: 'INVALID_STRUCTURED_OUTPUT' }, diagnostics: { httpStatus: 200, schemaStatus: 'invalid' } });
  } finally { vi.unstubAllGlobals(); }
});
it('endpoint diagnostics redact environment credentials, raw response and user text', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('never-exposed-test-secret', { status: 401 }));
  vi.stubGlobal('fetch', transport);
  try {
    const failed = await request({ text: text + ' never-exposed-test-secret' }, { mode: 'openrouter' });
    expect(failed.status).toBe(401); expect(failed.result).not.toContain('never-exposed-test-secret'); expect(failed.result).toContain('[REDACTED]');
  } finally { vi.unstubAllGlobals(); }
});
it('resolver logging endpoint accepts only status/count/trace, never document data', async () => {
  expect((await request({ traceId: 'ai-report', status: 'ready', actionCount: 3 }, { path: '/api/ai/resolution' })).status).toBe(200);
  expect((await request({ traceId: 'ai-report', status: 'ready', actionCount: 3, document: {} }, { path: '/api/ai/resolution' })).status).toBe(400);
});
