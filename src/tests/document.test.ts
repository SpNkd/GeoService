import { describe, expect, it } from 'vitest';
import { applyCommand, canEditVertex } from '../domain/commands';
import { entityPoints, entityVertexIds, worldVertex, type Entity, type GeoDocument, type PointEntity } from '../domain/model';
import { polygonArea, pathLength } from '../geometry';
import { createSampleDocument } from '../sample/document';
import { editorReducer, initialEditorState } from '../store/editor';
import { renderItems, visibleBounds } from '../renderer/selectors';

function addPoint(document: GeoDocument, id: string, vertexId: string, x: number, y: number, layerId = 'survey-points') {
  if (!document.layers.some(layer => layer.id === layerId)) throw new Error(`Unknown fixture layer ${layerId}`);
  return { type: 'add-entity' as const, entity: { id, name: id, type: 'point' as const, layerId, vertexId }, vertices: [worldVertex(vertexId, { x, y })] };
}
function byId(document: GeoDocument, id: string) { return document.entities.find(entity => entity.id === id)!; }
const vertex = (document: GeoDocument, id: string) => document.vertices[id]!;

describe('canonical vertex registry', () => {
  it('migrates every sample entity and shared corner to stable, valid vertex IDs', () => {
    const document = createSampleDocument();
    expect(new Set(document.entities.map(e => e.id)).size).toBe(document.entities.length);
    expect(new Set(Object.keys(document.vertices)).size).toBe(Object.keys(document.vertices).length);
    for (const entity of document.entities) for (const id of entityVertexIds(entity)) {
      expect(Object.hasOwn(document.vertices, id)).toBe(true);
    }
    expect((byId(document, 'p1') as PointEntity).vertexId).toBe((byId(document, 'boundary-01') as Extract<Entity, { type: 'polygon' }>).vertexIds[0]);
    expect((byId(document, 'sp1') as PointEntity).vertexId).toBe((byId(document, 'survey-path') as Extract<Entity, { type: 'polyline' }>).vertexIds[0]);
    expect(new Set(document.entities.map(e => e.type))).toEqual(new Set(['point', 'line', 'polyline', 'polygon', 'text']));
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });
  it('resolves a shared sample vertex into the point, parcel, and connected lines', () => {
    const document = createSampleDocument();
    const parcel = byId(document, 'boundary-01') as Extract<Entity, { type: 'polygon' }>;
    const area = polygonArea(entityPoints(parcel, document.vertices));
    const next = applyCommand(document, { type: 'update-vertex', vertexId: 'v-p1', position: { x: 1001, y: 2000, z: 152.4 } });
    expect((byId(next, 'p1') as PointEntity).vertexId).toBe('v-p1');
    expect(vertex(next, 'v-p1').x).toBe(1001);
    expect(polygonArea(entityPoints(byId(next, 'boundary-01'), next.vertices))).toBe(area - 20);
    expect(vertex(document, 'v-p1').x).toBe(1000);
    const connected = byId(next, 'survey-path') as Extract<Entity, { type: 'polyline' }>;
    const measured = pathLength(entityPoints(connected, next.vertices));
    const movedSurvey = applyCommand(next, { type: 'move-vertex', vertexId: 'v-sp1', delta: { x: 1, y: 0 } });
    expect(pathLength(entityPoints(byId(movedSurvey, 'survey-path'), movedSurvey.vertices))).not.toBe(measured);
    expect(vertex(movedSurvey, 'v-sp1').x).toBe(vertex(next, 'v-sp1').x + 1);
  });
  it('keeps unrelated nearby vertices separate until a command explicitly reuses an ID', () => {
    const document = createSampleDocument();
    const next = applyCommand(document, addPoint(document, 'nearby-point', 'v-nearby-point', 1000.01, 2000));
    expect((byId(next, 'p1') as PointEntity).vertexId).toBe('v-p1');
    expect((byId(next, 'nearby-point') as PointEntity).vertexId).toBe('v-nearby-point');
    expect(vertex(next, 'v-nearby-point')).toEqual({ id: 'v-nearby-point', x: 1000.01, y: 2000 });
  });
  it('copies command payload data so callers cannot mutate the inserted document later', () => {
    const document = createSampleDocument();
    const command = addPoint(document, 'owned-copy', 'v-owned-copy', 12, 34);
    const next = applyCommand(document, command);
    command.entity.name = 'Changed outside'; command.vertices[0]!.x = 999;
    expect(byId(next, 'owned-copy').name).toBe('owned-copy');
    expect(vertex(next, 'v-owned-copy').x).toBe(12);
    expect(document.entities.some(entity => entity.id === 'owned-copy')).toBe(false);
  });
  it('deletes an entity, preserves referenced shared vertices and collects orphan vertices', () => {
    const document = applyCommand(createSampleDocument(), addPoint(createSampleDocument(), 'scratch-point', 'v-scratch', 5, 9));
    const afterPoint = applyCommand(document, { type: 'delete-entity', entityId: 'p1' });
    expect(Object.hasOwn(afterPoint.vertices, 'v-p1')).toBe(true); // parcel still refers to it
    const afterParcel = applyCommand(afterPoint, { type: 'delete-entity', entityId: 'boundary-01' });
    expect(Object.hasOwn(afterParcel.vertices, 'v-p1')).toBe(false); // point reference was removed too
    const afterScratch = applyCommand(afterParcel, { type: 'delete-entity', entityId: 'scratch-point' });
    expect(Object.hasOwn(afterScratch.vertices, 'v-scratch')).toBe(false);
    for (const entity of afterScratch.entities) for (const point of entityPoints(entity, afterScratch.vertices)) expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
  });
  it('rejects dangling, duplicate, non-finite and unused vertices on entity creation', () => {
    const document = createSampleDocument();
    const dangling: Entity = { id: 'bad', name: 'Bad', type: 'point', layerId: 'survey-points', vertexId: 'unknown' };
    expect(() => applyCommand(document, { type: 'add-entity', entity: dangling, vertices: [] })).toThrow(/координаты/);
    expect(() => applyCommand(document, addPoint(document, 'p1', 'v-new', 0, 0))).toThrow(/уже используется/);
    expect(() => applyCommand(document, addPoint(document, 'p-new', 'v-new', NaN, 0))).toThrow(/конечными/);
    expect(() => applyCommand(document, { type: 'add-entity', entity: dangling, vertices: [worldVertex('unknown', { x: 0, y: 0 }), worldVertex('orphan', { x: 1, y: 1 })] })).toThrow(/не используется/);
  });
});

