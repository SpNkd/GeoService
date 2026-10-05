import { describe, expect, it } from 'vitest';
import { applyCommand } from '../domain/commands';
import { createGeometryCommand } from '../domain/geometryIntent';
import { createNewDocument } from '../domain/newDocument';
import type { GeoDocument } from '../domain/model';
import { documentModelFrame, staleControls } from '../geometry/georeferencing';
import { serializeDocument, deserializeDocument } from '../persistence/serialization';
import { isDocumentDirty, editorReducer, initialEditorState } from '../store/editor';
import { createSnapProvider, DEFAULT_SNAP_OPTIONS, findSnapCandidate } from '../snapping';

function fixture() {
  let document = createNewDocument();
  const vertexIds: Record<string, string> = {};
  const points = [
    ['p-a', 'P-A', 0, 0], ['p-b', 'P-B', 10, 0], ['p-c', 'P-C', 0, 20], ['p-d', 'P-D', 20, 0],
  ] as const;
  for (const [id, name, x, y] of points) {
    document = applyCommand(document, createGeometryCommand(document, 'point', [{ position: { x, y } }], { newId: prefix => `${prefix}-${id}` }));
    const point = document.entities.at(-1)!;
    if (point.type === 'point') vertexIds[name] = point.vertexId;
  }
  const vertex = (name: string) => document.vertices[vertexIds[name]!]!;
  document = applyCommand(document, createGeometryCommand(document, 'line', [{ vertexId: vertex('P-A').id, position: vertex('P-A') }, { vertexId: vertex('P-B').id, position: vertex('P-B') }], { newId: prefix => `${prefix}-source-line` }));
  let anonymousId = 0;
  document = applyCommand(document, createGeometryCommand(document, 'line', [{ position: { x: 30, y: 0 } }, { position: { x: 40, y: 0 } }], { newId: prefix => `${prefix}-anonymous-${anonymousId++}` }));
  const anonymousLine = document.entities.at(-1) as Extract<GeoDocument['entities'][number], { type: 'line' }>;
  document = applyCommand(document, createGeometryCommand(document, 'dimension', [{ vertexId: vertex('P-A').id, position: vertex('P-A') }, { vertexId: vertex('P-B').id, position: vertex('P-B') }], { offset: 2, newId: prefix => `${prefix}-ab` }));
  document = applyCommand(document, { type: 'update-entity', entityId: 'dimension-ab', patch: { textPosition: 0.72 } });
  document = applyCommand(document, { type: 'set-horizontal-reference', pairs: [
    { pointEntityId: 'point-p-a', survey: { e: 500000, n: 6000000 } }, { pointEntityId: 'point-p-b', survey: { e: 500010, n: 6000000 } },
  ] });
  document = applyCommand(document, { type: 'set-vertical-reference', reference: { modelZero: 0, absoluteAtModelZero: 125 } });
  return { document, pointVertex: (name: string) => vertex(name), anonymousVertexId: anonymousLine.startVertexId, dimension: document.entities.find(entity => entity.id === 'dimension-ab') as Extract<GeoDocument['entities'][number], { type: 'dimension' }> };
}

