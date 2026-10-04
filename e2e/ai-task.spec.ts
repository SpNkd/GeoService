import { expect, test, type Page } from '@playwright/test';
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
const twoMutations = 'Создай границу по P1 P2 P3 P4 и поставь размер между P1 и P2';
test('two mutations share preview, local offset, one Apply and one Undo/Redo with stable IDs', async ({ page }) => {
  await setup(page); const before = await snapshot(page); await generate(page, twoMutations);
  await expect(page.getByTestId('ai-action')).toHaveCount(2); await expect(page.getByTestId('ai-ghost')).toHaveCount(2);
  await page.getByRole('spinbutton', { name: 'Offset (м)', exact: true }).fill('2.5'); expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(await snapshot(page)).toEqual(before);
  await generate(page, twoMutations); await page.getByRole('button', { name: 'Apply 2 changes', exact: true }).click();
  const mutations = page.locator('[data-entity-type="polygon"], [data-entity-type="dimension"]'); await expect(mutations).toHaveCount(2);
  const ids = await mutations.evaluateAll(items => items.map(item => item.getAttribute('data-entity-id')));
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(mutations).toHaveCount(0);
  await expect(page.getByLabel('Есть несохранённые изменения')).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click(); await expect(mutations).toHaveCount(2);
  expect(await mutations.evaluateAll(items => items.map(item => item.getAttribute('data-entity-id')))).toEqual(ids);
});
test('mixed task shows measurement before Apply, commits only polyline and keeps result through Undo/Redo', async ({ page }) => {
  await setup(page); const before = await snapshot(page); await generate(page, 'Соедини P1 P2 P3 полилинией и измерь расстояние от P1 до P4');
  await expect(page.getByTestId('ai-action')).toHaveCount(2); await expect(page.getByTestId('ai-ghost')).toHaveCount(2);
  await expect(page.getByTestId('ai-action').nth(1)).toContainText('40,000 м'); expect(await snapshot(page)).toEqual(before);
  const measureId = await page.getByTestId('ai-action').nth(1).getAttribute('data-action-id');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('[data-entity-type="polyline"]')).toHaveCount(1); await expect(page.locator('[data-entity-type="dimension"]')).toHaveCount(0);
  await expect(page.getByTestId('ai-action')).toHaveCount(1); await expect(page.getByTestId('ai-action')).toHaveAttribute('data-action-id', measureId!);
  await expect(page.getByTestId('ai-action')).toContainText('40,000 м'); await expect(page.getByRole('button', { name: /^Apply/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(page.locator('[data-entity-type="polyline"]')).toHaveCount(0);
  await expect(page.getByTestId('ai-action')).toContainText('40,000 м');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click(); await expect(page.getByTestId('ai-action')).toContainText('40,000 м');
});
test('read-only task shows both results without Apply, dirty/history/autosave effects', async ({ page }) => {
  await setup(page); const before = await snapshot(page), undoEnabled = await page.getByRole('button', { name: 'Отменить', exact: true }).isEnabled();
  await generate(page, 'Измерь расстояние P1-P2 и P3-P4'); await expect(page.getByTestId('ai-action')).toHaveCount(2);
  for (const action of await page.getByTestId('ai-action').all()) await expect(action).toContainText('60,000 м');
  await expect(page.getByRole('button', { name: /^Apply/ })).toHaveCount(0); expect(await snapshot(page)).toEqual(before);
  expect(await page.getByRole('button', { name: 'Отменить', exact: true }).isEnabled()).toBe(undoEnabled);
});
test('shared ambiguity asks once and supplies the same P1 to dimension and measure', async ({ page }) => {
  await setup(page, true); const before = await snapshot(page); await generate(page, 'Поставь размер между P1 и P2 и измерь расстояние от P1 до P3');
  await expect(page.getByRole('combobox', { name: 'Разрешить P1', exact: true })).toHaveCount(1);
  await expect(page.getByTestId('ai-ghost')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Разрешить P1', exact: true }).selectOption({ index: 1 });
  await expect(page.getByTestId('ai-ghost')).toHaveCount(2); expect(await snapshot(page)).toEqual(before);
  for (const action of await page.getByTestId('ai-action').all()) await expect(action.locator('.ai-points li').first()).toContainText('X 1000 · Y 2000');
});
test('stale task hides every ghost; one refresh updates the whole task before renewed Apply', async ({ page }) => {
  await setup(page); await generate(page, twoMutations); await expect(page.getByTestId('ai-ghost')).toHaveCount(2);
  await moveX(page, 'P1', '1005'); await expect(page.getByTestId('ai-ghost')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apply 2 changes', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Пересчитать план', exact: true }).click(); await expect(page.getByTestId('ai-ghost')).toHaveCount(2);
  await expect(page.getByTestId('ai-action').nth(0)).toContainText(/2\s300,000 м²/); await expect(page.getByTestId('dimension-preview-value')).toHaveText('55,000 м');
  await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(0); await page.getByRole('button', { name: 'Apply 2 changes', exact: true }).click();
  await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(1); await expect(page.locator('[data-entity-type="dimension"]')).toHaveCount(1);
});
test('unsupported part rejects the entire request with no partial preview or mutation', async ({ page }) => {
  await setup(page); const before = await snapshot(page); await generate(page, 'Создай границу P1 P2 P3 и удали P4');
  await expect(page.getByRole('alert')).toContainText('не поддерживается'); await expect(page.getByTestId('ai-ghost')).toHaveCount(0);
  await expect(page.getByTestId('ai-plan')).toHaveCount(0); expect(await snapshot(page)).toEqual(before);
});
