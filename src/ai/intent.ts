import { z } from 'zod';

export const AI_LIMITS = Object.freeze({ requestBytes: 8192, responseBytes: 96 * 1024, upstreamBytes: 256 * 1024,
  pointNames: 500, nameLength: 128, timeoutMs: 30000 });
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;
export const aiRequestSchema = z.strictObject({ text: z.string().trim().min(1).max(AI_LIMITS.requestBytes)
  .refine(text => utf8Bytes(text) <= AI_LIMITS.requestBytes, 'Запрос превышает лимит 8 КБ') });
export const createBoundaryIntentSchema = z.strictObject({ type: z.literal('create_boundary_from_named_points'),
  pointNames: z.array(z.string().trim().min(1).max(AI_LIMITS.nameLength)).min(3).max(AI_LIMITS.pointNames) });
export const aiIntentSchema = z.discriminatedUnion('type', [createBoundaryIntentSchema]);
export type AiIntent = z.infer<typeof aiIntentSchema>;
export const unsupportedSchema = z.strictObject({ status: z.literal('unsupported') });
export type ParserResult = AiIntent | z.infer<typeof unsupportedSchema>;

/** Literal provenance/order check only; this does not interpret natural language or replace a provider. */
export function validateParserResult(raw: unknown, text: string): ParserResult {
  if (utf8Bytes(JSON.stringify(raw) ?? '') > AI_LIMITS.responseBytes) throw new Error('Ответ AI превышает лимит');
  if (unsupportedSchema.safeParse(raw).success) return { status: 'unsupported' };
  const parsed = aiIntentSchema.safeParse(raw);
  if (!parsed.success) throw new Error('AI вернул неверный intent. Попробуйте явно перечислить от 3 до 500 имён точек.');
  let cursor = 0;
  const nameCharacter = /[\p{L}\p{N}_-]/u;
  for (const name of parsed.data.pointNames) {
    let at = text.indexOf(name, cursor);
    while (at >= 0) {
      const before = text.slice(0, at).match(/.$/u)?.[0] ?? '';
      const after = text.slice(at + name.length).match(/^./u)?.[0] ?? '';
      if (!nameCharacter.test(before) && !nameCharacter.test(after)) break;
      at = text.indexOf(name, at + 1);
    }
    if (at < 0) throw new Error(`Имя «${name}» отсутствует в запросе или нарушен порядок. Уточните запрос.`);
    cursor = at + name.length;
  }
  return parsed.data;
}

/** Bound the bytes while reading, including responses without Content-Length. */
export async function readBoundedJson(response: Response, limit = AI_LIMITS.responseBytes): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw new Error('Ответ AI превышает лимит');
  }
  if (!response.body) throw new Error('Пустой ответ AI');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new Error('Ответ AI превышает лимит');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    try { return JSON.parse(text) as unknown; } catch { throw new Error('AI вернул невалидный JSON'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
