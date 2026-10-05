import type { Bounds } from './index';
import type { WorldPoint } from '../domain/model';

export const SPATIAL_ANCHORS = ['north', 'south', 'east', 'west', 'north_east', 'north_west', 'south_east', 'south_west'] as const;
export type LayoutAnchor = 'center' | typeof SPATIAL_ANCHORS[number];
/** Metres in MODEL space. AUTO LAYOUT INSET is a sketch default, never a regulatory setback. */
export const AUTO_LAYOUT_INSET = Object.freeze({ fraction: 0.05, minimum: 0.5, maximum: 2 });
export type PlacementResult = { status: 'ready'; origin: WorldPoint; nominalInset: number; insetX: number; insetY: number }
  | { status: 'invalid'; message: string };
export function resolvePlacement(parent: Bounds, child: { width: number; height: number }, anchor: LayoutAnchor,
  options: { center?: WorldPoint } = {}): PlacementResult {
  const width = parent.maxX - parent.minX, height = parent.maxY - parent.minY;
  if (![parent.minX, parent.minY, parent.maxX, parent.maxY, child.width, child.height, width, height].every(Number.isFinite)
    || width <= 0 || height <= 0 || child.width <= 0 || child.height <= 0) return { status: 'invalid', message: 'Некорректные размеры для размещения' };
  if (child.width > width || child.height > height) return { status: 'invalid', message: `Объект ${child.width}×${child.height} м не помещается внутри участка ${width}×${height} м.` };
  const nominalInset = Math.min(AUTO_LAYOUT_INSET.maximum, Math.max(AUTO_LAYOUT_INSET.minimum, Math.min(width, height) * AUTO_LAYOUT_INSET.fraction));
  const horizontal = anchor.includes('east') || anchor.includes('west'), vertical = anchor.includes('north') || anchor.includes('south');
  // A physically fitting child keeps its size. Tight parents reduce the sketch inset explicitly.
  const insetX = horizontal ? Math.min(nominalInset, (width - child.width) / 2) : 0;
  const insetY = vertical ? Math.min(nominalInset, (height - child.height) / 2) : 0;
  const center = anchor === 'center' && options.center ? options.center : { x: parent.minX + width / 2, y: parent.minY + height / 2 };
  const origin = { x: anchor.includes('east') ? parent.maxX - insetX - child.width : anchor.includes('west') ? parent.minX + insetX : center.x - child.width / 2,
    y: anchor.includes('north') ? parent.maxY - insetY - child.height : anchor.includes('south') ? parent.minY + insetY : center.y - child.height / 2 };
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return { status: 'invalid', message: 'Размещение вне диапазона координат' };
  return { status: 'ready', origin, nominalInset, insetX, insetY };
}

/** Test the complete child perimeter, including notches between its corners. Boundary contact is allowed. */
export function rectangleInsidePolygon(rectangle: readonly WorldPoint[], polygon: readonly WorldPoint[]): boolean {
  return rectangle.length === 4 && pathInsidePolygon(rectangle, polygon, true);
}
/** Shared containment of complete line/path segments, including concave notches. */
export function pathInsidePolygon(rectangle: readonly WorldPoint[], polygon: readonly WorldPoint[], closed = false): boolean {
  if (polygon.length < 3 || rectangle.length < 2) return false;
  const cross = (a: WorldPoint, b: WorldPoint) => a.x * b.y - a.y * b.x;
  const sub = (a: WorldPoint, b: WorldPoint) => ({ x: a.x - b.x, y: a.y - b.y });
  const inside = (point: WorldPoint) => {
    let result = false;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!, v = sub(b, a), p = sub(point, a);
      if (Math.abs(cross(v, p)) <= 1e-9 * Math.max(1, Math.hypot(v.x, v.y)) && point.x >= Math.min(a.x, b.x) - 1e-9 && point.x <= Math.max(a.x, b.x) + 1e-9
        && point.y >= Math.min(a.y, b.y) - 1e-9 && point.y <= Math.max(a.y, b.y) + 1e-9) return true;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < a.x + (point.y - a.y) * (b.x - a.x) / (b.y - a.y)) result = !result;
    }
    return result;
  };
  if (!rectangle.every(inside)) return false;
  for (let i = 0; i < rectangle.length - (closed ? 0 : 1); i++) {
    const a = rectangle[i]!, b = rectangle[(i + 1) % rectangle.length]!, r = sub(b, a), cuts = [0, 1];
    for (let j = 0; j < polygon.length; j++) {
      const c = polygon[j]!, d = polygon[(j + 1) % polygon.length]!, s = sub(d, c), offset = sub(c, a), denominator = cross(r, s);
      if (denominator !== 0) {
        const t = cross(offset, s) / denominator, u = cross(offset, r) / denominator;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
      } else if (cross(offset, r) === 0) {
        for (const point of [c, d]) {
          const t = Math.abs(r.x) >= Math.abs(r.y) ? (point.x - a.x) / r.x : (point.y - a.y) / r.y;
          if (t > 0 && t < 1) cuts.push(t);
        }
      }
    }
    cuts.sort((x, y) => x - y);
    for (let j = 1; j < cuts.length; j++) {
      const t = (cuts[j - 1]! + cuts[j]!) / 2;
      if (!inside({ x: a.x + t * r.x, y: a.y + t * r.y })) return false;
    }
  }
  return true;
}