describe('dimension reference retarget', () => {
  it('changes only the requested reference and keeps source geometry untouched', () => {
    const { document, pointVertex } = fixture();
    const line = document.entities.find(entity => entity.id === 'line-source-line');
    const next = applyCommand(document, { type: 'update-dimension-reference', dimensionId: 'dimension-ab', endpoint: 'end', vertexId: pointVertex('P-C').id });
    expect(next.entities.find(entity => entity.id === 'dimension-ab')).toMatchObject({ startVertexId: pointVertex('P-A').id, endVertexId: pointVertex('P-C').id, offset: 2, textPosition: 0.72 });
    expect(Math.hypot(next.vertices[pointVertex('P-C').id]!.x - next.vertices[pointVertex('P-A').id]!.x, next.vertices[pointVertex('P-C').id]!.y - next.vertices[pointVertex('P-A').id]!.y)).toBe(20);
    const startUpdated = applyCommand(document, { type: 'update-dimension-reference', dimensionId: 'dimension-ab', endpoint: 'start', vertexId: pointVertex('P-C').id });
    expect(startUpdated.entities.find(entity => entity.id === 'dimension-ab')).toMatchObject({ startVertexId: pointVertex('P-C').id, endVertexId: pointVertex('P-B').id, offset: 2, textPosition: 0.72 });
    expect(next.entities.find(entity => entity.id === 'line-source-line')).toBe(line);
    expect(next.vertices).toBe(document.vertices);
  });

  it('rejects opposite endpoint, coincident target, missing target and locked dimension layer', () => {
    const { document, pointVertex } = fixture();
    expect(() => applyCommand(document, { type: 'update-dimension-reference', dimensionId: 'dimension-ab', endpoint: 'end', vertexId: pointVertex('P-A').id })).toThrow(/разные вершины/);
    const coincident = applyCommand(document, createGeometryCommand(document, 'point', [{ position: pointVertex('P-A') }], { newId: prefix => `${prefix}-same-position` }));
    expect(() => applyCommand(coincident, { type: 'update-dimension-reference', dimensionId: 'dimension-ab', endpoint: 'end', vertexId: (coincident.entities.find(entity => entity.id === 'point-same-position') as Extract<GeoDocument['entities'][number], { type: 'point' }>).vertexId })).toThrow(/одну позицию/);
    expect(() => applyCommand(document, { type: 'update-dimension-reference', dimensionId: 'dimension-ab', endpoint: 'end', vertexId: 'missing' })).toThrow(/не найдена/);
    expect(() => applyCommand(document, { type: 'update-dimension-reference', dimensionId: 'missing-dimension', endpoint: 'end', vertexId: pointVertex('P-C').id })).toThrow(/Размер не найден/);
    const locked = applyCommand(document, { type: 'set-layer-lock', layerId: 'dimensions', locked: true });
    expect(() => applyCommand(locked, { type: 'update-dimension-reference', dimensionId: 'dimension-ab', endpoint: 'end', vertexId: pointVertex('P-C').id })).toThrow(/заблокирован/);
  });

  it('retarget accepts anonymous canonical vertices and follows visible/locked snap policy', () => {
    const { document, anonymousVertexId, pointVertex } = fixture();
    expect(document.entities.some(entity => entity.type === 'point' && entity.vertexId === anonymousVertexId)).toBe(false);
    const viewport = { center: { x: 0, y: 0 }, pixelsPerUnit: 1 }, options = { ...DEFAULT_SNAP_OPTIONS, tolerancePx: 12, midpoint: false, grid: false };
    expect(findSnapCandidate(document.vertices[pointVertex('P-C').id]!, createSnapProvider(document), viewport, options)).toMatchObject({ type: 'vertex', sourceVertexId: pointVertex('P-C').id });
    expect(applyCommand(document, { type: 'update-dimension-reference', dimensionId: 'dimension-ab', endpoint: 'end', vertexId: anonymousVertexId }).entities.find(entity => entity.id === 'dimension-ab')).toMatchObject({ endVertexId: anonymousVertexId });
    const locked = applyCommand(document, { type: 'set-layer-lock', layerId: 'survey-points', locked: true });
    expect(findSnapCandidate(locked.vertices[pointVertex('P-C').id]!, createSnapProvider(locked), viewport, options)?.type).toBe('vertex');
    const hidden = applyCommand(document, { type: 'set-layer-visibility', layerId: 'survey-points', visible: false });
    expect(findSnapCandidate(hidden.vertices[pointVertex('P-C').id]!, createSnapProvider(hidden), viewport, options)).toBeNull();
  });

  it('keeps preview transient and commits one history step; Undo and Redo restore references', () => {
    const { document, pointVertex } = fixture();
    const beforeText = serializeDocument(document);
    let state = initialEditorState(document);
    state = editorReducer(state, { type: 'begin-dimension-retarget', dimensionId: 'dimension-ab', endpoint: 'end' });
    const transaction = state.transactionBefore;
    for (let i = 0; i < 20; i++) state = editorReducer(state, { type: 'preview-dimension-retarget', vertexId: i % 2 ? pointVertex('P-D').id : pointVertex('P-C').id });
    state = editorReducer(state, { type: 'preview-dimension-retarget', vertexId: pointVertex('P-C').id });
    expect(state.document).toBe(document); expect(state.transactionBefore).toBe(transaction); expect(state.past).toHaveLength(0);
    expect(isDocumentDirty(state)).toBe(false); expect(serializeDocument(state.document)).toBe(beforeText);
    state = editorReducer(state, { type: 'finish-dimension-retarget', vertexId: pointVertex('P-C').id });
    expect(state.past).toEqual([document]); expect(state.future).toHaveLength(0); expect(isDocumentDirty(state)).toBe(true);
    expect(state.document.entities.find(entity => entity.id === 'dimension-ab')).toMatchObject({ endVertexId: pointVertex('P-C').id, offset: 2 });
    state = editorReducer(state, { type: 'undo' }); expect(state.document).toBe(document);
    state = editorReducer(state, { type: 'redo' }); expect(state.document.entities.find(entity => entity.id === 'dimension-ab')).toMatchObject({ endVertexId: pointVertex('P-C').id });
  });

  it('cancels or rejects invalid drag without mutation, history or dirty state', () => {
    const { document, pointVertex } = fixture();
    let state = initialEditorState(document);
    state = editorReducer(state, { type: 'begin-dimension-retarget', dimensionId: 'dimension-ab', endpoint: 'start' });
    state = editorReducer(state, { type: 'preview-dimension-retarget', vertexId: pointVertex('P-D').id });
    state = editorReducer(state, { type: 'cancel-transaction' });
    expect(state.document).toBe(document); expect(state.transactionBefore).toBeNull(); expect(state.dimensionRetarget).toBeNull(); expect(isDocumentDirty(state)).toBe(false);
    state = editorReducer(state, { type: 'begin-dimension-retarget', dimensionId: 'dimension-ab', endpoint: 'start' });
    state = editorReducer(state, { type: 'finish-dimension-retarget', vertexId: pointVertex('P-B').id });
    expect(state.document).toBe(document); expect(state.past).toHaveLength(0); expect(state.error).toMatch(/разные вершины/); expect(isDocumentDirty(state)).toBe(false);
  });

  it('dropping on the current endpoint is an identity no-op without history', () => {
    const { document, dimension } = fixture();
    let state = initialEditorState(document);
    state = editorReducer(state, { type: 'begin-dimension-retarget', dimensionId: dimension.id, endpoint: 'start' });
    state = editorReducer(state, { type: 'finish-dimension-retarget', vertexId: dimension.startVertexId });
    expect(state.document).toBe(document); expect(state.past).toHaveLength(0); expect(state.future).toHaveLength(0); expect(isDocumentDirty(state)).toBe(false);
  });

  it('inspector pick waits for an existing vertex and is one undoable command', () => {
    const { document, pointVertex } = fixture();
    let state = initialEditorState(document);
    state = editorReducer(state, { type: 'begin-dimension-pick', dimensionId: 'dimension-ab', endpoint: 'start' });
    expect(state.document).toBe(document); expect(state.past).toHaveLength(0); expect(state.dimensionPick).toEqual({ dimensionId: 'dimension-ab', endpoint: 'start' });
    state = editorReducer(state, { type: 'finish-dimension-pick', vertexId: pointVertex('P-C').id });
    expect(state.dimensionPick).toBeNull(); expect(state.past).toEqual([document]); expect(state.document.entities.find(entity => entity.id === 'dimension-ab')).toMatchObject({ startVertexId: pointVertex('P-C').id });
    expect(editorReducer(state, { type: 'undo' }).document).toBe(document);
  });

  it('preserves georeferencing snapshots and round-trips endpoint IDs through Save/Open', () => {
    const { document, pointVertex } = fixture();
    const reference = document.horizontalReference;
    expect(documentModelFrame(document)).toBe('local'); expect(staleControls(document)).toEqual([]);
    const next = applyCommand(document, { type: 'update-dimension-reference', dimensionId: 'dimension-ab', endpoint: 'end', vertexId: pointVertex('P-C').id });
    expect(next.horizontalReference).toEqual(reference); expect(next.verticalReference).toEqual(document.verticalReference); expect(staleControls(next)).toEqual([]);
    const reopened = deserializeDocument(serializeDocument(next));
    expect(reopened.entities.find(entity => entity.id === 'dimension-ab')).toMatchObject({ startVertexId: pointVertex('P-A').id, endVertexId: pointVertex('P-C').id });
    expect(reopened.horizontalReference).toEqual(reference); expect(staleControls(reopened)).toEqual([]);
  });
});
