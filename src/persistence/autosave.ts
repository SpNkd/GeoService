import { prepareAutosaveDocument, type AutosavePreparation, type PreparedAutosave } from './autosavePreparation';
import type { GeoDocument } from '../domain/model';
import { validateDocument } from './documentSchema';
import { deserializeDocument } from './serialization';

export const LEGACY_DOCUMENT_KEY = 'geoservice.document.v2';
export const LEGACY_DIRTY_KEY = 'geoservice.document.dirty.v2';
const DATABASE_NAME = 'geoservice.autosave';
const DATABASE_VERSION = 1;
const STORE_NAME = 'documents';
const CURRENT_DOCUMENT_ID = 'current';

export type AutosaveErrorCode = 'QUOTA_EXCEEDED' | 'INDEXEDDB_UNAVAILABLE' | 'OPEN_FAILED' | 'TRANSACTION_FAILED' | 'WRITE_FAILED' | 'READ_FAILED' | 'CORRUPTED_AUTOSAVE' | 'VALIDATION_FAILED';
export class AutosaveError extends Error {
  constructor(readonly code: AutosaveErrorCode, message: string, options?: ErrorOptions) { super(message, options); this.name = 'AutosaveError'; }
}
export interface AutosaveRecord {
  id: typeof CURRENT_DOCUMENT_ID;
  persistenceVersion: 1;
  schemaVersion: 2;
  savedAt: string;
  approximateSerializedBytes: number;
  entityCount: number;
  dirty: boolean;
  sourceFormat?: string;
  document: GeoDocument;
}
export interface AutosaveInfo extends Omit<AutosaveRecord, 'document'> { storageUsage?: number; storageQuota?: number }
export interface RestoredAutosave { document: GeoDocument; dirty: boolean; savedAt: string; approximateSerializedBytes: number; migrated: boolean }
export interface AutosaveStoreOptions { prepare?: AutosavePreparation; indexedDB?: IDBFactory; legacyStorage?: Pick<Storage, 'getItem' | 'removeItem'>; estimate?: () => Promise<StorageEstimate> }
const storageError = (error: unknown, fallback: AutosaveErrorCode): AutosaveError => {
  if (error instanceof AutosaveError) return error;
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return new AutosaveError('QUOTA_EXCEEDED', 'Хранилище браузера исчерпало доступную квоту.', { cause: error });
  return new AutosaveError(fallback, error instanceof Error ? error.message : 'Ошибка локального хранилища.', { cause: error });
};
const isRecord = (value: unknown): value is AutosaveRecord => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<AutosaveRecord>;
  return record.id === CURRENT_DOCUMENT_ID && record.persistenceVersion === 1 && record.schemaVersion === 2 && typeof record.savedAt === 'string' && Number.isFinite(record.approximateSerializedBytes) && typeof record.entityCount === 'number' && typeof record.dirty === 'boolean' && !!record.document && typeof record.document === 'object';
};

