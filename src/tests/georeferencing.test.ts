import { describe, expect, it } from 'vitest';
import { absoluteToModelZ, computeRigidTransform2D, createHorizontalReference, documentModelFrame, documentSurveyXY, GEOREFERENCE_POLICY, modelToAbsoluteZ, modelToSurveyXY, staleControls, surveyNorthDirection, surveyToModelXY } from '../geometry/georeferencing';
import { createNewDocument } from '../domain/newDocument';
import { applyCommand, applyCommandsAtomically, type DocumentCommand } from '../domain/commands';
import type { GeoDocument, LabelEntity, RigidTransform2D } from '../domain/model';
import { initialEditorState, editorReducer, isDocumentDirty } from '../store/editor';
import { deserializeDocument, serializeDocument } from '../persistence/serialization';
import { resolveLabelTemplate } from '../geometry/labels';
import { validateDocument } from '../persistence/documentSchema';

const a = { x: 0, y: 0 }, b = { x: 30, y: 0 }, surveyA = { e: 500000, n: 6000000 }, surveyB = { e: 500000, n: 6000030 };
function fixture(): GeoDocument {
  const base = createNewDocument();
  return { ...base, vertices: { v1: { id: 'v1', x: 0, y: 0, z: 2.5 }, v2: { id: 'v2', x: 30, y: 0 }, v3: { id: 'v3', x: 30, y: 20 } }, entities: [1, 2, 3].map(i => ({ id: `p${i}`, type: 'point', vertexId: `v${i}`, name: `P${i}`, layerId: 'boundary' })) };
}
const command: DocumentCommand = { type: 'set-horizontal-reference', pairs: [{ pointEntityId: 'p1', survey: surveyA }, { pointEntityId: 'p2', survey: surveyB }] };
const calibrated = () => applyCommand(fixture(), command);
const heightCommand: DocumentCommand = { type: 'set-vertical-reference', reference: { modelZero: 0, absoluteAtModelZero: 153.42 } };
const label: LabelEntity = { id: 'label', name: 'Высота', layerId: 'boundary', type: 'label', targetId: 'p1', template: 'Z={z}; H={h_absolute}', dx: 1, dy: 1 };

