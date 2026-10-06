import { editorCommand } from './helpers/editorCommands';
import { expect, test, type Page } from '@playwright/test';
import { autosaveSnapshot } from './helpers/autosave';
import { developmentMockProvider } from '../server/ai';
const consoleErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = []; consoleErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
});
test.afterEach(({ page }) => { expect(consoleErrors.get(page)).toEqual([]); });
const data = 'Name\tEasting\tNorthing\tHeight\nP1\t1000\t2000\t10\nP2\t1060\t2000\t13\nP3\t1060\t2040\t\nP4\t1000\t2040\t';
async function setup(page: Page, duplicate = false, coordinates = data) {
  await page.addInitScript(() => { const writes: string[] = []; Reflect.set(window, '__writes', writes);
    const original = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { writes.push(k); return original.call(this, k, v); }; });
  await page.route('**/api/ai/config', route => route.fulfill({ json: { mode: 'mock' } }));
  const provider = developmentMockProvider();
  await page.route('**/api/ai/intent', async route => {
    const body = route.request().postDataJSON(); expect(Object.keys(body)).toEqual(['text']);
    await route.fulfill({ json: await provider.parseIntent({ text: body.text, signal: new AbortController().signal }) });
  });
  await page.goto('/'); await editorCommand(page, 'Новый документ');
  await editorCommand(page, 'Импорт координат');
  await page.getByRole('textbox', { name: 'Вставьте координаты', exact: true }).fill(coordinates + (duplicate ? '\nP1\t1001\t2001\t14' : ''));
  await page.getByRole('button', { name: `Импортировать (${duplicate ? 5 : 4})`, exact: true }).click();
  await editorCommand(page, 'Сохранить JSON');
  await expect(page.getByLabel('Есть несохранённые изменения')).toHaveCount(0);
}
async function snapshot(page: Page) { return { ...await autosaveSnapshot(page), writes: await page.evaluate(() => Reflect.get(window, '__writes').length) }; }
async function generate(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Запрос', exact: true }).fill(text); await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
}
async function moveX(page: Page, name: string, x: string) {
  await page.locator(`[data-entity-type="point"][aria-label="${name}"] circle[r="14"]`).click();
  const input = page.getByRole('textbox', { name: 'X', exact: true }); await input.fill(x); await input.blur();
}
const request = 'Построй границу по P1 P2 P3 P4 и проставь размеры всех её сторон';
const mutations = (page: Page) => page.locator('[data-entity-type="polygon"], [data-entity-type="dimension"]');
test('boundary plus all four edges: projection has no writes; one Apply/Undo/Redo and Save/Open', async ({ page }) => {
  await setup(page); const before = await snapshot(page); await generate(page, request);
  await expect(page.getByTestId('ai-action')).toHaveCount(2); await expect(page.getByTestId('ai-ghost')).toHaveCount(5);
  await expect(page.getByTestId('dimension-preview-value')).toHaveText(['60,000 м', '40,000 м', '60,000 м', '40,000 м']);
  await expect(page.getByTestId('ai-edge-list').locator('li')).toHaveCount(4);
  await expect(page.getByRole('spinbutton', { name: 'Offset (м)', exact: true })).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before); await expect(mutations(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply 5 changes', exact: true }).click(); await expect(mutations(page)).toHaveCount(5);
  const ids = await mutations(page).evaluateAll(items => items.map(item => item.getAttribute('data-entity-id')));
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(mutations(page)).toHaveCount(0);
  await expect(page.locator('[data-entity-type="point"]')).toHaveCount(4); await expect(page.getByLabel('Есть несохранённые изменения')).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click(); await expect(mutations(page)).toHaveCount(5);
  expect(await mutations(page).evaluateAll(items => items.map(item => item.getAttribute('data-entity-id')))).toEqual(ids);
  const downloadPromise = page.waitForEvent('download'); await editorCommand(page, 'Сохранить JSON');
  const download = await downloadPromise, path = await download.path(); if (!path) throw Error('download');
  await editorCommand(page, 'Новый документ'); await expect(mutations(page)).toHaveCount(0);
  await page.getByLabel('Файл GeoDocument', { exact: true }).setInputFiles(path); await expect(mutations(page)).toHaveCount(5);
  expect(await mutations(page).evaluateAll(items => items.map(item => item.getAttribute('data-entity-id')))).toEqual(ids);
});
test('rotated boundary: lengths and rendered outward side match final dimension lines', async ({ page }) => {
  // A 60×40 rectangle rotated by a 3/5,4/5 world basis (CCW).
  await setup(page, false, 'Name\tEasting\tNorthing\tHeight\nP1\t1000\t2000\t\nP2\t1036\t2048\t\nP3\t1004\t2072\t\nP4\t968\t2024\t');
  await generate(page, request); await expect(page.getByTestId('ai-ghost')).toHaveCount(5);
  await expect(page.getByTestId('dimension-preview-value')).toHaveText(['60,000 м', '40,000 м', '60,000 м', '40,000 м']);
  const geometry = await page.locator('[data-testid="ai-ghost"] .dimension-shape').evaluateAll(shapes => shapes.map(shape => {
    const lines = [...shape.querySelectorAll('line')]; const coords = (line: Element) => ['x1', 'y1', 'x2', 'y2'].map(key => Number(line.getAttribute(key)));
    return { a: coords(lines[0]!), b: coords(lines[1]!), dimension: coords(lines[2]!) };
  }));
  expect(geometry).toHaveLength(4);
  for (const { a, b } of geometry) {
    // Screen Y is inverted: the world outward cross is negative; screen cross is positive.
    expect((b[0]! - a[0]!) * (a[3]! - a[1]!) - (b[1]! - a[1]!) * (a[2]! - a[0]!)).toBeGreaterThan(0);
  }
  await page.getByRole('button', { name: 'Apply 5 changes', exact: true }).click();
  const finalLines = await page.locator('[data-entity-type="dimension"] .dimension-shape').evaluateAll(shapes => shapes.map(shape => {
    const line = shape.querySelectorAll('line')[3]!; return ['x1', 'y1', 'x2', 'y2'].map(key => Number(line.getAttribute(key)));
  }));
  expect(finalLines).toEqual(geometry.map(edge => edge.dimension));
});
test('stale dependent plan hides all ghosts; refresh updates affected edges before explicit Apply', async ({ page }) => {
  await setup(page); await generate(page, request); await expect(page.getByTestId('ai-ghost')).toHaveCount(5);
  await moveX(page, 'P2', '1065'); await expect(page.getByTestId('ai-ghost')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apply 5 changes', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Пересчитать план', exact: true }).click(); await expect(page.getByTestId('ai-ghost')).toHaveCount(5);
  await expect(page.getByTestId('dimension-preview-value').first()).toHaveText('65,000 м');
  await expect(page.getByTestId('dimension-preview-value').nth(1)).toHaveText('40,311 м');
  await expect(mutations(page)).toHaveCount(0); await page.getByRole('button', { name: 'Apply 5 changes', exact: true }).click(); await expect(mutations(page)).toHaveCount(5);
});
test('one ambiguity choice feeds boundary and both incident dependent edges', async ({ page }) => {
  await setup(page, true); const before = await snapshot(page); await generate(page, request);
  const choice = page.getByRole('combobox', { name: 'Разрешить P1', exact: true }); await expect(choice).toHaveCount(1);
  await expect(page.getByTestId('ai-action').nth(1)).toContainText('заблокированы зависимостью');
  await expect(page.getByTestId('ai-ghost')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Apply 1 changes', exact: true })).toHaveCount(0);
  await choice.selectOption({ index: 2 }); await expect(page.getByTestId('ai-ghost')).toHaveCount(5);
  await expect(page.getByTestId('dimension-preview-value')).toHaveText(['59,008 м', '40,000 м', '60,000 м', '39,013 м']);
  expect(await snapshot(page)).toEqual(before); await page.getByRole('button', { name: 'Apply 5 changes', exact: true }).click();
  await expect(mutations(page)).toHaveCount(5);
  const stored = await snapshot(page), doc = JSON.parse(stored.document!);
  const boundary = doc.entities.find((entity: { type: string }) => entity.type === 'polygon');
  const dims = doc.entities.filter((entity: { type: string }) => entity.type === 'dimension');
  expect(dims[0].startVertexId).toBe(boundary.vertexIds[0]); expect(dims[3].endVertexId).toBe(boundary.vertexIds[0]);
});
test('dangling bulk request is unsupported without document/history/autosave effects', async ({ page }) => {
  await setup(page); const before = await snapshot(page); await generate(page, 'Проставь размеры всех сторон');
  await expect(page.getByRole('alert')).toContainText('не поддерживается'); await expect(page.getByTestId('ai-ghost')).toHaveCount(0);
  await expect(page.getByTestId('ai-plan')).toHaveCount(0); expect(await snapshot(page)).toEqual(before);
});
test('boundary, bulk and measure: six ghosts, five mutations, persistent transient result through Undo', async ({ page }) => {
  await setup(page); const before = await snapshot(page);
  await generate(page, 'Создай границу P1 P2 P3 P4, проставь размеры всех сторон и измерь P1 P4');
  await expect(page.getByTestId('ai-action')).toHaveCount(3); await expect(page.getByTestId('ai-ghost')).toHaveCount(6);
  await expect(page.getByTestId('ai-action').nth(2)).toContainText('40,000 м'); expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Apply 5 changes', exact: true }).click(); await expect(mutations(page)).toHaveCount(5);
  await expect(page.getByTestId('ai-action')).toHaveCount(1); await expect(page.getByTestId('ai-action')).toContainText('40,000 м');
  await expect(page.getByRole('button', { name: /^Apply/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(mutations(page)).toHaveCount(0);
  await expect(page.locator('[data-entity-type="point"]')).toHaveCount(4); await expect(page.getByTestId('ai-action')).toContainText('40,000 м');
});
