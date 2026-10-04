import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.locator('[data-entity-id="baseline-01"]')).toBeVisible(); });

test('layer rows select, expose properties, rename with undo, and eye/lock do not change layer selection', async ({ page }) => {
  const row = page.locator('.layer-row').nth(3);
  await row.locator('.layer-name').click();
  await expect(row.locator('.layer-name')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('textbox', { name: 'Название слоя' })).toHaveValue('Аннотации');
  await page.getByRole('textbox', { name: 'Название слоя' }).fill('Примечания');
  await page.locator('.panel-heading h2').last().click();
  await expect(row).toContainText('Примечания');
  await page.keyboard.press('Control+z'); await expect(row).toContainText('Аннотации');
  await row.getByRole('button', { name: 'Скрыть слой Аннотации' }).click();
  await expect(row.locator('.layer-name')).toHaveAttribute('aria-pressed', 'true');
  await row.getByRole('button', { name: 'Показать слой Аннотации' }).click();
  await row.getByRole('button', { name: 'Заблокировать слой Аннотации' }).click();
  await expect(row.locator('.layer-name')).toHaveAttribute('aria-pressed', 'true');
  await row.getByRole('button', { name: 'Разблокировать слой Аннотации' }).click();
});

test('Text hit target selects, drag is one undo step, and double-click editing suppresses shortcuts', async ({ page }) => {
  await page.getByRole('button', { name: 'Инструмент: Текст', exact: true }).click();
  const canvas = page.getByTestId('drawing-canvas'), box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + 130, box.y + 130);
  const entry = page.getByRole('textbox', { name: 'Текст аннотации' }); await entry.fill('Линия L-17'); await entry.press('Enter');
  const id = await page.getByTestId('selected-id').textContent();
  const text = page.locator(`[data-entity-id="${id}"]`);
  const rect = text.locator('rect'); await rect.click(); await expect(page.getByTestId('selected-id')).toHaveText(id!);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('geoservice.document.v2')!).vertices);
  const hit = (await rect.boundingBox())!;
  await page.mouse.move(hit.x + 4, hit.y + 6); await page.mouse.down(); await page.mouse.move(hit.x + 44, hit.y + 28, { steps: 5 }); await page.mouse.up();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('geoservice.document.v2')!).vertices);
  expect(after).not.toEqual(before);
  await page.keyboard.press('Control+z');
  const undo = await page.evaluate(() => JSON.parse(localStorage.getItem('geoservice.document.v2')!).vertices);
  expect(undo).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  await rect.dblclick();
  const editor = page.getByRole('textbox', { name: 'Редактировать текст' }); await expect(editor).toBeVisible();
  await editor.fill('Проверка '); await page.keyboard.press('l');
  await expect(editor).toHaveValue('Проверка l');
  await expect(page.getByRole('button', { name: 'Инструмент: Линия', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape'); await expect(text.locator('text.annotation-label')).toHaveText('Линия L-17');
  await rect.dblclick(); await editor.fill('Committed text'); await editor.press('Enter');
  await expect(text.locator('text.annotation-label')).toHaveText('Committed text');
  await page.keyboard.press('Control+z'); await expect(text.locator('text.annotation-label')).toHaveText('Линия L-17');
  await page.keyboard.press('Delete'); await expect(text).toHaveCount(0);
  await page.keyboard.press('l');
  await expect(page.getByRole('button', { name: 'Инструмент: Линия', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('CAD sequences resolve deterministically and linked labels follow geometry with persistent offset', async ({ page }) => {
  await page.keyboard.press('p'); await page.keyboard.press('l');
  await expect(page.getByRole('button', { name: 'Инструмент: Полилиния', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('d'); await page.keyboard.press('i'); await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Инструмент: Размер', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('d'); await page.keyboard.press('i'); await page.waitForTimeout(950);
  await expect(page.getByRole('button', { name: 'Инструмент: Измерение', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.locator('[data-entity-id="baseline-01"] line[stroke="transparent"]').click({ force: true });
  await page.getByRole('button', { name: 'Добавить подпись' }).click();
  const label = page.locator('[data-entity-type="label"]'); await expect(label).toHaveCount(1);
  const template = page.getByRole('textbox', { name: 'Шаблон подписи' }); await template.fill('Ось ограждения · L={length} м'); await template.blur();
  const hit = (await label.locator('rect').boundingBox())!;
  await page.mouse.move(hit.x + 4, hit.y + 5); await page.mouse.down(); await page.mouse.move(hit.x + 35, hit.y + 20, { steps: 4 }); await page.mouse.up();
  const beforeMove = await page.evaluate(() => JSON.parse(localStorage.getItem('geoservice.document.v2')!).entities.find((entity: { type: string }) => entity.type === 'label'));
  await page.keyboard.press('Control+z');
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('geoservice.document.v2')!).entities.find((entity: { type: string }) => entity.type === 'label'));
  expect(restored.dx).not.toBe(beforeMove.dx);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить JSON', exact: true }).click()]);
  const savedPath = await download.path(); expect(savedPath).toBeTruthy();
  await page.getByRole('button', { name: 'Новый документ', exact: true }).click();
  await page.locator('input[type="file"][aria-label="Файл GeoDocument"]').setInputFiles(savedPath!);
  await expect(page.locator('[data-entity-type="label"]')).toHaveCount(1);
  await page.keyboard.press('?'); await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('DIM');
});
