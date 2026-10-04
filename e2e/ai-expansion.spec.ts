import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { developmentMockProvider } from '../server/ai';
const consoleErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = []; consoleErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
});
test.afterEach(({ page }) => { expect(consoleErrors.get(page)).toEqual([]); });
const data = 'Name\tEasting\tNorthing\tHeight\nP1\t1000\t2000\t10\nP2\t1060\t2000\t13\nP3\t1060\t2040\t\nP4\t1000\t2040\t';
async function setup(page: Page, duplicate = false) {
  await page.addInitScript(() => { const writes: string[] = []; Reflect.set(window, '__writes', writes);
    const original = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { writes.push(k); return original.call(this, k, v); }; });
  await page.route('**/api/ai/config', route => route.fulfill({ json: { mode: 'mock' } }));
  const provider = developmentMockProvider();
  await page.route('**/api/ai/intent', async route => {
    const body = route.request().postDataJSON(); expect(Object.keys(body)).toEqual(['text']);
    await route.fulfill({ json: await provider.parseIntent({ text: body.text, signal: new AbortController().signal }) });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Новый документ', exact: true }).click();
  await page.getByRole('button', { name: 'Импорт координат', exact: true }).click();
  await page.getByRole('textbox', { name: 'Вставьте координаты', exact: true }).fill(data + (duplicate ? '\nP1\t1001\t2001\t14' : ''));
  await page.getByRole('button', { name: `Импортировать (${duplicate ? 5 : 4})`, exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить JSON', exact: true }).click();
  await expect(page.getByLabel('Есть несохранённые изменения')).toHaveCount(0);
}
async function snapshot(page: Page) { return page.evaluate(() => ({ document: localStorage.getItem('geoservice.document.v2'), dirty: localStorage.getItem('geoservice.document.dirty.v2'), writes: Reflect.get(window, '__writes').length })); }
async function generate(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Запрос', exact: true }).fill(text); await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
}
async function moveX(page: Page, name: string, x: string) {
  await page.locator(`[data-entity-type="point"][aria-label="${name}"] circle[r="14"]`).click();
  const input = page.getByRole('textbox', { name: 'X', exact: true }); await input.fill(x); await input.blur();
}
test('polyline preview/Apply/Undo/Redo shares canonical vertices and persists with dimensions', async ({ page }) => {
  await setup(page); const before = await snapshot(page); await generate(page, 'Соедини P1, P2 и P3 полилинией');
  await expect(page.getByTestId('ai-ghost').locator('polyline')).toBeVisible(); await expect(page.getByTestId('ai-plan')).toContainText('100,000 м');
  expect(await snapshot(page)).toEqual(before); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const path = page.locator('[data-entity-type="polyline"]'); await expect(path).toHaveCount(1); const id = await path.getAttribute('data-entity-id');
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(path).toHaveCount(0); await expect(page.locator('[data-entity-type="point"]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click(); await expect(path).toHaveAttribute('data-entity-id', id!);
  await generate(page, 'Поставь размер между P1 и P2'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Сохранить JSON', exact: true }).click();
  const file = (await (await download).path())!, saved = JSON.parse(await readFile(file, 'utf8'));
  expect(saved.entities.filter((e: {type: string}) => ['polyline', 'dimension'].includes(e.type))).toHaveLength(2); expect(Object.keys(saved.vertices)).toHaveLength(4);
  expect(saved.entities.some((e: object) => 'generatedByAI' in e)).toBe(false);
  await page.getByRole('button', { name: 'Новый документ', exact: true }).click(); await page.getByLabel('Файл GeoDocument', { exact: true }).setInputFiles(file);
  await expect(path).toHaveAttribute('data-entity-id', id!); await expect(page.getByTestId('dimension-value')).toHaveText('60,000 м');
});
test('dimension offset is local before Apply; moving source updates dimension and Undo restores it', async ({ page }) => {
  await setup(page); const before = await snapshot(page); await generate(page, 'Поставь размер между P1 и P2');
  await expect(page.getByTestId('dimension-preview-value')).toHaveText('60,000 м'); await page.getByRole('spinbutton', { name: 'Offset (м)', exact: true }).fill('-1.5');
  expect(await snapshot(page)).toEqual(before); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByTestId('dimension-value')).toHaveText('60,000 м'); await moveX(page, 'P2', '1065');
  await expect(page.getByTestId('dimension-value')).toHaveText('65,000 м'); await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.getByTestId('dimension-value')).toHaveText('60,000 м');
});
test('measure shows deterministic metrics, no Apply, dirty/history/autosave unchanged and clears ghost', async ({ page }) => {
  await setup(page); const before = await snapshot(page), undoBefore = await page.getByRole('button', { name: 'Отменить', exact: true }).isEnabled();
  await generate(page, 'Какое расстояние между P1 и P3?'); const plan = page.getByTestId('ai-plan');
  await expect(plan).toContainText('72,111 м'); await expect(plan).toContainText('ΔX'); await expect(plan).toContainText('ΔY'); await expect(plan).toContainText('Azimuth');
  await expect(plan).not.toContainText('3D distance'); await expect(page.getByTestId('ai-ghost').locator('line')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0); expect(await snapshot(page)).toEqual(before);
  expect(await page.getByRole('button', { name: 'Отменить', exact: true }).isEnabled()).toBe(undoBefore);
  await moveX(page, 'P1', '1005'); await expect(plan).toContainText('Измерение обновлено'); await expect(plan).toContainText('68,007 м');
  await page.getByRole('button', { name: 'Clear', exact: true }).click(); await expect(page.getByTestId('ai-ghost')).toHaveCount(0);
});
test('ambiguous dimension uses shared local choice and has no partial effects', async ({ page }) => {
  await setup(page, true); const before = await snapshot(page); await generate(page, 'Поставь размер между P1 и P2');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Разрешить P1', exact: true }).selectOption({ index: 1 }); await expect(page.getByTestId('dimension-preview-value')).toHaveText('60,000 м');
  expect(await snapshot(page)).toEqual(before); await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.locator('[data-entity-type="dimension"]')).toHaveCount(1);
});
test('unsupported mixed request has no partial mutation', async ({ page }) => {
  await setup(page); const before = await snapshot(page); await generate(page, 'Соедини P1 P2 P3 полилинией и удали P4');
  await expect(page.getByRole('alert')).toContainText('не поддерживается'); expect(await snapshot(page)).toEqual(before); await expect(page.getByTestId('ai-ghost')).toHaveCount(0);
});
test('stale dimension cannot Apply until local refresh and another confirmation', async ({ page }) => {
  await setup(page); await generate(page, 'Поставь размер между P1 и P2'); await expect(page.getByTestId('dimension-preview-value')).toBeVisible();
  await moveX(page, 'P1', '1005'); await expect(page.getByTestId('ai-ghost')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Пересчитать план', exact: true }).click(); await expect(page.getByTestId('dimension-preview-value')).toHaveText('55,000 м');
  await expect(page.locator('[data-entity-type="dimension"]')).toHaveCount(0); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByTestId('dimension-value')).toHaveText('55,000 м');
});