describe('document commands and mutation guards', () => {
  it('updates vertex values immutably at double precision and supports optional Z', () => {
    const document = createSampleDocument();
    const next = applyCommand(document, { type: 'update-vertex', vertexId: 'v-sp1', position: { x: 562341.234123456, y: 6189345.2212345, z: 152.3400123 } });
    expect(next.vertices['v-sp1']).toEqual({ id: 'v-sp1', x: 562341.234123456, y: 6189345.2212345, z: 152.3400123 });
    expect(document.vertices['v-sp1']).toEqual({ id: 'v-sp1', x: 1008.234567, y: 2010.221, z: 152.34 });
    expect(() => applyCommand(document, { type: 'update-vertex', vertexId: 'v-sp1', position: { x: Infinity, y: 0 } })).toThrow(/конечными/);
    expect(() => applyCommand(document, { type: 'update-vertex', vertexId: 'missing', position: { x: 0, y: 0 } })).toThrow(/отсутствующую/);
  });
  it('a shared vertex is locked when any referencing entity is on a locked layer', () => {
    const document = applyCommand(createSampleDocument(), { type: 'set-layer-lock', layerId: 'boundary', locked: true });
    expect(canEditVertex(document, 'v-p1')).toBe(false);
    expect(() => applyCommand(document, { type: 'move-vertex', vertexId: 'v-p1', delta: { x: 1, y: 0 } })).toThrow(/заблокирован/);
    expect(canEditVertex(document, 'v-sp2')).toBe(true);
  });
  it('enforces source and destination layer locks, while layer visibility and lock can be changed', () => {
    const document = createSampleDocument();
    const locked = applyCommand(document, { type: 'set-layer-lock', layerId: 'survey-points', locked: true });
    expect(() => applyCommand(locked, { type: 'set-entity-layer', entityId: 'p1', layerId: 'boundary' })).toThrow(/заблокированном/);
    expect(() => applyCommand(locked, { type: 'set-entity-layer', entityId: 'building-01', layerId: 'survey-points' })).toThrow(/Целевой/);
    expect(() => applyCommand(locked, { type: 'delete-entity', entityId: 'sp1' })).toThrow(/заблокированном/);
    expect(() => applyCommand(locked, { type: 'add-entity', ...{ entity: { id: 'blocked', name: 'Blocked', type: 'point', layerId: 'survey-points', vertexId: 'v-blocked' } as Entity, vertices: [worldVertex('v-blocked', { x: 1, y: 2 })] } })).toThrow(/заблокирован/);
    expect(() => applyCommand(document, { type: 'set-entity-layer', entityId: 'building-01', layerId: 'missing' })).toThrow(/Целевой/);
    expect(() => applyCommand(document, { type: 'set-layer-visibility', layerId: 'missing', visible: false })).toThrow(/Слой/);
    expect(applyCommand(document, { type: 'set-entity-layer', entityId: 'p1', layerId: 'boundary' }).entities.find(e => e.id === 'p1')?.layerId).toBe('boundary');
  });
  it('updates only text properties and rejects invalid geometry patches', () => {
    const document = createSampleDocument();
    expect(applyCommand(document, { type: 'update-entity', entityId: 'building-label', patch: { content: 'Новый текст' } }).entities.find(e => e.id === 'building-label')?.type).toBe('text');
    expect(() => applyCommand(document, { type: 'update-entity', entityId: 'p1', patch: { content: 'text' } })).toThrow(/текстовой/);
    expect(() => applyCommand(document, { type: 'update-entity', entityId: 'building-label', patch: { fontSize: -1 } })).toThrow(/положительным/);
  });
  it('filters invisible layers, orders render items and handles an empty view', () => {
    const document = createSampleDocument();
    const hidden = applyCommand(document, { type: 'set-layer-visibility', layerId: 'buildings', visible: false });
    expect(renderItems(hidden).some(item => item.entity.id === 'building-01')).toBe(false);
    expect(renderItems(document).map(item => item.layer.order)).toEqual(renderItems(document).map(item => item.layer.order).sort((a, b) => a - b));
    expect(visibleBounds({ ...document, layers: document.layers.map(layer => ({ ...layer, visible: false })) })).toBeNull();
  });
});

