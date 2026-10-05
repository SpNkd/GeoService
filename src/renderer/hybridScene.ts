import type { Entity, GeoDocument, Viewport } from '../domain/model';
import { bounds, screenToWorld, type Bounds, type ViewSize } from '../geometry';
import { entityBoundsPoints } from '../geometry/entityBounds';
import type { RenderItem } from './selectors';

export type RendererMode = 'svg' | 'canvas';
export const MAX_CANVAS_STRATA = 8;
export function canvasEntity(e: Entity) {
  return e.source?.kind === 'dxf' && ['line', 'polyline', 'polygon', 'text', 'arc', 'circle', 'block_instance', 'imported_graphic'].includes(e.type);
}
export interface Stratum { kind: RendererMode; items: RenderItem[] }
/** Consecutive runs preserve both layer order and within-layer text priority. */
export function composeScene(items: RenderItem[], mode: RendererMode): { strata: Stratum[]; fallback: boolean } {
  const strata: Stratum[] = [];
  for (const item of items) {
    const kind = mode === 'canvas' && canvasEntity(item.entity) ? 'canvas' : 'svg';
    const last = strata.at(-1);
    if (last?.kind === kind) last.items.push(item); else strata.push({ kind, items: [item] });
  }
  const fallback = strata.filter(s => s.kind === 'canvas').length > MAX_CANVAS_STRATA;
  return { strata: fallback ? [{ kind: 'svg', items }] : strata, fallback };
}
export function viewportBounds(view: Viewport, size: ViewSize, paddingPx = 12): Bounds {
  const a = screenToWorld({ x: -paddingPx, y: -paddingPx }, view, size);
  const b = screenToWorld({ x: size.width + paddingPx, y: size.height + paddingPx }, view, size);
  return { minX: a.x, maxX: b.x, minY: b.y, maxY: a.y };
}
export const intersects = (a: Bounds, b: Bounds) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
const boxes = new WeakMap<GeoDocument, WeakMap<Entity, Bounds | null>>();
export function ownerBounds(document: GeoDocument, entity: Entity) {
  let cache = boxes.get(document);
  if (!cache) { cache = new WeakMap(); boxes.set(document, cache); }
  if (cache.has(entity)) return cache.get(entity)!;
  const box = bounds(entityBoundsPoints(document, entity)); cache.set(entity, box); return box;
}
