import { expect, it, vi } from 'vitest';
import { AI_LIMITS, aiTaskSchema, validateParserResult, type AiIntent, type AiTaskIntent } from '../ai/intent';
import { buildPointNameIndex } from '../ai/resolver';
import { resolveAiTaskPlan } from '../ai/task';
import { applicationReducer, type ApplicationState } from '../ai/workflow';
import { applyCommandsAtomically, type DocumentCommand } from '../domain/commands';
import { initialEditorState, editorReducer, isDocumentDirty } from '../store/editor';
import { createSampleDocument } from '../sample/document';
import { serializeDocument } from '../persistence/serialization';
import { developmentMockProvider, OpenRouterIntentProvider } from '../../server/ai';
import { AiRequestRunner, MockAiIntentProvider, type RequestEvent } from '../ai/provider';
const boundary: AiIntent = { type: 'create_boundary_from_named_points', pointNames: ['P1', 'P2', 'P3', 'P4'] };
const dimension: AiIntent = { type: 'create_dimension_between_named_points', pointNames: ['P1', 'P2'] };
const measure: AiIntent = { type: 'measure_between_named_points', pointNames: ['P1', 'P4'] };
const line: AiIntent = { type: 'create_polyline_from_named_points', pointNames: ['P1', 'P2', 'P3'] };
const doc = () => { const d = createSampleDocument(); return { ...d, entities: d.entities.filter(e => e.type === 'point' && e.name.startsWith('P')) }; };
function preview(actions: AiIntent[], document = doc()): ApplicationState {
  const state: ApplicationState = { editor: initialEditorState(document), ai: { status: 'idle' } };
  const started = applicationReducer(state, { type: 'ai-event', event: { type: 'start', id: 'multi', text: 'local fixture' } });
  return applicationReducer(started, { type: 'ai-event', event: { type: 'result', id: 'multi', result: { actions } } });
}
function task(state: ApplicationState) { if (state.ai.status !== 'preview' && state.ai.status !== 'stale') throw Error('preview'); return state.ai.plan; }
const ready = (state: ApplicationState, index: number) => { const r = task(state).actions[index]!.resolution; if (r.status !== 'ready') throw Error('ready'); return r; };
it.each([1, 2, 8])('accepts %s ordered actions', count => {
  const actions = Array.from({ length: count }, (_, i) => ({ ...measure, pointNames: ['Т1', `КН-${i}`] }));
  expect(aiTaskSchema.parse({ actions }).actions).toEqual(actions);
});
it.each([
  { actions: [] }, { actions: Array.from({ length: 9 }, (_, i) => ({ ...measure, pointNames: ['P1', `P${i}`] })) },
  { actions: [{ type: 'delete', pointNames: ['P1'] }] }, { actions: [measure], command: {} },
  { actions: [{ ...measure, id: 'AI-ID' }] }, { actions: [measure, measure] },
  { actions: [{ ...boundary, pointNames: Array.from({ length: 500 }, (_, i) => `P${i}`) },
    { ...line, pointNames: Array.from({ length: 500 }, (_, i) => `Q${i}`) }, measure] },
])('rejects empty/oversized/injected/duplicate tasks: %#', raw => { expect(aiTaskSchema.safeParse(raw).success).toBe(false); });
it('aggregate boundary is inclusive and budgets are centralized', () => {
  expect(AI_LIMITS.actions).toBe(8); expect(AI_LIMITS.totalReferences).toBe(1000);
  expect(aiTaskSchema.safeParse({ actions: [boundary, line].map((action, j) => ({ ...action, pointNames: Array.from({ length: 500 }, (_, i) => `${j}-${i}`) })) }).success).toBe(true);
});
it('literal pair syntax accepts exact names without allowing embedded prefixes', () => {
  const actions = [dimension, { ...measure, pointNames: ['КН-7', 'P4'] }];
  expect(validateParserResult({ actions }, 'Поставь размер P1-P2 и измерь КН-7-P4')).toEqual({ actions });
  expect(() => validateParserResult({ actions: [dimension] }, 'P12-P2')).toThrow();
  expect(() => validateParserResult({ actions: [dimension] }, 'КН-P1-P2')).toThrow();
});
it('resolves each unique name once, preserves action order, reference identity and local metrics', () => {
  const d = doc(), index = buildPointNameIndex(d.entities), get = vi.spyOn(index, 'get');
  const task = resolveAiTaskPlan({ actions: [boundary, dimension, measure] }, d, new Map(), { id: 'runtime', index });
  expect(get.mock.calls.map(([name]) => name)).toEqual(['P1', 'P2', 'P3', 'P4']);
  expect(task.resolution.status).toBe('ready'); expect(task.actions.map(a => a.kind)).toEqual(['boundary', 'dimension', 'measure']);
  expect(task.actions.map(a => a.id)).toEqual(['runtime-action-1', 'runtime-action-2', 'runtime-action-3']);
  const results = task.actions.map(a => a.resolution); expect(results[0]).toMatchObject({ area: 2400, perimeter: 200 });
  expect(results[1]).toMatchObject({ metrics: { horizontal: 60, azimuth: 90 } }); expect(results[2]).toMatchObject({ metrics: { horizontal: 40 } });
  if (results.every(r => r.status === 'ready')) expect(results[0]!.references[0]).toBe(results[2]!.references[0]);
});
it('missing second action and invalid geometry block the entire task', () => {
  for (const second of [{ ...dimension, pointNames: ['P1', 'P999'] }, { ...dimension, pointNames: ['P1', 'P1'] }]) {
    const state = preview([boundary, second]); expect(task(state).resolution.status).not.toBe('ready');
    expect(applicationReducer(state, { type: 'ai-apply' }).editor).toBe(state.editor);
  }
});
it('one ambiguity issue and choice are shared across every action', () => {
  const d = doc(); d.entities = [...d.entities, { ...d.entities[0]!, id: 'duplicate' }];
  const state = preview([boundary, dimension, measure], d);
  expect(task(state).resolution).toMatchObject({ status: 'unresolved', issues: [{ name: 'P1', kind: 'ambiguous' }] });
  if (task(state).resolution.status === 'unresolved') expect(task(state).resolution).toHaveProperty('issues.length', 1);
  const chosen = applicationReducer(state, { type: 'ai-choose', name: 'P1', entityId: 'duplicate' });
  expect(task(chosen).resolution.status).toBe('ready');
  for (const action of task(chosen).actions) if (action.resolution.status === 'ready') expect(action.resolution.references[0]!.entityId).toBe('duplicate');
});
it('boundary + dimension + polyline commits once with stable IDs and one newly shared layer', () => {
  const d = doc(); d.layers = d.layers.filter(layer => layer.id !== 'boundary');
  const state = preview([boundary, dimension, line], d), before = serializeDocument(d);
  const applied = applicationReducer(state, { type: 'ai-apply' }); expect(applied.ai.status).toBe('applied');
  expect(applied.editor.past).toHaveLength(1); expect(applied.editor.document.entities).toHaveLength(d.entities.length + 3);
  expect(applied.editor.document.layers.filter(l => l.id === 'boundary')).toHaveLength(1);
  expect(serializeDocument(d)).toBe(before); const undone = applicationReducer(applied, { type: 'undo' }); expect(undone.editor.document).toBe(d);
  expect(applicationReducer(undone, { type: 'redo' }).editor.document).toBe(applied.editor.document);
});
it('valid first command then invalid second candidate publishes nothing and cannot trigger autosave', () => {
  const state = preview([boundary, dimension]); const first = ready(state, 0), second = ready(state, 1);
  if (!('command' in first) || !('command' in second) || second.command.type !== 'add-entity' || second.command.entity.type !== 'dimension') throw Error('command');
  const broken: DocumentCommand = { ...second.command, entity: { ...second.command.entity, endVertexId: 'missing' } };
  const before = serializeDocument(state.editor.document), past = state.editor.past, future = state.editor.future, saved = state.editor.savedFingerprint;
  expect(() => applyCommandsAtomically(state.editor.document, [first.command, broken])).toThrow('missing');
  const next = editorReducer(state.editor, { type: 'execute-batch', commands: [first.command, broken], expectedDocument: state.editor.document });
  expect(next.document).toBe(state.editor.document); expect(serializeDocument(next.document)).toBe(before);
  expect(next.past).toBe(past); expect(next.future).toBe(future); expect(next.savedFingerprint).toBe(saved); expect(isDocumentDirty(next)).toBe(false);
  // App autosave effect depends only on this pair; both retain identity/value after failure.
  expect([next.transactionBefore ?? next.document, isDocumentDirty(next)]).toEqual([state.editor.document, false]);
  const malformed = { ...broken, injected: true }; expect(() => applyCommandsAtomically(state.editor.document, [first.command, malformed])).toThrow('Неверная команда');
});
it('general batch rejects active transactions and stale expected revision', () => {
  const editor = initialEditorState(doc()), command: DocumentCommand = { type: 'move-vertex', vertexId: 'v-p1', delta: { x: 1, y: 0 } };
  const dragging = editorReducer(editor, { type: 'begin-transaction' });
  expect(editorReducer(dragging, { type: 'execute-batch', commands: [command], expectedDocument: editor.document }).document).toBe(editor.document);
  const moved = editorReducer(editor, { type: 'execute', command });
  expect(editorReducer(moved, { type: 'execute-batch', commands: [command], expectedDocument: editor.document }).document).toBe(moved.document);
});
it('mixed task preserves/recalculates read-only results after Apply/Undo/Redo with the original action ID', () => {
  const state = preview([boundary, measure]); expect(isDocumentDirty(state.editor)).toBe(false); expect(ready(state, 1)).toMatchObject({ metrics: { horizontal: 40 } });
  const applied = applicationReducer(state, { type: 'ai-apply' });
  expect(applied.editor.document.entities).toHaveLength(state.editor.document.entities.length + 1); expect(applied.editor.past).toHaveLength(1);
  for (const next of [applied, applicationReducer(applied, { type: 'undo' }), applicationReducer(applicationReducer(applied, { type: 'undo' }), { type: 'redo' })]) {
    if (next.ai.status !== 'applied') throw Error('applied');
    expect(next.ai.results?.actions[0]).toMatchObject({ id: 'multi-action-2', resolution: { metrics: { horizontal: 40 } } });
    expect(next.ai.results?.basedOnDocument).toBe(next.editor.document); expect(next.ai.results?.mutationCount).toBe(0);
    expect(applicationReducer(next, { type: 'ai-apply' })).toBe(next);
  }
});
it('two measurements never mutate; update together only on committed revisions', () => {
  const state = preview([measure, { ...measure, pointNames: ['P2', 'P3'] }]);
  expect(task(state)).toMatchObject({ mutationCount: 0, readOnlyCount: 2, requiresConfirmation: false });
  expect(applicationReducer(state, { type: 'ai-apply' })).toBe(state); expect(state.editor.past).toHaveLength(0); expect(isDocumentDirty(state.editor)).toBe(false);
  const moved = applicationReducer(state, { type: 'execute', command: { type: 'move-vertex', vertexId: 'v-p4', delta: { x: 3, y: 0 } } });
  expect(task(moved).basedOnDocument).toBe(moved.editor.document); expect(ready(moved, 0)).toMatchObject({ metrics: { horizontal: Math.hypot(3, 40) } });
});
it('per-action dimension offsets and Cancel preserve the editor; whole-task stale refresh renews confirmation', () => {
  const state = preview([boundary, dimension, { ...dimension, pointNames: ['P2', 'P3'] }, measure]);
  const adjusted = applicationReducer(state, { type: 'ai-offset', actionId: 'multi-action-3', offset: -2.5 });
  expect(adjusted.editor).toBe(state.editor); expect(ready(adjusted, 1)).toMatchObject({ offset: 6 }); expect(ready(adjusted, 2)).toMatchObject({ offset: -2.5 });
  expect(applicationReducer(adjusted, { type: 'ai-cancel' }).editor).toBe(state.editor);
  const moved = applicationReducer(adjusted, { type: 'execute', command: { type: 'move-vertex', vertexId: 'v-p2', delta: { x: 5, y: 0 } } });
  expect(moved.ai.status).toBe('stale'); const refreshed = applicationReducer(moved, { type: 'ai-apply' }); expect(refreshed.editor).toBe(moved.editor);
  expect(ready(refreshed, 1)).toMatchObject({ metrics: { horizontal: 65 }, offset: 6.5 }); expect(ready(refreshed, 2)).toMatchObject({ offset: -2.5 });
  expect(applicationReducer(refreshed, { type: 'ai-apply' }).editor.past).toHaveLength(2);
});
it.each(['Создай границу P1 P2 P3 и удали P4', 'Построй границу P1 P2 P3 и проставь размеры всех сторон и удали P4', 'Измерь P1-P2 и экспортируй PDF', 'Поставь размер P1-P2 и сделай его красным'])('unsupported whole request: %s', async text => {
  const provider = developmentMockProvider(); expect(await provider.parseIntent({ text, signal: new AbortController().signal })).toEqual({ status: 'unsupported' });
  const state = preview([boundary]); const started = applicationReducer(state, { type: 'ai-event', event: { type: 'start', id: 'unsupported', text } });
  const blocked = applicationReducer(started, { type: 'ai-event', event: { type: 'result', id: 'unsupported', result: { status: 'unsupported' } } });
  expect(blocked.ai.status).toBe('error'); expect(blocked.editor).toBe(state.editor);
});
it('multi-action provider schema is bounded, strict, text-only and validates the whole response', async () => {
  const output: AiTaskIntent = { actions: [boundary, dimension] }, text = 'P1 P2 P3 P4 P1 P2';
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ intent: output }) } }] })));
  expect(await new OpenRouterIntentProvider('fake', 'qwen/test', transport).parseIntent({ text, signal: new AbortController().signal })).toEqual(output);
  const body = JSON.parse(String(transport.mock.calls[0]![1]!.body)); expect(body.messages[1]).toEqual({ role: 'user', content: text });
  expect(body.response_format.json_schema.schema.properties.intent.anyOf[0].properties.actions.maxItems).toBe(8);
});
it('cancel/new request ignores an abort-ignoring late multi task', async () => {
  const finishes: ((raw: unknown) => void)[] = [], events: RequestEvent[] = [];
  const runner = new AiRequestRunner(new MockAiIntentProvider(() => new Promise(resolve => finishes.push(resolve))));
  const a = runner.run('P1 P2 P3 P4 P1 P2', e => events.push(e)); runner.cancel();
  const b = runner.run('P1 P4', e => events.push(e)); finishes[1]!({ actions: [measure] }); await b;
  finishes[0]!({ actions: [boundary, dimension] }); await a;
  expect(events.map(e => e.type)).toEqual(['start', 'start', 'result']); expect(events.at(-1)).toMatchObject({ result: { actions: [measure] } });
});
it('normalizes whitespace before shared lookup', () => {
  expect(resolveAiTaskPlan({ actions: [{ ...measure, pointNames: [' P1 ', 'P4 '] }] }, doc()).resolution.status).toBe('ready');
});
it('offset binding survives an unresolved refresh and resets when an explicit choice changes endpoints', () => {
  const state = applicationReducer(preview([dimension, measure]), { type: 'ai-offset', actionId: 'multi-action-1', offset: 2.5 });
  const d = doc(), p1 = d.entities.find(e => e.id === 'p1')!; if (p1.type !== 'point') throw Error('point');
  const added = applicationReducer(state, { type: 'execute', command: { type: 'add-entity', entity: { ...p1, id: 'other-p1', vertexId: 'v-other' },
    vertices: [{ id: 'v-other', x: 1001, y: 2001 }] } });
  const unresolved = applicationReducer(added, { type: 'ai-refresh' }); expect(task(unresolved).resolution.status).toBe('unresolved');
  const chosen = applicationReducer(unresolved, { type: 'ai-choose', name: 'P1', entityId: 'other-p1' });
  expect(ready(chosen, 0)).toMatchObject({ offset: Math.hypot(59, 1) * 0.1 });
  expect(task(chosen).actions[0]).toMatchObject({ offsetOverride: null, offsetEndpoints: null });
});
