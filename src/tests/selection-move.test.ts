import { describe, expect, it } from 'vitest';
import { applyCommand } from '../domain/commands';
import { entityPoints, entityVertexIds, type GeoDocument, type LabelEntity } from '../domain/model';
import { projectSelectionMove, resolveSelectionMove, selectionTranslation } from '../domain/selectionMove';
import { pathLength, polygonArea, screenToWorld, worldToScreen } from '../geometry';
import { alignedDimension } from '../geometry/survey';
import { resolvedLabelPosition } from '../geometry/labels';
import { documentSurveyXY, staleControls } from '../geometry/georeferencing';
import { deserializeDocument, serializeDocument } from '../persistence/serialization';
import { editorReducer, initialEditorState, isDocumentDirty } from '../store/editor';
import { applicationReducer, type ApplicationState } from '../ai/workflow';
import { resolveShortcut } from '../editor/shortcuts';
import { moveDocument } from './fixtures/moveDocument';

const delta = { x: 5, y: -2 };
const move = (document: GeoDocument, entityIds: string[], displacement = delta) => applyCommand(document, { type: 'move-entities', entityIds, delta: displacement });
const label = (document: GeoDocument, id = 'label') => document.entities.find(entity => entity.id === id) as LabelEntity;

describe('deterministic MODEL translation', () => {
  it.each(['point', 'line', 'path', 'house', 'text'])('translates %s without altering IDs, Z, topology or unrelated vertices', id => {
    const before = moveDocument(), entity = before.entities.find(e => e.id === id)!;
    const ids = new Set(entityVertexIds(entity)), after = move(before, [id]);
    expect(after.entities).toBe(before.entities); expect(Object.keys(after.vertices)).toEqual(Object.keys(before.vertices));
    for (const [vertexId, vertex] of Object.entries(before.vertices)) {
      if (ids.has(vertexId)) expect(after.vertices[vertexId]).toEqual({ ...vertex, x: vertex.x + 5, y: vertex.y - 2 });
      else expect(after.vertices[vertexId]).toBe(vertex);
    }
    expect(before.vertices.a).toEqual({ id: 'a', x: 0, y: 0, z: 2 });
    expect(deserializeDocument(serializeDocument(after))).toEqual(after);
  });
  it('preserves polygon area, perimeter and all edge vectors while moving shared selected vertices once', () => {
    const before = moveDocument(), house = before.entities[0]!;
    const resolved = resolveSelectionMove(before, ['house', 'line', 'house', 'text', 'point']);
    expect(resolved.vertexIds.filter(id => id === 'a')).toHaveLength(1);
    const after = move(before, resolved.entityIds), points = entityPoints(house, before.vertices), shifted = entityPoints(house, after.vertices);
    expect(polygonArea(shifted)).toBe(polygonArea(points)); expect(pathLength(shifted, true)).toBe(pathLength(points, true));
    expect(after.vertices.a).toEqual({ id: 'a', x: 5, y: -2, z: 2 }); expect(after.vertices.e).toMatchObject({ x: 0, y: -5 });
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      expect({ x: shifted[j]!.x - shifted[i]!.x, y: shifted[j]!.y - shifted[i]!.y }).toEqual({ x: points[j]!.x - points[i]!.x, y: points[j]!.y - points[i]!.y });
    }
  });
  it('exposes unselected connected geometry, dimensions and derived labels, including hidden objects', () => {
    const before = moveDocument(); before.layers.find(l => l.id === 'boundary')!.visible = false;
    const resolved = resolveSelectionMove(before, ['house']);
    expect(resolved.affectedEntityIds).toEqual(['line', 'label', 'line-label', 'dim-0', 'dim-1', 'dim-2', 'dim-3']);
    const after = move(before, ['house']); expect(after.vertices.a).toMatchObject({ x: 5, y: -2 }); expect(after.vertices.e).toBe(before.vertices.e);
    expect(after.entities.find(e => e.id === 'line')).toBe(before.entities.find(e => e.id === 'line'));
  });
  it('translates shared Text position without detaching it', () => {
    const before = moveDocument(); before.entities = before.entities.map(e => e.id === 'text' ? { ...e, vertexId: 'a' } : e);
    const after = move(before, ['text', 'house']); expect(after.vertices.a).toMatchObject({ x: 5, y: -2 });
    expect(after.entities).toBe(before.entities); expect(Object.keys(after.vertices)).toEqual(Object.keys(before.vertices));
  });
  it('leaves zero translations as identity and rejects missing IDs, nonfinite deltas and overflow atomically', () => {
    const before = moveDocument(), serialized = serializeDocument(before);
    expect(move(before, ['house'], { x: 0, y: 0 })).toBe(before);
    for (const ids of [[], ['missing'], ['house', 'missing']]) expect(() => move(before, ids)).toThrow();
    for (const value of [NaN, Infinity, -Infinity]) expect(() => move(before, ['house'], { x: value, y: 0 })).toThrow();
    const huge = { ...before, vertices: { ...before.vertices, a: { ...before.vertices.a!, x: 1e308 } } };
    expect(() => move(huge, ['house'], { x: 1e308, y: 0 })).toThrow(/диапазон/);
    expect(serializeDocument(before)).toBe(serialized);
  });
  it('applies exact numeric offsets at large MODEL coordinates and rejects extraneous Z', () => {
    const before = moveDocument(); before.vertices = Object.fromEntries(Object.entries(before.vertices).map(([id, v]) => [id, { ...v, x: v.x + 1e6, y: v.y + 6e6 }]));
    expect(move(before, ['house', 'text']).vertices.a).toEqual({ id: 'a', x: 1000005, y: 5999998, z: 2 });
    expect(() => applyCommand(before, { type: 'move-entities', entityIds: ['house'], delta: { ...delta, z: 1 } } as never)).toThrow();
  });
});

