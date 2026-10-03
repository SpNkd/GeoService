import { describe, expect, it } from 'vitest';
import { bounds, distance, fitToBounds, gridStep, midpoint, panViewport, pathLength, polygonArea, screenToWorld, worldToScreen, zoomAt, MAX_ZOOM, MIN_ZOOM } from '../geometry';
import { formatCoordinate } from '../geometry/format';

describe('deterministic planar geometry', () => {
  it('computes planar distance independently of height', () => {
    expect(distance({ x: 0, y: 0, z: 20 }, { x: 3, y: 4, z: 100 })).toBe(5);
  });
  it('computes midpoints and interpolates Z only if both heights exist', () => {
    expect(midpoint({ x: 562000, y: 6189000, z: 152 }, { x: 562006, y: 6189004, z: 153 })).toEqual({ x: 562003, y: 6189002, z: 152.5 });
    expect(midpoint({ x: 0, y: 0 }, { x: 2, y: 4, z: 10 })).toEqual({ x: 1, y: 2 });
  });
  it('bounds empty, singleton and mixed coordinates', () => {
    expect(bounds([])).toBeNull();
    expect(bounds([{ x: 2, y: 3 }])).toEqual({ minX: 2, minY: 3, maxX: 2, maxY: 3 });
    expect(bounds([{ x: -8, y: 20 }, { x: 7, y: -4 }])).toEqual({ minX: -8, minY: -4, maxX: 7, maxY: 20 });
  });
  it('computes area in either winding, including large survey coordinates', () => {
    const vertices = [{ x: 562341.234, y: 6189345.221 }, { x: 562359.234, y: 6189345.221 }, { x: 562359.234, y: 6189357.221 }, { x: 562341.234, y: 6189357.221 }];
    expect(polygonArea(vertices)).toBeCloseTo(216, 8);
    expect(polygonArea([...vertices].reverse())).toBeCloseTo(216, 8);
    expect(polygonArea([])).toBe(0);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }, { x: 4, y: 2 }, { x: 0, y: 4 }])).toBe(24);
  });
  it('calculates open and closed lengths', () => {
    const p = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];
    expect(pathLength(p)).toBe(7); expect(pathLength(p, true)).toBe(12);
  });
  it('formats display values without changing model precision', () => {
    const p = { x: 152.340123456 };
    expect(formatCoordinate(p.x)).toBe('152.340'); expect(p.x).toBe(152.340123456);
  });
});

describe('world / screen transformations', () => {
  const size = { width: 1000, height: 700 };
  const view = { center: { x: 562341.234, y: 6189345.221 }, pixelsPerUnit: 11.7 };
  it('maps camera center to screen center and north upwards', () => {
    expect(worldToScreen(view.center, view, size)).toEqual({ x: 500, y: 350 });
    expect(worldToScreen({ ...view.center, y: view.center.y + 10 }, view, size).y).toBeCloseTo(233);
  });
  it('round trips large and negative coordinates at different zooms', () => {
    for (const scale of [0.01, 1, 11.7, 10000]) {
      for (const point of [{ x: 562341.234123, y: 6189345.221345 }, { x: -5.125, y: -9.875 }]) {
        const camera = { ...view, pixelsPerUnit: scale };
        const result = screenToWorld(worldToScreen(point, camera, size), camera, size);
        expect(result.x).toBeCloseTo(point.x, 8); expect(result.y).toBeCloseTo(point.y, 8);
      }
    }
  });
  it('keeps the world point under the cursor fixed while zooming', () => {
    const anchor = { x: 220, y: 120 };
    const fixed = screenToWorld(anchor, view, size);
    const next = zoomAt(view, size, anchor, 2.8);
    const result = screenToWorld(anchor, next, size);
    expect(result.x).toBeCloseTo(fixed.x, 8); expect(result.y).toBeCloseTo(fixed.y, 8);
    expect(next.pixelsPerUnit).toBeCloseTo(32.76);
  });
  it('pans in screen direction without mutating the view', () => {
    const next = panViewport(view, { x: 117, y: 234 });
    expect(next.center.x).toBeCloseTo(view.center.x - 10); expect(next.center.y).toBeCloseTo(view.center.y + 20);
    expect(view.center.x).toBe(562341.234);
  });
  it('fits large bounds with padding and handles empty / degenerate content', () => {
    const box = { minX: 562000, maxX: 562060, minY: 6189000, maxY: 6189040 };
    const fitted = fitToBounds(box, size, 70)!;
    const topLeft = worldToScreen({ x: box.minX, y: box.maxY }, fitted, size);
    expect(topLeft.x).toBeGreaterThanOrEqual(70); expect(topLeft.y).toBeGreaterThanOrEqual(70);
    expect(fitToBounds(null, size)).toBeNull();
    expect(fitToBounds(box, { width: 0, height: 0 })).toBeNull();
    expect(fitToBounds({ minX: 1, maxX: 1, minY: 2, maxY: 2 }, size)?.pixelsPerUnit).toBeGreaterThan(0);
  });
  it('bounds zoom and keeps grid readable over the supported range', () => {
    expect(zoomAt(view, size, { x: 0, y: 0 }, 1e20).pixelsPerUnit).toBe(MAX_ZOOM);
    expect(zoomAt(view, size, { x: 0, y: 0 }, 1e-20).pixelsPerUnit).toBe(MIN_ZOOM);
    for (const scale of [MIN_ZOOM, 0.5, 1, 10, 100, MAX_ZOOM]) {
      const pixels = gridStep(scale) * scale;
      expect(pixels).toBeGreaterThanOrEqual(64); expect(pixels).toBeLessThanOrEqual(160);
    }
  });
});
