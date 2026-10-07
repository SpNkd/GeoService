import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const external = [], ai = [], errors = [];
page.on('request', r => { if (/^https?:/.test(r.url()) && new URL(r.url()).hostname !== '127.0.0.1') external.push(r.url()); if (r.url().includes('/api/ai/intent')) ai.push(r.url()); });
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:5173/');
  const sizes = [[1920, 1080], [3840, 2160], [7680, 4320]], measurements = [];
  for (const [width, height] of sizes) for (let repeat = 0; repeat < 3; repeat++) {
    const result = await page.evaluate(async ({ width, height }) => {
      const { prepareImage, processImage } = await import('/src/image/client.ts'), { fullQuad } = await import('/src/image/transform.ts'), { DEFAULT_EXTRACTION } = await import('/src/image/types.ts');
      const { vectorizationCommands } = await import('/src/image/apply.ts'), { applyCommand, applyCommandsAtomically } = await import('/src/domain/commands.ts'), { createNewDocument } = await import('/src/domain/newDocument.ts');
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, width, height); ctx.strokeStyle = '#202020'; ctx.lineWidth = width / 480 * 3;
      ctx.strokeRect(width * .1, height * .15, width * .35, height * .45); ctx.beginPath(); ctx.moveTo(width * .55, height * .18); ctx.lineTo(width * .86, height * .18); ctx.moveTo(width * .12, height * .8); ctx.lineTo(width * .38, height * .8); ctx.lineTo(width * .38, height * .93); ctx.stroke(); ctx.beginPath(); ctx.arc(width * .72, height * .7, height * .12, 0, Math.PI * 2); ctx.stroke();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); canvas.width = canvas.height = 0;
      const longTasks = []; const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({ duration: e.duration, start: e.startTime })))); observer.observe({ type: 'longtask' });
      const start = performance.now(), bitmap = await createImageBitmap(blob), decode = performance.now() - start, preparationStart = performance.now(), source = prepareImage(bitmap), preparation = performance.now() - preparationStart;
      const calibration = { quad: fullQuad(width, height), rectifiedWidth: width, rectifiedHeight: height }, workerStart = performance.now();
      const result = await processImage(source, { width, height }, calibration, DEFAULT_EXTRACTION, new AbortController().signal), workerWall = performance.now() - workerStart;
      const previewStart = performance.now(), preview = document.createElement('canvas'); preview.width = result.image.width; preview.height = result.image.height; preview.getContext('2d').putImageData(new ImageData(result.image.data, result.image.width, result.image.height), 0, 0);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.style.width = '600px'; svg.style.height = '400px';
      for (const candidate of result.result.candidates) { const e = document.createElementNS(svg.namespaceURI, candidate.type === 'circle' ? 'circle' : 'polyline'); if ('points' in candidate) e.setAttribute('points', candidate.points.map(p => `${p.x},${p.y}`).join(' ')); if (candidate.type === 'circle') { e.setAttribute('cx', candidate.center.x); e.setAttribute('cy', candidate.center.y); e.setAttribute('r', candidate.radius); } e.setAttribute('fill', 'none'); e.setAttribute('stroke', '#1f73b7'); svg.append(e); }
      document.body.append(svg); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); const previewPaint = performance.now() - previewStart;
      const base = createNewDocument(), underlay = { id: 'benchmark-image', name: 'Synthetic plan', type: 'raster_underlay', assetId: 'benchmark-local', layerId: base.layers[0].id, position: { x: 0, y: 0 }, width: width * .01, height: height * .01, rotationDeg: 0, opacity: .6, locked: false }, documentBefore = applyCommand(base, { type: 'add-entity', entity: underlay, vertices: [] }), original = documentBefore.entities[0];
      const applyStart = performance.now(), commands = vectorizationCommands(documentBefore, original, original, calibration, result.result.candidates, new Set(result.result.candidates.map(c => c.id)), '__new', 'benchmark'), applied = applyCommandsAtomically(documentBefore, commands), apply = performance.now() - applyStart;
      await new Promise(resolve => setTimeout(resolve, 60)); observer.disconnect(); svg.remove(); preview.width = preview.height = 0; bitmap.close();
      return { width, height, decode, preparation, workerWall, ...result.result.timings, previewPaint, apply, counts: result.result.candidates.reduce((map, c) => { map[c.type] = (map[c.type] || 0) + 1; return map; }, {}), entities: applied.entities.length - 1, analysis: { width: source.width, height: source.height }, longTasks: longTasks.filter(t => t.start >= start), memory: { originalBitmapRGBA: width * height * 4, boundedBufferRGBA: source.width * source.height * 4, jsHeapUsed: performance.memory?.usedJSHeapSize ?? null } };
    }, { width, height });
    measurements.push(result);
  }
  const fixtures = await page.evaluate(async () => { const { imagePlan, skewedCorners } = await import('/src/tests/fixtures/imagePlan.ts'), { extractGeometry } = await import('/src/image/extract.ts'), { rectifyImage } = await import('/src/image/transform.ts'), { DEFAULT_EXTRACTION } = await import('/src/image/types.ts'); return ['clean', 'rotated', 'skewed', 'noisy', 'circle', 'text'].map(kind => { const source = imagePlan(kind), image = kind === 'skewed' ? rectifyImage(source, skewedCorners, 480, 320) : source, candidates = extractGeometry(image, DEFAULT_EXTRACTION).candidates; return { kind, counts: candidates.reduce((map, c) => { map[c.type] = (map[c.type] || 0) + 1; return map; }, {}) }; }); });
  const report = { date: new Date().toISOString(), method: 'Three sequential fresh image decodes per size; bounded local Worker; synthetic strokes only. No remote provider.', measurements, fixtures, external, ai, errors };
  await writeFile('docs/audit-results/image-vectorization-performance.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (external.length || ai.length || errors.length) throw new Error('Privacy or browser error verification failed.');
} finally { await browser.close(); }