describe('annotation and lock policy', () => {
  it('keeps Label offset unchanged alongside its selected target, without double translation', () => {
    const before = moveDocument(), after = move(before, ['house', 'label']);
    expect(label(after)).toBe(label(before)); const p = resolvedLabelPosition(before, label(before))!;
    expect(resolvedLabelPosition(after, label(after))).toMatchObject({ x: p.x + 5, y: p.y - 2 });
  });
  it('moves independent selected Label by its offset, without moving target geometry', () => {
    const before = moveDocument(), after = move(before, ['label', 'text']);
    expect(label(after)).toMatchObject({ dx: 5, dy: -1 }); expect(after.vertices.a).toBe(before.vertices.a);
    expect(move(before, ['label']).vertices).toBe(before.vertices);
  });
  it('compensates partial indirect target motion so a selected Label receives exactly one visual delta', () => {
    const before = moveDocument(), after = move(before, ['house', 'line-label']);
    const p = resolvedLabelPosition(before, label(before, 'line-label'))!;
    expect(resolvedLabelPosition(after, label(after, 'line-label'))).toMatchObject({ x: p.x + 5, y: p.y - 2 });
    expect(label(after, 'line-label')).toMatchObject({ dx: 2.5, dy: 0 });
  });
  it('follows a fully moved unselected target through shared topology, without changing offset', () => {
    const before = moveDocument(), after = move(before, ['house', 'point', 'line-label']);
    expect(label(after, 'line-label')).toBe(label(before, 'line-label'));
  });
  it('Dimension alone cannot translate sources; dimensions follow selected geometry with preserved references/settings/value', () => {
    const before = moveDocument(); expect(() => move(before, ['dim-0'])).toThrow(/Размер/);
    const after = move(before, ['house', 'dim-0']);
    for (const entity of before.entities) if (entity.type === 'dimension') {
      expect(after.entities.find(e => e.id === entity.id)).toBe(entity);
      const a = alignedDimension(before.vertices[entity.startVertexId]!, before.vertices[entity.endVertexId]!, entity.offset, entity.textPosition);
      const b = alignedDimension(after.vertices[entity.startVertexId]!, after.vertices[entity.endVertexId]!, entity.offset, entity.textPosition);
      expect(b.length).toBe(a.length); expect(b.start.x).toBeCloseTo(a.start.x + 5); expect(b.start.y).toBeCloseTo(a.start.y - 2);
    }
  });
  it.each(['buildings', 'boundary', 'annotations', 'dimensions'])('blocks the entire move for selected or indirectly locked %s layer', layerId => {
    const before = moveDocument(); before.layers.find(l => l.id === layerId)!.locked = true;
    const original = serializeDocument(before);
    expect(() => move(before, ['house', 'text'])).toThrow(/заблокирован/); expect(serializeDocument(before)).toBe(original);
    const state = editorReducer(initialEditorState(before), { type: 'execute', command: { type: 'move-entities', entityIds: ['house', 'text'], delta } });
    expect(state.document).toBe(before); expect(state.past).toHaveLength(0);
  });
  it('blocks hidden locked shared consumers and permits moving Label offset beside a locked target', () => {
    const before = moveDocument(); before.layers.find(l => l.id === 'boundary')!.locked = true; before.layers.find(l => l.id === 'boundary')!.visible = false;
    expect(() => move(before, ['house'])).toThrow(/заблокирован/);
    before.layers.find(l => l.id === 'buildings')!.locked = true;
    expect(move(before, ['label']).entities.find(e => e.id === 'label')).toMatchObject({ dx: 5, dy: -1 });
  });
});

