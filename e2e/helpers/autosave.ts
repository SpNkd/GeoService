import { expect, type Page } from '@playwright/test';
import type { GeoDocument } from '../../src/domain/model';

export interface BrowserAutosaveRecord {
  id: 'current';
  persistenceVersion: 1;
  schemaVersion: 2;
  savedAt: string;
  approximateSerializedBytes: number;
  entityCount: number;
  dirty: boolean;
  sourceFormat?: string;
  document: GeoDocument;
}

export async function readAutosaveRecord(page: Page): Promise<BrowserAutosaveRecord | null> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('geoservice.autosave', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('documents', 'readonly').objectStore('documents').get('current');
      read.onsuccess = () => { db.close(); resolve((read.result as BrowserAutosaveRecord | undefined) ?? null); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  })) as Promise<BrowserAutosaveRecord | null>;
}

export async function readAutosaveDocument(page: Page): Promise<GeoDocument> {
  await page.waitForTimeout(30);
  await expect(page.getByTestId('persistence-status')).toHaveText('Сохранено локально');
  const record = await readAutosaveRecord(page);
  if (!record) throw new Error('IndexedDB autosave record is missing');
  return record.document;
}

export async function autosaveSnapshot(page: Page) {
  await page.waitForTimeout(30);
  await expect(page.getByTestId('persistence-status')).toHaveText('Сохранено локально');
  const record = await readAutosaveRecord(page);
  return { document: record ? JSON.stringify(record.document) : null, dirty: record?.dirty ?? null };
}

export async function corruptAutosaveRecord(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('geoservice.autosave', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('documents', 'readwrite');
      tx.objectStore('documents').put({ id: 'current' });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
}
