import { test, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { createNewDocument } from '../src/domain/newDocument';
import { buildPointNameIndex, resolveCreateBoundaryIntent, resolveIntent } from '../src/ai/resolver';
import type { AiIntent } from '../src/ai/intent';
import type { GeoDocument } from '../src/domain/model';
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
function fixture(count: number): GeoDocument {
  const document = createNewDocument();
  for (let i = 0; i < count; i++) {
    const id = `v-${i}`, corner = [{ x: 562341.234123456, y: 6189345.221234567 }, { x: 562401.234123456, y: 6189345.221234567 },
      { x: 562401.234123456, y: 6189385.221234567 }, { x: 562341.234123456, y: 6189385.221234567 }][i];
    document.vertices[id] = { id, ...(corner ?? { x: 560000 + i, y: 6100000 + i }) };
    document.entities.push({ type: 'point', id: `p-${i}`, name: `P${i + 1}`, layerId: 'survey-points', vertexId: id });
  }
  return document;
}
test('AI names at 1k/10k/50k: index lifecycle and cached resolution (no timing assertions)', () => {
  const rows: unknown[] = [], intent: AiIntent = { type: 'create_boundary_from_named_points', pointNames: ['P1', 'P2', 'P3', 'P4'] };
  for (const points of [1000, 10000, 50000]) {
    const document = fixture(points); const builds: number[] = [], resolutions: number[] = [], uncached: number[] = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now(), index = buildPointNameIndex(document.entities), built = performance.now();
      const resolved = resolveCreateBoundaryIntent(intent, document, new Map(), { index }), end = performance.now();
      expect(resolved.status).toBe(points === 50000 ? 'invalid' : 'ready');
      const before = performance.now(); resolveCreateBoundaryIntent(intent, document); const after = performance.now();
      if (i >= 5) { builds.push(built - start); resolutions.push(end - built); uncached.push(after - before); }
    }
    rows.push({ points, buildIndexMedianMs: median(builds), cachedResolutionMedianMs: median(resolutions), uncachedResolutionMedianMs: median(uncached),
      result: points === 50000 ? 'capacity rejection after name/geometry resolution (50000 entity ceiling)' : 'ready' });
  }
  for (const points of [1000, 10000, 50000]) {
    const document = fixture(points), index = buildPointNameIndex(document.entities);
    for (const type of ['create_polyline_from_named_points', 'create_dimension_between_named_points', 'measure_between_named_points'] as const) {
      const intent: AiIntent = { type, pointNames: ['P1', 'P2'] }, values: number[] = [];
      for (let i = 0; i < 30; i++) {
        const start = performance.now(), result = resolveIntent(intent, document, new Map(), { index });
        if (i >= 5) values.push(performance.now() - start);
        expect(result.status).toBe(points === 50000 && type !== 'measure_between_named_points' ? 'invalid' : 'ready');
      }
      rows.push({ points, intent: type, cachedResolutionMedianMs: median(values) });
    }
  }
  const document = fixture(49999), index = buildPointNameIndex(document.entities), values: number[] = [];
  for (let i = 0; i < 30; i++) { const start = performance.now(); const result = resolveCreateBoundaryIntent(intent, document, new Map(), { index });
    if (i >= 5) values.push(performance.now() - start); expect(result.status).toBe('ready'); }
  rows.push({ points: 49999, cachedResolutionMedianMs: median(values), result: 'ready, one remaining slot for boundary' });
  const result = { node: process.version, machine: process.arch, date: new Date().toISOString(), namesPerRequest: 4, rows };
  writeFileSync('docs/audit-results/ai-resolution.json', JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
});
