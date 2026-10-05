import { expect, test } from '@playwright/test';
import { readAutosaveDocument } from './helpers/autosave';
import { createSampleDocument } from '../src/sample/document';
import { serializeDocument } from '../src/persistence/serialization';

test('committed document restores from IndexedDB after reload and remains editable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('drawing-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Новый документ', exact: true }).click();
  await page.getByRole('button', { name: 'Создать слой', exact: true }).click();
  await expect(page.getByTestId('persistence-status')).toHaveText('Сохранено локально');
  const first = await readAutosaveDocument(page);
  expect(first.layers.some(layer => layer.name === 'Новый слой')).toBe(true);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Выбрать слой Новый слой', exact: true })).toBeVisible();
  const restored = await readAutosaveDocument(page);
  expect(restored).toEqual(first);
  await expect(page.getByLabel('Есть несохранённые изменения')).toBeVisible();

  await page.getByRole('button', { name: 'Создать слой', exact: true }).click();
  await expect(page.getByTestId('persistence-status')).toHaveText('Сохранено локально');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('persistence-status')).toHaveText('Сохранено локально');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('persistence-status')).toHaveText('Сохранено локально');
  const expectedFinal = await readAutosaveDocument(page);
  await page.reload();
  const final = await readAutosaveDocument(page);
  expect(final).toEqual(expectedFinal);
});

test('IndexedDB unavailable is reported while the document stays editable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined }));
  await page.goto('/');
  await expect(page.getByTestId('persistence-status')).toHaveText('Автосохранение не выполнено');
  await expect(page.locator('.document-notice')).toContainText('IndexedDB недоступен.');
  await page.getByRole('button', { name: 'Создать слой', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Выбрать слой Новый слой', exact: true })).toBeVisible();
  await expect(page.getByTestId('persistence-status')).toHaveText('Автосохранение не выполнено');
});

test('legacy autosave migrates to IndexedDB and its large text payload is removed only after restore', async ({ page }) => {
  const legacy = serializeDocument(createSampleDocument());
  await page.addInitScript(value => { localStorage.setItem('geoservice.document.v2', value); localStorage.setItem('geoservice.document.dirty.v2', 'true'); }, legacy);
  await page.goto('/');
  await expect(page.getByTestId('persistence-status')).toHaveText('Сохранено локально');
  const state = await page.evaluate(() => ({ legacyDocument: localStorage.getItem('geoservice.document.v2'), legacyDirty: localStorage.getItem('geoservice.document.dirty.v2') }));
  expect(state).toEqual({ legacyDocument: null, legacyDirty: null });
  const record = await page.evaluate(() => new Promise<{ id: string; dirty: boolean; document: { entities: unknown[] } } | null>((resolve, reject) => {
    const request = indexedDB.open('geoservice.autosave', 1);
    request.onsuccess = () => { const db = request.result; const get = db.transaction('documents').objectStore('documents').get('current'); get.onsuccess = () => { db.close(); resolve(get.result ?? null); }; get.onerror = () => reject(get.error); };
    request.onerror = () => reject(request.error);
  }));
  expect(record).toMatchObject({ id: 'current', dirty: true, document: { entities: expect.any(Array) } });
});
