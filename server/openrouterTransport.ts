import { AI_LIMITS } from '../src/ai/intent';
import { AiProviderError, httpErrorCode, safeDiagnostic, type AiDiagnostic } from '../src/ai/reliability';

export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new AiProviderError('TIMEOUT');
  let abort!: () => void;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    abort = () => reject(new AiProviderError('TIMEOUT')); signal.addEventListener('abort', abort, { once: true });
  })]); } finally { signal.removeEventListener('abort', abort); }
}
async function boundedText(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader(); if (!reader) return '';
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const limit = response.ok ? AI_LIMITS.upstreamBytes : 16384;
  let size = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const { done, value } = await reader.read(); if (done) break;
    if (size + value.byteLength > limit) {
      if (response.ok) throw new AiProviderError('INVALID_STRUCTURED_OUTPUT');
      chunks.push(value.slice(0, limit - size)); size = limit; await reader.cancel(); break;
    }
    size += value.byteLength; chunks.push(value);
  } } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  const merged = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(merged);
}
function retryDelay(status: number, retryAfter: string | null): number | null {
  if (![429, 502, 503, 504].includes(status)) return null;
  if (!retryAfter) return 250;
  const seconds = Number(retryAfter);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
  return Number.isFinite(ms) && ms >= 0 && ms <= 1000 ? Math.max(250, ms) : null;
}
export async function routerResponse(transport: typeof fetch, key: string, body: unknown, signal: AbortSignal, diagnostics: AiDiagnostic, fallbackBody?: unknown): Promise<string> {
  const start = performance.now();
  for (let attempt = 1; attempt <= 2; attempt++) {
    const attemptStart = performance.now();
    const requestBody = attempt === 2 && fallbackBody ? fallbackBody : body;
    const requestedModel = requestBody && typeof requestBody === 'object' && 'model' in requestBody ? String(requestBody.model) : diagnostics.primaryModel;
    const entry = { attempt, requestedModel, latencyMs: 0 };
    diagnostics.attempts.push(entry);
    try {
      const response = await abortable(transport('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-AI-Trace-ID': diagnostics.traceId }, body: JSON.stringify(requestBody),
      }), signal);
      diagnostics.httpStatus = response.status;
      const raw = await abortable(boundedText(response, signal), signal);
      const bytes = new TextEncoder().encode(raw).byteLength;
      diagnostics.responseBytes = bytes;
      Object.assign(entry, { httpStatus: response.status, responseBytes: bytes, latencyMs: Math.round(performance.now() - attemptStart) });
      if (response.ok) return raw;
      const code = httpErrorCode(response.status);
      // Upstream can echo credentials; never retain its body without redaction.
      diagnostics.safeErrorBody = String(safeDiagnostic({ ...diagnostics, safeErrorBody: raw.slice(0, 16384) }, [key]).safeErrorBody);
      Object.assign(entry, { errorCode: code, safeErrorBody: diagnostics.safeErrorBody });
      const delay = retryDelay(response.status, response.headers.get('retry-after'));
      if (attempt === 1 && delay !== null) { await backoff(delay, signal); continue; }
      throw new AiProviderError(code);
    } catch (error) {
      const code = error instanceof AiProviderError ? error.code : signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR';
      Object.assign(entry, { errorCode: code, latencyMs: Math.round(performance.now() - attemptStart) });
      if (attempt === 1 && code === 'NETWORK_ERROR') { await backoff(250, signal); continue; }
      throw new AiProviderError(code);
    } finally { diagnostics.latencyMs = Math.round(performance.now() - start); }
  }
  throw new AiProviderError('NETWORK_ERROR');
}
async function backoff(ms: number, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await abortable(new Promise<void>(resolve => { timer = setTimeout(resolve, ms); }), signal); }
  finally { clearTimeout(timer); }
}
