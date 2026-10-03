import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-entity-id="boundary-01"]')).toBeVisible();
  await expect(page.getByTestId('drawing-canvas')).toHaveAttribute('data-zoom', /^(?!10$).+/);
});
const canvasBox = async (page: Page) => (await page.getByTestId('drawing-canvas').boundingBox())!;
async function clickScreen(page: Page, x: number, y: number) {
  const box = await canvasBox(page); await page.mouse.click(box.x + x * box.width, box.y + y * box.height);
}
const entityCount = (page: Page, type: string) => page.locator(`[data-entity-type="${type}"]`).count();
async function selectPoint(page: Page, id = 'sp1') {
  await page.locator(`[data-entity-id="${id}"] circle[r="14"]`).click();
  await expect(page.getByTestId('selected-id')).toHaveText(id);
}
async function createPath(page: Page, tool: string, points: [number, number][]) {
  await page.getByRole('button', { name: `Инструмент: ${tool}`, exact: true }).click();
  for (const [x, y] of points) await clickScreen(page, x, y);
}

test('point creation, inspector coordinates, Cmd/Ctrl+Z and redo preserve the same entity', async ({ page }) => {
  const before = await entityCount(page, 'point');
  await page.getByRole('button', { name: 'Инструмент: Точка', exact: true }).click();
  await clickScreen(page, 0.31, 0.24);
  await expect(page.locator('[data-entity-type="point"]')).toHaveCount(before + 1);
  const created = page.locator('[data-entity-type="point"]').last();
  const id = await created.getAttribute('data-entity-id');
  await expect(page.getByTestId('selected-id')).toHaveText(id!);
  const x = page.getByRole('textbox', { name: 'X', exact: true });
  await x.fill('562341.234123456'); await page.getByRole('textbox', { name: 'Y', exact: true }).fill('6189345.2212345');
  await page.getByRole('textbox', { name: 'Z', exact: true }).fill('152.3400123');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('textbox', { name: 'Z', exact: true })).toHaveValue('');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('textbox', { name: 'Z', exact: true })).toHaveValue('152.3400123');
  await expect(x).toHaveValue('562341.234123456');
  await expect(page.getByRole('textbox', { name: 'Y', exact: true })).toHaveValue('6189345.2212345');
  await expect(page.getByRole('textbox', { name: 'Z', exact: true })).toHaveValue('152.3400123');
});

test('creates a real two-vertex line and restores it with undo and redo', async ({ page }) => {
  const before = await entityCount(page, 'line');
  await page.getByRole('button', { name: 'Инструмент: Линия', exact: true }).click();
  await clickScreen(page, 0.18, 0.2); await expect(page.getByText(/выберите конечную точку/i)).toBeVisible();
  await clickScreen(page, 0.36, 0.27);
  await expect(page.locator('[data-entity-type="line"]')).toHaveCount(before + 1);
  const id = await page.locator('[data-entity-type="line"]').last().getAttribute('data-entity-id');
  await expect(page.getByTestId('selected-id')).toHaveText(id!);
  await expect(page.getByText('Вершины', { exact: true }).locator('..')).toContainText('2');
  await page.keyboard.press('Control+z'); await expect(page.locator(`[data-entity-id="${id}"]`)).toHaveCount(0);
  await page.keyboard.press('Control+y'); await expect(page.locator(`[data-entity-id="${id}"]`)).toBeVisible();
});

test('creates a polygon from world vertices and shows its computed area', async ({ page }) => {
  const before = await entityCount(page, 'polygon');
  await createPath(page, 'Полигон', [[0.21, 0.25], [0.47, 0.25], [0.38, 0.41]]);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(before + 1);
  await expect(page.locator('.entity-heading h3')).toHaveText(/Полигон/);
  const area = page.locator('.property-facts').getByText('Площадь', { exact: true }).locator('..');
  await expect(area).toContainText('м²');
  await page.keyboard.press('Control+z'); await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(before);
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(before + 1);
});

test('double-click finishes a polyline; text tool creates an independently selectable annotation', async ({ page }) => {
  const lines = await entityCount(page, 'polyline');
  await page.getByRole('button', { name: 'Инструмент: Полилиния', exact: true }).click();
  await clickScreen(page, 0.16, 0.34); await clickScreen(page, 0.26, 0.37); await clickScreen(page, 0.34, 0.31);
  await page.mouse.dblclick((await canvasBox(page)).x + (await canvasBox(page)).width * 0.44, (await canvasBox(page)).y + (await canvasBox(page)).height * 0.27);
  await expect(page.locator('[data-entity-type="polyline"]')).toHaveCount(lines + 1);
  const texts = await entityCount(page, 'text');
  await page.getByRole('button', { name: 'Инструмент: Текст', exact: true }).click(); await clickScreen(page, 0.53, 0.23);
  const input = page.getByRole('textbox', { name: 'Текст аннотации', exact: true });
  await input.fill('Контрольный репер'); await input.press('Enter');
  await expect(page.locator('[data-entity-type="text"]')).toHaveCount(texts + 1);
  await expect(page.locator('.entity-heading h3')).toHaveText(/Текст/);
});

