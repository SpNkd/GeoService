import { expect, it, vi } from 'vitest';
import { AI_LIMITS, aiTaskSchema, validateParserResult, type AiAction, type AiTaskIntent } from '../ai/intent';
import { resolveAiTaskPlan, taskCommands, taskPreviews } from '../ai/task';
import { buildPointNameIndex } from '../ai/resolver';
import { applicationReducer, type ApplicationState } from '../ai/workflow';
import { applyCommand, applyCommandsAtomically, type DocumentCommand } from '../domain/commands';
import { createNewDocument } from '../domain/newDocument';
import { entityPoints, type GeoDocument } from '../domain/model';
import { alignedDimension } from '../geometry/survey';
import { signedPolygonArea, polygonOrientation, distance, midpoint } from '../geometry';
import { initialEditorState, editorReducer, isDocumentDirty } from '../store/editor';
import { serializeDocument, deserializeDocument } from '../persistence/serialization';
import { developmentMockProvider, OpenRouterIntentProvider } from '../../server/ai';
const square = [{ x: 1000, y: 2000 }, { x: 1060, y: 2000 }, { x: 1060, y: 2040 }, { x: 1000, y: 2040 }];
function drawing(points = square): GeoDocument {
  const d = createNewDocument();
  points.forEach((point, i) => { const id = `v${i}`; d.vertices[id] = { id, ...point };
    d.entities.push({ type: 'point', id: `p${i}`, name: `P${i + 1}`, layerId: 'survey-points', vertexId: id }); });
  return d;
}
const boundary = (count = 4): Extract<AiAction, { type: 'create_boundary_from_named_points' }> => ({ type: 'create_boundary_from_named_points', pointNames: Array.from({ length: count }, (_, i) => `P${i + 1}`) });
const bulk = (boundaryActionIndex = 0): AiAction => ({ type: 'create_dimensions_for_boundary_edges', boundaryActionIndex });
const task = (count = 4): AiTaskIntent => ({ actions: [boundary(count), bulk()] });
const resolve = (d = drawing()) => resolveAiTaskPlan(task(d.entities.length), d, new Map(), { id: 'dependent' });
function preview(d = drawing(), actions = task().actions): ApplicationState {
  const state: ApplicationState = { editor: initialEditorState(d), ai: { status: 'idle' } };
  return applicationReducer(applicationReducer(state, { type: 'ai-event', event: { type: 'start', id: 'dependent', text: 'fixture' } }),
    { type: 'ai-event', event: { type: 'result', id: 'dependent', result: { actions } } });
}
function plan(state: ApplicationState) { if (state.ai.status !== 'preview' && state.ai.status !== 'stale') throw Error('preview'); return state.ai.plan; }
const circle = (count: number) => Array.from({ length: count }, (_, i) => ({ x: 562000 + 100 * Math.cos(i * Math.PI * 2 / count), y: 6180000 + 100 * Math.sin(i * Math.PI * 2 / count) }));
it('validates a bounded, zero-based backward boundary reference', () => {
  expect(aiTaskSchema.parse(task())).toEqual(task());
  const raw = { actions: [{ type: 'measure_between_named_points', pointNames: ['P1', 'P2'] }, boundary(), bulk(1)] };
  expect(aiTaskSchema.safeParse(raw).success).toBe(true);
  expect(validateParserResult(task(), 'Создай границу P1 P2 P3 P4 с размерами сторон')).toEqual(task());
});
it.each([
  { actions: [bulk(1), boundary()] }, { actions: [boundary(), bulk(1)] }, { actions: [boundary(), bulk(7)] },
  { actions: [boundary(), bulk(-1)] }, { actions: [boundary(), bulk(0.5)] },
  { actions: [{ type: 'measure_between_named_points', pointNames: ['P1', 'P2'] }, bulk()] },
  { actions: [{ type: 'create_polyline_from_named_points', pointNames: ['P1', 'P2'] }, bulk()] },
  { actions: [boundary(), { ...bulk(), entityId: 'polygon' }] }, { actions: [boundary(), { ...bulk(), boundaryRef: '/actions/0/command' }] },
  { actions: [boundary(), { type: 'create_dimensions_for_boundary_edges' }] }, { actions: [bulk()] },
])('rejects future/self/out-of-range/wrong-kind/arbitrary/dangling refs: %#', raw => {
  expect(aiTaskSchema.safeParse(raw).success).toBe(false);
});
it.each([3, 4, 5])('expands %s ordered edges including closure with existing vertex references', count => {
  const d = drawing(circle(count)), p = resolve(d); expect(p.resolution.status).toBe('ready');
  expect(p.mutationCount).toBe(2); expect(p.generatedCommandCount).toBe(count + 1);
  const result = p.actions[1]!.resolution; if (result.status !== 'ready' || result.kind !== 'bulk-dimensions') throw Error('bulk');
  expect(result.dimensions).toHaveLength(count);
  for (const [i, dimension] of result.dimensions.entries()) {
    expect(dimension.references.map(ref => ref.vertexId)).toEqual([`v${i}`, `v${(i + 1) % count}`]);
    expect(dimension.metrics.horizontal).toBe(distance(d.vertices[`v${i}`]!, d.vertices[`v${(i + 1) % count}`]!));
    expect(dimension.command).toMatchObject({ type: 'add-entity', vertices: [] });
  }
  expect(taskPreviews(p)).toHaveLength(count + 1);
});
it.each([
  ['CCW square', square, 'ccw'], ['CW square', [...square].reverse(), 'cw'],
  ['rotated rectangle', square.map(p => ({ x: 562000 + (p.x - 1000) * Math.cos(0.6) - (p.y - 2000) * Math.sin(0.6), y: 6180000 + (p.x - 1000) * Math.sin(0.6) + (p.y - 2000) * Math.cos(0.6) })), 'ccw'],
  ['irregular concave', [{ x: 0, y: 0 }, { x: 60, y: 5 }, { x: 40, y: 20 }, { x: 50, y: 55 }, { x: 5, y: 40 }], 'ccw'],
] as const)('outward world normal: %s', (_name, points, orientation) => {
  expect(polygonOrientation(points)).toBe(orientation); expect(Math.sign(signedPolygonArea(points))).toBe(orientation === 'ccw' ? 1 : -1);
  const d = drawing([...points]), result = resolve(d).actions[1]!.resolution;
  if (result.status !== 'ready' || result.kind !== 'bulk-dimensions') throw Error('bulk');
  for (const edge of result.dimensions) {
    const [a, b] = edge.geometry, aligned = alignedDimension(a!, b!, edge.offset), original = midpoint(a!, b!);
    const cross = (b!.x - a!.x) * (aligned.label.y - original.y) - (b!.y - a!.y) * (aligned.label.x - original.x);
    expect(cross * (orientation === 'ccw' ? 1 : -1)).toBeLessThan(0);
    expect(Math.abs(edge.offset)).toBe(Math.min(10, Math.max(0.5, edge.metrics.horizontal * 0.1)));
  }
});
it('projection is private, preserves source references and matches every applied dimension exactly', () => {
  const d = drawing(), before = serializeDocument(d), p = resolve(d);
  expect(serializeDocument(d)).toBe(before); expect(d.entities).toHaveLength(4); expect(p.basedOnDocument).toBe(d);
  expect(p.projectedDocument?.entities).toHaveLength(9); expect(p.projectedDocument?.vertices).toBe(d.vertices);
  const created = p.actions[0]!.resolution; if (created.status !== 'ready' || created.kind !== 'boundary') throw Error('boundary');
  expect(created.output).toMatchObject({ kind: 'created_polygon', vertexIds: ['v0', 'v1', 'v2', 'v3'] });
  const applied = applyCommandsAtomically(d, taskCommands(p)); expect(applied).toEqual(p.projectedDocument);
  const bulk = p.actions[1]!.resolution; if (bulk.status !== 'ready' || bulk.kind !== 'bulk-dimensions') throw Error('bulk');
  for (const edge of bulk.dimensions) {
    if (edge.command.type !== 'add-entity') throw Error('add');
    const actual = applied.entities.find(e => edge.command.type === 'add-entity' && e.id === edge.command.entity.id)!;
    expect(actual).toEqual(edge.command.entity); if (actual.type !== 'dimension') throw Error('dimension');
    const positions = entityPoints(actual, applied.vertices); expect(positions).toEqual(edge.geometry);
    expect(alignedDimension(positions[0]!, positions[1]!, actual.offset)).toEqual(alignedDimension(edge.geometry[0]!, edge.geometry[1]!, edge.offset));
  }
});
it('100 sides succeed, 101 block the entire task without partial dimensions', () => {
  expect(AI_LIMITS.bulkDimensions).toBe(100); expect(AI_LIMITS.generatedCommands).toBe(128);
  const allowed = resolve(drawing(circle(100))); expect(allowed.generatedCommandCount).toBe(101); expect(allowed.resolution.status).toBe('ready');
  const state = preview(drawing(circle(101)), task(101).actions), p = plan(state);
  expect(p.resolution).toMatchObject({ status: 'invalid', message: 'Создание размеров для 101 сторон превышает лимит 100' });
  expect(p.projectedDocument).toBeNull(); expect(taskPreviews(p)).toEqual([]);
  expect(applicationReducer(state, { type: 'ai-apply' }).editor).toBe(state.editor); expect(state.editor.document.entities).toHaveLength(101);
});
it('aggregate generated-command budget is separate from semantic count and applies to all groups', () => {
  const d = drawing(circle(64)), first = boundary(64), second = { ...boundary(64), pointNames: Array.from({ length: 63 }, (_, i) => `P${i + 1}`) };
  const allowed = resolveAiTaskPlan({ actions: [second, bulk(), { ...second, pointNames: [...second.pointNames].reverse() }, bulk(2)] }, d);
  expect(allowed.generatedCommandCount).toBe(128); expect(allowed.resolution.status).toBe('ready');
  const blocked = resolveAiTaskPlan({ actions: [first, bulk(), second, bulk(2)] }, d);
  expect(blocked.generatedCommandCount).toBe(129); expect(blocked.resolution).toMatchObject({ status: 'invalid' }); expect(blocked.projectedDocument).toBeNull();
});
it('root missing/ambiguity errors block dependency once, then one choice drives every edge', () => {
  const d = drawing(); d.entities = [...d.entities, { ...d.entities[0]!, id: 'duplicate' }];
  const index = buildPointNameIndex(d.entities), get = vi.spyOn(index, 'get');
  const unresolved = resolveAiTaskPlan(task(), d, new Map(), { index }); expect(get).toHaveBeenCalledTimes(4);
  expect(unresolved.resolution).toMatchObject({ status: 'unresolved', issues: [{ name: 'P1' }] });
  expect(unresolved.actions[1]!.resolution).toMatchObject({ status: 'blocked', dependencyIndex: 0 });
  const chosen = resolveAiTaskPlan(task(), d, new Map([['P1', 'duplicate']])); expect(chosen.resolution.status).toBe('ready');
  const b = chosen.actions[1]!.resolution; if (b.status !== 'ready' || b.kind !== 'bulk-dimensions') throw Error('bulk');
  expect(b.dimensions[0]!.references[0]!.entityId).toBe('duplicate'); expect(b.dimensions[3]!.references[1]!.entityId).toBe('duplicate');
  const missing = resolveAiTaskPlan({ actions: [{ ...boundary(), pointNames: ['P1', 'P2', 'P3', 'P999'] }, bulk()] }, drawing());
  expect(missing.resolution).toMatchObject({ status: 'unresolved', issues: [{ name: 'P999' }] }); expect(missing.actions[1]!.resolution).toMatchObject({ status: 'blocked' });
});
it('Apply/Undo/Redo commits all five entities once, preserves IDs, vertices and ordinary persistence', () => {
  const state = preview(), applied = applicationReducer(state, { type: 'ai-apply' });
  expect(applied.editor.past).toHaveLength(1); expect(applied.editor.document.entities).toHaveLength(9); expect(applied.editor.document.vertices).toBe(state.editor.document.vertices);
  expect(applicationReducer(applied, { type: 'undo' }).editor.document).toBe(state.editor.document);
  const redone = applicationReducer(applicationReducer(applied, { type: 'undo' }), { type: 'redo' }); expect(redone.editor.document).toBe(applied.editor.document);
  const restored = deserializeDocument(serializeDocument(redone.editor.document)); expect(restored).toEqual(redone.editor.document);
  expect(serializeDocument(restored)).not.toMatch(/boundaryActionIndex|generatedByAI|created_polygon/);
});
it('failure of a generated middle dimension leaves no boundary/dimensions/history/dirty/autosave change', () => {
  const state = preview(), commands = taskCommands(plan(state));
  const last = commands[3]!; if (last.type !== 'add-entity' || last.entity.type !== 'dimension') throw Error('dimension');
  commands[3] = { ...last, entity: { ...last.entity, endVertexId: 'missing' } };
  const before = serializeDocument(state.editor.document); const failed = editorReducer(state.editor, { type: 'execute-batch', commands, expectedDocument: state.editor.document });
  expect(failed.document).toBe(state.editor.document); expect(serializeDocument(failed.document)).toBe(before);
  expect(failed.past).toBe(state.editor.past); expect(failed.future).toBe(state.editor.future); expect(isDocumentDirty(failed)).toBe(false);
  expect(failed.savedFingerprint).toBe(state.editor.savedFingerprint); expect(failed.transactionBefore ?? failed.document).toBe(state.editor.document);
});
it('whole-task stale refresh recomputes edge lengths, outward offsets and requires renewed Apply', () => {
  const state = preview(), old = plan(state), moved = applicationReducer(state, { type: 'execute', command: { type: 'move-vertex', vertexId: 'v1', delta: { x: 5, y: 0 } } });
  expect(moved.ai.status).toBe('stale'); const refreshed = applicationReducer(moved, { type: 'ai-apply' }); expect(refreshed.editor).toBe(moved.editor);
  const b = plan(refreshed).actions[1]!.resolution, previous = old.actions[1]!.resolution;
  if (b.status !== 'ready' || b.kind !== 'bulk-dimensions' || previous.status !== 'ready' || previous.kind !== 'bulk-dimensions') throw Error('bulk');
  expect(b.dimensions[0]).toMatchObject({ metrics: { horizontal: 65 }, offset: -6.5 }); expect(previous.dimensions[0]).toMatchObject({ metrics: { horizontal: 60 }, offset: -6 });
  expect(taskCommands(plan(refreshed)).map(c => c.type === 'add-entity' ? c.entity.id : '')).toEqual(taskCommands(old).map(c => c.type === 'add-entity' ? c.entity.id : ''));
  expect(applicationReducer(refreshed, { type: 'ai-apply' }).editor.past).toHaveLength(2);
});
it('mixed dependent task keeps measurement before/after Apply/Undo without extra mutations', () => {
  const state = preview(drawing(), [...task().actions, { type: 'measure_between_named_points', pointNames: ['P1', 'P4'] }]);
  expect(taskPreviews(plan(state))).toHaveLength(6); expect(isDocumentDirty(state.editor)).toBe(false);
  const applied = applicationReducer(state, { type: 'ai-apply' }); expect(applied.editor.past).toHaveLength(1); expect(applied.editor.document.entities).toHaveLength(9);
  for (const app of [applied, applicationReducer(applied, { type: 'undo' })]) {
    if (app.ai.status !== 'applied') throw Error('applied'); expect(app.ai.results?.actions[0]).toMatchObject({ resolution: { kind: 'measure', metrics: { horizontal: 40 } } });
  }
});
it('optimized general addition runs preserve sequential semantics, locks, payload ownership and failure isolation', () => {
  const d = drawing(), commands = taskCommands(resolve(d)), sequential = commands.reduce((candidate, command) => applyCommand(candidate, command), d);
  const atomic = applyCommandsAtomically(d, commands); expect(atomic).toEqual(sequential);
  const entity = commands[0]!; if (entity.type !== 'add-entity') throw Error('add'); entity.entity.name = 'changed caller'; expect(atomic.entities.at(4)?.name).not.toBe('changed caller');
  const duplicate = [...commands, commands[1]!]; expect(() => applyCommandsAtomically(d, duplicate)).toThrow('ID'); expect(d.entities).toHaveLength(4);
  const locked = applyCommand(d, { type: 'set-layer-lock', layerId: 'boundary', locked: true });
  expect(() => applyCommandsAtomically(locked, commands)).toThrow('заблокирован');
  const mixed: DocumentCommand[] = [{ type: 'set-layer-lock', layerId: 'boundary', locked: true }, ...commands];
  expect(() => applyCommandsAtomically(d, mixed)).toThrow('заблокирован'); expect(d.layers.find(l => l.id === 'boundary')!.locked).toBe(false);
});
it('task capacity checks include all expanded commands during projection', () => {
  const d = drawing(); for (let i = 0; i < 49992; i++) d.entities.push({ type: 'point', id: `extra-${i}`, name: `Extra-${i}`, layerId: 'survey-points', vertexId: 'v0' });
  const p = resolveAiTaskPlan(task(), d); expect(p.resolution.status).toBe('invalid'); expect(p.projectedDocument).toBeNull(); expect(d.entities).toHaveLength(49996);
});
it.each([
  ['Построй границу по P1 P2 P3 P4 и проставь размеры всех её сторон', 2], ['Создай границу P1 P2 P3 P4 с размерами сторон', 2],
  ['Создай контур через Т1 Т2 Т3 и добавь размеры всех сторон', 2], ['Построй границу P1 P2 P3, проставь размеры всех сторон и измерь P1-P3', 3],
])('mock uses one semantic bulk reference, never enumerated pairs: %s', async (text, count) => {
  const result = validateParserResult(await developmentMockProvider().parseIntent({ text, signal: new AbortController().signal }), text);
  if (!('actions' in result)) throw Error('task');
  expect(result.actions[1]).toEqual({ type: 'create_dimensions_for_boundary_edges', boundaryActionIndex: 0 });
  expect(result.actions).toHaveLength(count);
});
it.each(['Проставь размеры всех сторон', 'Проставь размеры всех сторон границы Boundary-1', 'Проставь размеры сторон выбранной границы', 'Создай полилинию P1 P2 P3 с размерами всех сторон'])('no selection/entity-name/polyline implicit target: %s', async text => {
  expect(await developmentMockProvider().parseIntent({ text, signal: new AbortController().signal })).toEqual({ status: 'unsupported' });
});
it('OpenRouter schema expresses only a bounded ordinal and local validation rejects future refs', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ intent: task() }) } }] })));
  expect(await new OpenRouterIntentProvider('fake', 'qwen/test', transport).parseIntent({ text: 'P1 P2 P3 P4 с размерами сторон', signal: new AbortController().signal })).toEqual(task());
  const body = JSON.parse(String(transport.mock.calls[0]![1]!.body)); expect(body.messages[1].content).toBe('P1 P2 P3 P4 с размерами сторон');
  const schemas = body.response_format.json_schema.schema.properties.intent.anyOf[0].properties.actions.items.anyOf;
  expect(schemas.at(-1)).toMatchObject({ additionalProperties: false, required: ['type', 'boundaryActionIndex'], properties: { boundaryActionIndex: { type: 'integer', minimum: 0, maximum: 7 } } });
  transport.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ intent: { actions: [boundary(), bulk(1)] } }) } }] })));
  await expect(new OpenRouterIntentProvider('fake', 'qwen/test', transport).parseIntent({ text: 'P1 P2 P3 P4', signal: new AbortController().signal })).rejects.toThrow();
});
it('added vertices/layers are available to subsequent additions with shared references and owned payloads', () => {
  const d = drawing(), layer = { ...d.layers[0]!, id: 'new-layer', name: 'New' }, vertex = { id: 'new-v', x: 1080, y: 2000 };
  const commands: DocumentCommand[] = [
    { type: 'add-entity', layer, vertices: [vertex], entity: { type: 'point', id: 'new-p', name: 'New', layerId: layer.id, vertexId: vertex.id } },
    { type: 'add-entity', vertices: [], entity: { type: 'dimension', id: 'new-dim', name: 'Dimension', layerId: layer.id, startVertexId: 'v0', endVertexId: vertex.id, offset: 3 } },
  ];
  const result = applyCommandsAtomically(d, commands); expect(result.vertices['new-v']).toEqual(vertex); expect(result.layers.at(-1)).toEqual(layer);
  expect(d.vertices['new-v']).toBeUndefined(); expect(d.layers.some(item => item.id === layer.id)).toBe(false);
  vertex.x = 0; layer.name = 'changed caller'; expect(result.vertices['new-v']!.x).toBe(1080); expect(result.layers.at(-1)!.name).toBe('New');
  const first = commands[0]!; if (first.type !== 'add-entity') throw Error('add');
  expect(() => applyCommandsAtomically(d, [first, { ...first, entity: { ...first.entity, id: 'other' } }])).toThrow();
});
it('bulk references survive polygon deletion and remain dynamic when source vertices move', () => {
  const d = drawing(), p = resolve(d), commands = taskCommands(p), applied = applyCommandsAtomically(d, commands);
  const boundary = applied.entities.find(entity => entity.type === 'polygon')!;
  const withoutBoundary = applyCommand(applied, { type: 'delete-entity', entityId: boundary.id });
  expect(withoutBoundary.entities.filter(entity => entity.type === 'dimension')).toHaveLength(4);
  const moved = applyCommand(withoutBoundary, { type: 'move-vertex', vertexId: 'v1', delta: { x: 5, y: 0 } });
  const first = moved.entities.find(entity => entity.type === 'dimension')!;
  const points = entityPoints(first, moved.vertices); expect(distance(points[0]!, points[1]!)).toBe(65);
  expect(moved.entities.filter(entity => entity.type === 'point')).toHaveLength(4);
});
