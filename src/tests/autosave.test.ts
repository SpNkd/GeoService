import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createSampleDocument } from '../sample/document';
import { createAutosaveStore, LEGACY_DIRTY_KEY, LEGACY_DOCUMENT_KEY } from '../persistence/autosave';
import { serializeDocument } from '../persistence/serialization';
import { validateDocument } from '../persistence/documentSchema';
import type { GeoDocument } from '../domain/model';

const storage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key: string) => data.get(key) ?? null, removeItem: (key: string) => { data.delete(key); } };
};
const store = (legacyStorage = storage()) => ({ api: createAutosaveStore({ indexedDB: new IDBFactory(), legacyStorage }), legacyStorage });

function largeDocument(targetBytes = 9 * 1024 * 1024): GeoDocument {
  const document = createSampleDocument();
  const template = document.entities.find(entity => entity.type === 'text');
  if (!template || template.type !== 'text') throw new Error('sample text entity is missing');
  const content = 'КАДАСТРОВЫЙ DXF annotation '.repeat(400).slice(0, 9000);
  const encoder = new TextEncoder();
  const initialBytes = encoder.encode(serializeDocument(document)).byteLength;
  const perEntityBytes = encoder.encode(JSON.stringify({ ...template, id: 'large-text', name: 'large-text', vertexId: 'large-vertex', content })).byteLength + 80;
  const count = Math.ceil((targetBytes - initialBytes) / perEntityBytes);
  for (let i = 0; i < count; i++) {
    const id = `large-text-${i}`;
    const vertexId = `large-vertex-${i}`;
    document.vertices[vertexId] = { id: vertexId, x: i, y: i, z: 0 };
    document.entities.push({ ...template, id, name: id, vertexId, content });
  }
  return document;
}

describe('IndexedDB document autosave', () => {
  it('saves and restores a small canonical document with metadata and dirty state', async () => {
    const { api } = store(); const document = createSampleDocument();
    const serializationStart = performance.now();
    const serialized = serializeDocument(document);
    const serializationMs = performance.now() - serializationStart;
    const saveStart = performance.now();
    const record = await api.saveAutosave(document, true);
    const writeMs = performance.now() - saveStart;
    expect(record?.approximateSerializedBytes).toBe(new TextEncoder().encode(serialized).byteLength);
    const restoreStart = performance.now();
    expect(await api.loadAutosave()).toMatchObject({ document, dirty: true, migrated: false });
    const readAndValidateMs = performance.now() - restoreStart;
    const validationStart = performance.now();
    expect(validateDocument(document)).toEqual(document);
    const validationMs = performance.now() - validationStart;
    expect(await api.getAutosaveInfo()).toMatchObject({ entityCount: document.entities.length, dirty: true });
    console.info('IndexedDB small-document timings', JSON.stringify({ bytes: record!.approximateSerializedBytes, serializationMs, writeIncludingSerializationMs: writeMs, readIncludingValidationMs: readAndValidateMs, validationMs }));
  });

  it('round-trips a DXF-like 9 MiB document through IndexedDB', async () => {
    const { api } = store(); const document = largeDocument(); const started = performance.now();
    const saved = await api.saveAutosave(document, false);
    const writeMs = performance.now() - started; const readStart = performance.now();
    const restored = await api.loadAutosave(); const readMs = performance.now() - readStart;
    expect(saved?.approximateSerializedBytes).toBeGreaterThan(5 * 1024 * 1024);
    expect(restored?.document).toEqual(document);
    console.info('IndexedDB synthetic large-document timings', JSON.stringify({ bytes: saved?.approximateSerializedBytes, writeMs, readMs }));
  });

  it('migrates a valid legacy autosave and deletes it only after the IndexedDB write', async () => {
    const document = createSampleDocument(); const legacyStorage = storage({ [LEGACY_DOCUMENT_KEY]: serializeDocument(document), [LEGACY_DIRTY_KEY]: 'true' });
    const { api } = store(legacyStorage); const restored = await api.loadAutosave();
    expect(restored).toMatchObject({ document, dirty: true, migrated: true });
    expect(legacyStorage.data.size).toBe(0);
    expect((await api.loadAutosave())?.migrated).toBe(false);
  });

  it('retains legacy data when IndexedDB migration cannot open its database', async () => {
    const legacyStorage = storage({ [LEGACY_DOCUMENT_KEY]: serializeDocument(createSampleDocument()) });
    const indexedDB = { open: () => { throw new DOMException('disabled', 'SecurityError'); } } as unknown as IDBFactory;
    const api = createAutosaveStore({ indexedDB, legacyStorage });
    await expect(api.loadAutosave()).rejects.toMatchObject({ code: 'OPEN_FAILED' });
    expect(legacyStorage.data.has(LEGACY_DOCUMENT_KEY)).toBe(true);
  });

  it('reports corrupt legacy and corrupt IndexedDB entries without returning a document', async () => {
    const legacyStorage = storage({ [LEGACY_DOCUMENT_KEY]: '{broken' });
    const { api } = store(legacyStorage);
    await expect(api.loadAutosave()).rejects.toMatchObject({ code: 'CORRUPTED_AUTOSAVE' });
    expect(legacyStorage.data.has(LEGACY_DOCUMENT_KEY)).toBe(true);

    const indexedDB = new IDBFactory(); const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('geoservice.autosave', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put({ id: 'current' }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
    await expect(createAutosaveStore({ indexedDB }).loadAutosave()).rejects.toMatchObject({ code: 'CORRUPTED_AUTOSAVE' });
  });

  it('New clears the stored document and later committed state replaces Open content', async () => {
    const { api } = store(); const opened = createSampleDocument();
    await api.saveAutosave(opened, false); await expect(api.loadAutosave()).resolves.toMatchObject({ document: opened });
    await api.clearAutosave(); await expect(api.loadAutosave()).resolves.toBeNull();
    const replacement = { ...opened, metadata: { ...opened.metadata, title: 'Opened JSON' } };
    await api.saveAutosave(replacement, false); await expect(api.loadAutosave()).resolves.toMatchObject({ document: replacement });
  });

  it('serializes concurrent committed saves so the latest revision wins', async () => {
    const { api } = store(); const first = createSampleDocument();
    const second = { ...first, metadata: { ...first.metadata, title: 'latest' } };
    const [a, b, c] = await Promise.all([api.saveAutosave(first, true), api.saveAutosave(second, true), api.saveAutosave(first, false)]);
    expect(a).toBeNull(); expect(b).toBeNull(); expect(c?.document).toEqual(first);
    expect((await api.loadAutosave())?.document).toEqual(first);
  });

  it('does not mutate editor current document, history, or dirty state on storage failure', async () => {
    const indexedDB = { open: () => { throw new DOMException('quota', 'QuotaExceededError'); } } as unknown as IDBFactory;
    const api = createAutosaveStore({ indexedDB }); const original = createSampleDocument();
    await expect(api.saveAutosave(original, true)).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(original).toEqual(createSampleDocument());
  });
});
