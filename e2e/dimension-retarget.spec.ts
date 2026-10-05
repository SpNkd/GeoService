import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { GeoDocument, DimensionEntity } from '../src/domain/model';
import { staleControls } from '../src/geometry/georeferencing';

const input = 'Name\tEasting\tNorthing\nP1\t0\t0\nP2\t10\t0\nP3\t0\t20\nP4\t20\t0';
const document = (page: Page): Promise<GeoDocument> => page.evaluate(() => JSON.parse(localStorage.getItem('geoservice.document.v2')!));
const point = (page: Page, name: string) => page.locator(`[data-entity-type="point"][aria-label="${name}"]`);
async function center(locator: ReturnType<Page['locator']>) {
  const box = (await locator.boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function pointCenter(page: Page, name: string) { return center(point(page, name).locator('circle[r="14"]')); }
async function clickPoint(page: Page, name: string) { const p = await pointCenter(page, name); await page.mouse.click(p.x, p.y); }
async function documentWithDimension(page: Page, georeference = false) {
  await page.route('**/api/ai/config', route => route.fulfill({ json: { mode: 'mock' } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Новый документ', exact: true }).click();
  await page.getByRole('button', { name: 'Импорт координат', exact: true }).click();
  await page.getByRole('textbox', { name: 'Вставьте координаты', exact: true }).fill(input);
  await page.getByRole('combobox', { name: 'Система входных координат', exact: true }).selectOption('model');
  await page.getByRole('button', { name: 'Импортировать (4)', exact: true }).click();
  if (georeference) {
    await page.getByRole('button', { name: 'Привязать координаты', exact: true }).click();
    await page.getByRole('button', { name: 'Выбрать A на схеме', exact: true }).click(); await clickPoint(page, 'P1');
    await page.getByRole('button', { name: 'Выбрать B на схеме', exact: true }).click(); await clickPoint(page, 'P2');
    await page.getByRole('textbox', { name: 'Easting A', exact: true }).fill('500000'); await page.getByRole('textbox', { name: 'Northing A', exact: true }).fill('6000000');
    await page.getByRole('textbox', { name: 'Easting B', exact: true }).fill('500010'); await page.getByRole('textbox', { name: 'Northing B', exact: true }).fill('6000000');
    await page.getByRole('button', { name: 'Применить привязку', exact: true }).click();
    await expect(page.getByTestId('control-markers')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Инструмент: Размер', exact: true }).click(); await clickPoint(page, 'P1'); await clickPoint(page, 'P2');
  const a = await pointCenter(page, 'P1'), b = await pointCenter(page, 'P2'); await page.mouse.click((a.x + b.x) / 2, a.y + 48);
  await expect(page.locator('[data-entity-type="dimension"]')).toHaveCount(1);
  return (await document(page)).entities.find(entity => entity.type === 'dimension') as DimensionEntity;
}

test('endpoint grip previews without document/autosave changes, then retargets one endpoint in one Undo/Redo', async ({ page }) => {
  const dimension = await documentWithDimension(page), before = await document(page), storageBefore = await page.evaluate(() => localStorage.getItem('geoservice.document.v2'));
  const grip = page.getByTestId('dimension-start-grip'); await expect(grip).toBeVisible();
  const from = await center(grip), target = await pointCenter(page, 'P3');
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move((from.x + target.x) / 2, (from.y + target.y) / 2, { steps: 5 });
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await expect(page.getByTestId('dimension-retarget-target')).toBeVisible();
  expect(await document(page)).toEqual(before);
  expect(await page.evaluate(() => localStorage.getItem('geoservice.document.v2'))).toBe(storageBefore);
  await page.mouse.up();
  await expect.poll(async () => (await document(page)).entities.find(entity => entity.id === dimension.id)).toMatchObject({ startVertexId: (await document(page)).entities.find(entity => entity.type === 'point' && entity.name === 'P3') && ((await document(page)).entities.find(entity => entity.type === 'point' && entity.name === 'P3') as Extract<GeoDocument['entities'][number], { type: 'point' }>).vertexId });
  const retargeted = await document(page), entity = retargeted.entities.find(item => item.id === dimension.id) as DimensionEntity;
  expect(entity).toMatchObject({ startVertexId: (retargeted.entities.find(item => item.type === 'point' && item.name === 'P3') as Extract<GeoDocument['entities'][number], { type: 'point' }>).vertexId, endVertexId: dimension.endVertexId, offset: dimension.offset });
  await expect(page.getByTestId('dimension-value')).toHaveText('22,361 м');
  expect(retargeted.vertices).toEqual(before.vertices);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); expect(await document(page)).toEqual(before);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click(); expect(await document(page)).toEqual(retargeted);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Сохранить JSON', exact: true }).click();
  const file = (await (await download).path())!, saved = JSON.parse(await readFile(file, 'utf8')) as GeoDocument;
  expect(saved.entities.find(item => item.id === dimension.id)).toEqual(entity);
  await page.getByRole('button', { name: 'Новый документ', exact: true }).click(); await page.getByLabel('Файл GeoDocument', { exact: true }).setInputFiles(file);
  expect((await document(page)).entities.find(item => item.id === dimension.id)).toEqual(entity);
});

test('end endpoint grip retargets independently and preserves the start reference', async ({ page }) => {
  const dimension = await documentWithDimension(page), target = await pointCenter(page, 'P4'), from = await center(page.getByTestId('dimension-end-grip'));
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 10 }); await page.mouse.up();
  const after = await document(page), updated = after.entities.find(entity => entity.id === dimension.id) as DimensionEntity;
  expect(updated.startVertexId).toBe(dimension.startVertexId);
  expect(updated.endVertexId).toBe((after.entities.find(entity => entity.type === 'point' && entity.name === 'P4') as Extract<GeoDocument['entities'][number], { type: 'point' }>).vertexId);
});

test('inspector pick accepts only existing vertices, supports cancel, and midpoint/free targets do not mutate', async ({ page }) => {
  const dimension = await documentWithDimension(page);
  const rows = page.locator('.dimension-reference-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Начало · P1'); await expect(rows.nth(1)).toContainText('Конец · P2');
  const original = await document(page);
  await rows.nth(0).getByRole('button', { name: 'Выбрать на схеме' }).click();
  await expect(page.getByTestId('editor-error')).toContainText('Выберите существующую вершину для начала');
  const canvasBox = (await page.getByTestId('drawing-canvas').boundingBox())!;
  await page.mouse.click(canvasBox.x + canvasBox.width * 0.94, canvasBox.y + canvasBox.height * 0.92);
  await expect(page.getByTestId('editor-error')).toContainText('Выберите существующую вершину.');
  expect(await document(page)).toEqual(original);
  await page.keyboard.press('Escape'); expect(await document(page)).toEqual(original);
  await rows.nth(0).getByRole('button', { name: 'Выбрать на схеме' }).click(); await clickPoint(page, 'P3');
  const picked = await document(page), pickedDimension = picked.entities.find(item => item.id === dimension.id) as DimensionEntity;
  expect(pickedDimension.startVertexId).toBe((picked.entities.find(item => item.type === 'point' && item.name === 'P3') as Extract<GeoDocument['entities'][number], { type: 'point' }>).vertexId);
  expect(pickedDimension.endVertexId).toBe(dimension.endVertexId);
  await rows.nth(1).getByRole('button', { name: 'Выбрать на схеме' }).click(); await clickPoint(page, 'P4');
  expect(((await document(page)).entities.find(item => item.id === dimension.id) as DimensionEntity).endVertexId).toBe(((await document(page)).entities.find(item => item.type === 'point' && item.name === 'P4') as Extract<GeoDocument['entities'][number], { type: 'point' }>).vertexId);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); expect(await document(page)).toEqual(original);

  // A line midpoint is a valid ordinary snap candidate, but dimension retarget accepts vertex candidates only.
  await page.getByRole('button', { name: 'Инструмент: Линия', exact: true }).click(); await clickPoint(page, 'P1'); await clickPoint(page, 'P2');
  await expect(page.locator('[data-entity-type="line"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Инструмент: Выбор', exact: true }).click();
  // Drawing owns point clicks while its tool is active. Explicitly reselect the dimension after creating the line.
  await page.locator('[data-entity-type="dimension"] [data-dimension-text-handle]').click();
  const endGrip = page.getByTestId('dimension-end-grip'), from = await center(endGrip), a = await pointCenter(page, 'P1'), b = await pointCenter(page, 'P2');
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 }); await page.mouse.up();
  await expect(page.getByTestId('editor-error')).toContainText('существующей вершине');
  expect((await document(page)).entities.find(item => item.id === dimension.id)).toMatchObject({ startVertexId: dimension.startVertexId, endVertexId: dimension.endVertexId });
});

test('retarget keeps MODEL/SURVEY geometry and georeference valid', async ({ page }) => {
  const dimension = await documentWithDimension(page, true), before = await document(page), from = await center(page.getByTestId('dimension-start-grip')), target = await pointCenter(page, 'P3');
  const vertices = structuredClone(before.vertices), reference = structuredClone(before.horizontalReference), pointEntities = before.entities.filter(entity => entity.type === 'point');
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 12 }); await page.mouse.up();
  const after = await document(page), retargeted = after.entities.find(entity => entity.id === dimension.id) as DimensionEntity;
  expect(retargeted.startVertexId).toBe((after.entities.find(entity => entity.type === 'point' && entity.name === 'P3') as Extract<GeoDocument['entities'][number], { type: 'point' }>).vertexId);
  expect(after.vertices).toEqual(vertices); expect(after.horizontalReference).toEqual(reference); expect(after.entities.filter(entity => entity.type === 'point')).toEqual(pointEntities);
  expect(staleControls(after)).toEqual([]);
  await expect(page.locator('.dimension-reference-row').first()).toContainText('SURVEY E 500000.000 · N 6000020.000 м');
});

test('dimension layer lock removes endpoint grips and rejects inspector picking', async ({ page }) => {
  await documentWithDimension(page);
  await expect(page.getByTestId('dimension-start-grip')).toBeVisible();
  await page.getByRole('button', { name: 'Заблокировать слой Размеры' }).click();
  await expect(page.getByTestId('dimension-start-grip')).toHaveCount(0);
  const pickButtons = page.locator('.dimension-reference-row button');
  await expect(pickButtons).toHaveCount(2);
  await expect(pickButtons.nth(0)).toBeDisabled(); await expect(pickButtons.nth(1)).toBeDisabled();
});
