import { resolveSelectionMove, projectSelectionMove, type ResolvedSelectionMove } from './selectionMove';
import { entityVertexIds, type GeoDocument, type WorldPoint, type Entity } from './model';
import { modelSelectionBounds } from '../geometry/entityBounds';
import { resolvedLabelPosition, labelAnchor } from '../geometry/labels';
import { blockAttributeLocalPosition, blockDefinition } from '../vectors/geometry';
import { normalizeSymbolRotation } from '../symbols/types';
import type { VectorPrimitive } from '../vectors/types';
export const rotationSnapDeg = 15;
export const AXON_ROTATE_MESSAGE = 'Свободное вращение доступно в виде План. В аксонометрии можно задать точный поворот вокруг оси Z.';
export type SelectionTransform = {
    kind: 'translate';
    delta: {
        x: number;
        y: number;
    };
} | {
    kind: 'rotate';
    pivot: WorldPoint;
    angleDeg: number;
};
export function rotatePoint<T extends WorldPoint>(p: T, pivot: WorldPoint, angleDeg: number): T {
    const a = angleDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), x = p.x - pivot.x, y = p.y - pivot.y;
    const next = { ...p, x: pivot.x + c * x - s * y, y: pivot.y + s * x + c * y };
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y))
        throw new Error('Поворот выходит за диапазон координат.');
    return next;
}
export function rotationDelta(start: number, current: number, snap = false) { const d = current - start, deg = Math.atan2(Math.sin(d), Math.cos(d)) * 180 / Math.PI; return snap ? Math.round(deg / rotationSnapDeg) * rotationSnapDeg : deg; }
export function selectionPivot(document: GeoDocument, ids: readonly string[]) { const b = modelSelectionBounds(document, ids); if (!b)
    throw new Error('Нет геометрии для поворота.'); return { x: b.minX / 2 + b.maxX / 2, y: b.minY / 2 + b.maxY / 2 }; }
export function resolveSelectionTransform(document: GeoDocument, ids: readonly string[], kind: SelectionTransform['kind']): ResolvedSelectionMove {
    const resolved = resolveSelectionMove(document, ids);
    if (kind === 'translate')
        return resolved;
    const selected = new Set(ids), vertices = new Set(resolved.vertexIds), affected = new Set([...ids, ...resolved.affectedEntityIds]);
    for (const e of document.entities)
        if (e.type === 'connector' && (selected.has(e.start.symbolEntityId) || selected.has(e.end.symbolEntityId)))
            affected.add(e.id);
    for (const e of document.entities)
        if (e.type === 'label' && affected.has(e.targetId))
            affected.add(e.id);
    const locked = document.entities.find(e => affected.has(e.id) && (document.layers.find(l => l.id === e.layerId)?.locked !== false || e.type === 'raster_underlay' && e.locked));
    if (locked)
        throw new Error(`Поворот затронет заблокированный объект «${locked.name}».`);
    if (ids.length === 1) {
        const e = document.entities.find(e => e.id === ids[0])!;
        if (e.type === 'point' || e.type === 'circle' || e.type === 'connector' || e.type === 'dimension')
            throw new Error('У этого объекта нет самостоятельного поворота. Выберите его вместе с геометрией.');
    }
    // References consume the rotated vertices; selected dimensions/connectors never own another transform.
    return { ...resolved, affectedEntityIds: [...affected].filter(id => !selected.has(id)), vertexIds: [...vertices] };
}
function rotatePrimitive(p: VectorPrimitive, angle: number): VectorPrimitive {
    const pivot = { x: 0, y: 0 };
    if (p.kind === 'path')
        return { ...p, points: p.points.map(q => rotatePoint(q, pivot, angle)) };
    if (p.kind === 'arc')
        return { ...p, center: rotatePoint(p.center, pivot, angle), startAngle: p.startAngle + angle * Math.PI / 180, endAngle: p.endAngle + angle * Math.PI / 180 };
    if (p.kind === 'circle')
        return { ...p, center: rotatePoint(p.center, pivot, angle) };
    return { ...p, position: rotatePoint(p.position, pivot, angle), rotationDeg: p.rotationDeg + angle };
}
/** Pure preview from one immutable base. Commit re-resolves locks and topology. */
export function projectSelectionTransform(document: GeoDocument, resolved: ResolvedSelectionMove, transform: SelectionTransform): GeoDocument {
    if (transform.kind === 'translate')
        return projectSelectionMove(document, resolved, transform.delta);
    const { angleDeg, pivot } = transform;
    if (!Number.isFinite(angleDeg) || !Number.isFinite(pivot.x) || !Number.isFinite(pivot.y))
        throw new Error('Поворот должен быть конечным числом.');
    if (angleDeg % 360 === 0)
        return document;
    const selected = new Set(resolved.entityIds), moved = new Set(resolved.vertexIds), vertices = { ...document.vertices };
    for (const id of moved)
        vertices[id] = rotatePoint(document.vertices[id]!, pivot, angleDeg);
    let entities = document.entities.map((e): Entity => {
        if (!selected.has(e.id))
            return e;
        if (e.type === 'text')
            return { ...e, rotationDeg: (e.rotationDeg ?? 0) + angleDeg };
        if (e.type === 'arc')
            return { ...e, center: rotatePoint(e.center, pivot, angleDeg), startAngle: e.startAngle + angleDeg * Math.PI / 180, endAngle: e.endAngle + angleDeg * Math.PI / 180 };
        if (e.type === 'circle')
            return { ...e, center: rotatePoint(e.center, pivot, angleDeg) };
        if (e.type === 'symbol' || e.type === 'raster_underlay')
            return { ...e, position: rotatePoint(e.position, pivot, angleDeg), rotationDeg: e.type === 'symbol' ? normalizeSymbolRotation(e.rotationDeg + angleDeg) : e.rotationDeg + angleDeg };
        if (e.type === 'block_instance') {
            const block = blockDefinition(document, e.blockDefinitionId)!;
            const attributes = e.attributeCoordinateSpace === 'block-local' ? e.attributePrimitives : e.attributePrimitives?.map(p => p.kind === 'text' && p.source?.originalType === 'ATTRIB' ? { ...p, position: blockAttributeLocalPosition(e, block, p.position), rotationDeg: p.rotationDeg - e.rotationDeg } : p);
            return { ...e, position: rotatePoint(e.position, pivot, angleDeg), rotationDeg: e.rotationDeg + angleDeg, ...(attributes ? { attributePrimitives: attributes, attributeCoordinateSpace: 'block-local' as const } : {}) };
        }
        if (e.type === 'imported_graphic')
            return { ...e, position: rotatePoint(e.position, pivot, angleDeg), primitives: e.primitives.map(p => rotatePrimitive(p, angleDeg)) };
        return e;
    });
    const projected = { ...document, vertices, entities };
    entities = entities.map(e => {
        if (e.type !== 'label')
            return e;
        const target = document.entities.find(t => t.id === e.targetId)!;
        const follows = selected.has(target.id) || entityVertexIds(target).length > 0 && entityVertexIds(target).every(id => moved.has(id));
        if (!selected.has(e.id) && !follows)
            return e;
        const before = resolvedLabelPosition(document, e), anchor = labelAnchor(projected, projected.entities.find(t => t.id === e.targetId)!);
        if (!before)
            return e;
        const desired = rotatePoint(before, pivot, angleDeg);
        return { ...e, dx: desired.x - anchor.x, dy: desired.y - anchor.y };
    });
    return { ...projected, entities };
}