test('dragging a shared point moves its parcel corner in one undoable action', async ({ page }) => {
  const before = await page.locator('[data-entity-id="boundary-01"] polygon').getAttribute('points');
  const point = page.locator('[data-entity-id="p1"]');
  const target = await point.locator('circle[r="14"]').boundingBox();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2); await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2 + 52, target!.y + target!.height / 2 - 36, { steps: 12 }); await page.mouse.up();
  const after = await page.locator('[data-entity-id="boundary-01"] polygon').getAttribute('points');
  expect(after).not.toBe(before);
  await expect(page.getByRole('textbox', { name: 'X', exact: true })).not.toHaveValue('1000');
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-entity-id="boundary-01"] polygon')).toHaveAttribute('points', before!);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('[data-entity-id="boundary-01"] polygon')).toHaveAttribute('points', after!);
});

test('locked layers permit selection and inspection while blocking geometry edits and deletion', async ({ page }) => {
  const point = page.locator('[data-entity-id="p1"]');
  await selectPoint(page, 'p1');
  const before = await page.locator('[data-entity-id="boundary-01"] polygon').getAttribute('points');
  await page.getByRole('button', { name: 'Заблокировать слой Геодезические точки' }).click();
  await expect(page.getByTestId('selected-id')).toHaveText('p1');
  await expect(page.getByRole('textbox', { name: 'X', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Удалить объект/ })).toHaveCount(0);
  const target = await point.locator('circle[r="14"]').boundingBox();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2); await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2 + 48, target!.y + target!.height / 2 - 30, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('[data-entity-id="boundary-01"] polygon')).toHaveAttribute('points', before!);
  await page.keyboard.press('Delete'); await expect(point).toBeVisible();
});

test('cancelled drawing leaves no entity; deletion and undo/redo preserve vertex lifetime', async ({ page }) => {
  const before = await entityCount(page, 'polygon');
  await createPath(page, 'Полигон', [[0.2, 0.2], [0.4, 0.2], [0.36, 0.35]]);
  await page.keyboard.press('Escape'); await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(before);
  await selectPoint(page);
  await page.keyboard.press('Delete'); await expect(page.locator('[data-entity-id="sp1"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Отменить' })).toBeEnabled();
  await page.keyboard.press('Control+z'); await expect(page.locator('[data-entity-id="sp1"]')).toBeVisible();
  await page.keyboard.press('Control+y'); await expect(page.locator('[data-entity-id="sp1"]')).toHaveCount(0);
});

test('wheel zoom and space-pan move the camera while the world point remains unchanged', async ({ page }) => {
  await selectPoint(page, 'sp1');
  const canvas = page.getByTestId('drawing-canvas'); const box = await canvas.boundingBox();
  const originalX = await page.getByRole('textbox', { name: 'X', exact: true }).inputValue();
  const originalY = await page.getByRole('textbox', { name: 'Y', exact: true }).inputValue();
  const originalScale = await canvas.getAttribute('data-zoom');
  await page.mouse.move(Math.round(box!.x + box!.width * 0.68), Math.round(box!.y + box!.height * 0.52));
  await page.mouse.wheel(0, -160);
  await expect(canvas).not.toHaveAttribute('data-zoom', originalScale!);
  await expect(page.getByRole('textbox', { name: 'X', exact: true })).toHaveValue(originalX);
  await expect(page.getByRole('textbox', { name: 'Y', exact: true })).toHaveValue(originalY);
  const oldCenter = await canvas.getAttribute('data-center-x');
  await page.keyboard.down('Space'); await page.mouse.down();
  await page.mouse.move(Math.round(box!.x + box!.width * 0.68) + 64, Math.round(box!.y + box!.height * 0.52) + 32, { steps: 4 });
  await page.mouse.up(); await page.keyboard.up('Space');
  await expect(canvas).not.toHaveAttribute('data-center-x', oldCenter!);
  await expect(page.getByRole('textbox', { name: 'X', exact: true })).toHaveValue(originalX);
  await expect(page.getByRole('textbox', { name: 'Y', exact: true })).toHaveValue(originalY);
  await page.getByRole('button', { name: 'Вписать', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-center-x', '1030'); await expect(canvas).toHaveAttribute('data-center-y', '2020');
});

test('renders the drawing without console or page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.reload();
  await expect(page.locator('[data-entity-id="sp1"]')).toBeVisible();
  await page.screenshot({ path: 'test-results/editor-desktop.png' });
  await expect(page.locator('.world-grid')).toBeVisible();
  expect(errors).toEqual([]);
});
