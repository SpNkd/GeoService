import { describe, expect, it } from 'vitest';
import { createSampleDocument } from '../sample/document';
import { createNewDocument } from '../domain/newDocument';
import { validateDocument } from '../persistence/documentSchema';
import { deserializeDocument, serializeDocument } from '../persistence/serialization';
import { DIRTY_KEY, persistLocalDocument, restoreLocalDocument, STORAGE_KEY } from '../persistence/local';
import { fitToBounds } from '../geometry';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Grid } from '../renderer/Grid';
import { editorReducer, initialEditorState, isDocumentDirty } from '../store/editor';

const size = { width: 900, height: 600 };
describe('document persistence boundary', () => {
  it('round-trips valid v2 and shared references, stripping UI-only state', () => {
    const document = createSampleDocument();
    const text = serializeDocument({ ...document, selection: 'p1', past: [document], modal: true } as typeof document);
    expect(deserializeDocument(text)).toEqual(document);
    expect(text).not.toContain('selection'); expect(text).not.toContain('modal');
    const result = deserializeDocument(text);
    expect(result.entities.find(entity => entity.id === 'p1')).toMatchObject({ vertexId: 'v-p1' });
    expect(result.entities.find(entity => entity.id === 'boundary-01')).toMatchObject({ vertexIds: expect.arrayContaining(['v-p1']) });
  });
  it('preserves full floating point precision at real-world large coordinates', () => {
    const document = createSampleDocument();
    document.vertices['v-p1'] = { id: 'v-p1', x: 562341.234123456, y: 6189345.221234567, z: 152.340012345678 };
    expect(deserializeDocument(serializeDocument(document)).vertices['v-p1']).toEqual(document.vertices['v-p1']);
  });
  it('rejects missing vertices with an actionable error', () => {
    const document = createSampleDocument(); delete document.vertices['v-p1'];
    expect(() => validateDocument(document)).toThrow('Entity boundary-01 references missing vertex v-p1');
  });
  it.each([1, 3, undefined])('rejects unsupported version %s without inventing a legacy migration', version => {
    expect(() => deserializeDocument(JSON.stringify({ ...createSampleDocument(), schemaVersion: version }))).toThrow('Unsupported document version');
  });
  it.each(['layers', 'entities', 'styles'] as const)('rejects duplicate %s IDs', key => {
    const document = createSampleDocument();
    const raw = { ...document, [key]: [...document[key], document[key][0]] };
    expect(() => validateDocument(raw)).toThrow('Duplicate');
  });
  it('rejects missing layer/style, registry ID mismatch and nonfinite coordinates', () => {
    const missingLayer = createSampleDocument(); missingLayer.entities[0]!.layerId = 'missing';
    expect(() => validateDocument(missingLayer)).toThrow('missing layer');
    const missingStyle = createSampleDocument(); missingStyle.layers[0]!.styleId = 'missing';
    expect(() => validateDocument(missingStyle)).toThrow('missing style');
    const wrongKey = createSampleDocument(); wrongKey.vertices['v-p1']!.id = 'v-other';
    expect(() => validateDocument(wrongKey)).toThrow('does not match');
    const infinite = createSampleDocument(); infinite.vertices['v-p1']!.x = Infinity;
    expect(() => validateDocument(infinite)).toThrow('vertices.v-p1.x');
  });
  it('rejects incorrect units, axes and entity shapes', () => {
    const document = createSampleDocument();
    expect(() => validateDocument({ ...document, units: { length: 'ft', area: 'm2' } })).toThrow('units.length');
    expect(() => validateDocument({ ...document, coordinateSystem: { ...document.coordinateSystem, xAxis: 'north' } })).toThrow('coordinateSystem.xAxis');
    expect(() => validateDocument({ ...document, entities: [{ id: 'a', name: 'A', layerId: 'boundary', type: 'polygon', vertexIds: ['v-p1'] }] })).toThrow();
  });
  it('malformed and semantically invalid JSON preserve current document, history, selection and view', () => {
    let state = initialEditorState(createSampleDocument());
    state = editorReducer(state, { type: 'select', entityId: 'p1' });
    state = editorReducer(state, { type: 'execute', command: { type: 'update-vertex', vertexId: 'v-p1', position: { x: 1010, y: 2000 } } });
    for (const text of ['{broken', JSON.stringify({ ...state.document, vertices: {} })]) {
      const next = editorReducer(state, { type: 'load-json', text, size });
      expect(next.document).toBe(state.document); expect(next.past).toBe(state.past);
      expect(next.selectionId).toBe('p1'); expect(next.viewport).toBe(state.viewport); expect(next.error).toBeTruthy();
    }
  });
  it('successful open resets history/selection/dirty and fits geometry', () => {
    const state = { ...initialEditorState(createSampleDocument()), selectionId: 'p1', past: [createSampleDocument()] };
    const result = editorReducer(state, { type: 'load-json', text: serializeDocument(state.document), size });
    expect(result.past).toEqual([]); expect(result.future).toEqual([]); expect(result.selectionId).toBeNull();
    expect(isDocumentDirty(result)).toBe(false); expect(result.viewport.center).toEqual({ x: 1030, y: 2020 });
    expect(result.documentEpoch).toBe(1);
  });
  it('New creates a valid, empty, clean document with editor layers', () => {
    const document = createNewDocument(); expect(validateDocument(document)).toEqual(document);
    expect(document.entities).toEqual([]); expect(document.vertices).toEqual({});
    expect(document.layers.map(layer => layer.id)).toContain('survey-points');
    expect(isDocumentDirty(initialEditorState(document))).toBe(false);
  });
  it('dirty follows Save and undo/redo of saved content; autosave does not reset it', () => {
    let state = initialEditorState(createSampleDocument());
    state = editorReducer(state, { type: 'execute', command: { type: 'update-vertex', vertexId: 'v-p1', position: { x: 1010, y: 2000 } } });
    expect(isDocumentDirty(state)).toBe(true);
    persistLocalDocument({ setItem: () => {} }, state.document);
    expect(isDocumentDirty(state)).toBe(true);
    state = editorReducer(state, { type: 'mark-saved' }); expect(isDocumentDirty(state)).toBe(false);
    state = editorReducer(state, { type: 'undo' }); expect(isDocumentDirty(state)).toBe(true);
    state = editorReducer(state, { type: 'redo' }); expect(isDocumentDirty(state)).toBe(false);
  });
  it('restores valid autosave and falls back without crashing for corrupt or unavailable storage', () => {
    const text = serializeDocument(createNewDocument());
    expect(restoreLocalDocument({ getItem: key => key === STORAGE_KEY ? text : null }, createSampleDocument).document).toEqual(deserializeDocument(text));
    expect(restoreLocalDocument({ getItem: () => '{broken' }, createSampleDocument).notice).toBeTruthy();
    expect(restoreLocalDocument({ getItem: () => { throw new Error('denied'); } }, createSampleDocument).document).toEqual(createSampleDocument());
    expect(persistLocalDocument({ setItem: () => { throw new Error('quota'); } }, createSampleDocument())).toContain('лимит');
  });
  it('persists dirty separately from canonical JSON and restores it without history', () => {
    const saved = new Map<string, string>();
    const storage = { setItem: (key: string, value: string) => { saved.set(key, value); }, getItem: (key: string) => saved.get(key) ?? null };
    const document = createNewDocument();
    expect(persistLocalDocument(storage, document, true)).toBeNull();
    expect(saved.get(DIRTY_KEY)).toBe('true'); expect(deserializeDocument(saved.get(STORAGE_KEY)!)).toEqual(document);
    expect(restoreLocalDocument(storage, createSampleDocument).dirty).toBe(true);
    persistLocalDocument(storage, document, false); expect(restoreLocalDocument(storage, createSampleDocument).dirty).toBe(false);
  });
  it('bounds JSON size and prevents dangerous view scale while retaining finite coordinate values', () => {
    expect(() => deserializeDocument(' '.repeat(10 * 1024 * 1024 + 1))).toThrow('10 МБ');
    const document = createNewDocument(); document.viewport.pixelsPerUnit = 1e-300;
    expect(() => validateDocument(document)).toThrow('viewport.pixelsPerUnit');
  });
  it('fits extreme finite coordinates without overflow and does not hang grid indices beyond safe integer range', () => {
    const viewport = fitToBounds({ minX: -1e308, maxX: 1e308, minY: 1e100, maxY: 1e100 }, size)!;
    expect(Number.isFinite(viewport.center.x)).toBe(true);
    const markup = renderToStaticMarkup(createElement(Grid, { viewport: { center: { x: 1e100, y: 1e100 }, pixelsPerUnit: 10 }, size }));
    expect(markup).not.toContain('<line');
  });
});
