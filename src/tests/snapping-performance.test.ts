import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { createNewDocument } from '../domain/newDocument';
import { createSnapProvider, DEFAULT_SNAP_OPTIONS, findSnapCandidate } from '../snapping';

it('queries a cached provider with 50,000 survey points and records a reproducible local estimate', () => {
  const document = createNewDocument();
  for (let i = 0; i < 50000; i++) {
    const id = `v-${i}`;
    document.vertices[id] = { id, x: 562000 + (i % 250) * 5, y: 6189000 + Math.floor(i / 250) * 5 };
    document.entities.push({ id: `p-${i}`, name: `P${i}`, type: 'point', layerId: 'survey-points', vertexId: id });
  }
  const start = performance.now(), provider = createSnapProvider(document), buildMs = performance.now() - start;
  const viewport = { center: { x: 562000, y: 6189000 }, pixelsPerUnit: 10 };
  const query = (i: number) => {
    const index = (i * 37) % 50000, vertex = document.vertices[`v-${index}`]!;
    return findSnapCandidate({ x: vertex.x + 0.2, y: vertex.y - 0.1 }, provider, viewport, DEFAULT_SNAP_OPTIONS);
  };
  for (let i = 0; i < 100; i++) query(i);
  const timings: number[] = []; let matched = 0;
  for (let i = 0; i < 1000; i++) {
    const before = performance.now(), result = query(i); timings.push(performance.now() - before);
    if (result?.sourceVertexId === `v-${(i * 37) % 50000}`) matched++;
  }
  timings.sort((a, b) => a - b);
  const report = { points: 50000, queries: 1000, warmup: 100, candidates: provider.candidates.length, buildMs,
    meanMs: timings.reduce((a, b) => a + b, 0) / timings.length, p50Ms: timings[500], p95Ms: timings[950],
    cpu: cpus()[0]?.model, node: process.version,
    scope: 'Pure cached linear snap query only; does not measure SVG rendering, history or persistence.' };
  mkdirSync('test-results', { recursive: true }); writeFileSync('test-results/snapping-benchmark.json', JSON.stringify(report, null, 2));
  expect(provider.candidates).toHaveLength(50000); expect(matched).toBe(1000);
});
