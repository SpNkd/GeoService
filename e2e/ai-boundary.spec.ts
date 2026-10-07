import { editorCommand , openRightTab } from './helpers/editorCommands';
import { expect, test, type Page } from '@playwright/test';
import { autosaveSnapshot } from './helpers/autosave';
import { readFile, writeFile } from 'node:fs/promises';
import { MockAiIntentProvider } from '../src/ai/provider';

const text = 'Создай границу по точкам P1, P2, P3 и P4';
const boundary = (names = ['P1', 'P2', 'P3', 'P4']) => ({ type: 'create_boundary_from_named_points', pointNames: names });
const data = 'Name\tEasting\tNorthing\tHeight\nP1\t562341.234123456\t6189345.221234567\t152.34\nP2\t562358.188\t6189349.113\t152.41\nP3\t562361.982\t6189321.551\t152.27\nP4\t562320.000\t6189330.000\t';
async function setup(page: Page, output: unknown = boundary(), duplicates = false) {
  await page.addInitScript(() => {
    const writes: string[] = []; Reflect.set(window, '__aiWrites', writes);
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if(!['geoservice.preferences.v1','geoservice.ai-device-key.v1'].includes(key))writes.push(key); return setItem.call(this, key, value); };
  });
  await page.route('**/api/ai/config', route => route.fulfill({ json: { mode: 'mock' } }));
  const provider = new MockAiIntentProvider(() => { if (output instanceof Error) throw output; return output; });
  await page.route('**/api/ai/intent', async route => {
    expect(Object.keys(route.request().postDataJSON())).toEqual(['text']);
    try { await route.fulfill({ json: await provider.parseIntent({ text: route.request().postDataJSON().text, signal: new AbortController().signal }) }); }
    catch { await route.fulfill({ status: 502, json: { error: 'mock failure' } }); }
  });
  await page.goto('/'); await editorCommand(page, 'Новый документ');
  await editorCommand(page, 'Импорт координат');
  await page.getByRole('textbox', { name: 'Вставьте координаты', exact: true }).fill(data + (duplicates ? '\nP1\t562341.23\t6189345.22\t153' : ''));
  await page.getByRole('button', { name: `Импортировать (${duplicates ? 5 : 4})`, exact: true }).click();
  await expect(page.locator('[data-entity-type="point"]')).toHaveCount(duplicates ? 5 : 4);
  await editorCommand(page, 'Сохранить JSON');
  await expect(page.getByLabel('Есть несохранённые изменения')).toHaveCount(0);
}
async function snapshot(page: Page) {
  return { ...await autosaveSnapshot(page), writes: await page.evaluate(() => Reflect.get(window, '__aiWrites').length) };
}
async function generate(page: Page, request = text) {
  await openRightTab(page,'ai');await page.getByRole('textbox', { name: 'Запрос', exact: true }).fill(request);
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
}

test('AI preview has no canonical/history/autosave effects; Apply/Undo/Redo/Save/Open preserve shared refs', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await setup(page); const before = await snapshot(page);
  await generate(page); await expect(page.getByTestId('ai-ghost')).toBeVisible();
  await expect(page.getByTestId('ai-plan')).toContainText('Perimeter'); await expect(page.getByTestId('ai-plan')).toContainText('Area');
  await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before); await expect(page.getByLabel('Есть несохранённые изменения')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByTestId('ai-ghost')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  await generate(page); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const polygon = page.locator('[data-entity-type="polygon"]'); await expect(polygon).toHaveCount(1);
  const id = await polygon.getAttribute('data-entity-id'); await expect(page.getByTestId('ai-ghost')).toHaveCount(0);
  await expect(page.getByLabel('Есть несохранённые изменения')).toBeVisible();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(polygon).toHaveCount(0);
  await expect(page.locator('[data-entity-type="point"]')).toHaveCount(4); await expect(page.getByLabel('Есть несохранённые изменения')).toHaveCount(0);
  // The next Undo would undo import: AI contributes exactly one history step.
  await page.getByRole('button', { name: 'Повторить', exact: true }).click(); await expect(polygon).toHaveAttribute('data-entity-id', id!);
  const downloading = page.waitForEvent('download'); await editorCommand(page, 'Сохранить JSON');
  const path = (await (await downloading).path())!, savedText = await readFile(path, 'utf8'), saved = JSON.parse(savedText);
  const savedBoundary = saved.entities.find((entity: { type: string }) => entity.type === 'polygon');
  expect(savedBoundary.vertexIds).toEqual(saved.entities.filter((entity: { type: string }) => entity.type === 'point').map((entity: { vertexId: string }) => entity.vertexId));
  expect(Object.keys(saved.vertices)).toHaveLength(4); expect(saved.ai).toBeUndefined();
  await writeFile('/private/tmp/geoservice-ai-manual.json', savedText);
  await editorCommand(page, 'Новый документ');
  await page.getByLabel('Файл GeoDocument', { exact: true }).setInputFiles(path); await expect(polygon).toHaveAttribute('data-entity-id', id!);
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeDisabled(); expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/ai-boundary-applied.png' });
});

