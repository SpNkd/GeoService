import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function frame(page) {
  let timer;
  try { await Promise.race([page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Frame observation exceeded 60 seconds')), 60000); })]); }
  finally { clearTimeout(timer); }
}

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const report = { label: process.env.AUDIT_LABEL ?? 'after', engine: await browser.version(), sizes: [] };
try {
  for (const count of (process.env.AUDIT_SIZES ?? '1000,10000,50000').split(',').map(Number)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.audit = { serializations: 0, serializationMs: 0 };
      const stringify = JSON.stringify;
      JSON.stringify = function(value, ...args) {
        const start = performance.now(), result = stringify.call(JSON, value, ...args);
        if (value?.schemaVersion === 2 && value?.entities) { window.audit.serializations++; window.audit.serializationMs += performance.now() - start; }
        return result;
      };
    });
    await page.goto('http://127.0.0.1:5173');
    await page.getByTestId('drawing-canvas').waitFor();
    console.log(`Starting ${count} points`);
    const start = performance.now();
    await page.getByLabel('Файл GeoDocument', { exact: true }).setInputFiles(`/private/tmp/geoservice-profile-${count}.json`);
    await page.locator(`[data-entity-id="p${count - 1}"]`).waitFor({ timeout: 60000 });
    const mountMs = performance.now() - start; console.log(`Mounted ${count} in ${mountMs.toFixed(1)} ms`);
    const svgElements = await page.locator('svg.drawing-canvas *').count();
    if (process.env.AUDIT_MOUNT_ONLY === '1') {
      report.sizes.push({ count, mountMs, svgElements, errors });
      await writeFile(`/private/tmp/geoservice-audit-render-${report.label}.json`, JSON.stringify(report, null, 2));
      await page.close(); continue;
    }
    const c = await page.getByTestId('drawing-canvas').boundingBox();
    const samples = [];
    await page.evaluate(() => { window.audit.serializations = 0; window.audit.serializationMs = 0; });
    for (let i = 0; i < 8; i++) {
      const t = performance.now();
      await page.mouse.move(c.x + 100 + i * 17, c.y + 180 + i * 9);
      await frame(page);
      samples.push(performance.now() - t);
    }
    const hover = await page.evaluate(() => window.audit);
    await page.getByRole('button', { name: 'Привязки', exact: true }).click();
    const p = await page.locator('[data-entity-id="p0"] circle[r="14"]').boundingBox();
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2); await page.mouse.down();
    await page.evaluate(() => { window.audit.serializations = 0; window.audit.serializationMs = 0; });
    const dragStart = performance.now();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(p.x + p.width / 2 + i * 3, p.y + p.height / 2 - i * 2);
      await frame(page);
    }
    const dragMs = performance.now() - dragStart, drag = await page.evaluate(() => ({ ...window.audit }));
    await page.mouse.up();
    const commit = await page.evaluate(() => window.audit);
    samples.sort((a, b) => a - b);
    report.sizes.push({ count, mountMs, svgElements, hoverMedianMs: samples[4], hoverMaxMs: samples[7], hover, dragEightFramesMs: dragMs, drag, commit, errors });
    console.log(JSON.stringify(report.sizes.at(-1)));
    await writeFile(`/private/tmp/geoservice-audit-render-${report.label}.json`, JSON.stringify(report, null, 2));
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`/private/tmp/geoservice-audit-render-${report.label}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
