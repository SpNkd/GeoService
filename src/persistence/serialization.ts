import type { GeoDocument } from '../domain/model';
import { validateDocument } from './documentSchema';
import { migrateToCurrent } from './migrations';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export function assertDocumentSize(text: string): void {
  if (new TextEncoder().encode(text).length > MAX_DOCUMENT_BYTES) throw new Error('JSON превышает лимит 10 МБ');
}
export function deserializeDocument(text: string): GeoDocument {
  assertDocumentSize(text);
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('Не удалось открыть JSON: повреждённый синтаксис'); }
  return validateDocument(migrateToCurrent(raw));
}
// The same byte budget applies to import and Save. Whitespace must not make a readable file unsaveable.
export function encodeDocument(document: GeoDocument): string {
  const pretty = JSON.stringify(document, null, 2);
  if (new TextEncoder().encode(pretty).length <= MAX_DOCUMENT_BYTES) return pretty;
  const compact = JSON.stringify(document);
  assertDocumentSize(compact);
  return compact;
}
export function serializeDocument(document: GeoDocument): string {
  return encodeDocument(validateDocument(document));
}
export const documentFingerprint = (document: GeoDocument) => JSON.stringify(document);