describe('editor snapshot history and session state', () => {
  it('adds, undoes, and redoes an entity and its owned vertex snapshot', () => {
    const initial = initialEditorState(createSampleDocument());
    const added = editorReducer(initial, { type: 'execute', command: addPoint(initial.document, 'p-new', 'v-new', 33, 44) });
    expect(byId(added.document, 'p-new')).toBeTruthy(); expect(added.document.vertices['v-new']?.x).toBe(33);
    expect(added.past).toHaveLength(1); expect(added.future).toHaveLength(0);
    const undone = editorReducer(added, { type: 'undo' });
    expect(undone.document).toBe(initial.document); expect(undone.document.vertices['v-new']).toBeUndefined();
    const redone = editorReducer(undone, { type: 'redo' });
    expect(byId(redone.document, 'p-new')).toBeTruthy(); expect(vertex(redone.document, 'v-new').x).toBe(33);
  });
  it('undoes and redoes entity deletion without losing shared geometry', () => {
    const initial = initialEditorState(createSampleDocument());
    const deleted = editorReducer(initial, { type: 'execute', command: { type: 'delete-entity', entityId: 'p1' } });
    expect(deleted.document.vertices['v-p1']).toBeTruthy();
    const undo = editorReducer(deleted, { type: 'undo' });
    expect(byId(undo.document, 'p1')).toBeTruthy(); expect(undo.document.vertices['v-p1']).toBeTruthy();
    const redo = editorReducer(undo, { type: 'redo' });
    expect(redo.document.entities.some(e => e.id === 'p1')).toBe(false); expect(redo.document.vertices['v-p1']).toBeTruthy();
  });
  it('undoes inspector vertex edits and clears redo after a new edit', () => {
    const initial = initialEditorState(createSampleDocument());
    const changed = editorReducer(initial, { type: 'execute', command: { type: 'update-vertex', vertexId: 'v-sp1', position: { x: 999, y: 888, z: 152.34 } } });
    expect(vertex(changed.document, 'v-sp1').x).toBe(999);
    const undone = editorReducer(changed, { type: 'undo' });
    expect(vertex(undone.document, 'v-sp1').x).toBe(1008.234567);
    expect(undone.future).toHaveLength(1);
    const diverged = editorReducer(undone, { type: 'execute', command: { type: 'update-vertex', vertexId: 'v-sp1', position: { x: 777, y: 888, z: 152.34 } } });
    expect(diverged.future).toHaveLength(0);
  });
  it('makes undo of an in-progress inspector edit redoable and replaces a stale redo branch', () => {
    const initial = initialEditorState(createSampleDocument());
    const changed = editorReducer(initial, { type: 'execute', command: { type: 'update-vertex', vertexId: 'v-sp1', position: { x: 999, y: 888, z: 152.34 } } });
    let state = editorReducer(changed, { type: 'undo' });
    expect(state.future).toHaveLength(1);
    state = editorReducer(state, { type: 'begin-transaction' });
    state = editorReducer(state, { type: 'transient', command: { type: 'update-vertex', vertexId: 'v-sp1', position: { x: 777, y: 888, z: 152.34 } } });
    state = editorReducer(state, { type: 'undo' });
    expect(vertex(state.document, 'v-sp1').x).toBe(1008.234567);
    expect(state.future).toHaveLength(1);
    state = editorReducer(state, { type: 'redo' });
    expect(vertex(state.document, 'v-sp1').x).toBe(777);
    expect(state.future).toHaveLength(0);
  });
  it('records a multi-event vertex drag as one history action; escape cancellation restores the document', () => {
    const initial = initialEditorState(createSampleDocument());
    let draft = editorReducer(initial, { type: 'begin-transaction' });
    draft = editorReducer(draft, { type: 'transient', command: { type: 'update-vertex', vertexId: 'v-sp1', position: { x: 1030, y: 2040, z: 152.34 } } });
    draft = editorReducer(draft, { type: 'transient', command: { type: 'update-vertex', vertexId: 'v-sp1', position: { x: 1050, y: 2050, z: 152.34 } } });
    expect(draft.past).toHaveLength(0);
    draft = editorReducer(draft, { type: 'commit-transaction' });
    expect(draft.past).toHaveLength(1);
    expect(vertex(editorReducer(draft, { type: 'undo' }).document, 'v-sp1').x).toBe(1008.234567);
    expect(editorReducer(editorReducer(initial, { type: 'begin-transaction' }), { type: 'cancel-transaction' }).document).toBe(initial.document);
  });
  it('excludes selection, pan, zoom and grid from history while allowing read-only locked selection', () => {
    const state = initialEditorState(createSampleDocument());
    let next = editorReducer(state, { type: 'pan', delta: { x: 200, y: -80 } });
    next = editorReducer(next, { type: 'zoom', size: { width: 1000, height: 700 }, anchor: { x: 345, y: 200 }, factor: 2 });
    next = editorReducer(next, { type: 'toggle-grid' });
    next = editorReducer(next, { type: 'execute', command: { type: 'set-layer-lock', layerId: 'survey-points', locked: true } });
    next = editorReducer(next, { type: 'select', entityId: 'p1' });
    expect(next.selectionId).toBe('p1'); expect(next.past).toHaveLength(1);
    const rejected = editorReducer(next, { type: 'execute', command: { type: 'update-vertex', vertexId: 'v-p1', position: { x: 0, y: 0 } } });
    expect(rejected.document).toBe(next.document); expect(rejected.error).toMatch(/заблокирован/);
    expect(state.document.entities).toBe(next.document.entities);
  });
});
