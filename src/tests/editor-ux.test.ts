import { describe, expect, it } from 'vitest';
import { applyCommand } from '../domain/commands';
import { createGeometryCommand, createLabelCommand } from '../domain/geometryIntent';
import { resolveLabelTemplate, labelAnchor, resolvedLabelPosition } from '../geometry/labels';
import { createSampleDocument } from '../sample/document';
import { deserializeDocument, serializeDocument } from '../persistence/serialization';
import { editorReducer, initialEditorState } from '../store/editor';
import { renderItems } from '../renderer/selectors';
import { resolveShortcut, shortcutMatchesPrefix, shortcutNeedsWait } from '../editor/shortcuts';
import type { GeoDocument, LabelEntity } from '../domain/model';

const withLabel = (document: GeoDocument, targetId: string, id = `label-${targetId}`) => {
  const command = createLabelCommand(document, targetId, prefix => `${id}-${prefix}`);
  return applyCommand(document, command);
};
const labelOf = (document: GeoDocument) => document.entities.filter(entity => entity.type === 'label').at(-1) as LabelEntity;

describe('persistent linked labels', () => {
  it.each(['p1', 'baseline-01', 'survey-path', 'boundary-01'])('supports target %s with a derived anchor', targetId => {
    const document = withLabel(createSampleDocument(), targetId);
    const label = labelOf(document), target = document.entities.find(entity => entity.id === targetId)!;
    expect(label.targetId).toBe(targetId);
    expect(labelAnchor(document, target)).toMatchObject(resolvedLabelPosition(document, { ...label, dx: 0, dy: 0 })!);
  });
  it('recomputes its target anchor and preserves world offset as geometry moves', () => {
    const original = withLabel(createSampleDocument(), 'baseline-01'), label = labelOf(original);
    const initial = resolvedLabelPosition(original, label)!;
    const initialText = resolveLabelTemplate(original, label);
    const moved = applyCommand(original, { type: 'update-vertex', vertexId: 'v-sp1', position: { x: 1010, y: 2010 } });
    const next = resolvedLabelPosition(moved, labelOf(moved))!;
    expect(next.x - label.dx).not.toBe(initial.x - label.dx);
    expect(labelOf(moved).dx).toBe(label.dx);
    expect(resolveLabelTemplate(moved, labelOf(moved))).not.toBe(initialText);
  });
  it('renders whitelisted fields with centralized formatting and leaves unknown tokens literal', () => {
    let document = withLabel(createSampleDocument(), 'p1');
    let label = labelOf(document);
    document = applyCommand(document, { type: 'update-entity', entityId: label.id, patch: { template: '{name} {x} {y} {z} {unknown}' } });
    expect(resolveLabelTemplate(document, labelOf(document))).toBe('P1 1000.000 2000.000 152.340 {unknown}');
    document = withLabel(document, 'baseline-01', 'l1'); label = labelOf(document);
    document = applyCommand(document, { type: 'update-entity', entityId: label.id, patch: { template: 'L={length}' } });
    expect(resolveLabelTemplate(document, labelOf(document))).toBe('L=40,925');
    document = withLabel(document, 'survey-path', 'l2'); label = labelOf(document);
    document = applyCommand(document, { type: 'update-entity', entityId: label.id, patch: { template: '{length}' } });
    expect(resolveLabelTemplate(document, labelOf(document))).toBe('56,459');
    document = withLabel(document, 'boundary-01', 'l3'); label = labelOf(document);
    document = applyCommand(document, { type: 'update-entity', entityId: label.id, patch: { template: '{area} {perimeter}' } });
    expect(resolveLabelTemplate(document, labelOf(document))).toBe('2 400,000 200,000');
  });
  it('deletes a label without its target and cascades target deletion into one undoable snapshot', () => {
    const start = withLabel(createSampleDocument(), 'baseline-01'), labelId = labelOf(start).id;
    const afterLabel = applyCommand(start, { type: 'delete-entity', entityId: labelId });
    expect(afterLabel.entities.some(entity => entity.id === 'baseline-01')).toBe(true);
    const initial = initialEditorState(start);
    const deleted = editorReducer(initial, { type: 'execute', command: { type: 'delete-entity', entityId: 'baseline-01' } });
    expect(deleted.document.entities.some(entity => entity.id === labelId)).toBe(false);
    expect(editorReducer(deleted, { type: 'undo' }).document.entities.some(entity => entity.id === labelId)).toBe(true);
  });
  it('round-trips label target, formatting precision and old v2 documents', () => {
    const document = withLabel(createSampleDocument(), 'boundary-01');
    expect(deserializeDocument(serializeDocument(document))).toEqual(document);
    expect(deserializeDocument(serializeDocument(createSampleDocument()))).toEqual(createSampleDocument());
    expect(() => deserializeDocument(JSON.stringify({ ...document, entities: document.entities.map(entity => entity.type === 'label' ? { ...entity, targetId: 'missing' } : entity) }))).toThrow(/references missing or unsupported target/);
  });
  it('renames layers through a history command and keeps layer selection outside history', () => {
    let state = initialEditorState(createSampleDocument());
    state = editorReducer(state, { type: 'select-layer', layerId: 'annotations' });
    expect(state.selectedLayerId).toBe('annotations'); expect(state.currentLayerId).toBe('annotations'); expect(state.past).toHaveLength(0);
    state = editorReducer(state, { type: 'execute', command: { type: 'update-layer', layerId: 'annotations', name: 'Примечания' } });
    expect(state.document.layers.find(layer => layer.id === 'annotations')?.name).toBe('Примечания');
    expect(editorReducer(state, { type: 'undo' }).document.layers.find(layer => layer.id === 'annotations')?.name).toBe('Аннотации');
  });
  it('selects all objects in a layer without history and creates manual text in a selected writable layer', () => {
    let state = initialEditorState(createSampleDocument());
    state = editorReducer(state, { type: 'select-layer-objects', layerId: 'survey-points' });
    expect(state.selectedEntityIds).toContain('sp1'); expect(state.past).toHaveLength(0);
    const command = createGeometryCommand(state.document, 'text', [{ position: { x: 10, y: 20 } }], { content: 'Note', layerId: 'annotations', newId: prefix => `${prefix}-custom` });
    expect(command).toMatchObject({ type: 'add-entity', entity: { type: 'text', layerId: 'annotations' } });
    const hidden = applyCommand(state.document, { type: 'set-layer-visibility', layerId: 'annotations', visible: false });
    expect(() => createGeometryCommand(hidden, 'text', [{ position: { x: 1, y: 2 } }], { content: 'x', layerId: 'annotations' })).toThrow(/скрыт или заблокирован/);
  });
  it('moves text through transient commands and commits one undoable history entry', () => {
    const initial = initialEditorState(createSampleDocument()); let state = editorReducer(initial, { type: 'begin-transaction' });
    state = editorReducer(state, { type: 'transient', command: { type: 'move-text', entityId: 'building-label', vertexId: 'v-detached', position: { x: 1030, y: 2030 } } });
    state = editorReducer(state, { type: 'transient', command: { type: 'move-text', entityId: 'building-label', vertexId: 'v-detached', position: { x: 1031, y: 2031 } } });
    state = editorReducer(state, { type: 'commit-transaction' });
    expect(state.past).toHaveLength(1); expect(state.document.vertices['v-building-label']).toMatchObject({ x: 1031, y: 2031 });
    expect(editorReducer(state, { type: 'undo' }).document.entities.find(entity => entity.id === 'building-label')).toMatchObject({ vertexId: 'v-building-label' });
    expect(editorReducer(editorReducer(state, { type: 'undo' }), { type: 'redo' }).document.vertices['v-building-label']?.x).toBe(1031);
  });
  it('allows a label to move while its target is locked and hides it with either layer', () => {
    let document = withLabel(createSampleDocument(), 'baseline-01'); const label = labelOf(document);
    document = applyCommand(document, { type: 'set-layer-lock', layerId: 'boundary', locked: true });
    expect(applyCommand(document, { type: 'update-entity', entityId: label.id, patch: { dx: 20 } }).entities.find(entity => entity.id === label.id)).toMatchObject({ dx: 20 });
    document = applyCommand(document, { type: 'set-layer-visibility', layerId: 'boundary', visible: false });
    expect(renderItems(document).some(item => item.entity.id === label.id)).toBe(false);
    document = applyCommand(document, { type: 'set-layer-visibility', layerId: 'boundary', visible: true });
    document = applyCommand(document, { type: 'set-layer-visibility', layerId: 'annotations', visible: false });
    expect(renderItems(document).some(item => item.entity.id === label.id)).toBe(false);
  });
});

