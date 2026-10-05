import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyCommand, canEditVertex, lockedVertexIds, type DocumentCommand } from '../domain/commands';
import { createNewDocument } from '../domain/newDocument';
import { createGeometryCommand } from '../domain/geometryIntent';
import { entityVertexIds } from '../domain/model';
import { polygonSelfIntersects } from '../geometry/survey';
import { deserializeDocument, MAX_DOCUMENT_BYTES, serializeDocument } from '../persistence/serialization';
import { validateDocument } from '../persistence/documentSchema';
import { EntityView } from '../renderer/EntityView';
import { renderItems } from '../renderer/selectors';
import { createSampleDocument } from '../sample/document';
import { editorReducer, initialEditorState, isDocumentDirty } from '../store/editor';

const size = { width: 900, height: 600 };
describe('non-UI command boundary', () => {
  it.each([
    { type: 'update-entity', entityId: 'p1', patch: { type: 'point', vertexId: 'missing' } },
    { type: 'update-entity', entityId: 'p1', patch: { layerId: 'buildings' } },
    { type: 'update-entity', entityId: 'p1', patch: { name: 'x'.repeat(1001) } },
    { type: 'update-entity', entityId: 'p1', patch: { name: ` ${'x'.repeat(1000)} ` } },
    { type: 'update-entity', entityId: 'building-label', patch: { content: '' } },
    { type: 'unknown', entityId: 'p1', patch: {} },
    { type: 'move-vertex', vertexId: '__proto__', delta: { x: 0, y: 0 } },
    { type: 'set-layer-lock', layerId: 'survey-points', locked: 'false' },
    { type: 'update-vertex', vertexId: 'v-p1', position: { x: 1, y: 2, screenX: 30 } },
  ])('rejects malformed runtime input atomically: $type', raw => {
    const d = createSampleDocument(), before = serializeDocument(d);
    expect(() => applyCommand(d, raw)).toThrow();
    expect(serializeDocument(d)).toBe(before);
    expect(Object.getPrototypeOf(d.vertices)).toBe(Object.prototype);
  });
  it('rejects reserved IDs, unknown entity fields and invalid layer properties on creation', () => {
    const d = createNewDocument();
    const command = { type: 'add-entity', entity: { type: 'point', id: 'p', name: 'P', layerId: 'survey-points', vertexId: 'v' }, vertices: [{ id: 'v', x: 1, y: 2 }] };
    expect(() => applyCommand(d, { ...command, entity: { ...command.entity, id: 'constructor' } })).toThrow();
    expect(() => applyCommand(d, { ...command, entity: { ...command.entity, x: 999 } })).toThrow();
    expect(() => applyCommand(d, { ...command, entity: { ...command.entity, type: 'arc' } })).toThrow();
    expect(() => applyCommand(d, { ...command, layer: { ...d.layers[0], id: 'new', order: .5 } })).toThrow();
  });
  it('is deterministic independent of tool/selection/camera and owns inserted payloads', () => {
    const d = createSampleDocument();
    const command: DocumentCommand = { type: 'add-entity', entity: { type: 'line', id: 'shared-line', name: 'L', layerId: 'boundary', startVertexId: 'v-p1', endVertexId: 'v-p2' }, vertices: [] };
    const a = editorReducer(initialEditorState(d), { type: 'execute', command });
    const b = editorReducer({ ...initialEditorState(d), tool: 'measure', selectionId: 'sp1', viewport: { center: { x: -20, y: 30 }, pixelsPerUnit: 1 } }, { type: 'execute', command });
    expect(a.document).toEqual(b.document); expect(a.document).toEqual(applyCommand(d, command));
    command.entity.name = 'External mutation';
    expect(a.document.entities.at(-1)!.name).toBe('L'); expect(a.past[0]).toBe(d);
  });
  it('executes the parsed coordinate payload without re-reading caller getters', () => {
    let reads = 0;
    const position = { get x() { reads++; return reads === 1 ? 1001 : NaN; }, y: 2000 };
    const d = applyCommand(createSampleDocument(), { type: 'update-vertex', vertexId: 'v-p1', position });
    expect(d.vertices['v-p1']!.x).toBe(1001); expect(reads).toBe(1); expect(() => validateDocument(d)).not.toThrow();
  });
  it('bounds resolved path references even when they reuse existing vertices', () => {
    const d = createSampleDocument();
    expect(() => applyCommand(d, { type: 'add-entity', entity: { type: 'polyline', id: 'oversized', name: 'Path', layerId: 'boundary', vertexIds: Array(50001).fill('v-p1') }, vertices: [] })).toThrow(/50 000/);
  });
  it('enforces the layer limit before adding a layer and entity', () => {
    const d = createNewDocument(); d.layers = Array.from({ length: 1000 }, (_, i) => ({ ...d.layers[0]!, id: `layer${i}` }));
    expect(() => applyCommand(d, { type: 'add-entity', entity: { type: 'point', id: 'p', name: 'P', layerId: 'extra', vertexId: 'v' }, vertices: [{ id: 'v', x: 1, y: 2 }], layer: { ...d.layers[0]!, id: 'extra' } })).toThrow(/1000/);
    expect(d.entities).toEqual([]);
  });
  it('does not write undefined mutable properties into an entity', () => {
    const d = createSampleDocument();
    const next = applyCommand(d, { type: 'update-entity', entityId: 'p1', patch: { name: undefined } });
    expect(validateDocument(next)).toEqual(d);
  });
  it('bulk handle policy preserves shared locks across hidden layers and consumer changes', () => {
    let d = createSampleDocument();
    d = applyCommand(d, { type: 'set-layer-lock', layerId: 'boundary', locked: true });
    d = applyCommand(d, { type: 'set-layer-visibility', layerId: 'boundary', visible: false });
    d = applyCommand(d, { type: 'delete-entity', entityId: 'p1' });
    const locked = lockedVertexIds(d);
    expect(locked.has('v-p1')).toBe(true); expect(locked.has('v-sp2')).toBe(false);
    for (const id of Object.keys(d.vertices)) expect(!locked.has(id)).toBe(canEditVertex(d, id));
    d = applyCommand(d, { type: 'set-layer-lock', layerId: 'boundary', locked: false });
    expect(lockedVertexIds(d).has('v-p1')).toBe(false);
  });
  it('protects every entity/vertex mutation route when a shared dimension layer is locked', () => {
    let d = createSampleDocument();
    d = applyCommand(d, createGeometryCommand(d, 'dimension', [{ vertexId: 'v-p1', position: d.vertices['v-p1']! }, { vertexId: 'v-p2', position: d.vertices['v-p2']! }]));
    const dim = d.entities.at(-1)!;
    d = applyCommand(d, { type: 'set-layer-lock', layerId: 'dimensions', locked: true });
    for (const raw of [
      { type: 'update-vertex', vertexId: 'v-p1', position: { x: 1, y: 2 } },
      { type: 'move-vertex', vertexId: 'v-p1', delta: { x: 1, y: 2 } },
      { type: 'delete-entity', entityId: dim.id },
      { type: 'update-entity', entityId: dim.id, patch: { name: 'Changed' } },
      { type: 'set-entity-layer', entityId: dim.id, layerId: 'boundary' },
      { type: 'set-entity-layer', entityId: 'p1', layerId: 'dimensions' },
      { type: 'add-entity', entity: { type: 'point', id: 'x', name: 'X', layerId: 'dimensions', vertexId: 'v-p1' }, vertices: [] },
      { type: 'import-points', points: [{ entity: { type: 'point', id: 'x', name: 'X', layerId: 'dimensions', vertexId: 'v-x' }, vertex: { id: 'v-x', x: 1, y: 2 } }] },
    ]) expect(() => applyCommand(d, raw)).toThrow(/заблокирован/);
  });
});

