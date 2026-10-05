import { expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { computeRigidTransform2D, modelToSurveyXY, surveyToModelXY } from '../src/geometry/georeferencing';

/** Opt-in CPU audit. No React, network, generated document fields, or pointer-driven bulk projection. */
test('on-demand rigid projection at 1k/10k/50k', () => {
  const transform = computeRigidTransform2D({ x: 0, y: 0 }, { x: 30, y: 0 }, { e: 500000, n: 6000000 }, { e: 500018, n: 6000024 }).transform!;
  const rows = [];
  for (const count of [1000, 10000, 50000]) {
    const points = Array.from({ length: count }, (_, i) => ({ x: i * 0.1234, y: -i * 0.07123 }));
    const before = JSON.stringify(points);
    let checksum = 0;
    const samples: number[] = [];
    for (let iteration = 0; iteration < 25; iteration++) {
      const started = performance.now();
      for (const point of points) { const survey = modelToSurveyXY(point, transform); checksum += survey.e + survey.n; }
      if (iteration >= 5) samples.push(performance.now() - started);
    }
    samples.sort((a,b) => a-b);
    const started = performance.now();
    for (let i = 0; i < 100000; i++) checksum += modelToSurveyXY(points[i % count]!, transform).e;
    const singleDemandMicroseconds = (performance.now() - started) * 1000 / 100000;
    const point = points.at(-1)!, restored = surveyToModelXY(modelToSurveyXY(point, transform), transform);
    expect(restored.x).toBeCloseTo(point.x, 7); expect(restored.y).toBeCloseTo(point.y, 7);
    expect(Number.isFinite(checksum)).toBe(true); expect(JSON.stringify(points)).toBe(before);
    rows.push({ count, bulkMedianMs: samples[Math.floor(samples.length / 2)], bulkP95Ms: samples[Math.ceil(samples.length * 0.95) - 1], singleDemandMicroseconds, precisionMaxXYError: Math.max(Math.abs(restored.x - point.x), Math.abs(restored.y - point.y)) });
  }
  const report = { timestamp: new Date().toISOString(), node: process.version, platform: process.platform, architecture: process.arch, iterations: 20, coordinates: 'E≈500000 N≈6000000; rotation atan2(24,18); scale1', notes: 'Synthetic CPU measurements; UI transforms only cursor/inspected point/two controls, not the whole registry on pointermove.', rows };
  writeFileSync('docs/audit-results/georeferencing.json', JSON.stringify(report, null, 2) + '\n');
  console.info(JSON.stringify(report, null, 2));
});
