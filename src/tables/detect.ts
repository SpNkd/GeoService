import type { GeoDocument } from '../domain/model';
import type { VectorPrimitive } from '../vectors/types';
import { bounds, type Bounds } from '../geometry';
export interface TableCandidate {
    id: string;
    context: 'Model' | 'Paper Space' | 'Block definition';
    layoutId?: string;
    ownerIds: string[];
    sourcePath: string[];
    layerIds: string[];
    handles: string[];
    box: Bounds;
    rotationDeg: number;
    rows: string[][];
    cellHandles: string[][];
    columns: number;
    confidence: 'STRONG' | 'WEAK';
    title: string;
    explication: {
        number: string;
        name: string;
    }[];
    instantiated: boolean;
}
const cache = new WeakMap<GeoDocument, TableCandidate[]>();
// Layer presentation changes preserve geometry and table text; reuse the derived index.
const geometryCache = new WeakMap<GeoDocument['entities'], { vertices: GeoDocument['vertices']; blocks: GeoDocument['blocks']; layouts: GeoDocument['dxfLayouts']; layerNames: string; candidates: TableCandidate[] }>();
type Grid = Pick<TableCandidate, 'rows' | 'cellHandles' | 'columns' | 'rotationDeg' | 'box' | 'confidence' | 'title' | 'layerIds' | 'handles'>;
const detected = new WeakMap<VectorPrimitive[], Grid | null>();
const MAX_PRIMITIVES = 12000, MAX_CELLS = 4096;
/** Bounded exploded-grid detector. Text is assigned only by geometric cell containment. */
export function detectGrid(primitives: VectorPrimitive[]): Grid | null {
    const cached = detected.get(primitives);
    if (cached !== undefined)
        return cached;
    if (primitives.length > MAX_PRIMITIVES) {
        detected.set(primitives, null);
        return null;
    }
    const lines: {
        a: {
            x: number;
            y: number;
        };
        b: {
            x: number;
            y: number;
        };
    }[] = [], texts: Extract<VectorPrimitive, {
        kind: 'text';
    }>[] = [];
    for (const p of primitives) {
        if (p.kind === 'text')
            texts.push(p);
        else if (p.kind === 'path')
            for (let i = 1; i < p.points.length; i++) {
                if (lines.length >= MAX_PRIMITIVES) {
                    detected.set(primitives, null);
                    return null;
                }
                lines.push({ a: p.points[i - 1]!, b: p.points[i]! });
            }
    }
    if (lines.length < 5 || texts.length < 4) {
        detected.set(primitives, null);
        return null;
    }
    const longest = lines.reduce((a, b) => Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y) > Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) ? a : b), rotation = ((Math.atan2(longest.b.y - longest.a.y, longest.b.x - longest.a.x) + Math.PI / 4 + Math.PI * 2) % (Math.PI / 2)) - Math.PI / 4, origin = longest.a, c = Math.cos(rotation), s = Math.sin(rotation), local = (p: {
        x: number;
        y: number;
    }) => ({ x: (p.x - origin.x) * c + (p.y - origin.y) * s, y: -(p.x - origin.x) * s + (p.y - origin.y) * c });
    const segments = lines.map(l => ({ a: local(l.a), b: local(l.b) })), box = bounds(segments.flatMap(l => [l.a, l.b]))!, tol = Math.max(1e-6, Math.max(box.maxX - box.minX, box.maxY - box.minY) * 1e-6), hs = segments.filter(l => Math.abs(l.a.y - l.b.y) < tol && Math.abs(l.a.x - l.b.x) > tol * 10), vs = segments.filter(l => Math.abs(l.a.x - l.b.x) < tol && Math.abs(l.a.y - l.b.y) > tol * 10);
    const unique = (values: number[]) => values.sort((a, b) => a - b).filter((x, i, a) => !i || x - a[i - 1]! > tol), xs = unique(vs.map(l => l.a.x)), ys = unique(hs.map(l => l.a.y)).reverse();
    if (xs.length < 3 || ys.length < 3 || (xs.length - 1) * (ys.length - 1) > MAX_CELLS) {
        detected.set(primitives, null);
        return null;
    }
    const rows = ys.slice(1).map(() => xs.slice(1).map(() => '')), handles = rows.map(row => row.map(() => ''));
    let assigned = 0;
    for (const t of texts) {
        const p = local(t.position), col = xs.findIndex((x, i) => i < xs.length - 1 && p.x >= x - tol && p.x < xs[i + 1]! + tol), row = ys.findIndex((y, i) => i < ys.length - 1 && p.y <= y + tol && p.y > ys[i + 1]! - tol);
        if (row < 0 || col < 0)
            continue;
        rows[row]![col] += (rows[row]![col] ? '\n' : '') + t.content;
        handles[row]![col] += (handles[row]![col] ? ' / ' : '') + (t.source?.handle ?? '');
        assigned++;
    }
    if (assigned < 4) {
        detected.set(primitives, null);
        return null;
    }
    const result = { rows, cellHandles: handles, columns: xs.length - 1, rotationDeg: rotation * 180 / Math.PI, box: bounds(lines.flatMap(l => [l.a, l.b]))!, confidence: (hs.length >= 4 && vs.length >= 3 && assigned >= 6 ? 'STRONG' : 'WEAK') as 'STRONG' | 'WEAK', title: texts.map(t => t.content).find(t => /экспликац|ведомост|наименован/i.test(t)) ?? 'Табличная сетка', layerIds: [...new Set(primitives.map(p => p.layerId))], handles: texts.flatMap(t => t.source?.handle ? [t.source.handle] : []) };
    detected.set(primitives, result);
    return result;
}
export function documentTables(document: GeoDocument): TableCandidate[] {
    const cached = cache.get(document);
    if (cached)
        return cached;
    const layerNames = JSON.stringify(document.layers.map(l => [l.id, l.name]));
    const geometry = geometryCache.get(document.entities);
    if (geometry && geometry.vertices === document.vertices && geometry.blocks === document.blocks && geometry.layouts === document.dxfLayouts && geometry.layerNames === layerNames) {
        cache.set(document, geometry.candidates);
        return geometry.candidates;
    }
    const candidates: TableCandidate[] = [];
    const add = (primitives: VectorPrimitive[], context: TableCandidate['context'], sourcePath: string[], ownerIds: string[], instantiated: boolean, layoutId?: string) => { const grid = detectGrid(primitives); if (!grid)
        return; let numberCol = -1, nameCol = -1; for (const row of grid.rows)
        row.forEach((cell, col) => { if (/номер.*план|№|позици/i.test(cell))
            numberCol = col; if (/наименован/i.test(cell))
            nameCol = col; }); const explication = grid.confidence === 'STRONG' && numberCol >= 0 && nameCol >= 0 ? grid.rows.filter(row => /^\d+(?:[.\-–]\d+)*$/.test(row[numberCol]?.trim() ?? '') && row[nameCol]?.trim()).map(row => ({ number: row[numberCol]!.trim(), name: row[nameCol]!.trim() })) : []; candidates.push({ ...grid, id: `table-${candidates.length}`, context, sourcePath, ownerIds, instantiated, ...(layoutId ? { layoutId } : {}), explication }); };
    for (const block of document.blocks ?? []) {
        const owners = document.entities.filter(e => e.type === 'block_instance' && e.blockDefinitionId === block.id).map(e => e.id), paperUses = document.dxfLayouts?.flatMap(l => l.paperPrimitives.filter(p => p.kind === 'block' && p.blockDefinitionId === block.id).map(() => l.id)) ?? [], nested = (document.blocks ?? []).some(b => b.primitives.some(p => p.kind === 'block' && p.blockDefinitionId === block.id));
        add(block.primitives, 'Block definition', [block.sourceName], owners, !!(owners.length || paperUses.length || nested));
    }
    for (const e of document.entities)
        if (e.type === 'imported_graphic')
            add(e.primitives, 'Model', [e.name], [e.id], true);
    for (const layout of document.dxfLayouts ?? [])
        add(layout.paperPrimitives, 'Paper Space', [layout.name], [], true, layout.id);
    // Top-level exploded MODEL clusters grouped by source layer; oversized contexts are explicitly bounded.
    const layers = new Map<string, VectorPrimitive[]>();
    for (const e of document.entities) {
        let ps: VectorPrimitive[] = [];
        if (e.type === 'line')
            ps = [{ kind: 'path', points: [document.vertices[e.startVertexId]!, document.vertices[e.endVertexId]!], closed: false, layerId: e.layerId, colorMode: 'bylayer' }];
        else if (e.type === 'text')
            ps = [{ kind: 'text', position: document.vertices[e.vertexId]!, content: e.content, height: e.height ?? 1, rotationDeg: e.rotationDeg ?? 0, layerId: e.layerId, colorMode: 'bylayer', ...(e.source ? { source: e.source } : {}) }];
        const group = layers.get(e.layerId) ?? [];
        group.push(...ps);
        layers.set(e.layerId, group);
    }
    for (const [layer, ps] of layers)
        add(ps, 'Model', [document.layers.find(l => l.id === layer)?.name ?? layer], document.entities.filter(e => e.layerId === layer && ['line', 'text'].includes(e.type)).map(e => e.id), true);
    geometryCache.set(document.entities, { vertices: document.vertices, blocks: document.blocks, layouts: document.dxfLayouts, layerNames, candidates });
    cache.set(document, candidates);
    return candidates;
}
