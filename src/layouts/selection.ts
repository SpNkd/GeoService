import { navigationViewport, type ViewportNavigation } from './camera';
import { bounds } from '../geometry';
import type { Entity, GeoDocument, ImportedGraphicEntity } from '../domain/model';
import { entityBoundsPoints } from '../geometry/entityBounds';
import { renderItems } from '../renderer/selectors';
import { primitivePresentationPoints, visitEntityPrimitives } from '../view/geometry';
import type { DxfLayout, DxfViewport } from './types';
import { viewportDocument } from './context';
export type SelectionScope = {
    kind: 'model-all' | 'model-visible' | 'current-view';
} | {
    kind: 'paper-visible' | 'paper-entities';
    layoutId: string;
} | {
    kind: 'viewport-visible';
    layoutId: string;
    viewportId: string;
};
export const paperEntityId = (layout: DxfLayout, index: number) => `${layout.id}-paper-${index}`;
const papers = new WeakMap<GeoDocument, Map<string, GeoDocument>>();
export function paperDocument(document: GeoDocument, layout: DxfLayout) {
    let cache = papers.get(document);
    if (!cache) {
        cache = new Map();
        papers.set(document, cache);
    }
    const hit = cache.get(layout.id);
    if (hit)
        return hit;
    const result = { ...document, entities: layout.paperPrimitives.map((p, i): ImportedGraphicEntity => ({ id: paperEntityId(layout, i), type: 'imported_graphic', name: p.kind === 'text' ? p.content : 'Paper Space', layerId: p.layerId, position: { x: 0, y: 0 }, primitives: [p], ...(p.source ? { source: p.source } : {}) })) };
    cache.set(layout.id, result);
    return result;
}
export function viewportPoint(vp: DxfViewport, p: {
    x: number;
    y: number;
}) { const a = vp.twist * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), x = p.x - vp.modelCenter.x, y = p.y - vp.modelCenter.y; return { x: x * c - y * s, y: x * s + y * c }; }
function segmentBox(a: {
    x: number;
    y: number;
}, b: {
    x: number;
    y: number;
}, w: number, h: number) { let lo = 0, hi = 1; for (const [o, d, m] of [[a.x, b.x - a.x, w], [a.y, b.y - a.y, h]]) {
    if (d === 0) {
        if (Math.abs(o!) > m!)
            return false;
    }
    else {
        const x = (-m! - o!) / d!, y = (m! - o!) / d!;
        lo = Math.max(lo, Math.min(x, y));
        hi = Math.min(hi, Math.max(x, y));
        if (lo > hi)
            return false;
    }
} return true; }
export function entityIntersectsViewport(document: GeoDocument, entity: Entity, vp: DxfViewport) {
    if (vp.unsupportedReason)
        return false;
    const w = vp.viewHeight * vp.sizePaper.width / vp.sizePaper.height / 2, h = vp.viewHeight / 2, inside = (p: {
        x: number;
        y: number;
    }) => Math.abs(p.x) <= w && Math.abs(p.y) <= h;
    const broad = entityBoundsPoints(document, entity).map(p => viewportPoint(vp, p));
    if (!broad.length || Math.min(...broad.map(p => p.x)) > w || Math.max(...broad.map(p => p.x)) < -w || Math.min(...broad.map(p => p.y)) > h || Math.max(...broad.map(p => p.y)) < -h)
        return false;
    let hit = false, visited = false, budget = 0;
    visitEntityPrimitives(document, entity, { stroke: '#000', lineWeight: 1, dash: undefined }, part => { if (hit || budget > 200000)
        return; visited = true; const points = primitivePresentationPoints(part, Math.max(1, vp.scale)).map(p => viewportPoint(vp, p)); budget += points.length; if (points.some(inside)) {
        hit = true;
        return;
    } const closed = part.primitive.kind === 'circle' || part.primitive.kind === 'text' || part.primitive.kind === 'path' && part.primitive.closed; for (let i = 0; i < points.length - (closed ? 0 : 1); i++)
        if (segmentBox(points[i]!, points[(i + 1) % points.length]!, w, h)) {
            hit = true;
            return;
        } if (closed) {
        let contains = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const a = points[i]!, b = points[j]!;
            if ((a.y > 0) !== (b.y > 0) && 0 < (b.x - a.x) * (-a.y) / (b.y - a.y) + a.x)
                contains = !contains;
        }
        hit = contains;
    } });
    return visited ? hit : broad.some(inside) || broad.some((p, i) => segmentBox(p, broad[(i + 1) % broad.length]!, w, h));
}
const visibleCache = new WeakMap<GeoDocument, WeakMap<DxfViewport, ReadonlySet<string>>>();
export function viewportVisibleIds(document: GeoDocument, vp: DxfViewport): ReadonlySet<string> { let cache = visibleCache.get(document); if (!cache) {
    cache = new WeakMap();
    visibleCache.set(document, cache);
} const hit = cache.get(vp); if (hit)
    return hit; const view = viewportDocument(document, vp), result = new Set(renderItems(view).filter(i => entityIntersectsViewport(view, i.entity, vp)).map(i => i.entity.id)); cache.set(vp, result); return result; }
