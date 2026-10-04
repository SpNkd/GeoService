import { describe, expect, it } from 'vitest';
import { applyCommand, canEditVertex } from '../domain/commands';
import { commandFromOrderedPoints, createGeometryCommand, type GeometryAnchor } from '../domain/geometryIntent';
import { createNewDocument } from '../domain/newDocument';
import { entityPoints, entityVertexIds, type GeoDocument, type PointEntity } from '../domain/model';
import { distance, gridStep, pathLength, polygonArea } from '../geometry';
import { alignedDimension, azimuth, delta, dimensionOffset, distance3D, measurePair, polygonSelfIntersects, segmentIntersection } from '../geometry/survey';
import { formatAzimuth, formatDistance } from '../geometry/format';
import { createSnapProvider, DEFAULT_SNAP_OPTIONS, findSnapCandidate, type SnapOptions } from '../snapping';
import { deserializeDocument, serializeDocument } from '../persistence/serialization';
import { createSampleDocument } from '../sample/document';
import { editorReducer, initialEditorState } from '../store/editor';
import { buildImportPlan, createImportCommand, defaultMapping } from '../import/importPlan';
import { parseTable } from '../import/parser';
import { visibleBounds } from '../renderer/selectors';

const base = { x: 562341.234, y: 6189345.221 };
function survey(): GeoDocument {
  const table = parseTable('Name;E;N;H\nP1;562341.234;6189345.221;100\nP2;562351.234;6189345.221;103\nP3;562351.234;6189365.221;\nP4;562341.234;6189365.221;101', ';');
  const plan = buildImportPlan(table, { header: true, decimal: '.', mapping: defaultMapping(table, true) });
  return applyCommand(createNewDocument(), createImportCommand(plan, createNewDocument(), 'survey-points'));
}
const points = (d: GeoDocument) => d.entities.filter((e): e is PointEntity => e.type === 'point');
const anchors = (d: GeoDocument): GeometryAnchor[] => points(d).map(e => ({ vertexId: e.vertexId, position: d.vertices[e.vertexId]! }));
function snap(d: GeoDocument, x: number, y: number, zoom = 1, patch: Partial<SnapOptions> = {}) {
  return findSnapCandidate({ x: base.x + x, y: base.y + y }, createSnapProvider(d), { center: base, pixelsPerUnit: zoom }, { ...DEFAULT_SNAP_OPTIONS, ...patch });
}