describe('replacement, history and reference ownership', () => {
  it('validates and owns replacement input; failed replacement preserves document/history/view', () => {
    const initial = initialEditorState(createSampleDocument());
    const state = editorReducer(initial, { type: 'execute', command: { type: 'move-vertex', vertexId: 'v-p1', delta: { x: 1, y: 0 } } });
    const failed = editorReducer(state, { type: 'replace-document', document: { ...state.document, vertices: {} }, size });
    expect(failed.document).toBe(state.document); expect(failed.past).toBe(state.past); expect(failed.viewport).toBe(state.viewport); expect(failed.documentEpoch).toBe(state.documentEpoch); expect(failed.error).toBeTruthy();
    const payload = createSampleDocument(), replaced = editorReducer(state, { type: 'replace-document', document: payload, size });
    payload.vertices['v-p1']!.x = 999; payload.entities[0]!.name = 'Outside';
    expect(replaced.document.vertices['v-p1']!.x).toBe(1000); expect(replaced.document.entities[0]!.name).not.toBe('Outside'); expect(replaced.past).toEqual([]);
  });
  it('retains Point + Line + Dimension vertices through deletion, Undo/Redo and JSON until the last consumer', () => {
    let d = createNewDocument();
    for (const [id, x] of [['a', 562000], ['b', 562010]] as const) d = applyCommand(d, { type: 'add-entity', entity: { type: 'point', id, name: id, layerId: 'survey-points', vertexId: `v-${id}` }, vertices: [{ id: `v-${id}`, x, y: 6189000 }] });
    const anchors = ['a', 'b'].map(id => ({ vertexId: `v-${id}`, position: d.vertices[`v-${id}`]! }));
    d = applyCommand(d, createGeometryCommand(d, 'line', anchors)); const line = d.entities.at(-1)!;
    d = applyCommand(d, createGeometryCommand(d, 'dimension', anchors, { offset: -2 })); const dim = d.entities.at(-1)!;
    let state = initialEditorState(d);
    for (const entityId of ['a', 'b', line.id]) {
      const before = state.document;
      state = editorReducer(state, { type: 'execute', command: { type: 'delete-entity', entityId } });
      expect(state.document.vertices['v-a']).toBeDefined(); expect(state.document.vertices['v-b']).toBeDefined();
      expect(deserializeDocument(serializeDocument(state.document))).toEqual(state.document);
      const undo = editorReducer(state, { type: 'undo' }); expect(undo.document).toBe(before);
      expect(editorReducer(undo, { type: 'redo' }).document).toBe(state.document);
      for (const entity of state.document.entities) for (const id of entityVertexIds(entity)) expect(state.document.vertices[id]).toBeDefined();
    }
    const before = state.document;
    state = editorReducer(state, { type: 'execute', command: { type: 'delete-entity', entityId: dim.id } });
    expect(state.document.vertices).toEqual({}); expect(editorReducer(state, { type: 'undo' }).document).toBe(before);
    expect(editorReducer(editorReducer(state, { type: 'undo' }), { type: 'redo' }).document.vertices).toEqual({});
  });
  it('allows only coordinate updates in transient transactions; rejection does not invalidate redo', () => {
    let state = initialEditorState(createSampleDocument());
    state = editorReducer(state, { type: 'execute', command: { type: 'move-vertex', vertexId: 'v-p1', delta: { x: 1, y: 0 } } });
    state = editorReducer(editorReducer(state, { type: 'undo' }), { type: 'begin-transaction' });
    const rejected = editorReducer(state, { type: 'transient', command: { type: 'delete-entity', entityId: 'p1' } });
    expect(rejected.document).toBe(state.document); expect(rejected.future).toBe(state.future); expect(rejected.error).toContain('только');
  });
  it('detects a changed transient draft without serializing the document', () => {
    let state = editorReducer(initialEditorState(createSampleDocument()), { type: 'begin-transaction' });
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      for (let i = 0; i < 20; i++) {
        state = editorReducer(state, { type: 'transient', command: { type: 'move-vertex', vertexId: 'v-p1', delta: { x: .01, y: 0 } } });
        expect(isDocumentDirty(state)).toBe(true);
      }
      expect(stringify).not.toHaveBeenCalled(); expect(state.past).toHaveLength(0);
    } finally { stringify.mockRestore(); }
    state = editorReducer(state, { type: 'cancel-transaction' }); expect(isDocumentDirty(state)).toBe(false);
  });
});

