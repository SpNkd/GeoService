import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-entity-id="p1"]')).toBeVisible();
  await expect(page.getByTestId('drawing-canvas')).toHaveAttribute('data-zoom', /^(?!10$).+/);
});
const selectPoint = async (page: Page, id = 'sp1') => {
  await page.locator(`[data-entity-id="${id}"] circle[r="3.5"]`).click();
  await expect(page.getByTestId('selected-id')).toHaveText(id);
};

test('renders the sample and edits X/Y with full precision', async ({ page }) => {
  await expect(page.locator('[data-entity-id]')).toHaveCount(13);
  await selectPoint(page);
  const before = await page.locator('[data-entity-id="sp1"] circle').first().getAttribute('cx');
  await page.getByRole('textbox', { name: 'X', exact: true }).fill('1009.123456789');
  await expect(page.getByRole('textbox', { name: 'X', exact: true })).toHaveValue('1009.123456789');
  await expect(page.locator('[data-entity-id="sp1"] circle').first()).not.toHaveAttribute('cx', before!);
  await page.getByRole('textbox', { name: 'Y', exact: true }).fill('2011.987654321');
  await page.getByRole('button', { name: 'Снять выбор', exact: true }).click();
  await selectPoint(page);
  await expect(page.getByRole('textbox', { name: 'X', exact: true })).toHaveValue('1009.123456789');
  await expect(page.getByRole('textbox', { name: 'Y', exact: true })).toHaveValue('2011.987654321');
});

test('selects polygon, line, polyline and standalone text', async ({ page }) => {
  const canvas = page.getByTestId('drawing-canvas');
  const box = (await canvas.boundingBox())!;
  const clickWorld = async (x: number, y: number) => {
    const cx = Number(await canvas.getAttribute('data-center-x'));
    const cy = Number(await canvas.getAttribute('data-center-y'));
    const scale = Number(await canvas.getAttribute('data-zoom'));
    await page.mouse.click(box.x + box.width / 2 + (x - cx) * scale, box.y + box.height / 2 + (cy - y) * scale);
  };
  for (const id of ['building-01', 'baseline-01', 'survey-path', 'building-label']) {
    if (id === 'baseline-01') await clickWorld(1028.6797835, 2009.3805);
    else if (id === 'survey-path') await clickWorld(1009.8672835, 2020.1105);
    else await page.locator(`[data-entity-id="${id}"] ${id === 'building-01' ? 'polygon' : 'text'}`).click();
    await expect(page.getByTestId('selected-id')).toHaveText(id);
    await expect(page.locator(`[data-entity-id="${id}"]`)).toHaveAttribute('data-selected', 'true');
  }
});

test('hides and locks layers and clears stale selection', async ({ page }) => {
  await selectPoint(page);
  await page.getByRole('button', { name: 'Скрыть слой Геодезические точки', exact: true }).click();
  await expect(page.locator('[data-entity-id="sp1"]')).toHaveCount(0);
  await expect(page.getByText('Выберите объект', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Показать слой Геодезические точки', exact: true }).click();
  await page.getByRole('button', { name: 'Заблокировать слой Геодезические точки', exact: true }).click();
  await page.locator('[data-entity-id="sp1"] circle[r="3.5"]').click();
  await expect(page.getByTestId('selected-id')).toHaveCount(0);
  await page.getByRole('button', { name: 'Разблокировать слой Геодезические точки', exact: true }).click();
  await selectPoint(page);
});

test('wheel zoom and pan move the camera without changing world coordinates', async ({ page }) => {
  await selectPoint(page);
  const canvas = page.getByTestId('drawing-canvas');
  const box = (await canvas.boundingBox())!;
  const zoom = await canvas.getAttribute('data-zoom');
  const mouseX = Math.round(box.x + box.width * 0.7);
  const mouseY = Math.round(box.y + box.height * 0.5);
  await page.mouse.move(mouseX, mouseY);
  const cursorX = await page.getByTestId('cursor-x').textContent();
  const cursorY = await page.getByTestId('cursor-y').textContent();
  await page.mouse.wheel(0, -180);
  await expect(canvas).not.toHaveAttribute('data-zoom', zoom!);
  await expect(page.getByRole('textbox', { name: 'X', exact: true })).toHaveValue('1008.234567');
  await expect(page.getByTestId('cursor-x')).toHaveText(cursorX!);
  await expect(page.getByTestId('cursor-y')).toHaveText(cursorY!);
  const center = await canvas.getAttribute('data-center-x');
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(mouseX + 90, mouseY + 40, { steps: 5 });
  await page.mouse.up(); await page.keyboard.up('Space');
  await expect(canvas).not.toHaveAttribute('data-center-x', center!);
  await expect(page.getByTestId('cursor-x')).toHaveText(cursorX!);
  await expect(page.getByTestId('cursor-y')).toHaveText(cursorY!);
  await expect(page.getByRole('textbox', { name: 'X', exact: true })).toHaveValue('1008.234567');
  await expect(page.getByRole('textbox', { name: 'Y', exact: true })).toHaveValue('2010.221');
  await page.getByRole('button', { name: 'Вписать схему', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-center-x', '1030');
  await expect(canvas).toHaveAttribute('data-center-y', '2020');
});

test('handles large coordinates, invalid input and world grid toggle', async ({ page }) => {
  await selectPoint(page);
  const x = page.getByRole('textbox', { name: 'X', exact: true });
  await x.fill('562341.234123');
  await page.getByRole('textbox', { name: 'Y', exact: true }).fill('6189345.221345');
  await page.getByRole('button', { name: 'Вписать схему', exact: true }).click();
  await expect(page.locator('[data-entity-id="sp1"] circle').first()).toBeVisible();
  await x.fill('NaN');
  await expect(x).toHaveAttribute('aria-invalid', 'true');
  await x.blur();
  await expect(x).toHaveValue('562341.234123');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  await expect(page.locator('.world-grid')).toHaveCount(0);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  await expect(page.locator('.world-grid')).toBeVisible();
});

test('has no console or page errors and captures the desktop view', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.reload();
  await expect(page.locator('[data-entity-id="sp1"]')).toBeVisible();
  await selectPoint(page);
  await page.screenshot({ path: 'test-results/editor-desktop.png' });
  await expect(page.locator('.world-grid')).toBeVisible();
  expect(errors).toEqual([]);
});