export function resolveSelectionScope(document: GeoDocument, scope: SelectionScope, context: {
    layoutId: string | null;
    dxfViewportId: string | null;
    viewportEditing?: boolean;
    viewportNavigation?: ViewportNavigation | null;
    isolation?: {
        entityIds: readonly string[];
        layerIds?: readonly string[];
    } | null;
}) {
    if (scope.kind === 'current-view')
        scope = context.layoutId ? (context.viewportEditing && context.dxfViewportId ? { kind: 'viewport-visible', layoutId: context.layoutId, viewportId: context.dxfViewportId } : { kind: 'paper-visible', layoutId: context.layoutId }) : { kind: 'model-visible' };
    const modelIds = new Set<string>(), paperIds = new Set<string>();
    if (scope.kind === 'model-all' || scope.kind === 'model-visible') {
        for (const e of scope.kind === 'model-all' ? document.entities : renderItems(document).map(i => i.entity))
            modelIds.add(e.id);
    }
    else if ('layoutId' in scope) {
        const layout = document.dxfLayouts?.find(l => l.id === scope.layoutId);
        if (layout) {
            if (scope.kind !== 'viewport-visible')
                for (const item of renderItems(paperDocument(document, layout)))
                    if (!context.isolation || context.isolation.layerIds?.includes(item.layer.id) || context.isolation.entityIds.includes(item.entity.id))
                        paperIds.add(item.entity.id);
            if (scope.kind !== 'paper-entities')
                for (const vp of layout.viewports)
                    if (scope.kind !== 'viewport-visible' || vp.id === scope.viewportId)
                        for (const id of viewportVisibleIds(document, navigationViewport(vp, context)))
                            modelIds.add(id);
        }
    }
    return { modelIds: [...modelIds], paperIds: [...paperIds], label: scope.kind };
}
/** Presentation-only bounds: project selected MODEL owners through supported source clips. */
export function selectionPaperBounds(document: GeoDocument, layout: DxfLayout, ids: readonly string[], viewportId?: string) { const selected = new Set(ids), points: {
    x: number;
    y: number;
}[] = []; const paper = paperDocument(document, layout); for (const e of paper.entities)
    if (selected.has(e.id))
        points.push(...entityBoundsPoints(paper, e)); for (const vp of layout.viewports) {
    if (viewportId && vp.id !== viewportId || vp.unsupportedReason)
        continue;
    const visible = viewportVisibleIds(document, vp);
    for (const e of document.entities)
        if (selected.has(e.id) && visible.has(e.id)) {
            const ps = entityBoundsPoints(document, e).map(p => viewportPoint(vp, p)), w = vp.viewHeight * vp.sizePaper.width / vp.sizePaper.height / 2, h = vp.viewHeight / 2;
            const x = Math.max(-w, Math.min(...ps.map(p => p.x))), X = Math.min(w, Math.max(...ps.map(p => p.x))), y = Math.max(-h, Math.min(...ps.map(p => p.y))), Y = Math.min(h, Math.max(...ps.map(p => p.y)));
            points.push({ x: vp.centerPaper.x + x * vp.scale, y: vp.centerPaper.y + y * vp.scale }, { x: vp.centerPaper.x + X * vp.scale, y: vp.centerPaper.y + Y * vp.scale });
        }
} return bounds(points); }
