import { test, expect, type Page } from '@playwright/test';
import { corruptAutosaveRecord, readAutosaveDocument } from './helpers/autosave';
import { readFile } from 'node:fs/promises';

const data = 'Name\tEasting\tNorthing\tHeight\nP1\t562341.234123456\t6189345.221234567\t152.340\nP2\t562358.188\t6189349.113\t152.410\nP3\t562361.982\t6189321.551\t152.270\nP4\t562320.000\t6189330.000\t';
async function newDocument(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Новый документ', exact: true }).click();
  await expect(page.locator('[data-entity-id]')).toHaveCount(0);
}
async function preview(page: Page, text = data) {
  await page.getByRole('button', { name: 'Импорт координат', exact: true }).click();
  await page.getByRole('textbox', { name: 'Вставьте координаты', exact: true }).fill(text);
}
async function importNow(page: Page, count = 4) {
  await page.getByRole('button', { name: `Импортировать (${count})`, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-entity-type="point"]')).toHaveCount(count);
}
async function selectP1(page: Page) {
  await page.locator('[data-entity-type="point"][aria-label="P1"] circle[r="14"]').click();
}

test('Excel paste previews four large-coordinate points, fits, pans/zooms and undoes the whole import', async ({ page }) => {
  await newDocument(page); await preview(page);
  await expect(page.getByTestId('import-counts')).toContainText('Валидных: 4');
  await expect(page.getByRole('combobox', { name: 'Разделитель', exact: true })).toHaveValue('\t');
  await page.screenshot({ path: 'test-results/import-preview.png' });
  await importNow(page);
  const ids = await page.locator('[data-entity-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-entity-id')));
  const canvas = page.getByTestId('drawing-canvas');
  expect(Number(await canvas.getAttribute('data-center-x'))).toBeCloseTo(562340.991, 6);
  await expect(page.getByLabel('Есть несохранённые изменения')).toBeVisible();
  await selectP1(page);
  await expect(page.getByRole('textbox', { name: 'X', exact: true })).toHaveValue('562341.234123456');
  await expect(page.getByRole('textbox', { name: 'Y', exact: true })).toHaveValue('6189345.221234567');
  await page.getByRole('button', { name: 'Увеличить', exact: true }).click();
  const center = await canvas.getAttribute('data-center-x'), box = (await canvas.boundingBox())!;
  await page.keyboard.down('Space'); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20); await page.mouse.up(); await page.keyboard.up('Space');
  await expect(canvas).not.toHaveAttribute('data-center-x', center!);
  await page.getByRole('button', { name: 'Вписать', exact: true }).click();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(page.locator('[data-entity-id]')).toHaveCount(0);
  await expect(page.getByLabel('Есть несохранённые изменения')).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click(); await expect(page.locator('[data-entity-type="point"]')).toHaveCount(4);
  expect(await page.locator('[data-entity-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-entity-id')))).toEqual(ids);
  await page.screenshot({ path: 'test-results/imported-survey.png' });
});

test('source X/Y can be swapped before import, preserving canonical Easting/Northing', async ({ page }) => {
  await newDocument(page); await preview(page, 'Name;X;Y;H\nP1;6189345.221;562341.234;152.34');
  await page.getByRole('combobox', { name: 'Столбец X', exact: true }).selectOption('northing');
  await expect(page.getByRole('button', { name: 'Импортировать', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Столбец Y', exact: true }).selectOption('easting');
  await importNow(page, 1); await selectP1(page);
  await expect(page.getByRole('textbox', { name: 'X', exact: true })).toHaveValue('562341.234');
  await expect(page.getByRole('textbox', { name: 'Y', exact: true })).toHaveValue('6189345.221');
  await expect(page.getByRole('textbox', { name: 'Z', exact: true })).toHaveValue('152.34');
});

test('Save JSON, New and Open preserve precise geometry, and dirty New requires confirmation', async ({ page }) => {
  await newDocument(page); await preview(page); await importNow(page);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Новый документ', exact: true }).click();
  await expect(page.locator('[data-entity-type="point"]')).toHaveCount(4);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить JSON', exact: true }).click();
  const download = await downloadPromise, path = (await download.path())!;
  const saved = JSON.parse(await readFile(path, 'utf8'));
  expect(saved.schemaVersion).toBe(2); expect(saved.entities).toHaveLength(4); expect(saved.selectionId).toBeUndefined();
  expect(Object.values(saved.vertices)[0]).toMatchObject({ x: 562341.234123456, y: 6189345.221234567 });
  await expect(page.getByLabel('Есть несохранённые изменения')).toHaveCount(0);
  await page.getByRole('button', { name: 'Новый документ', exact: true }).click();
  await expect(page.locator('[data-entity-id]')).toHaveCount(0);
  await page.getByLabel('Файл GeoDocument', { exact: true }).setInputFiles(path);
  await expect(page.locator('[data-entity-type="point"]')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeDisabled();
  await selectP1(page); await expect(page.getByRole('textbox', { name: 'X', exact: true })).toHaveValue('562341.234123456');
});

test('broken syntax and broken references leave the current drawing intact', async ({ page }) => {
  await page.goto('/'); const polygon = page.locator('[data-entity-id="boundary-01"] polygon');
  const points = await polygon.getAttribute('points');
  const current = await readAutosaveDocument(page);
  for (const text of ['{broken', JSON.stringify({ ...current, vertices: {} })]) {
    await page.getByLabel('Файл GeoDocument', { exact: true }).setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect(page.getByRole('alert')).toBeVisible(); await expect(polygon).toHaveAttribute('points', points!);
    await expect(page.locator('[data-entity-id]')).toHaveCount(13);
  }
  await expect(page.getByRole('alert')).toContainText('references missing vertex');
});

test('reload restores committed geometry; corrupt local data falls back with a notice and no console errors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await newDocument(page); await preview(page); await importNow(page);
  await expect.poll(async () => (await readAutosaveDocument(page)).entities.length).toBe(4);
  await page.reload(); await expect(page.locator('[data-entity-type="point"]')).toHaveCount(4);
  await expect(page.getByLabel('Есть несохранённые изменения')).toBeVisible();
  await selectP1(page); await expect(page.getByRole('textbox', { name: 'X', exact: true })).toHaveValue('562341.234123456');
  await corruptAutosaveRecord(page);
  await page.reload(); await expect(page.locator('[data-entity-id="boundary-01"]')).toBeVisible();
  await expect(page.getByTestId('persistence-status')).toHaveText('Автосохранение не выполнено');
  await expect(page.locator('.document-notice')).toContainText('повреждена'); expect(errors).toEqual([]);
});

test('CSV file with decimal commas exposes invalid rows and duplicate warnings before explicit partial import', async ({ page }) => {
  await newDocument(page); await page.getByRole('button', { name: 'Импорт координат', exact: true }).click();
  await page.getByLabel('Файл координат', { exact: true }).setInputFiles({ name: 'survey.csv', mimeType: 'text/csv', buffer: Buffer.from('Name;E;N;H\nP1;562341,234;6189345,221;152,340\nP1;562358,188;6189349,113;\nP3;abc;6189321,551;152,270') });
  await expect(page.getByTestId('import-counts')).toContainText('Ошибочных: 1');
  await expect(page.getByText(/Повторяющиеся имена:/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Импортировать (2)', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Импортировать только валидные строки' }).check();
  await importNow(page, 2); await expect(page.locator('.point-label')).toHaveText(['P1', 'P1']);
});
