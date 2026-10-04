import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { GeoDocument, PointEntity, LineEntity, DimensionEntity, PolygonEntity } from '../src/domain/model';

const input = 'Name\tEasting\tNorthing\tHeight\nP1\t562341\t6189345\t100\nP2\t562351\t6189345\t103\nP3\t562351\t6189365\t\nP4\t562341\t6189365\t101';
const point = (page: Page, name: string) => page.locator(`[data-entity-type="point"][aria-label="${name}"]`);
const doc = (page: Page): Promise<GeoDocument> => page.evaluate(() => JSON.parse(localStorage.getItem('geoservice.document.v2')!));
async function position(page: Page, name: string) {
  const box = (await point(page, name).locator('circle[r="14"]').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function clickPoint(page: Page, name: string, dx = 0, dy = 0) {
  const p = await position(page, name); await page.mouse.click(p.x + dx, p.y + dy);
}
async function tool(page: Page, name: string) { await page.getByRole('button', { name: `Инструмент: ${name}`, exact: true }).click(); }
async function importPoints(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Новый документ', exact: true }).click();
  await page.getByRole('button', { name: 'Импорт координат', exact: true }).click();
  await page.getByRole('textbox', { name: 'Вставьте координаты', exact: true }).fill(input);
  await page.getByRole('button', { name: 'Импортировать (4)', exact: true }).click();
  await expect(page.locator('[data-entity-type="point"]')).toHaveCount(4);
}
async function movePoint(page: Page, name: string, dx = 40, dy = -25) {
  const p = await position(page, name);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + dx, p.y + dy, { steps: 8 }); await page.mouse.up();
}

test.beforeEach(async ({ page }) => { await importPoints(page); });

test('ordered imported points create a boundary with shared IDs, computed area, Undo and Redo', async ({ page }) => {
  const before = await doc(page), points = before.entities as PointEntity[];
  await page.keyboard.down('Shift');
  for (const name of ['P1', 'P2', 'P3', 'P4']) await clickPoint(page, name);
  await page.keyboard.up('Shift');
  await expect(page.locator('.ordered-selection li')).toHaveText(['P1', 'P2', 'P3', 'P4']);
  await expect(page.locator('.selection-order text')).toHaveText(['1', '2', '3', '4']);
  await page.getByRole('button', { name: 'Создать границу', exact: true }).click();
  await expect(page.locator('.property-facts').last()).toContainText('200,00 м²');
  const after = await doc(page), boundary = after.entities.find(e => e.type === 'polygon') as PolygonEntity;
  expect(boundary.vertexIds).toEqual(points.map(p => p.vertexId)); expect(Object.keys(after.vertices)).toHaveLength(4);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(0); await expect(page.locator('[data-entity-type="point"]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click(); await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(1);
});

test('line clicks near endpoints reuse vertices; dragging a shared point updates the line', async ({ page }) => {
  await tool(page, 'Линия'); const p = await position(page, 'P1'); await page.mouse.move(p.x + 4, p.y);
  await expect(page.getByTestId('snap-indicator')).toHaveAttribute('data-snap-type', 'vertex');
  await clickPoint(page, 'P1', 4); await clickPoint(page, 'P2', -4);
  const before = await doc(page), line = before.entities.find(e => e.type === 'line') as LineEntity;
  const points = before.entities.filter(e => e.type === 'point');
  expect([line.startVertexId, line.endVertexId]).toEqual(points.slice(0, 2).map(e => e.vertexId)); expect(Object.keys(before.vertices)).toHaveLength(4);
  const svg = page.locator('[data-entity-type="line"] line').first(); const x = await svg.getAttribute('x1');
  await movePoint(page, 'P1'); await expect(svg).not.toHaveAttribute('x1', x!);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(svg).toHaveAttribute('x1', x!);
});

test('dimension value follows shared drag and Undo, then Save/Open/reload preserve references', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await tool(page, 'Размер'); await clickPoint(page, 'P1'); await clickPoint(page, 'P2');
  const a = await position(page, 'P1'), b = await position(page, 'P2'); await page.mouse.click((a.x + b.x) / 2, a.y + 45);
  const value = page.getByTestId('dimension-value'); await expect(value).toHaveText('10,000 м');
  const before = await doc(page), dim = before.entities.find(e => e.type === 'dimension') as DimensionEntity;
  expect(Object.keys(before.vertices)).toHaveLength(4); expect(dim.offset).toBeLessThan(0);
  await movePoint(page, 'P2', -32, -35); await expect(value).not.toHaveText('10,000 м'); const moved = await value.textContent();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(value).toHaveText('10,000 м');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click(); await expect(value).toHaveText(moved!);
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Сохранить JSON', exact: true }).click();
  const path = (await (await downloadPromise).path())!, saved = JSON.parse(await readFile(path, 'utf8')) as GeoDocument;
  expect(saved.entities.find(e => e.type === 'dimension')).toEqual(dim); expect(saved.schemaVersion).toBe(2);
  await page.reload(); await expect(value).toHaveText(moved!);
  await page.getByRole('button', { name: 'Новый документ', exact: true }).click();
  await page.getByLabel('Файл GeoDocument', { exact: true }).setInputFiles(path); await expect(value).toHaveText(moved!);
  expect((await doc(page)).entities.find(e => e.type === 'dimension')).toEqual(dim); expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/survey-dimension.png' });
});

test('dimension offset can be dragged or edited in Properties as one undoable change', async ({ page }) => {
  await tool(page, 'Размер'); await clickPoint(page, 'P1'); await clickPoint(page, 'P2');
  const a = await position(page, 'P1'), b = await position(page, 'P2'); await page.mouse.click((a.x + b.x) / 2, a.y + 45);
  const readDocument = () => doc(page);
  const initial = await readDocument(), dimension = initial.entities.find(entity => entity.type === 'dimension') as DimensionEntity;
  const dragLine = page.locator('[data-entity-type="dimension"] .dimension-shape line').nth(2), box = (await dragLine.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 32, { steps: 6 }); await page.mouse.up();
  const dragged = (await readDocument()).entities.find(entity => entity.type === 'dimension') as DimensionEntity;
  expect(dragged.offset).not.toBe(dimension.offset);
  expect((await readDocument()).vertices).toEqual(initial.vertices);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  expect(((await readDocument()).entities.find(entity => entity.type === 'dimension') as DimensionEntity).offset).toBe(dimension.offset);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  expect(((await readDocument()).entities.find(entity => entity.type === 'dimension') as DimensionEntity).offset).toBe(dragged.offset);

  const offset = page.getByRole('textbox', { name: 'Отступ размера', exact: true });
  await offset.fill('2.25'); await offset.press('Tab');
  await expect.poll(async () => ((await readDocument()).entities.find(entity => entity.type === 'dimension') as DimensionEntity).offset).toBe(2.25);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  expect(((await readDocument()).entities.find(entity => entity.type === 'dimension') as DimensionEntity).offset).toBe(dragged.offset);
});

test('Measure snaps and shows horizontal/deltas/North-clockwise azimuth/3D; Escape leaves history intact', async ({ page }) => {
  const before = await doc(page); await tool(page, 'Измерение'); await clickPoint(page, 'P1', 3); await clickPoint(page, 'P2', -3);
  const readout = page.getByTestId('measurement-readout');
  await expect(readout).toContainText('Horizontal: 10,000 м'); await expect(readout).toContainText('ΔX: 10,000 м'); await expect(readout).toContainText('ΔY: 0,000 м');
  await expect(readout).toContainText('Azimuth: 90,000°'); await expect(readout).toContainText('ΔZ: 3,000 м'); await expect(readout).toContainText('3D: 10,440 м');
  await page.keyboard.press('Escape'); await expect(readout).toHaveCount(0); expect(await doc(page)).toEqual(before);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(page.locator('[data-entity-id]')).toHaveCount(0); // only import was in history
});

test('SNAP OFF creates independent nearby vertices and label modes never fabricate missing Z', async ({ page }) => {
  await page.getByRole('button', { name: 'Привязки', exact: true }).click(); await tool(page, 'Линия');
  await clickPoint(page, 'P1', 4); await clickPoint(page, 'P2', -4);
  const d = await doc(page), line = d.entities.find(e => e.type === 'line') as LineEntity;
  expect(Object.keys(d.vertices)).toHaveLength(6); expect(d.entities.filter(e => e.type === 'point').map(e => e.vertexId)).not.toContain(line.startVertexId);
  await page.getByRole('combobox', { name: 'Подписи точек', exact: true }).selectOption('z');
  await expect(page.locator('.point-label')).toHaveCount(0); await expect(page.locator('.height-label')).toHaveCount(3); await expect(point(page, 'P3').locator('.height-label')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Подписи точек', exact: true }).selectOption('name'); await expect(page.locator('.height-label')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Длины линий', exact: true }).check(); await expect(page.locator('[data-entity-type="line"] .dimension-label')).toBeVisible();
});

test('hidden survey layer does not contribute snap candidates', async ({ page }) => {
  const a = await position(page, 'P1'); await page.getByRole('button', { name: 'Скрыть слой Геодезические точки', exact: true }).click();
  await tool(page, 'Линия'); await page.mouse.move(a.x + 3, a.y); await expect(page.getByTestId('snap-indicator')).toHaveCount(0);
  await page.mouse.click(a.x + 3, a.y); await page.mouse.click(a.x + 45, a.y + 32);
  const d = await doc(page); expect(Object.keys(d.vertices)).toHaveLength(6); await expect(page.locator('[data-entity-type="point"]')).toHaveCount(0);
});

test('locked geometry remains a snap reference; shared vertex edits and drag remain blocked', async ({ page }) => {
  await page.getByRole('button', { name: 'Заблокировать слой Геодезические точки', exact: true }).click();
  await tool(page, 'Линия'); await clickPoint(page, 'P1', 3); await clickPoint(page, 'P2', -3);
  const before = await doc(page), line = before.entities.find(e => e.type === 'line') as LineEntity;
  expect(Object.keys(before.vertices)).toHaveLength(4); expect(line.startVertexId).toBe((before.entities[0] as PointEntity).vertexId);
  await movePoint(page, 'P1'); expect((await doc(page)).vertices).toEqual(before.vertices);
  await expect(page.getByRole('textbox', { name: 'X', exact: true })).toBeDisabled();
  await page.keyboard.press('Delete'); await expect(point(page, 'P1')).toBeVisible();
});
