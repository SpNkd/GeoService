import { expect, it, vi } from 'vitest';
import { aiIntentSchema, validateParserResult, type AiIntent } from '../ai/intent';
import { resolveIntent, resolveNamedPointReferences, pointNameIndex, defaultDimensionOffset } from '../ai/resolver';
import { applicationReducer, mutationExecutionGate, type ApplicationState } from '../ai/workflow';
import { AiRequestRunner, MockAiIntentProvider, type RequestEvent } from '../ai/provider';
import { initialEditorState, isDocumentDirty } from '../store/editor';
import { createSampleDocument } from '../sample/document';
import { serializeDocument, deserializeDocument } from '../persistence/serialization';
import { applyCommand } from '../domain/commands';
import { entityPoints } from '../domain/model';
import { measurePair } from '../geometry/survey';
import { developmentMockProvider, OpenRouterIntentProvider } from '../../server/ai';

const types = ['create_boundary_from_named_points', 'create_polyline_from_named_points', 'create_dimension_between_named_points', 'measure_between_named_points'] as const;
const namesFor = (type: AiIntent['type']) => type === types[0] ? ['P1', 'P2', 'P3', 'P4'] : type === types[1] ? ['P1', 'P2', 'P3'] : ['P1', 'P2'];
const intent = (type: AiIntent['type'], pointNames = namesFor(type)) => aiIntentSchema.parse({ type, pointNames });
const drawing = () => { const d = createSampleDocument(); return { ...d, entities: d.entities.filter(e => e.type === 'point' && e.name.startsWith('P')),
  vertices: Object.fromEntries(Object.entries(d.vertices).filter(([id]) => id.startsWith('v-p'))) }; };
