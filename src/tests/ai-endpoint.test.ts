import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import { expect, it } from 'vitest';
import { aiDevelopmentEndpoint } from '../../server/ai';

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void | Promise<void>;
async function request(body: unknown, options: { mode?: string; host?: string; origin?: string; path?: string; method?: string; contentType?: string; raw?: string } = {}) {
  let handle!: Middleware;
  const server = { middlewares: { use: (callback: Middleware) => { handle = callback; } } };
  const hook = aiDevelopmentEndpoint({ AI_PROVIDER: options.mode ?? 'mock', OPENAI_API_KEY: 'never-exposed-test-secret', AI_MODEL: 'test-model' }).configureServer;
  if (typeof hook !== 'function') throw new Error('Expected server hook');
  await hook.call({} as never, server as ViteDevServer);
  const req = Readable.from([options.raw ?? JSON.stringify(body)]) as unknown as IncomingMessage;
  req.url = options.path ?? '/api/ai/intent'; req.method = options.method ?? 'POST';
  req.headers = { host: options.host ?? '127.0.0.1:5173', 'content-type': options.contentType ?? 'application/json', ...(options.origin ? { origin: options.origin } : {}) };
  const emitter = new EventEmitter(); let status = 0, result = '', next = false;
  const res = Object.assign(emitter, { destroyed: false, writableEnded: false,
    writeHead: (code: number) => { status = code; }, end: (value: string) => { result = value; } }) as unknown as ServerResponse;
  await handle(req, res, () => { next = true; }); return { status, result, next };
}
const text = 'Создай границу по точкам P1, P2, P3 и P4';
it('local dev endpoint accepts only text and returns validated mock intent', async () => {
  const response = await request({ text }); expect(response.status).toBe(200);
  expect(JSON.parse(response.result)).toEqual({ actions: [{ type: 'create_boundary_from_named_points', pointNames: ['P1', 'P2', 'P3', 'P4'] }] });
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
