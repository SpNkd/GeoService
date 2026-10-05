import { expect, test, type Page } from '@playwright/test';
import { readAutosaveDocument } from './helpers/autosave';
import { readFile } from 'node:fs/promises';
import type { GeoDocument } from '../src/domain/model';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const collected: string[] = []; errors.set(page, collected);
  page.on('pageerror', error => collected.push(error.message)); page.on('console', message => { if (message.type() === 'error') collected.push(message.text()); });
  await page.route('**/api/ai/config', route => route.fulfill({ json: { mode: 'mock' } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Новый документ', exact: true }).click();
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));
async function document(page: Page): Promise<GeoDocument> { return readAutosaveDocument(page); }
async function controls(page: Page) {
  await page.getByRole('button', { name: 'Импорт координат', exact: true }).click();
  await page.getByRole('textbox', { name: 'Вставьте координаты', exact: true }).fill('Name\tEasting\tNorthing\tHeight\nP1\t0\t0\t2.5\nP2\t30\t0\t\nP3\t30\t20\t');
  await page.getByRole('combobox', { name: 'Система входных координат', exact: true }).selectOption('model');
  await page.getByRole('button', { name: 'Импортировать (3)', exact: true }).click();
}
async function openCalibration(page: Page) { await page.getByRole('button', { name: 'Привязать координаты', exact: true }).click(); }
async function surveyInputs(page: Page, baseline = '30') {
  await page.getByRole('textbox', { name: 'Easting A', exact: true }).fill('500000'); await page.getByRole('textbox', { name: 'Northing A', exact: true }).fill('6000000');
  await page.getByRole('textbox', { name: 'Easting B', exact: true }).fill('500000'); await page.getByRole('textbox', { name: 'Northing B', exact: true }).fill(String(6000000 + Number(baseline)));
}
async function calibrate(page: Page) { await openCalibration(page); await surveyInputs(page); await page.getByRole('button', { name: 'Применить привязку', exact: true }).click(); }
async function select(page: Page, name: string) { await page.locator(`[data-entity-type="point"][aria-label="${name}"] circle[r="14"]`).click(); }
async function save(page: Page) { const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Сохранить JSON', exact: true }).click(); return (await (await event).path())!; }

test('A: AI local 20×30, centered 6×5 and four dimensions; PointEntity corner controls, preview, unchanged geometry and north', async ({ page }) => {
  const text = 'Нарисуй участок 20×30, в центре дом 6×5 и проставь размеры дома.';
  await page.route('**/api/ai/intent', async route => {
    expect(route.request().postDataJSON()).toEqual({ text });
    await route.fulfill({ json: { result: { actions: [
      { type: 'create_rectangle', name: 'Участок', width: 20, height: 30, placement: { type: 'local_origin' } },
      { type: 'create_rectangle', name: 'Дом', width: 6, height: 5, placement: { type: 'centered_in_action_result', polygonActionIndex: 0 } },
      { type: 'create_dimensions_for_boundary_edges', boundaryActionIndex: 1 },
    ] } } });
  });
  await page.getByRole('textbox', { name: 'Запрос', exact: true }).fill(text); await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await expect(page.getByTestId('ai-ghost')).toHaveCount(6); await page.getByRole('button', { name: 'Apply 6 changes', exact: true }).click();
  const ai = await document(page); expect(ai.modelFrame).toBe('local');
  const site = ai.entities.find(entity => entity.type === 'polygon' && entity.name === 'Участок')!;
  if (site.type !== 'polygon') throw Error('site');
  // The existing Point tool shares the snapped polygon vertex; calibration creates no points.
  const canvas = page.getByTestId('drawing-canvas'), box = (await canvas.boundingBox())!;
  const zoom = Number(await canvas.getAttribute('data-zoom')), cx = Number(await canvas.getAttribute('data-center-x')), cy = Number(await canvas.getAttribute('data-center-y'));
  for (const id of site.vertexIds.slice(0, 2)) {
    const vertex = ai.vertices[id]!;
    await page.getByRole('button', { name: 'Инструмент: Точка', exact: true }).click();
    await page.mouse.click(box.x + box.width / 2 + (vertex.x - cx) * zoom, box.y + box.height / 2 - (vertex.y - cy) * zoom);
  }
  const before = await document(page), points = before.entities.filter(entity => entity.type === 'point'); expect(points).toHaveLength(2);
  expect(points.map(point => point.vertexId)).toEqual(site.vertexIds.slice(0, 2));
  await openCalibration(page); await surveyInputs(page, '20');
  await expect(page.getByTestId('calibration-rotation')).toHaveText('90.000°'); await expect(page.getByTestId('control-markers')).toBeVisible();
  expect((await document(page))).toEqual(before); await page.getByRole('button', { name: 'Применить привязку', exact: true }).click();
  const after = await document(page); expect(after.vertices).toEqual(before.vertices); expect(after.entities).toEqual(before.entities);
  await expect(page.getByTestId('north-arrow')).toHaveAttribute('data-screen-x', '1');
  await expect(page.getByTestId('north-arrow')).toHaveAttribute('data-screen-y', /-6\.123/);
  await select(page, points[0]!.name); await expect(page.getByTestId('point-survey-e')).toHaveText('500000.000'); await expect(page.getByTestId('point-survey-n')).toHaveText('6000000.000');
  expect(after.entities.filter(entity => entity.type === 'dimension').map(entity => Math.hypot(after.vertices[entity.endVertexId]!.x - after.vertices[entity.startVertexId]!.x, after.vertices[entity.endVertexId]!.y - after.vertices[entity.startVertexId]!.y))).toEqual([6, 5, 6, 5]);
  const house = after.entities.find(entity => entity.type === 'polygon' && entity.name === 'Дом')!;
  if (house.type !== 'polygon') throw Error('house'); expect(house.vertexIds.map(id => after.vertices[id]!).map(({x,y}) => ({x,y}))).toEqual([{x:7,y:12.5},{x:13,y:12.5},{x:13,y:17.5},{x:7,y:17.5}]);
  await page.screenshot({ path: 'test-results/georeferencing-ai.png' });
});
test('B: display toggle changes status E/N only, no document/dirty/history/render/viewport changes', async ({ page }) => {
  await controls(page); await calibrate(page); await save(page);
  const before = await document(page), undoEnabled = await page.getByRole('button', { name: 'Отменить', exact: true }).isEnabled();
  const canvas = page.getByTestId('drawing-canvas'), box = (await canvas.boundingBox())!;
  const viewport = [await canvas.getAttribute('data-center-x'), await canvas.getAttribute('data-center-y'), await canvas.getAttribute('data-zoom')];
  const geometry = await canvas.locator('[data-entity-id]').evaluateAll(nodes => nodes.map(node => node.outerHTML));
  const cursor = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(cursor.x, cursor.y); await expect(page.getByTestId('cursor-x')).toHaveText('15.000'); await expect(page.getByTestId('cursor-y')).toHaveText('10.000');
  await page.getByRole('combobox', { name: 'Отображение координат', exact: true }).selectOption('survey'); await page.mouse.move(cursor.x, cursor.y);
  await expect(page.getByTestId('cursor-x')).toHaveText('499990.000'); await expect(page.getByTestId('cursor-y')).toHaveText('6000015.000');
  await expect(page.locator('.status-coordinates')).toContainText('E'); await expect(page.locator('.status-coordinates')).toContainText('N');
  expect(await document(page)).toEqual(before); await expect(page.getByLabel('Есть несохранённые изменения')).toHaveCount(0);
  expect(await page.getByRole('button', { name: 'Отменить', exact: true }).isEnabled()).toBe(undoEnabled);
  expect([await canvas.getAttribute('data-center-x'), await canvas.getAttribute('data-center-y'), await canvas.getAttribute('data-zoom')]).toEqual(viewport);
  expect(await canvas.locator('[data-entity-id]').evaluateAll(nodes => nodes.map(node => node.outerHTML))).toEqual(geometry);
  await page.getByRole('combobox', { name: 'Отображение координат', exact: true }).selectOption('model'); await page.mouse.move(cursor.x, cursor.y); await expect(page.getByTestId('cursor-x')).toHaveText('15.000');
});
test('C: independent height, live h_absolute label, missing Z, metadata history, Save/Open', async ({ page }) => {
  await controls(page); const vertices = (await document(page)).vertices;
  await page.getByRole('textbox', { name: 'Абсолютная отметка нуля', exact: true }).fill('153.420'); await page.getByRole('button', { name: 'Применить высотную привязку', exact: true }).click();
  await select(page, 'P1'); await expect(page.getByTestId('point-absolute-h')).toHaveText('155.920');
  await page.getByRole('combobox', { name: 'Вариант подписи', exact: true }).selectOption('H={h_absolute}'); await page.getByRole('button', { name: 'Добавить подпись', exact: true }).click();
  await expect(page.locator('[data-entity-type="label"] text')).toHaveText('H=155.920');
  await page.getByRole('button', { name: 'Удалить высотную привязку', exact: true }).click(); await expect(page.locator('[data-entity-type="label"] text')).toHaveText('H=—');
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(page.locator('[data-entity-type="label"] text')).toHaveText('H=155.920');
  const path = await save(page), saved = JSON.parse(await readFile(path, 'utf8')); expect(saved.vertices).toEqual(vertices); expect(saved.horizontalReference).toBeUndefined();
  await page.getByRole('button', { name: 'Новый документ', exact: true }).click(); await page.getByLabel('Файл GeoDocument', { exact: true }).setInputFiles(path);
  expect((await document(page))).toEqual(saved); await select(page, 'P1'); await expect(page.getByTestId('point-absolute-h')).toHaveText('155.920');
  await expect(page.getByRole('textbox', { name: 'Z', exact: true })).toHaveValue('2.5'); await select(page, 'P2'); await expect(page.getByTestId('point-absolute-h')).toHaveText('—');
});
test('D: moving control leaves transform committed, stale preview until Apply; delete guard, reference removal and Undo/Redo', async ({ page }) => {
  await controls(page); await calibrate(page); const before = await document(page);
  await select(page, 'P3'); await page.getByRole('textbox', { name: 'X', exact: true }).fill('31'); await page.getByRole('textbox', { name: 'X', exact: true }).blur(); await expect(page.getByTestId('reference-state')).not.toContainText('STALE');
  await select(page, 'P1'); await page.getByRole('textbox', { name: 'X', exact: true }).fill('0.01'); await page.getByRole('textbox', { name: 'X', exact: true }).blur();
  await expect(page.getByTestId('reference-state')).toContainText('STALE'); expect((await document(page)).horizontalReference).toEqual(before.horizontalReference);
  await page.getByRole('button', { name: 'Пересчитать привязку', exact: true }).click(); const moved = await document(page);
  await expect(page.getByTestId('calibration-preview')).toHaveAttribute('data-status', /OK|WARNING/); expect(await document(page)).toEqual(moved);
  await page.getByRole('button', { name: 'Применить привязку', exact: true }).click(); await expect(page.getByTestId('reference-state')).not.toContainText('STALE');
  expect((await document(page)).horizontalReference!.transform).not.toEqual(before.horizontalReference!.transform); expect((await document(page)).vertices).toEqual(moved.vertices);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(page.getByTestId('reference-state')).toContainText('STALE'); await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await select(page, 'P1'); await page.keyboard.press('Delete'); await expect(page.getByTestId('editor-error')).toContainText('Точка P1 используется для привязки координат. Сначала измените или удалите привязку.');
  await expect(page.locator('[data-entity-type="point"]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Удалить привязку', exact: true }).click(); expect((await document(page)).vertices).toEqual(moved.vertices);
  await select(page, 'P1'); await page.keyboard.press('Delete'); await expect(page.locator('[data-entity-type="point"]')).toHaveCount(2);
});
test('preview rejects duplicate/short/huge baselines; warning accepts fixed scale; canvas picker creates no points; cancel no writes', async ({ page }) => {
  await controls(page); const before = await document(page); await openCalibration(page); await surveyInputs(page, '42');
  await expect(page.getByTestId('calibration-preview')).toHaveAttribute('data-status', 'INVALID'); await expect(page.getByRole('button', { name: 'Применить привязку', exact: true })).toBeDisabled();
  await surveyInputs(page, '30.013'); await expect(page.getByTestId('calibration-preview')).toHaveAttribute('data-status', 'WARNING'); await expect(page.getByRole('button', { name: 'Применить привязку', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Выбрать A на схеме', exact: true }).click(); await select(page, 'P2');
  await expect(page.getByTestId('calibration-preview')).toHaveAttribute('data-status', 'INVALID'); await expect(page.getByRole('button', { name: 'Применить привязку', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Выбрать A на схеме', exact: true }).click(); await select(page, 'P1');
  await surveyInputs(page, '0.05'); await expect(page.getByRole('button', { name: 'Применить привязку', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click(); expect(await document(page)).toEqual(before); await expect(page.locator('[data-entity-type="point"]')).toHaveCount(3);
});

test('explicit projected/local frame choice preserves vertices, blocks implicit mixing and is undoable', async ({ page }) => {
  await controls(page); const before = await document(page);
  await page.getByRole('combobox', { name: 'Frame геометрии', exact: true }).selectOption('projected');
  expect((await document(page)).vertices).toEqual(before.vertices); await expect(page.getByTestId('reference-state')).toHaveText('Identity / direct');
  await select(page, 'P2'); await expect(page.getByTestId('point-survey-e')).toHaveText('30.000'); await expect(page.getByTestId('point-survey-n')).toHaveText('0.000');
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); expect(await document(page)).toEqual(before);
  await calibrate(page); await expect(page.getByRole('combobox', { name: 'Frame геометрии', exact: true })).toBeDisabled();
});

test('dialog keyboard boundaries and picker pan keep preview separate from document/history', async ({ page }) => {
  await controls(page); const before = await document(page); await openCalibration(page); await surveyInputs(page);
  const apply = page.getByRole('button', { name: 'Применить привязку', exact: true });
  await page.getByRole('button', { name: 'Закрыть привязку', exact: true }).focus(); await page.keyboard.press('Shift+Tab'); await expect(apply).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z'); expect(await document(page)).toEqual(before);
  await page.getByRole('button', { name: 'Выбрать A на схеме', exact: true }).click();
  const canvas = page.getByTestId('drawing-canvas'), box = (await canvas.boundingBox())!, cx = await canvas.getAttribute('data-center-x');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down({ button: 'middle' }); await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2); await page.mouse.up({ button: 'middle' });
  await expect(canvas).not.toHaveAttribute('data-center-x', cx!); expect(await document(page)).toEqual(before);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeVisible(); await expect(apply).toBeEnabled();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); expect(await document(page)).toEqual(before);
});