describe('shortcut sequence resolver', () => {
  it.each([[['L'], 'line'], [['P', 'L'], 'polyline'], [['P', 'O'], 'point'], [['P', 'O', 'L'], 'polygon'], [['T'], 'text'], [['D', 'I', 'M'], 'dimension'], [['D', 'I'], 'measure'], [['V'], 'select'], [['F'], 'fit'], [['Z', 'E'], 'fit-extents'], [['?'], 'help']] as const)('%s maps to %s', (sequence, expected) => {
    expect(resolveShortcut(sequence)?.id).toBe(expected);
  });
  it('waits on PO and DI prefixes, then resolves a single fallback after timeout', () => {
    expect(shortcutMatchesPrefix(['P'])).toBe(true); expect(resolveShortcut(['P'])).toBeNull();
    expect(shortcutNeedsWait(['P', 'O'])).toBe(true); expect(resolveShortcut(['P', 'O'])?.id).toBe('point');
    expect(shortcutNeedsWait(['D', 'I'])).toBe(true); expect(resolveShortcut(['D', 'I'])?.id).toBe('measure');
    expect(resolveShortcut(['P', 'L'])?.id).toBe('polyline'); expect(resolveShortcut(['D', 'I', 'M'])?.id).toBe('dimension');
  });
});