export function createAutosaveStore(options: AutosaveStoreOptions = {}) {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  let legacyStorage = options.legacyStorage;
  if (!legacyStorage) { try { legacyStorage = globalThis.localStorage; } catch { /* Legacy storage may be disabled while IndexedDB remains available. */ } }
  let database: Promise<IDBDatabase> | undefined;
  let writeQueue: Promise<unknown> = Promise.resolve();
  let requestedRevision = 0;
  let cachedInfo: AutosaveInfo | null | undefined;
  const recordInfo=(record:AutosaveRecord):AutosaveInfo=>({id:record.id,persistenceVersion:record.persistenceVersion,schemaVersion:record.schemaVersion,savedAt:record.savedAt,approximateSerializedBytes:record.approximateSerializedBytes,entityCount:record.entityCount,dirty:record.dirty,...(record.sourceFormat?{sourceFormat:record.sourceFormat}:{})});

  const open = (): Promise<IDBDatabase> => {
    if (!factory) return Promise.reject(new AutosaveError('INDEXEDDB_UNAVAILABLE', 'IndexedDB недоступен в этом браузере.'));
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try { request = factory.open(DATABASE_NAME, DATABASE_VERSION); }
      catch (error) { reject(storageError(error, 'OPEN_FAILED')); return; }
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(storageError(request.error, 'OPEN_FAILED'));
      request.onblocked = () => reject(new AutosaveError('OPEN_FAILED', 'Открытие IndexedDB заблокировано другой вкладкой.'));
    }).catch(error => { database = undefined; throw error; });
    return database!;
  };
  const transaction = <T>(mode: IDBTransactionMode, fallback: AutosaveErrorCode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => open().then(db => new Promise((resolve, reject) => {
    let tx: IDBTransaction, request: IDBRequest<T>;
    try { tx = db.transaction(STORE_NAME, mode); request = run(tx.objectStore(STORE_NAME)); }
    catch (error) { reject(storageError(error, fallback)); return; }
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => { /* transaction.onerror supplies the stable failure code */ };
    tx.oncomplete = () => resolve(result!);
    tx.onabort = tx.onerror = () => reject(storageError(tx.error ?? request.error, tx.error ? fallback : 'TRANSACTION_FAILED'));
  }));
  const write = async (document: GeoDocument, dirty: boolean, revision: number): Promise<AutosaveRecord | null> => {
    if(revision !== requestedRevision)return null;
    let prepared: PreparedAutosave;
    try { prepared = await (options.prepare ?? prepareAutosaveDocument)(document); }
    catch (error) { throw new AutosaveError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Документ не прошёл проверку.', { cause: error }); }
    const canonical = prepared.document;
    const sourceFormat = canonical.sources?.[0]?.format;
    const record: AutosaveRecord = { id: CURRENT_DOCUMENT_ID, persistenceVersion: 1, schemaVersion: 2, savedAt: new Date().toISOString(), approximateSerializedBytes: prepared.approximateSerializedBytes, entityCount: canonical.entities.length, dirty, ...(sourceFormat ? { sourceFormat } : {}), document: canonical };
    if (revision !== requestedRevision) return null;
    await transaction('readwrite', 'WRITE_FAILED', store => store.put(record));
    cachedInfo=recordInfo(record);
    return record;
  };
  const saveAutosave = (document: GeoDocument, dirty = false): Promise<AutosaveRecord | null> => {
    const revision = ++requestedRevision;
    const task = writeQueue.then(() => write(document, dirty, revision));
    writeQueue = task.catch(() => undefined);
    return task;
  };
  const readRecord = () => transaction<unknown>('readonly', 'READ_FAILED', store => store.get(CURRENT_DOCUMENT_ID));
  const loadAutosave = async (): Promise<RestoredAutosave | null> => {
    let existing: unknown;
    try { existing = await readRecord(); }
    catch (error) { throw storageError(error, 'READ_FAILED'); }
    if (existing !== undefined) {
      if (!isRecord(existing)) throw new AutosaveError('CORRUPTED_AUTOSAVE', 'Запись локального автосохранения повреждена.');
      let document: GeoDocument;
      try { document = validateDocument(existing.document); }
      catch (error) { throw new AutosaveError('VALIDATION_FAILED', 'Локальный документ не прошёл проверку схемы.', { cause: error }); }
      cachedInfo=recordInfo(existing);
      return { document, dirty: existing.dirty, savedAt: existing.savedAt, approximateSerializedBytes: existing.approximateSerializedBytes, migrated: false };
    }
    let legacy: string | null, legacyDirty: string | null;
    try { legacy = legacyStorage?.getItem(LEGACY_DOCUMENT_KEY) ?? null; legacyDirty = legacyStorage?.getItem(LEGACY_DIRTY_KEY) ?? null; }
    catch (error) { throw storageError(error, 'READ_FAILED'); }
    if (!legacy) return null;
    let document: GeoDocument;
    try { document = deserializeDocument(legacy); }
    catch (error) { throw new AutosaveError('CORRUPTED_AUTOSAVE', 'Старое локальное автосохранение повреждено и не было восстановлено.', { cause: error }); }
    let saved: AutosaveRecord | null;
    try { saved = await saveAutosave(document, legacyDirty === 'true'); }
    catch (error) { throw storageError(error, 'WRITE_FAILED'); }
    if (!saved) throw new AutosaveError('WRITE_FAILED', 'Миграция автосохранения была отменена более новой записью.');
    try { legacyStorage?.removeItem(LEGACY_DOCUMENT_KEY); legacyStorage?.removeItem(LEGACY_DIRTY_KEY); }
    catch { /* The IndexedDB copy is already committed and legacy data is safe to leave behind. */ }
    return { document, dirty: legacyDirty === 'true', savedAt: saved.savedAt, approximateSerializedBytes: saved.approximateSerializedBytes, migrated: true };
  };
  const clearAutosave = async (): Promise<void> => {
    const revision = ++requestedRevision;
    const task = writeQueue.then(async () => { if (revision !== requestedRevision) return; await transaction('readwrite', 'WRITE_FAILED', store => store.delete(CURRENT_DOCUMENT_ID));cachedInfo=null; });
    writeQueue = task.catch(() => undefined); await task;
  };
  const getAutosaveInfo = async (): Promise<AutosaveInfo | null> => {
    const [raw, estimate] = await Promise.all([cachedInfo === undefined ? readRecord() : Promise.resolve(cachedInfo), (options.estimate ?? globalThis.navigator?.storage?.estimate?.bind(globalThis.navigator.storage))?.().catch(() => undefined)]);
    if(raw===null||raw===undefined)return null;
    if(cachedInfo===undefined){if(!isRecord(raw))throw new AutosaveError('CORRUPTED_AUTOSAVE','Запись локального автосохранения повреждена.');cachedInfo=recordInfo(raw);}
    return {...cachedInfo!,...(estimate?.usage===undefined?{}:{storageUsage:estimate.usage}),...(estimate?.quota===undefined?{}:{storageQuota:estimate.quota})};
  };
  return { saveAutosave, loadAutosave, clearAutosave, getAutosaveInfo };
}

export const { saveAutosave, loadAutosave, clearAutosave, getAutosaveInfo } = createAutosaveStore();