describe('screen-tolerant deterministic snapping', () => {
  it('finds an endpoint and uses its readable survey name', () => {
    const d = survey(), result = snap(d, 1, 0);
    expect(result).toMatchObject({ type: 'vertex', sourceVertexId: points(d)[0]!.vertexId, distanceScreenPx: 1 });
    expect(result?.metadata.label).toBe('Endpoint P1'); expect(result?.worldPosition.z).toBe(100);
  });
  it('chooses nearest vertex; lexical ID makes exact-distance ties stable independent of provider order', () => {
    const d = survey(); expect(snap(d, 9, 0)?.sourceVertexId).toBe(points(d)[1]!.vertexId);
    const provider = createSnapProvider(d), options = { ...DEFAULT_SNAP_OPTIONS, midpoint: false };
    const cursor = { x: base.x + 5, y: base.y };
    const a = findSnapCandidate(cursor, provider, { center: base, pixelsPerUnit: 1 }, options);
    const b = findSnapCandidate(cursor, { query: () => [...provider.candidates].reverse() }, { center: base, pixelsPerUnit: 1 }, options);
    expect(a?.sourceVertexId).toBe([points(d)[0]!.vertexId, points(d)[1]!.vertexId].sort()[0]); expect(b).toEqual(a);
  });
  it('finds each segment midpoint including polygon closure without an existing vertex ID', () => {
    const d = survey(), polygon = applyCommand(d, commandFromOrderedPoints(d, points(d).map(p => p.id), 'polygon'));
    expect(snap(polygon, 5, 0, 10)).toMatchObject({ type: 'midpoint', worldPosition: { x: base.x + 5, y: base.y } });
    expect(snap(polygon, 5, 0, 10)?.worldPosition.z).toBeUndefined();
    expect(snap(polygon, 0, 10, 10)?.type).toBe('midpoint'); expect(snap(polygon, 0, 10, 10)?.sourceVertexId).toBeUndefined();
  });
  it('ignores hidden layers but keeps locked geometry as reference', () => {
    const d = survey();
    expect(snap(applyCommand(d, { type: 'set-layer-visibility', layerId: 'survey-points', visible: false }), 0, 0)).toBeNull();
    expect(snap(applyCommand(d, { type: 'set-layer-lock', layerId: 'survey-points', locked: true }), 0, 0)?.type).toBe('vertex');
  });
  it.each([0.5, 1, 10, 100])('maintains a 10 px tolerance at zoom %s', zoom => {
    const d = survey(); expect(snap(d, -9 / zoom, 0, zoom)?.distanceScreenPx).toBeCloseTo(9);
    expect(snap(d, -11 / zoom, 0, zoom)).toBeNull();
  });
  it('prioritizes a vertex even when a midpoint is closer; disabled and unchecked modes do not snap', () => {
    const d = survey(), line = applyCommand(d, createGeometryCommand(d, 'line', anchors(d).slice(0, 2)));
    expect(snap(line, 5, 0)?.type).toBe('vertex');
    expect(snap(line, 5, 0, 1, { vertex: false })?.type).toBe('midpoint');
    expect(snap(line, 5, 0, 1, { enabled: false })).toBeNull();
    expect(snap(line, 5, 0, 1, { vertex: false, midpoint: false })).toBeNull();
  });
  it('uses a world-grid multiple with screen tolerance and no invented Z', () => {
    const d = createNewDocument(), zoom = 5, step = gridStep(zoom);
    const result = findSnapCandidate({ x: step * 2 + 0.2, y: step * -3 }, createSnapProvider(d), { center: base, pixelsPerUnit: zoom }, { ...DEFAULT_SNAP_OPTIONS, grid: true });
    expect(result).toMatchObject({ type: 'grid', worldPosition: { x: step * 2, y: step * -3 } });
    expect(result?.worldPosition.z).toBeUndefined();
    const next = applyCommand(d, createGeometryCommand(d, 'point', [{ position: result!.worldPosition }]));
    expect(Object.keys(next.vertices)).toHaveLength(1); expect(entityPoints(next.entities[0]!, next.vertices)[0]).toEqual(result!.worldPosition);
  });
  it('reuses endpoint IDs and creates independent IDs for midpoint/grid/free positions', () => {
    const d = survey(), a = snap(d, 0, 0)!, b = snap(d, 10, 0)!;
    const shared = applyCommand(d, createGeometryCommand(d, 'line', [a, b].map(r => ({ position: r.worldPosition, vertexId: r.sourceVertexId! }))));
    expect(entityVertexIds(shared.entities.at(-1)!)).toEqual([a.sourceVertexId, b.sourceVertexId]);
    expect(Object.keys(shared.vertices)).toHaveLength(4);
    const mid = snap(shared, 5, 0, 10)!;
    const added = applyCommand(shared, createGeometryCommand(shared, 'point', [{ position: mid.worldPosition }]));
    expect(entityVertexIds(added.entities.at(-1)!)[0]).not.toBe(a.sourceVertexId);
    expect(Object.keys(added.vertices)).toHaveLength(5);
  });
  it('excludes the moved vertex and its incident midpoints without merging vertices', () => {
    const d = survey(), line = applyCommand(d, createGeometryCommand(d, 'line', anchors(d).slice(0, 2)));
    const result = findSnapCandidate({ x: base.x, y: base.y }, createSnapProvider(line), { center: base, pixelsPerUnit: 10 }, DEFAULT_SNAP_OPTIONS, points(d)[0]!.vertexId);
    expect(result).toBeNull();
  });
});

