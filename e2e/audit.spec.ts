import { test, expect } from '@playwright/test';
import { readAutosaveDocument } from './helpers/autosave';
import { createSampleDocument } from '../src/sample/document';

test('drag updates shared geometry without serializing drafts or writing autosave until commit', async ({ page }) => {
  await page.addInitScript(() => {
    const stringify = JSON.stringify;
    const audit = { calls: 0 };
    Object.defineProperty(window, 'serializationAudit', { value: audit });
    JSON.stringify = function(value, ...args) {
      if (value?.schemaVersion === 2 && value?.entities) audit.calls++;
      return Reflect.apply(stringify, JSON, [value, ...args]);
    };
  });
  await page.goto('/');
  await expect(page.locator('[data-entity-id="p1"]')).toBeVisible();
  await expect(page.getByTestId('persistence-status')).toHaveText('Сохранено локально');
  await page.getByRole('button', { name: 'Привязки', exact: true }).click();
  const point = await page.locator('[data-entity-id="p1"] circle[r="14"]').boundingBox();
  const before = await page.locator('[data-entity-id="boundary-01"] polygon').getAttribute('points');
  await page.mouse.move(point!.x + 14, point!.y + 14); await page.mouse.down();
  const count = () => page.evaluate(() => Reflect.get(window, 'serializationAudit').calls as number);
  const baseline = await count();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(point!.x + 14 + i * 4, point!.y + 14 - i * 3);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
  await expect(page.locator('[data-entity-id="boundary-01"] polygon')).not.toHaveAttribute('points', before!);
  expect(await count()).toBe(baseline);
  expect(await readAutosaveDocument(page).then(document => document.vertices['v-p1']!.x)).toBe(1000);
  await expect(page.getByLabel('Есть несохранённые изменения')).toBeVisible();
  await page.mouse.up();
  // Worker validates/encodes committed autosave; the editor thread must not stringify the full document.
  expect(await count()).toBe(baseline);
  await expect.poll(() => readAutosaveDocument(page).then(document => document.vertices['v-p1']!.x)).not.toBe(1000);
  expect(await count()).toBe(baseline);
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-entity-id="boundary-01"] polygon')).toHaveAttribute('points', before!);
  await expect(page.getByLabel('Есть несохранённые изменения')).toHaveCount(0);
});

test('JSON paint URLs are rejected before any external request and preserve the current drawing', async ({ page }) => {
  const requests: string[] = [];
  await page.route('https://audit.invalid/**', route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto('/');
  await expect(page.locator('[data-entity-id="p1"]')).toBeVisible();
  const doc = createSampleDocument(); doc.styles[0]!.stroke = 'url(https://audit.invalid/image)';
  await page.getByLabel('Файл GeoDocument', { exact: true }).setInputFiles({ name: 'hostile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  await expect(page.getByRole('alert')).toContainText('styles.0.stroke');
  await expect(page.locator('[data-entity-id="p1"]')).toBeVisible();
  expect(requests).toEqual([]);
});

test('selected boundary handles reflect locks on other shared consumers and return after unlock', async ({ page }) => {
  await page.goto('/');
  const canvas = page.getByTestId('drawing-canvas');
  await expect(canvas).toHaveAttribute('data-zoom', /^(?!10$).+/);
  const box = (await canvas.boundingBox())!;
  const coordinates = (await page.locator('[data-entity-id="boundary-01"] polygon').getAttribute('points'))!;
  const [a, b] = coordinates.split(' ').slice(0, 2).map(pair => pair.split(',').map(Number));
  await page.mouse.click(box.x + (a![0]! + b![0]!) / 2, box.y + (a![1]! + b![1]!) / 2);
  await expect(page.getByTestId('selected-id')).toHaveText('boundary-01');
  const handles = page.locator('[data-entity-id="boundary-01"] [data-vertex-handle]');
  await expect(handles).toHaveCount(4);
  await page.getByRole('button', { name: 'Заблокировать слой Геодезические точки', exact: true }).click();
  await expect(handles).toHaveCount(0);
  await page.getByRole('button', { name: 'Разблокировать слой Геодезические точки', exact: true }).click();
  await expect(handles).toHaveCount(4);
});