describe('geometry and persistence audit regressions', () => {
  it('rejects adjacent backtracking and zero-length boundary edges while accepting straight continuation', () => {
    expect(polygonSelfIntersects([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }])).toBe(true);
    expect(polygonSelfIntersects([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }])).toBe(true);
    expect(polygonSelfIntersects([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(false);
  });
  it('saves a 50k document within the portable byte limit and enforces command capacity', () => {
    const d = createNewDocument();
    for (let i = 0; i < 50000; i++) {
      const id = `v${i}`; d.vertices[id] = { id, x: 562000 + i, y: 6189000, z: 100 };
      d.entities.push({ type: 'point', id: `p${i}`, name: `P${i}`, layerId: 'survey-points', vertexId: id });
    }
    const bytes = (text: string) => new TextEncoder().encode(text).length;
    expect(bytes(JSON.stringify(d))).toBeLessThan(MAX_DOCUMENT_BYTES); expect(bytes(JSON.stringify(d, null, 2))).toBeGreaterThan(10 * 1024 * 1024);
    const saved = serializeDocument(deserializeDocument(JSON.stringify(d))); expect(bytes(saved)).toBeLessThan(MAX_DOCUMENT_BYTES);
    expect(deserializeDocument(saved)).toEqual(d);
    expect(() => applyCommand(d, { type: 'add-entity', entity: { type: 'point', id: 'extra', name: 'Extra', layerId: 'survey-points', vertexId: 'v0' }, vertices: [] })).toThrow(/50 000/);
  });
  it('preserves benign v2 literal colours including CSS whitespace', () => {
    const d = createSampleDocument(); d.styles[0]!.stroke = ' #abc '; d.styles[0]!.fill = ' rgba(0,0,0,.5) ';
    expect(deserializeDocument(serializeDocument(d))).toEqual(d);
  });
  it.each(['url(https://audit.invalid/image)', 'u\\72l(https://audit.invalid/image)', 'var(--external-paint)'])('rejects external paint syntax in JSON: %s', colour => {
    const d = createSampleDocument(); d.styles[0]!.stroke = colour;
    expect(() => deserializeDocument(JSON.stringify(d))).toThrow(/styles.0.stroke/);
  });
  it('renders hostile JSON labels as escaped SVG text without executable elements', () => {
    const d = createSampleDocument(); d.entities[0]!.name = '<script>alert(1)</script>';
    const item = renderItems(validateDocument(d)).find(item => item.entity.id === d.entities[0]!.id)!;
    const markup = renderToStaticMarkup(createElement(EntityView, { item, document: d, viewport: d.viewport, size, selected: false }));
    expect(markup).toContain('&lt;script&gt;'); expect(markup).not.toContain('<script>');
  });
});
