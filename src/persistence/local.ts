import type { GeoDocument } from '../domain/model';
import { deserializeDocument, serializeDocument } from './serialization';

export const STORAGE_KEY = 'geoservice.document.v2';
export const DIRTY_KEY = 'geoservice.document.dirty.v2';
export function restoreLocalDocument(storage: Pick<Storage, 'getItem'>, fallback: () => GeoDocument): { document: GeoDocument; notice: string | null; dirty: boolean } {
  try {
    const text = storage.getItem(STORAGE_KEY);
    return { document: text ? deserializeDocument(text) : fallback(), notice: null, dirty: Boolean(text) && storage.getItem(DIRTY_KEY) === 'true' };
  } catch {
    return { document: fallback(), notice: 'Локальный документ недоступен или повреждён. Открыт демодокумент.', dirty: false };
  }
}
export function persistLocalDocument(storage: Pick<Storage, 'setItem'>, document: GeoDocument, dirty?: boolean): string | null {
  try { storage.setItem(STORAGE_KEY, serializeDocument(document)); if (dirty !== undefined) storage.setItem(DIRTY_KEY, String(dirty)); return null; }
  catch { return 'Локальное сохранение недоступно (лимит браузера или доступ запрещён). Сохраните JSON вручную.'; }
}
