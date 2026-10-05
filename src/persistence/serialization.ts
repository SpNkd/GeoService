import type { GeoDocument } from '../domain/model';
import { validateDocument } from './documentSchema';
import { migrateToCurrent } from './migrations';

/** Portable JSON safety budget; geometry complexity is bounded separately by the runtime schema. */
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
export function assertDocumentByteSize(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Некорректный размер JSON');
  if (bytes > MAX_DOCUMENT_BYTES) throw new Error(`JSON: размер ${bytes.toLocaleString('ru-RU')} байт (${(bytes / 1024**2).toFixed(2)} MiB) превышает максимум 100 MiB (${MAX_DOCUMENT_BYTES.toLocaleString('ru-RU')} байт)`);
}
export function assertDocumentSize(text: string): void {
  assertDocumentByteSize(new TextEncoder().encode(text).length);
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
const fingerprints=new WeakMap<object,string>();
const componentFingerprint=(value:object)=>{let cached=fingerprints.get(value);if(cached===undefined){cached=JSON.stringify(value);fingerprints.set(value,cached);}return cached;};
/** Exact JSON equality for immutable canonical components; no hash collisions or document-wide re-encoding on layer edits. */
export const documentFingerprint = (document: GeoDocument) => {
  const parts=Object.keys(document).sort().flatMap(key=>{
    const value=document[key as keyof GeoDocument];if(value===undefined)return [];
    return [JSON.stringify(key)+':'+(value&&typeof value==='object'?componentFingerprint(value):JSON.stringify(value))];
  });
  return '{'+parts.join(',')+'}';
};
