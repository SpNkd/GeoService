import { entityVertexIds, getVertex, vertexPoint, type GeoDocument, type Viewport, type WorldPoint } from '../domain/model';
import { gridStep, midpoint } from '../geometry';

export interface SnapOptions { enabled: boolean; vertex: boolean; midpoint: boolean; grid: boolean; tolerancePx: number }
export const DEFAULT_SNAP_OPTIONS: SnapOptions = { enabled: true, vertex: true, midpoint: true, grid: false, tolerancePx: 10 };
export interface SnapResult {
  type: 'vertex' | 'midpoint' | 'grid'; worldPosition: WorldPoint; sourceEntityId?: string; sourceVertexId?: string;
  distanceScreenPx: number; metadata: { label: string; key: string; vertexIds: string[] };
}
export type SnapCandidate = Omit<SnapResult, 'distanceScreenPx'>;
/** Replaceable candidate-provider boundary; current implementation is cached linear search. */
export interface SnapProvider { query(cursor: WorldPoint, toleranceWorld: number): Iterable<SnapCandidate> }
export function createSnapProvider(document: GeoDocument): SnapProvider & { candidates: readonly SnapCandidate[] } {
  const visible = new Set(document.layers.filter(layer => layer.visible).map(layer => layer.id));
  const entities = document.entities.filter(entity => visible.has(entity.layerId) && entity.type !== 'text');
  const seen = new Set<string>(), candidates: SnapCandidate[] = [];
  // Prefer a point's readable name when a vertex also belongs to a boundary/line.
  for (const entity of [...entities.filter(entity => entity.type === 'point'), ...entities.filter(entity => entity.type !== 'point')]) {
    const ids = entityVertexIds(entity);
    for (const id of ids) if (!seen.has(id)) {
      seen.add(id); candidates.push({ type: 'vertex', worldPosition: vertexPoint(getVertex(document.vertices, id)), sourceEntityId: entity.id,
        sourceVertexId: id, metadata: { label: `Endpoint ${entity.name}`, key: id, vertexIds: [id] } });
    }
    if (entity.type === 'point' || entity.type === 'dimension') continue;
    const count = entity.type === 'polygon' ? ids.length : ids.length - 1;
    for (let i = 0; i < count; i++) {
      const start = ids[i]!, end = ids[(i + 1) % ids.length]!;
      const position = midpoint(getVertex(document.vertices, start), getVertex(document.vertices, end));
      candidates.push({ type: 'midpoint', worldPosition: { x: position.x, y: position.y },
        sourceEntityId: entity.id, metadata: { label: `Midpoint · ${entity.name}`, key: `${entity.id}:${i}`, vertexIds: [start, end] } });
    }
  }
  // A future spatial index can return only candidates inside the supplied search bounds.
  return { candidates, query: () => candidates };
}
export function findSnapCandidate(cursor: WorldPoint, provider: SnapProvider, viewport: Viewport, options: SnapOptions, excludeVertexId?: string): SnapResult | null {
  if (!options.enabled) return null;
  const toleranceWorld = options.tolerancePx / viewport.pixelsPerUnit;
  let best: SnapResult | null = null;
  const priority = { vertex: 0, midpoint: 1, grid: 2 };
  const consider = (candidate: SnapCandidate) => {
    if (excludeVertexId && candidate.metadata.vertexIds.includes(excludeVertexId)) return;
    if (!options[candidate.type]) return;
    const dx = Math.abs(candidate.worldPosition.x - cursor.x), dy = Math.abs(candidate.worldPosition.y - cursor.y);
    if (dx > toleranceWorld || dy > toleranceWorld) return;
    const px = Math.hypot(dx, dy) * viewport.pixelsPerUnit;
    if (px > options.tolerancePx) return;
    if (!best || priority[candidate.type] < priority[best.type] || (priority[candidate.type] === priority[best.type]
      && (px < best.distanceScreenPx || (px === best.distanceScreenPx && candidate.metadata.key < best.metadata.key)))) best = { ...candidate, distanceScreenPx: px };
  };
  for (const candidate of provider.query(cursor, toleranceWorld)) consider(candidate);
  if (options.grid) {
    const step = gridStep(viewport.pixelsPerUnit);
    const position = { x: Math.round(cursor.x / step) * step, y: Math.round(cursor.y / step) * step };
    consider({ type: 'grid', worldPosition: position, metadata: { label: `Grid · ${step} м`, key: 'grid', vertexIds: [] } });
  }
  return best;
}