function preview(type: AiIntent['type'], doc = drawing(), pointNames = namesFor(type)): ApplicationState {
  const state: ApplicationState = { editor: initialEditorState(doc), ai: { status: 'idle' } };
  const started = applicationReducer(state, { type: 'ai-event', event: { type: 'start', id: 'test', text: pointNames.join(' ') } });
  return applicationReducer(started, { type: 'ai-event', event: { type: 'result', id: 'test', result: intent(type, pointNames) } });
}
function plan(state: ApplicationState) { if (state.ai.status !== 'preview' && state.ai.status !== 'stale') throw Error('preview'); return state.ai.plan; }
it.each(types)('strict schema and common exact resolution: %s', type => {
  expect(aiIntentSchema.safeParse(intent(type)).success).toBe(true);
  expect(aiIntentSchema.safeParse({ ...intent(type), vertexIds: [] }).success).toBe(false);
  const refs = resolveNamedPointReferences(namesFor(type), drawing());
  expect(refs.status).toBe('resolved'); if (refs.status === 'resolved') expect(refs.references.map(r => r.name)).toEqual(namesFor(type));
  expect(resolveIntent(intent(type, namesFor(type).map(n => n === 'P1' ? 'p1' : n)), drawing()).status).toBe('unresolved');
  expect(resolveIntent(intent(type, namesFor(type).map(n => n === 'P1' ? 'P999' : n)), drawing())).toMatchObject({ status: 'unresolved', issues: [{ kind: 'missing', name: 'P999' }] });
});
it.each([types[1], types[2], types[3]])('enforces cardinality and Unicode identifiers: %s', type => {
  for (const pointNames of [[], ['Т1']]) expect(aiIntentSchema.safeParse({ type, pointNames }).success).toBe(false);
  if (type !== types[1]) expect(aiIntentSchema.safeParse({ type, pointNames: ['Т1', 'Т2', 'Т3'] }).success).toBe(false);
  expect(validateParserResult(intent(type, ['Т1', 'КН-2']), 'Т1 КН-2')).toEqual(intent(type, ['Т1', 'КН-2']));
  expect(() => validateParserResult({ intents: [intent(type), intent(type)] }, 'Т1 КН-2')).toThrow();
});
it.each(types)('duplicate names/vertices and ambiguity share semantics: %s', type => {
  const doc = drawing(); doc.entities = [...doc.entities, { ...doc.entities[0]!, id: 'duplicate' }];
  expect(resolveIntent(intent(type), doc).status).toBe('unresolved');
  expect(resolveIntent(intent(type), doc, new Map([['P1', 'duplicate']])).status).toBe('ready');
  expect(resolveIntent(intent(type), doc, new Map([['P1', 'p2']])).status).toBe('invalid');
  expect(resolveIntent(intent(type, namesFor(type).map(n => n === 'P2' ? 'P1' : n)), doc).status).toBe('invalid');
  const p2 = doc.entities.find(e => e.id === 'p2')!; if (p2.type === 'point') p2.vertexId = 'v-p1';
  expect(resolveIntent(intent(type), doc, new Map([['P1', 'p1']])).status).toBe('invalid');
});
it.each(types.slice(0, 3))('all mutation kinds use one gate, one history step, stable redo, persistence: %s', type => {
  const app = preview(type), p = plan(app); if (!p.requiresConfirmation) throw Error('mutation');
  const before = serializeDocument(app.editor.document); expect(isDocumentDirty(app.editor)).toBe(false); expect(app.editor.past).toHaveLength(0);
  expect(mutationExecutionGate(p, app.editor).status).toBe('execute'); expect(serializeDocument(app.editor.document)).toBe(before);
  const applied = applicationReducer(app, { type: 'ai-apply' }); expect(applied.editor.past).toHaveLength(1);
  const entity = applied.editor.document.entities.at(-1)!;
  expect(entity.type).toBe(type === types[0] ? 'polygon' : type === types[1] ? 'polyline' : 'dimension');
  expect(Object.keys(applied.editor.document.vertices)).toEqual(Object.keys(app.editor.document.vertices));
  expect(applied.editor.document.entities.filter(e => e.type === 'point')).toHaveLength(4);
  const undone = applicationReducer(applied, { type: 'undo' }); expect(undone.editor.document).toBe(app.editor.document);
  const redone = applicationReducer(undone, { type: 'redo' }); expect(redone.editor.document.entities.at(-1)).toEqual(entity);
  expect(deserializeDocument(serializeDocument(redone.editor.document))).toEqual(redone.editor.document);
});
it.each(types.slice(0, 3))('all mutation kinds reject transactions and stale Apply: %s', type => {
  const app = preview(type), p = plan(app); if (!p.requiresConfirmation) throw Error('mutation');
  const dragging = applicationReducer(app, { type: 'begin-transaction' }); expect(mutationExecutionGate(p, dragging.editor).status).toBe('blocked');
  const moved = applicationReducer(app, { type: 'execute', command: { type: 'move-vertex', vertexId: 'v-p1', delta: { x: 1, y: 0 } } });
  expect(moved.ai.status).toBe('stale'); expect(mutationExecutionGate(p, moved.editor).status).toBe('refreshed');
  const refreshed = applicationReducer(moved, { type: 'ai-apply' }); expect(refreshed.editor).toBe(moved.editor);
  expect(applicationReducer(refreshed, { type: 'ai-apply' }).editor.past).toHaveLength(2);
});
it('polyline length, order and crossings agree with manual semantics', () => {
  const r = resolveIntent(intent(types[1]), drawing()); expect(r).toMatchObject({ status: 'ready', kind: 'polyline', length: 100, segments: 2 });
  if (r.status !== 'ready' || r.kind !== 'polyline') throw Error('polyline');
  expect(r.command).toMatchObject({ vertices: [], entity: { vertexIds: ['v-p1', 'v-p2', 'v-p3'] } });
  expect(resolveIntent(intent(types[1], ['P1', 'P3', 'P2', 'P4']), drawing()).status).toBe('ready');
});
it('dimension default offset has min/proportion/max; local overrides never edit document and survive refresh', () => {
  expect([defaultDimensionOffset(1), defaultDimensionOffset(60), defaultDimensionOffset(1000)]).toEqual([0.5, 6, 10]);
  const app = preview(types[2]), p = plan(app); expect(p.resolution).toMatchObject({ metrics: { horizontal: 60, azimuth: 90 }, offset: 6 });
  const adjusted = applicationReducer(app, { type: 'ai-offset', offset: -1.5 }); expect(adjusted.editor).toBe(app.editor);
  expect(plan(adjusted).resolution).toMatchObject({ offset: -1.5, command: { entity: { offset: -1.5 } } });
  const moved = applicationReducer(adjusted, { type: 'execute', command: { type: 'move-vertex', vertexId: 'v-p2', delta: { x: 1, y: 0 } } });
  expect(plan(applicationReducer(moved, { type: 'ai-refresh' })).resolution).toMatchObject({ offset: -1.5 });
  const applied = applicationReducer(adjusted, { type: 'ai-apply' }); const dimension = applied.editor.document.entities.at(-1)!;
  expect(dimension).toMatchObject({ type: 'dimension', startVertexId: 'v-p1', endVertexId: 'v-p2', offset: -1.5 });
  const changed = applyCommand(applied.editor.document, { type: 'move-vertex', vertexId: 'v-p2', delta: { x: 5, y: 0 } });
  const points = entityPoints(dimension, changed.vertices); expect(measurePair(points[0]!, points[1]!).horizontal).toBe(65);
});
it.each([NaN, Infinity, 10001, -10001])('invalid preview offset blocks Apply: %s', offset => {
  const app = preview(types[2]), adjusted = applicationReducer(app, { type: 'ai-offset', offset });
  expect(plan(adjusted).resolution.status).toBe('invalid'); expect(applicationReducer(adjusted, { type: 'ai-apply' }).editor).toBe(app.editor);
});
it('locked sources allowed; locked/hidden dimensions target blocks; absent layer created atomically', () => {
  const doc = drawing(); doc.layers.find(l => l.id === 'survey-points')!.locked = true;
  const app = preview(types[2], doc); expect(plan(app).resolution.status).toBe('ready');
  const applied = applicationReducer(app, { type: 'ai-apply' }); expect(applied.editor.document.layers.find(l => l.id === 'dimensions')).toMatchObject({ locked: false, visible: true });
  const locked = applyCommand(applied.editor.document, { type: 'set-layer-lock', layerId: 'dimensions', locked: true });
  expect(resolveIntent(intent(types[2]), locked).status).toBe('invalid');
});
it('measure derives all metrics, remains read-only and updates only on committed revisions', () => {
  const app = preview(types[3]), p = plan(app); expect(p.requiresConfirmation).toBe(false);
  expect(p.resolution).toMatchObject({ kind: 'measure', metrics: { horizontal: 60, delta: { x: 60, y: 0, z: expect.closeTo(0.085, 8) }, azimuth: 90, spatial: expect.closeTo(Math.hypot(60, 0.085), 8) } });
  expect(p.resolution).not.toHaveProperty('command'); expect(applicationReducer(app, { type: 'ai-apply' })).toBe(app);
  expect(applicationReducer(app, { type: 'ai-cancel' }).editor).toBe(app.editor); expect(isDocumentDirty(app.editor)).toBe(false); expect(app.editor.past).toHaveLength(0);
  const dragging = applicationReducer(applicationReducer(app, { type: 'begin-transaction' }), { type: 'transient', command: { type: 'move-vertex', vertexId: 'v-p2', delta: { x: 5, y: 0 } } });
  expect(plan(dragging)).toBe(p);
  const committed = applicationReducer(dragging, { type: 'commit-transaction' }); expect(plan(committed).resolution).toMatchObject({ metrics: { horizontal: 65 } });
  expect(committed.editor.past).toHaveLength(1); // only the user's coordinate edit
});
it('measure omits Z/3D if either elevation absent, rejects coincident XY, and handles large coordinates', () => {
  const doc = drawing(); delete doc.vertices['v-p2']!.z;
  for (const v of Object.values(doc.vertices)) { v.x += 562000; v.y += 6180000; }
  const r = resolveIntent(intent(types[3]), doc); if (r.status !== 'ready' || r.kind !== 'measure') throw Error('measure');
  expect(r.metrics.horizontal).toBe(60); expect(r.metrics.delta.z).toBeUndefined(); expect(r.metrics.spatial).toBeNull();
  doc.vertices['v-p2']!.x = doc.vertices['v-p1']!.x;
  for (const type of [types[2], types[3]]) expect(resolveIntent(intent(type), doc).status).toBe('invalid');
});
it('all operation resolvers use one supplied cached name index across coordinate changes', () => {
  const doc = drawing(), index = pointNameIndex(doc.entities);
  const moved = applyCommand(doc, { type: 'move-vertex', vertexId: 'v-p1', delta: { x: 1, y: 0 } }); expect(pointNameIndex(moved.entities)).toBe(index);
  for (const type of types) expect(resolveIntent(intent(type), moved, new Map(), { index }).status).toBe('ready');
});
it.each([
  ['Создай границу по P1 P2 P3', types[0]], ['Построй контур через точки Т1, Т2, Т3', types[0]],
  ['Соедини P1, P4 и P8 полилинией', types[1]], ['Проведи ломаную через КН-1 КН-2 КН-7', types[1]],
  ['Поставь размер между P1 и P2', types[2]], ['Проставь расстояние размером между Т4 и Т8', types[2]],
  ['Какое расстояние между P1 и P7?', types[3]], ['Измерь от КН-1 до КН-4', types[3]],
])('Russian fixture: %s', async (text, type) => {
  expect(validateParserResult(await developmentMockProvider().parseIntent({ text, signal: new AbortController().signal }), text)).toMatchObject({ type });
});
it.each(['Соедини P1 P2 P3 и поставь размер между P1 P2', 'Построй границу и подпиши высоты', 'Покажи размер между P1 и P2'])('unsupported/multi-action: %s', async text => {
  expect(await developmentMockProvider().parseIntent({ text, signal: new AbortController().signal })).toEqual({ status: 'unsupported' });
});
it('dimension A cannot replace later measure B when A finishes last', async () => {
  const finish: ((raw: unknown) => void)[] = [], events: RequestEvent[] = [];
  const runner = new AiRequestRunner(new MockAiIntentProvider(() => new Promise(resolve => finish.push(resolve))));
  const a = runner.run('P1 P2', e => events.push(e)), b = runner.run('P1 P2', e => events.push(e));
  finish[1]!(intent(types[3])); await b; finish[0]!(intent(types[2])); await a;
  expect(events.map(e => e.type)).toEqual(['start', 'start', 'result']); expect(events.at(-1)).toMatchObject({ result: { type: types[3] } });
});
it('OpenRouter contract is structured, bounded, fixed-model, text-only; local validation remains mandatory', async () => {
  const output = intent(types[2]), transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ intent: output }) } }] })));
  expect(await new OpenRouterIntentProvider('fake-secret', 'qwen/test', transport).parseIntent({ text: 'P1 P2', signal: new AbortController().signal })).toEqual(output);
  const body = JSON.parse(String(transport.mock.calls[0]?.[1]?.body));
  expect(body.model).toBe('qwen/test'); expect(body.messages[1]).toEqual({ role: 'user', content: 'P1 P2' });
  expect(body.provider).toEqual({ require_parameters: true }); expect(body.reasoning.enabled).toBe(false);
  expect(body.response_format.json_schema.strict).toBe(true); expect(body).not.toHaveProperty('models');
});
it.each([
  { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
  { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ intent: { ...intent(types[2]), offsetMeters: 1 } }) } }] },
  { choices: [{ finish_reason: 'stop', message: { content: 'bad-json' } }] },
])('OpenRouter rejects truncated/extra-field/malformed outputs without retries', async output => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(output)));
  await expect(new OpenRouterIntentProvider('fake', 'model', transport).parseIntent({ text: 'P1 P2', signal: new AbortController().signal })).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});
