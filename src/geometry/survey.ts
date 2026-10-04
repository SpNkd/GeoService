import type { WorldPoint } from '../domain/model';
import { distance, midpoint } from './index';

export const distance2D = distance;
export function delta(a: WorldPoint, b: WorldPoint): WorldPoint {
  return { x: b.x - a.x, y: b.y - a.y, ...(a.z !== undefined && b.z !== undefined ? { z: b.z - a.z } : {}) };
}
export function distance3D(a: WorldPoint, b: WorldPoint): number | null {
  const d = delta(a, b);
  return d.z === undefined ? null : Math.hypot(d.x, d.y, d.z);
}
/** Geodetic azimuth: North clockwise; a coincident XY pair has no direction. */
export function azimuth(a: WorldPoint, b: WorldPoint): number | null {
  const d = delta(a, b);
  return d.x === 0 && d.y === 0 ? null : (Math.atan2(d.x, d.y) * 180 / Math.PI + 360) % 360;
}
export function measurePair(a: WorldPoint, b: WorldPoint) {
  return { horizontal: distance(a, b), delta: delta(a, b), spatial: distance3D(a, b), azimuth: azimuth(a, b) };
}
export function dimensionOffset(a: WorldPoint, b: WorldPoint, cursor: WorldPoint): number {
  const length = distance(a, b);
  return length === 0 ? 0 : ((cursor.x - a.x) * -(b.y - a.y) + (cursor.y - a.y) * (b.x - a.x)) / length;
}
export function alignedDimension(a: WorldPoint, b: WorldPoint, offset: number) {
  const length = distance(a, b), nx = length ? -(b.y - a.y) / length : 0, ny = length ? (b.x - a.x) / length : 1;
  const start = { x: a.x + nx * offset, y: a.y + ny * offset };
  const end = { x: b.x + nx * offset, y: b.y + ny * offset };
  return { start, end, label: midpoint(start, end), length };
}

const cross = (a: WorldPoint, b: WorldPoint) => a.x * b.y - a.y * b.x;
/** Segment-only intersection; collinear/parallel cases have no unique crossing point. */
export function segmentIntersection(a: WorldPoint, b: WorldPoint, c: WorldPoint, d: WorldPoint): WorldPoint | null {
  const ab = delta(a, b), cd = delta(c, d), ac = delta(a, c);
  const denominator = cross(ab, cd);
  const epsilon = Number.EPSILON * 16 * Math.max(1, Math.abs(ab.x * cd.y), Math.abs(ab.y * cd.x));
  if (Math.abs(denominator) <= epsilon) return null;
  const t = cross(ac, cd) / denominator, u = cross(ac, ab) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * ab.x, y: a.y + t * ab.y };
}
function onSegment(a: WorldPoint, b: WorldPoint, p: WorldPoint): boolean {
  const ab = delta(a, b), ap = delta(a, p);
  const epsilon = Number.EPSILON * 16 * Math.max(1, Math.abs(ab.x * ap.y), Math.abs(ab.y * ap.x));
  return Math.abs(cross(ab, ap)) <= epsilon && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
    && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
}
export function polygonSelfIntersects(points: readonly WorldPoint[]): boolean {
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
    const a = points[i]!, b = points[(i + 1) % points.length]!, c = points[j]!, d = points[(j + 1) % points.length]!;
    if (segmentIntersection(a, b, c, d) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return true;
  }
  return false;
}