describe('pure surveying calculations', () => {
  it.each([[0, 1, 0], [1, 0, 90], [0, -1, 180], [-1, 0, 270], [1, 1, 45], [1, -1, 135], [-1, -1, 225], [-1, 1, 315]])('North clockwise: ΔX=%s ΔY=%s → %s°', (x, y, expected) => {
    expect(azimuth(base, { x: base.x + x, y: base.y + y })).toBeCloseTo(expected);
  });
  it('distinguishes horizontal, spatial and height measurements with optional Z', () => {
    expect(measurePair({ x: 0, y: 0, z: 10 }, { x: 3, y: 4, z: 22 })).toEqual({ horizontal: 5, delta: { x: 3, y: 4, z: 12 }, spatial: 13, azimuth: azimuth({ x: 0, y: 0 }, { x: 3, y: 4 }) });
    expect(delta({ x: 0, y: 0, z: 10 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(distance3D(base, { ...base, z: 10 })).toBeNull(); expect(azimuth(base, base)).toBeNull();
  });
  it('keeps actual geometry unrounded and centralizes display precision', () => {
    expect(formatDistance(12.34567891)).toBe('12,346 м'); expect(formatAzimuth(134.5274)).toBe('134,527°');
    expect(distance({ x: 0, y: 0 }, { x: 12.34567891, y: 0 })).toBe(12.34567891);
  });
  it('projects signed world offset and derives parallel dimension geometry', () => {
    const a = { x: 0, y: 0 }, b = { x: 3, y: 4 };
    expect(dimensionOffset(a, b, { x: -8, y: 6 })).toBe(10);
    expect(alignedDimension(a, b, 10)).toEqual({ start: { x: -8, y: 6 }, end: { x: -5, y: 10 }, label: { x: -6.5, y: 8 }, length: 5 });
    expect(alignedDimension(a, b, -10).length).toBe(5); expect(alignedDimension(a, a, 10).length).toBe(0);
  });
  it('calculates crossings in translated real coordinates; parallel/outside segments return null', () => {
    const p = (x: number, y: number) => ({ x: base.x + x, y: base.y + y });
    expect(segmentIntersection(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toEqual(p(5, 5));
    expect(segmentIntersection(p(0, 0), p(10, 0), p(0, 1), p(10, 1))).toBeNull();
    expect(segmentIntersection(p(0, 0), p(1, 0), p(2, -1), p(2, 1))).toBeNull();
  });
  it('detects crossings, non-adjacent touching and collinear overlaps', () => {
    expect(polygonSelfIntersects([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }])).toBe(true);
    expect(polygonSelfIntersects([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }])).toBe(true);
    expect(polygonSelfIntersects([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(false);
  });
});

describe('ordered imported survey points and dimensions', () => {
  it('Shift selection preserves order and toggling moves a re-added point to the end without history', () => {
    const d = survey(), p = points(d); let state = initialEditorState(d);
    for (const index of [2, 0, 3, 0, 1, 0]) state = editorReducer(state, { type: 'select', entityId: p[index]!.id, toggle: true });
    expect(state.orderedPointIds).toEqual([p[2]!.id, p[3]!.id, p[1]!.id, p[0]!.id]);
    expect(state.document).toBe(d); expect(state.past).toHaveLength(0);
    state = editorReducer(state, { type: 'execute', command: { type: 'set-layer-visibility', layerId: 'survey-points', visible: false } });
    expect(state.orderedPointIds).toEqual([]);
  });
  it.each(['polyline', 'polygon'] as const)('creates %s from the same imported registry IDs in one history step', kind => {
    const d = survey(), p = points(d); let state = initialEditorState(d);
    for (const entity of p) state = editorReducer(state, { type: 'select', entityId: entity.id, toggle: true });
    state = editorReducer(state, { type: 'from-selected-points', kind });
    const entity = state.document.entities.at(-1)!;
    expect(entityVertexIds(entity)).toEqual(p.map(p => p.vertexId)); expect(Object.keys(state.document.vertices)).toHaveLength(4);
    expect(state.past).toHaveLength(1); expect(state.orderedPointIds).toEqual([]);
    if (kind === 'polygon') { expect(polygonArea(entityPoints(entity, state.document.vertices))).toBeCloseTo(200); expect(pathLength(entityPoints(entity, state.document.vertices), true)).toBeCloseTo(60); }
    else expect(pathLength(entityPoints(entity, state.document.vertices))).toBeCloseTo(40);
    expect(editorReducer(state, { type: 'undo' }).document).toBe(d);
    expect(editorReducer(editorReducer(state, { type: 'undo' }), { type: 'redo' }).document).toBe(state.document);
  });
  it('rejects a crossing boundary atomically, preserving points, order, document and history', () => {
    const d = survey(), p = points(d); let state = initialEditorState(d);
    for (const index of [0, 2, 1, 3]) state = editorReducer(state, { type: 'select', entityId: p[index]!.id, toggle: true });
    const failed = editorReducer(state, { type: 'from-selected-points', kind: 'polygon' });
    expect(failed.error).toContain('самопересекается'); expect(failed.document).toBe(d); expect(failed.past).toHaveLength(0); expect(failed.orderedPointIds).toEqual(state.orderedPointIds);
    expect(() => commandFromOrderedPoints(d, [p[0]!.id, p[0]!.id, p[1]!.id], 'polygon')).toThrow(/разные/);
  });
  it('creates a missing dimensions layer atomically and undoes it together with the dimension', () => {
    const d = survey(); d.layers = d.layers.filter(l => l.id !== 'dimensions');
    const state = editorReducer(initialEditorState(d), { type: 'execute', command: createGeometryCommand(d, 'dimension', anchors(d).slice(0, 2), { offset: -5 }) });
    const dim = state.document.entities.at(-1)!;
    expect(dim).toMatchObject({ type: 'dimension', layerId: 'dimensions', offset: -5 }); expect(entityVertexIds(dim)).toEqual(points(d).slice(0, 2).map(p => p.vertexId));
    expect(state.document.layers.some(l => l.id === 'dimensions')).toBe(true); expect(editorReducer(state, { type: 'undo' }).document).toBe(d);
    expect(visibleBounds(state.document)?.minY).toBeCloseTo(base.y - 5);
  });
  it('derives values from moved references and restores them with Undo/Redo and JSON Open', () => {
    const d = survey(); let state = editorReducer(initialEditorState(d), { type: 'execute', command: createGeometryCommand(d, 'dimension', anchors(d).slice(0, 2), { offset: 4 }) });
    const value = (doc: GeoDocument) => { const [a, b] = entityPoints(doc.entities.at(-1)!, doc.vertices); return distance(a!, b!); };
    expect(value(state.document)).toBe(10);
    state = editorReducer(state, { type: 'execute', command: { type: 'move-vertex', vertexId: points(d)[1]!.vertexId, delta: { x: 5, y: 0 } } });
    expect(value(state.document)).toBe(15); expect(value(editorReducer(state, { type: 'undo' }).document)).toBe(10);
    expect(value(editorReducer(editorReducer(state, { type: 'undo' }), { type: 'redo' }).document)).toBe(15);
    const reopened = deserializeDocument(serializeDocument(state.document)); expect(reopened).toEqual(state.document); expect(reopened.schemaVersion).toBe(2);
    expect(deserializeDocument(serializeDocument(createSampleDocument())).entities).toHaveLength(13);
    const broken = { ...state.document, vertices: {} }; expect(() => deserializeDocument(JSON.stringify(broken))).toThrow(/missing vertex/);
  });
  it('keeps references alive until the dimension is deleted, and includes dimensions in shared-lock protection', () => {
    const d = survey(), p = points(d); let next = applyCommand(d, createGeometryCommand(d, 'dimension', anchors(d).slice(0, 2)));
    const dim = next.entities.at(-1)!;
    next = applyCommand(next, { type: 'set-layer-lock', layerId: 'dimensions', locked: true });
    expect(canEditVertex(next, p[0]!.vertexId)).toBe(false);
    expect(() => applyCommand(next, { type: 'move-vertex', vertexId: p[0]!.vertexId, delta: { x: 1, y: 0 } })).toThrow(/заблокирован/);
    next = applyCommand(next, { type: 'set-layer-lock', layerId: 'dimensions', locked: false });
    for (const point of p.slice(0, 2)) next = applyCommand(next, { type: 'delete-entity', entityId: point.id });
    expect(next.vertices[p[0]!.vertexId]).toBeDefined(); expect(deserializeDocument(serializeDocument(next))).toEqual(next);
    expect(createSnapProvider(next).candidates.some(c => c.sourceVertexId === p[0]!.vertexId)).toBe(true);
    next = applyCommand(next, { type: 'delete-entity', entityId: dim.id });
    expect(next.vertices[p[0]!.vertexId]).toBeUndefined(); expect(next.vertices[p[1]!.vertexId]).toBeUndefined(); expect(Object.keys(next.vertices)).toHaveLength(2);
  });
  it('rejects a new zero-baseline dimension without adding a layer or vertices', () => {
    const d = survey(); expect(() => applyCommand(d, createGeometryCommand(d, 'dimension', [anchors(d)[0]!, anchors(d)[0]!]))).toThrow(/две разные/);
  });
  it('keeps snap, label, line-label and measure preferences outside document/history/JSON', () => {
    const initial = initialEditorState(survey()); let state = editorReducer(initial, { type: 'snap-options', patch: { enabled: false, grid: true } });
    state = editorReducer(state, { type: 'point-labels', mode: 'z' }); state = editorReducer(state, { type: 'toggle-line-lengths' }); state = editorReducer(state, { type: 'tool', tool: 'measure' });
    expect(state.document).toBe(initial.document); expect(state.past).toHaveLength(0); expect(serializeDocument(state.document)).toBe(serializeDocument(initial.document));
  });
});