describe('rigid math and north', () => {
  it.each([0, 90, 45, -30, -135])('rotation %s degrees with displaced MODEL origin and large survey origin', degrees => {
    const rotation = degrees * Math.PI / 180;
    const expected: RigidTransform2D = { rotation, translation: surveyA, scale: 1 };
    const ma = { x: 12, y: -6 }, mb = { x: 42, y: -6 };
    const result = computeRigidTransform2D(ma, mb, modelToSurveyXY(ma, expected), modelToSurveyXY(mb, expected));
    expect(result.status).toBe('OK'); expect(result.transform!.scale).toBe(1);
    expect(result.transform!.rotation).toBeCloseTo(rotation, 10);
    expect(result.transform!.translation.e).toBeCloseTo(surveyA.e, 7); expect(result.transform!.translation.n).toBeCloseTo(surveyA.n, 7);
    const p = { x: 5, y: 5 }, actual = modelToSurveyXY(p, result.transform!);
    expect(actual.e).toBeCloseTo(modelToSurveyXY(p, expected).e, 7); expect(actual.n).toBeCloseTo(modelToSurveyXY(p, expected).n, 7);
    const roundtrip = surveyToModelXY(actual, result.transform!);
    expect(roundtrip.x).toBeCloseTo(p.x, 7); expect(roundtrip.y).toBeCloseTo(p.y, 7);
  });
  it('the specified 90° example maps (5,5) to (499995,6000005)', () => {
    const result = computeRigidTransform2D(a, { x: 10, y: 0 }, surveyA, { e: 500000, n: 6000010 });
    expect(modelToSurveyXY({ x: 5, y: 5 }, result.transform!)).toEqual({ e: 499995, n: 6000005 });
  });
  it('1000 large-coordinate round trips preserve lengths without materialization', () => {
    const transform = computeRigidTransform2D(a, b, surveyA, surveyB).transform!;
    for (let i = 0; i < 1000; i++) {
      const point = { x: i * 0.1234 - 30, y: i * -0.07123 + 18 };
      const restored = surveyToModelXY(modelToSurveyXY(point, transform), transform);
      expect(restored.x).toBeCloseTo(point.x, 7); expect(restored.y).toBeCloseTo(point.y, 7);
    }
    const sa = modelToSurveyXY(a, transform), sb = modelToSurveyXY(b, transform);
    expect(Math.hypot(sb.e - sa.e, sb.n - sa.n)).toBeCloseTo(30, 10);
  });
  it.each([0, 90, 45, -90])('survey North %s° has one SVG inversion and maps to +N', degrees => {
    const transform: RigidTransform2D = { rotation: degrees * Math.PI / 180, translation: { e: 0, n: 0 }, scale: 1 };
    const north = surveyNorthDirection(transform), survey = modelToSurveyXY(north.model, transform);
    expect(survey.e).toBeCloseTo(0, 12); expect(survey.n).toBeCloseTo(1, 12);
    expect(north.screen.x).toBe(north.model.x); expect(north.screen.y).toBe(-north.model.y);
  });
});
describe('central safety policy and residuals', () => {
  it('30 vs30.013 is WARNING with signed residual, anchored A and scale1', () => {
    const result = computeRigidTransform2D(a, b, surveyA, { e: 500000, n: 6000030.013 });
    expect(result.status).toBe('WARNING'); expect(result.difference).toBeCloseTo(0.013, 8);
    expect(result.residual!.n).toBeCloseTo(0.013, 8); expect(result.residual!.e).toBeCloseTo(0, 8);
    expect(result.residual!.distance).toBeCloseTo(0.013, 8); expect(modelToSurveyXY(a, result.transform!)).toEqual(surveyA);
    expect(modelToSurveyXY(b, result.transform!).n).toBe(6000030);
  });
  it('negative mismatch keeps signed residual', () => {
    const result = computeRigidTransform2D(a, b, surveyA, { e: 500029.98, n: 6000000 });
    expect(result.status).toBe('WARNING'); expect(result.difference).toBeCloseTo(-0.02, 8); expect(result.residual!.e).toBeCloseTo(-0.02, 8);
  });
  it.each([0, 0.001, 0.009])('difference %s is OK', difference => expect(computeRigidTransform2D(a, b, surveyA, { e: 500030 + difference, n: 6000000 }).status).toBe('OK'));
  it('30 vs42 blocks Apply without stretching', () => {
    const result = computeRigidTransform2D(a, b, surveyA, { e: 500042, n: 6000000 });
    expect(result.status).toBe('INVALID'); expect(result.transform!.scale).toBe(1); expect(result.residual!.distance).toBe(12);
    expect(() => applyCommand(fixture(), { ...command, pairs: [{ pointEntityId: 'p1', survey: surveyA }, { pointEntityId: 'p2', survey: { e: 500042, n: 6000000 } }] })).toThrow('Большое расхождение');
  });
  it.each([0, GEOREFERENCE_POLICY.minimumBaseline / 2])('rejects degenerate/short MODEL baseline %s', length => expect(computeRigidTransform2D(a, { x: length, y: 0 }, surveyA, surveyB).status).toBe('INVALID'));
  it.each([0, 0.05])('rejects degenerate/short SURVEY baseline %s', length => expect(computeRigidTransform2D(a, b, surveyA, { e: surveyA.e + length, n: surveyA.n }).status).toBe('INVALID'));
  it('rejects nonfinite inputs and overflow', () => {
    expect(computeRigidTransform2D(a, { x: Infinity, y: 0 }, surveyA, surveyB).status).toBe('INVALID');
    expect(computeRigidTransform2D({ x: -1e308, y: 0 }, { x: 1e308, y: 0 }, surveyA, surveyB).status).toBe('INVALID');
  });
  it('requires distinct existing PointEntity IDs, not polygon corners', () => {
    expect(() => createHorizontalReference(fixture(), [{ pointEntityId: 'p1', survey: surveyA }, { pointEntityId: 'p1', survey: surveyB }])).toThrow('разными');
    expect(() => createHorizontalReference(fixture(), [{ pointEntityId: 'missing', survey: surveyA }, { pointEntityId: 'p2', survey: surveyB }])).toThrow('PointEntity');
  });
});
describe('canonical geometry, history, stale and persistence', () => {
  it('Apply/Undo/Redo/remove each preserve exact vertex values AND original registry identity', () => {
    const before = fixture(), values = JSON.stringify(before.vertices);
    let state = initialEditorState(before);
    state = editorReducer(state, { type: 'execute', command }); expect(state.past).toEqual([before]);
    for (const action of [{ type: 'undo' }, { type: 'redo' }, { type: 'execute', command: { type: 'set-horizontal-reference', pairs: null } }] as const) {
      expect(state.document.vertices).toBe(before.vertices); expect(JSON.stringify(state.document.vertices)).toBe(values);
      state = editorReducer(state, action);
    }
    expect(state.document.horizontalReference).toBeUndefined(); expect(state.document.vertices).toBe(before.vertices);
  });
  it('Model/Survey is a view preference with no history, dirty, document or viewport changes', () => {
    const state = initialEditorState(calibrated()), next = editorReducer(state, { type: 'coordinate-display', mode: 'survey' });
    expect(next.document).toBe(state.document); expect(next.viewport).toBe(state.viewport); expect(next.past).toBe(state.past); expect(isDocumentDirty(next)).toBe(false);
    expect(documentSurveyXY(next.document, a)).toEqual(surveyA);
  });
  it('moving noncontrol stays valid; control Z is independent of horizontal XY', () => {
    const before = calibrated();
    expect(staleControls(applyCommand(before, { type: 'move-vertex', vertexId: 'v3', delta: { x: 2, y: 1 } }))).toEqual([]);
    expect(staleControls(applyCommand(before, { type: 'update-vertex', vertexId: 'v1', position: { x: 0, y: 0, z: 4 } }))).toEqual([]);
  });
  it('moving a shared control vertex makes derived STALE and keeps committed transform through Save/Open', () => {
    const before = calibrated(), moved = applyCommand(before, { type: 'move-vertex', vertexId: 'v1', delta: { x: 0.01, y: 0 } });
    expect(staleControls(moved).map(control => control.pointEntityId)).toEqual(['p1']); expect(moved.horizontalReference).toBe(before.horizontalReference);
    const loaded = deserializeDocument(serializeDocument(moved)); expect(staleControls(loaded)).toHaveLength(1); expect(loaded.horizontalReference!.transform).toEqual(before.horizontalReference!.transform);
    expect(documentSurveyXY(loaded, a)).toEqual(surveyA);
  });
  it('recalculation is pure preview until renewed Apply; Undo restores old stale transform', () => {
    const moved = applyCommand(calibrated(), { type: 'move-vertex', vertexId: 'v1', delta: { x: 0.01, y: 0 } });
    const preview = createHorizontalReference(moved, (command as Extract<DocumentCommand, { type: 'set-horizontal-reference' }>).pairs!);
    expect(preview.transform).not.toEqual(moved.horizontalReference!.transform); expect(staleControls(moved)).toHaveLength(1);
    let state = editorReducer(initialEditorState(moved), { type: 'execute', command }); expect(staleControls(state.document)).toEqual([]);
    state = editorReducer(state, { type: 'undo' }); expect(state.document.horizontalReference).toBe(moved.horizontalReference); expect(staleControls(state.document)).toHaveLength(1);
  });
  it('control deletion is blocked atomically; removing reference permits deletion', () => {
    const before = calibrated();
    expect(() => applyCommand(before, { type: 'delete-entity', entityId: 'p1' })).toThrow('Точка P1 используется для привязки координат. Сначала измените или удалите привязку.');
    const state = editorReducer(initialEditorState(before), { type: 'execute-batch', commands: [{ type: 'delete-entity', entityId: 'p3' }, { type: 'delete-entity', entityId: 'p1' }] });
    expect(state.document).toBe(before); expect(state.past).toHaveLength(0);
    const removed = applyCommand(before, { type: 'set-horizontal-reference', pairs: null });
    expect(applyCommand(removed, { type: 'delete-entity', entityId: 'p1' }).entities).toHaveLength(2);
  });
  it('v2 stores controls/inputs/snapshots/references, no derived vertices or display preference', () => {
    const before = applyCommand(calibrated(), heightCommand), saved = serializeDocument(before), loaded = deserializeDocument(saved);
    expect(loaded).toEqual(before); expect(loaded.schemaVersion).toBe(2); expect(loaded.horizontalReference!.controls[0].survey).toEqual(surveyA);
    expect(loaded.vertices).toEqual(fixture().vertices); expect(saved).not.toContain('coordinateDisplay'); expect(saved).not.toContain('STALE');
  });
  it.each([0, 562341.234])('old v2 without modelFrame is identity regardless of magnitude %s', x => {
    const doc = fixture(); delete doc.modelFrame; doc.vertices.v1!.x = x;
    const loaded = deserializeDocument(serializeDocument(doc)); expect(documentModelFrame(loaded)).toBe('projected'); expect(documentSurveyXY(loaded, loaded.vertices.v1!)).toEqual({ e: x, n: 0 });
    expect(() => applyCommand(loaded, command)).toThrow('напрямую');
  });
  it('explicit frame choice reinterprets legacy metadata only, is undoable, and cannot discard reference', () => {
    const legacy = fixture(); delete legacy.modelFrame;
    const state = editorReducer(initialEditorState(legacy), { type: 'execute', command: { type: 'set-model-frame', frame: 'local' } });
    expect(state.document.modelFrame).toBe('local'); expect(state.document.vertices).toBe(legacy.vertices); expect(documentSurveyXY(state.document, a)).toBeUndefined();
    expect(editorReducer(state, { type: 'undo' }).document).toBe(legacy);
    expect(() => applyCommand(calibrated(), { type: 'set-model-frame', frame: 'projected' })).toThrow('удалите');
  });
  it('unreferenced explicit local model has no Survey values', () => expect(documentSurveyXY(fixture(), a)).toBeUndefined());
  it.each(['scale', 'translation', 'snapshot', 'missing-point', 'projected'])('rejects corrupt persisted %s calibration', kind => {
    const raw = JSON.parse(serializeDocument(calibrated()));
    if (kind === 'scale') raw.horizontalReference.transform.scale = 2;
    if (kind === 'translation') raw.horizontalReference.transform.translation.e += 1;
    if (kind === 'snapshot') raw.horizontalReference.controls[0].modelSnapshot.x += 1;
    if (kind === 'missing-point') raw.horizontalReference.controls[0].pointEntityId = 'not-a-point';
    if (kind === 'projected') raw.modelFrame = 'projected';
    expect(() => validateDocument(raw)).toThrow();
  });
});
describe('independent vertical reference and labels', () => {
  const reference = { modelZero: 0 as const, absoluteAtModelZero: 153.42 };
  it.each([[0, 153.42], [2.5, 155.92], [-1.2, 152.22]])('Z %s maps to H %s and back', (z, h) => {
    expect(modelToAbsoluteZ(z, reference)).toBeCloseTo(h, 10); expect(absoluteToModelZ(h, reference)).toBeCloseTo(z, 10);
  });
  it('missing Z or reference is unavailable, never implicit 0', () => {
    expect(modelToAbsoluteZ(undefined, reference)).toBeUndefined(); expect(modelToAbsoluteZ(2.5, undefined)).toBeUndefined(); expect(absoluteToModelZ(undefined, reference)).toBeUndefined();
  });
  it('vertical Apply/Undo/Redo/remove touches only metadata and leaves horizontal committed reference', () => {
    const before = calibrated(); let state = editorReducer(initialEditorState(before), { type: 'execute', command: heightCommand });
    for (const action of [{ type: 'undo' }, { type: 'redo' }, { type: 'execute', command: { type: 'set-vertical-reference', reference: null } }] as const) {
      expect(state.document.vertices).toBe(before.vertices); expect(state.document.horizontalReference).toBe(before.horizontalReference); state = editorReducer(state, action);
    }
    expect(state.document.verticalReference).toBeUndefined();
  });
  it('h_absolute resolves on demand; z remains MODEL; no reference or Z yields emdash', () => {
    const doc = applyCommand(fixture(), heightCommand); expect(resolveLabelTemplate(doc, label)).toBe('Z=2.500; H=155.920');
    expect(resolveLabelTemplate(fixture(), label)).toBe('Z=2.500; H=—');
    expect(resolveLabelTemplate(doc, { ...label, targetId: 'p2' })).toBe('Z={z}; H=—');
  });
});
describe('explicit input frame', () => {
  const input: Extract<DocumentCommand, { type: 'import-points' }> = { type: 'import-points', points: [{ entity: { id: 'p4', name: 'P4', type: 'point', vertexId: 'v4', layerId: 'boundary' }, vertex: { id: 'v4', x: 500000, y: 6000015, z: 2.5 } }] };
  it('external Survey into empty doc uses projected identity with untouched XY mapping', () => {
    const imported = applyCommand(createNewDocument(), { ...input, coordinateSpace: 'survey' }); expect(imported.modelFrame).toBe('projected'); expect(imported.vertices.v4).toEqual(input.points[0]!.vertex); expect(documentSurveyXY(imported, imported.vertices.v4!)).toEqual({ e: 500000, n: 6000015 });
  });
  it('MODEL/AI point import stays local; no magnitude-based classification', () => {
    expect(applyCommand(createNewDocument(), input).modelFrame).toBe('local'); expect(applyCommand(createNewDocument(), { ...input, coordinateSpace: 'model' }).modelFrame).toBe('local');
  });
  it('Survey import transforms only new XY into a calibrated local frame; Height mapping stays MODEL Z', () => {
    const before = calibrated(), imported = applyCommand(before, { ...input, coordinateSpace: 'survey' });
    expect(imported.vertices.v4!.x).toBeCloseTo(15, 7); expect(imported.vertices.v4!.y).toBeCloseTo(0, 7); expect(imported.vertices.v4!.z).toBe(2.5);
    for (const [id, vertex] of Object.entries(before.vertices)) expect(imported.vertices[id]).toEqual(vertex);
  });
  it('prevents silent mixing in unreferenced nonempty local model with atomic failure', () => {
    expect(() => applyCommandsAtomically(fixture(), [{ ...input, coordinateSpace: 'survey' }])).toThrow('нужна привязка');
  });
});
