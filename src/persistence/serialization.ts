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
export function serializeDocument(document: GeoDocument): string {
  const text = JSON.stringify(validateDocument(document), null, 2);
  assertDocumentSize(text);
  return text;
}
export const documentFingerprint = (document: GeoDocument) => JSON.stringify(document);