test('missing P999 blocks Apply without partial geometry or autosave', async ({ page }) => {
  await setup(page, boundary(['P1', 'P2', 'P999'])); const before = await snapshot(page);
  await generate(page, 'Создай границу по точкам P1, P2, P999'); await expect(page.getByTestId('ai-plan')).toContainText('P999 — точка не найдена');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled(); await expect(page.getByTestId('ai-ghost')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});

test('duplicate external P1 requires explicit local candidate selection', async ({ page }) => {
  await setup(page, boundary(), true); const before = await snapshot(page);
  await generate(page); await expect(page.getByTestId('ai-plan')).toContainText('P1 найдено в 2 экземплярах');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  const select = page.getByRole('combobox', { name: 'Разрешить P1', exact: true });
  await expect(select.locator('option').nth(1)).toContainText('562341.234123456'); await expect(select.locator('option').nth(2)).toContainText('153');
  await select.selectOption({ index: 1 }); await expect(page.getByTestId('ai-ghost')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(1);
});

test('manual P2 coordinate edit invalidates ghost and requires refreshed preview and explicit Apply', async ({ page }) => {
  await setup(page); await generate(page); const ghost = page.getByTestId('ai-ghost'); await expect(ghost).toBeVisible();
  const original = await ghost.locator('polygon').getAttribute('points');
  await page.locator('[data-entity-type="point"][aria-label="P2"] circle[r="14"]').click();
  await openRightTab(page,'properties');const x = page.getByRole('textbox', { name: 'X', exact: true }); await x.fill('562366.123456789');
  await expect(ghost).toHaveCount(0); await x.blur();await openRightTab(page,'ai');
  await expect(page.getByTestId('ai-plan')).toHaveAttribute('data-status', 'stale'); await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Пересчитать план', exact: true }).click();
  await expect(ghost).toBeVisible(); await expect(ghost.locator('polygon')).not.toHaveAttribute('points', original!);
  await expect(page.getByTestId('ai-plan')).toContainText('План пересчитан'); await expect(page.getByTestId('ai-plan')).toContainText('562366.123456789');
  await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(1);
});

test('unsupported delete request has no effect', async ({ page }) => {
  await setup(page, { status: 'unsupported' }); const before = await snapshot(page);
  await generate(page, 'удали все точки'); await expect(page.getByRole('alert')).toContainText('Эта команда пока не поддерживается');
  expect(await snapshot(page)).toEqual(before); await expect(page.locator('[data-entity-type="point"]')).toHaveCount(4);
});

test('malformed or hallucinated AI output is rejected before resolution with no effects', async ({ page }) => {
  await setup(page, { ...boundary(), entityIds: ['p1'] }); const before = await snapshot(page);
  await generate(page); await expect(page.getByRole('alert')).toContainText('неверный intent'); expect(await snapshot(page)).toEqual(before);
  await page.unroute('**/api/ai/intent'); await page.route('**/api/ai/intent', route => route.fulfill({ json: boundary() }));
  await generate(page, 'Создай границу P1 P2 P3'); await expect(page.getByRole('alert')).toContainText('P4'); expect(await snapshot(page)).toEqual(before);
});

test('provider error leaves editor usable and does not autosave', async ({ page }) => {
  await setup(page, new Error('network')); const before = await snapshot(page);
  await generate(page); await expect(page.getByRole('alert')).toContainText('AI недоступен'); expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Инструмент: Точка', exact: true }).click();
  const canvas = page.getByTestId('drawing-canvas'), box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await expect(page.locator('[data-entity-type="point"]')).toHaveCount(5);
});