describe('preview, selection and constraints', () => {
  it('100 previews stay separate from canonical/autosave/dirty/history, then commit once and Undo/Redo all', () => {
    const before = moveDocument(); let state = initialEditorState(before);
    state = editorReducer(state, { type: 'select', entityId: 'house' }); state = editorReducer(state, { type: 'select', entityId: 'text', toggle: true });
    expect(state.selectedEntityIds).toEqual(['house', 'text']);
    state = editorReducer(state, { type: 'begin-selection-move', entityIds: state.selectedEntityIds });
    for (let i = 1; i <= 100; i++) {
      state = editorReducer(state, { type: 'preview-selection-move', delta: { x: i / 20, y: -i / 50 } });
      expect(state.document).toBe(before); expect(state.transactionBefore).toBe(before); expect(state.past).toHaveLength(0); expect(isDocumentDirty(state)).toBe(false);
    }
    expect(state.selectionMove!.previewDocument.vertices.a).toMatchObject({ x: 5, y: -2 });
    // Changing React selection mid-drag never changes the captured command IDs.
    state = editorReducer(state, { type: 'select', entityId: 'point' });
    state = editorReducer(state, { type: 'finish-selection-move' }); expect(state.past).toEqual([before]); expect(state.selectionMove).toBeNull();
    const after = state.document; expect(after.vertices.t).toMatchObject({ x: 14, y: 5 });
    state = editorReducer(state, { type: 'undo' }); expect(state.document).toBe(before);
    expect(editorReducer(state, { type: 'redo' }).document).toBe(after);
  });
  it.each(['cancel-transaction', 'undo', 'redo'] as const)('%s cancels preview without dirty/history changes', type => {
    const before = moveDocument(); let state = editorReducer(initialEditorState(before), { type: 'begin-selection-move', entityIds: ['house'] });
    state = editorReducer(state, { type: 'preview-selection-move', delta }); state = editorReducer(state, { type });
    expect(state.document).toBe(before); expect(state.selectionMove).toBeNull(); expect(state.transactionBefore).toBeNull(); expect(state.past).toHaveLength(0); expect(isDocumentDirty(state)).toBe(false);
  });
  it('zero/no-op commits do not create history and invalid preview cannot commit the previous good frame', () => {
    const before = moveDocument(); let state = editorReducer(initialEditorState(before), { type: 'begin-selection-move', entityIds: ['house'] });
    state = editorReducer(state, { type: 'preview-selection-move', delta }); state = editorReducer(state, { type: 'preview-selection-move', delta: { x: Infinity, y: 0 } });
    state = editorReducer(state, { type: 'finish-selection-move' }); expect(state.document).toBe(before); expect(state.past).toHaveLength(0);
    expect(projectSelectionMove(before, resolveSelectionMove(before, ['house']), { x: 0, y: 0 })).toBe(before);
  });
  it.each([[10, 3, 10, 0], [2, 7, 0, 7], [-10, 3, -10, 0], [2, -7, 0, -7], [3, 3, 0, 3]])('Shift (%s,%s) -> (%s,%s)', (x,y,dx,dy) => {
    expect(selectionTranslation({ x: 100, y: 200 }, { x: 100+x, y: 200+y }, true)).toEqual({ x: dx, y: dy });
  });
  it.each([0.5, 2, 30])('world delta is viewport independent at zoom %s', pixelsPerUnit => {
    const viewport = { center: { x: 1e6, y: 6e6 }, pixelsPerUnit }, size = { width: 900, height: 600 };
    const a = { x: 1000002, y: 6000003 }, b = { x: 1000007, y: 6000001 };
    expect(selectionTranslation(screenToWorld(worldToScreen(a,viewport,size),viewport,size),screenToWorld(worldToScreen(b,viewport,size),viewport,size))).toEqual(delta);
  });
  it('M is available and does not mutate the document', () => {
    expect(resolveShortcut(['M'])?.id).toBe('move'); const before = initialEditorState(moveDocument()), after = editorReducer(before, { type: 'open-move-input' });
    expect(after.moveInputOpen).toBe(true); expect(after.document).toBe(before.document); expect(after.past).toHaveLength(0);
  });
  it('existing AI preview only becomes stale on Move commit, never on preview/cancel', () => {
    let state: ApplicationState = { editor: initialEditorState(moveDocument()), ai: { status: 'idle' } };
    state = applicationReducer(state, { type: 'ai-event', event: { type: 'start', id: 'move-ai', text: 'fixture' } });
    state = applicationReducer(state, { type: 'ai-event', event: { type: 'result', id: 'move-ai', result: { actions: [{ type: 'create_rectangle', name: 'New', width: 3, height: 2, placement: { type: 'local_origin' } }] } } });
    const status = state.ai.status; state = applicationReducer(state, { type: 'begin-selection-move', entityIds: ['house'] });
    state = applicationReducer(state, { type: 'preview-selection-move', delta }); expect(state.ai.status).toBe(status);
    expect(applicationReducer(state, { type: 'cancel-transaction' }).ai.status).toBe(status);
    expect(applicationReducer(state, { type: 'finish-selection-move' }).ai.status).toBe('stale');
  });
});

it('MODEL move derives rotated SURVEY coordinates, keeps ordinary calibration valid and marks moved control stale', () => {
  const before = applyCommand(moveDocument(), { type: 'set-horizontal-reference', pairs: [{ pointEntityId: 'control-a', survey: { e: 500000, n: 6000000 } }, { pointEntityId: 'control-b', survey: { e: 500000, n: 6000020 } }] });
  const after = move(before, ['house'], { x: 2, y: 0 }); expect(staleControls(after)).toEqual([]); expect(after.horizontalReference).toBe(before.horizontalReference);
  const a = documentSurveyXY(before, before.vertices.a!)!, b = documentSurveyXY(after, after.vertices.a!)!;
  expect(b.e).toBeCloseTo(a.e); expect(b.n - a.n).toBeCloseTo(2);
  const control = move(before, ['control-a']); expect(staleControls(control).map(c => c.pointEntityId)).toEqual(['control-a']); expect(control.horizontalReference).toBe(before.horizontalReference);
});
