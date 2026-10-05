import { describe, expect, it } from 'vitest';
import { createNewDocument } from '../domain/newDocument';
import { applyCommand } from '../domain/commands';
import { initialEditorState, editorReducer } from '../store/editor';
import { findSnapCandidate, createSnapProvider, DEFAULT_SNAP_OPTIONS } from '../snapping';
import { constrainAngle } from '../geometry/constraints';
import { visualGridSteps } from '../geometry/grid';
import { renderItems } from '../renderer/selectors';
import { createGeometryCommand } from '../domain/geometryIntent';
import { alignedDimension } from '../geometry/survey';
import { deserializeDocument, serializeDocument } from '../persistence/serialization';
import { resolveAiTaskPlan, taskCommands } from '../ai/task';
import { aiTaskSchema, validateParserResult, AI_LIMITS, type AiTaskIntent } from '../ai/intent';
import { applicationReducer, type ApplicationState } from '../ai/workflow';
import { developmentMockProvider, OpenRouterIntentProvider } from '../../server/ai';
import { MockAiIntentProvider, AiRequestRunner } from '../ai/provider';

const points = [{ name: 'P1', x: 0, y: 0 }, { name: 'P2', x: 30, y: 0 }, { name: 'P3', x: 30, y: 20 }, { name: 'P4', x: 0, y: 20 }];
const pointText = 'Создай P1 (0,0), P2 (30,0), P3 (30,20), P4 (0,20) и построй по ним границу';
const pointTask: AiTaskIntent = { actions: [{ type: 'create_points', points }, { type: 'create_boundary_from_named_points', pointNames: points.map(p => p.name) }] };
const site: AiTaskIntent['actions'][number] = { type: 'create_rectangle', name: 'Участок', width: 20, height: 30, placement: { type: 'local_origin' } };
const houseTask: AiTaskIntent = { actions: [site, { type: 'create_rectangle', name: 'Дом', width: 6, height: 4, placement: { type: 'centered_in_action_result', polygonActionIndex: 0 } }, { type: 'create_dimensions_for_boundary_edges', boundaryActionIndex: 1 }] };
function preview(task: AiTaskIntent, text = ''): ApplicationState {
  let state: ApplicationState = { editor: initialEditorState(createNewDocument()), ai: { status: 'idle' } };
  state = applicationReducer(state, { type: 'ai-event', event: { type: 'start', id: 'test', text } });
  return applicationReducer(state, { type: 'ai-event', event: { type: 'result', id: 'test', result: task } });
}

describe('layer commands and selection', () => {
  it('creates one history step with stable IDs, reconciles current layer on Undo, reorders and deletes empty layers', () => {
    const original = initialEditorState(createNewDocument());
    let state = editorReducer(original, { type: 'create-layer' });
    const layerId = state.currentLayerId;
    expect(state.document.layers.at(-1)).toMatchObject({ id: layerId, name: 'Новый слой', visible: true, locked: false });
    expect(state.selectedLayerId).toBe(layerId); expect(state.past).toHaveLength(1);
    state = editorReducer(state, { type: 'undo' }); expect(state.currentLayerId).not.toBe(layerId);
    state = editorReducer(state, { type: 'redo' }); expect(state.document.layers.at(-1)!.id).toBe(layerId);
    state = editorReducer(state, { type: 'execute', command: { type: 'move-layer', layerId, direction: -1 } });
    expect([...state.document.layers].sort((a,b) => a.order-b.order).at(-2)!.id).toBe(layerId);
    state = editorReducer(state, { type: 'execute', command: { type: 'delete-layer', layerId } });
    expect(state.document.layers.some(layer => layer.id === layerId)).toBe(false);
  });
  it('blocks deletion of non-empty and last layer; selection-only operations preserve history', () => {
    let state = initialEditorState(createNewDocument());
    state = editorReducer(state, { type: 'execute', command: createGeometryCommand(state.document, 'point', [{ position: { x: 1, y: 2 } }]) });
    const point = state.document.entities[0]!;
    const selected = editorReducer(state, { type: 'select-layer-objects', layerId: point.layerId });
    expect(selected.past).toBe(state.past); expect(selected.selectedEntityIds).toEqual([point.id]);
    expect(() => applyCommand(state.document, { type: 'delete-layer', layerId: point.layerId })).toThrow('Слой содержит 1 объектов');
    expect(() => applyCommand({ ...createNewDocument(), layers: [state.document.layers[0]!] }, { type: 'delete-layer', layerId: state.document.layers[0]!.id })).toThrow('последний');
  });
  it('renderer respects layer order even for annotations', () => {
    let doc = createNewDocument();
    doc = applyCommand(doc, createGeometryCommand(doc, 'text', [{ position: { x: 0, y: 0 } }], { content: 'text' }));
    doc = applyCommand(doc, createGeometryCommand(doc, 'point', [{ position: { x: 0, y: 0 } }]));
    const text = doc.entities.find(entity => entity.type === 'text')!;
    doc = { ...doc, layers: doc.layers.map(layer => ({ ...layer, order: layer.id === text.layerId ? -1 : layer.order })) };
    expect(renderItems(doc)[0]!.entity.id).toBe(text.id);
  });
});
describe('precision and dimension', () => {
  it.each([0.1, 0.5, 1, 10])('snaps to configured %s m independently of zoom', step => {
    const provider = createSnapProvider(createNewDocument());
    for (const pixelsPerUnit of [0.1, 1, 10]) {
      const result = findSnapCandidate({ x: step * 1.01, y: step * 2.02 }, provider, { center: { x: 999, y: 333 }, pixelsPerUnit }, { ...DEFAULT_SNAP_OPTIONS, grid: true, gridStep: step });
      expect(result?.worldPosition.x).toBeCloseTo(step); expect(result?.worldPosition.y).toBeCloseTo(step * 2);
    }
    expect(visualGridSteps(step, 0.1).minor).toBeGreaterThanOrEqual(step);
    expect(visualGridSteps(step, 0.1).major).toBe(visualGridSteps(step, 0.1).minor * 5);
  });
  it.each([[10, 1, 0], [1, 10, 90], [10, 9, 45], [-10, 9, 135]])('constrains world angle (%s,%s) to %s degrees', (x,y,expected) => {
    const point = constrainAngle({ x: 200, y: -400 }, { x: 200+x, y: -400+y }, 45);
    expect(Math.atan2(point.y+400, point.x-200) * 180/Math.PI).toBeCloseTo(expected);
  });
  it('Ortho is editor-only and dimension text position is bounded, persistent and defaults to center for old files', () => {
    let doc = createNewDocument();
    const cmd = createGeometryCommand(doc, 'dimension', [{ position: { x: 0, y: 0 } }, { position: { x: 10, y: 0 } }], { offset: 2 });
    doc = applyCommand(doc, cmd); const id = doc.entities[0]!.id;
    expect(alignedDimension({ x: 0, y: 0 }, { x: 10, y: 0 }, 2).label).toEqual({ x: 5, y: 2 });
    const old = deserializeDocument(serializeDocument(doc)); expect(old.entities[0]).not.toHaveProperty('textPosition');
    doc = applyCommand(doc, { type: 'update-entity', entityId: id, patch: { textPosition: 0.8 } });
    expect(deserializeDocument(serializeDocument(doc)).entities[0]).toHaveProperty('textPosition', 0.8);
    expect(() => applyCommand(doc, { type: 'update-entity', entityId: id, patch: { textPosition: 1.2 } })).toThrow();
    const state = initialEditorState(doc); expect(editorReducer(state, { type: 'toggle-ortho' }).document).toBe(doc);
  });
});
describe('construction and projected dependencies', () => {
  it.each(['Нарисуй участок 20x30 м, в центре дом, 6x5 м и проставь размеры дома',
    'Нарисуй участок 20 на 30, в середине дом 6 на 5, размеры дома поставь.',
    'Участок 20×30 м, посередине дом 6×5 м с размерами сторон'])('accepts explicit centering synonyms with equivalent construction semantics: %s', text => {
    const task: AiTaskIntent = { actions: [site, { type: 'create_rectangle', name: 'Дом', width: 6, height: 5, placement: { type: 'centered_in_action_result', polygonActionIndex: 0 } }, { type: 'create_dimensions_for_boundary_edges', boundaryActionIndex: 1 }] };
    expect(validateParserResult(task, text)).toEqual(task);
    const plan = resolveAiTaskPlan(task, createNewDocument());
    expect(plan.resolution.status).toBe('ready');
    const dimensions = plan.actions[2]!.resolution;
    if (dimensions.status !== 'ready' || dimensions.kind !== 'bulk-dimensions') throw new Error();
    expect(dimensions.dimensions.map(dimension => dimension.metrics.horizontal)).toEqual([6,5,6,5]);
    expect(() => validateParserResult(task, 'Участок 20×30 м, на участке дом 6×5 м с размерами')).toThrow('Уточните положение');
  });
  it('extracts explicit coordinates only; retains Z, scientific notation and Cyrillic names', () => {
    expect(validateParserResult(pointTask, pointText)).toEqual(pointTask);
    const task = { actions: [{ type: 'create_points', points: [{ name: 'КН-7', x: 562341.234123456, y: 6189345.221234567, z: 152.34 }] }] };
    expect(validateParserResult(task, 'Создай КН-7 (562341.234123456,6189345.221234567,152.34)')).toEqual(task);
    expect(validateParserResult({ actions: [{ type: 'create_points', points: [{ name: 'Т1', x: 1000, y: -200 }] }] }, 'Создай Т1 (1e3,-2e2)')).toHaveProperty('actions');
    expect(() => validateParserResult(pointTask, 'Создай точки P1 и P2')).toThrow('явно');
    expect(() => validateParserResult({ actions: [{ type: 'create_points', points: [{ name: 'P1', x: 99, y: 0 }] }] }, 'Создай P1 (0,0)')).toThrow();
    expect(() => validateParserResult({ actions: [{ type: 'create_points', points: [{ name: 'P1', x: 1, y: 2 }] }] }, 'Создай AP1 X=1 Y=2')).toThrow();
  });
  it('new points resolve names in subsequent boundary before Apply; one atomic history step preserves IDs', () => {
    const state = preview(pointTask, pointText), before = state.editor;
    expect(state.ai.status).toBe('preview'); if (state.ai.status !== 'preview') throw new Error();
    expect(state.ai.plan.resolution.status).toBe('ready'); expect(before.document.entities).toHaveLength(0); expect(before.past).toHaveLength(0);
    const projected = state.ai.plan.projectedDocument!; expect(projected.entities).toHaveLength(5);
    const applied = applicationReducer(state, { type: 'ai-apply' }); expect(applied.editor.document).toEqual(projected); expect(applied.editor.past).toHaveLength(1);
    const undone = applicationReducer(applied, { type: 'undo' }); expect(undone.editor.document).toBe(before.document);
    expect(applicationReducer(undone, { type: 'redo' }).editor.document).toEqual(projected);
  });
  it('blocks duplicate existing names and duplicate action names; self-crossing boundary has no partial points', () => {
    const existing = resolveAiTaskPlan({ actions: [pointTask.actions[0]!] }, createNewDocument()).projectedDocument!;
    expect(resolveAiTaskPlan(pointTask, existing).resolution).toMatchObject({ status: 'invalid', message: expect.stringContaining('уже существует') });
    expect(aiTaskSchema.safeParse({ actions: [{ type: 'create_points', points: [points[0], points[0]] }] }).success).toBe(false);
    const invalid = preview({ actions: [pointTask.actions[0]!, { type: 'create_boundary_from_named_points', pointNames: ['P1', 'P3', 'P2', 'P4'] }] });
    expect(applicationReducer(invalid, { type: 'ai-apply' }).editor).toBe(invalid.editor);
    expect(aiTaskSchema.safeParse({ actions: [{ type: 'create_points', points: Array.from({ length: AI_LIMITS.pointsPerAction + 1 }, (_,i) => ({name: `P${i}`,x:i,y:i})) }] }).success).toBe(false);
  });
  it.each([{ type: 'lower_left' as const, x: 10, y: 12 }, { type: 'center' as const, x: 13, y: 14 }])('constructs exact 6×4 corners for %s', placement => {
    const plan = resolveAiTaskPlan({ actions: [{ type: 'create_rectangle', name: 'Дом', width: 6, height: 4, placement }] }, createNewDocument());
    const result = plan.actions[0]!.resolution; if (result.status !== 'ready' || result.kind !== 'rectangle') throw new Error();
    expect(result.geometry).toEqual([{x:10,y:12},{x:16,y:12},{x:16,y:16},{x:10,y:16}]); expect(result.area).toBe(24); expect(result.perimeter).toBe(20);
  });
  it('site + centered house + dimensions uses typed polygon output and outward 6/4/6/4 dimensions', () => {
    const plan = resolveAiTaskPlan(houseTask, createNewDocument()); expect(plan.resolution.status).toBe('ready'); expect(taskCommands(plan)).toHaveLength(6);
    const rectangle = plan.actions[1]!.resolution; if (rectangle.status !== 'ready' || rectangle.kind !== 'rectangle') throw new Error();
    expect(rectangle.geometry).toEqual([{x:7,y:13},{x:13,y:13},{x:13,y:17},{x:7,y:17}]);
    const bulk = plan.actions[2]!.resolution; if (bulk.status !== 'ready' || bulk.kind !== 'bulk-dimensions') throw new Error();
    expect(bulk.dimensions.map(dim => dim.metrics.horizontal)).toEqual([6,4,6,4]); expect(bulk.dimensions.every(dim => dim.offset < 0)).toBe(true);
    const applied = applicationReducer(preview(houseTask), { type: 'ai-apply' }); expect(applied.editor.past).toHaveLength(1);
    expect(deserializeDocument(serializeDocument(applied.editor.document))).toEqual(applied.editor.document);
  });
  it('rejects future refs, invented dimensions and nonexplicit centering', () => {
    expect(aiTaskSchema.safeParse({ actions: [{ type: 'create_rectangle', name: 'Дом', width: 6, height: 4, placement: { type: 'centered_in_action_result', polygonActionIndex: 1 } }, site] }).success).toBe(false);
    expect(() => validateParserResult(houseTask, 'Нарисуй участок, на нем дом 6×4')).toThrow();
    expect(() => validateParserResult({ actions: [site] }, 'Нарисуй участок')).toThrow();
  });
});
describe('clarifications and providers', () => {
  it('bounded questions have no document/history/dirty effects, and follow-up remains text only', async () => {
    let state: ApplicationState = { editor: initialEditorState(createNewDocument()), ai: { status: 'idle' } }; const before = state.editor;
    const runner = new AiRequestRunner(developmentMockProvider());
    await runner.run('Создай точки P1 и P2', event => { state = applicationReducer(state, { type: 'ai-event', event }); });
    expect(state.editor).toBe(before); expect(state.ai.status).toBe('needs_clarification');
    await runner.run('Создай точки P1 и P2\nУточнение пользователя: P1 (0,0), P2 (30,0)', event => { state = applicationReducer(state, { type: 'ai-event', event }); });
    expect(state.ai.status).toBe('preview'); expect(state.editor).toBe(before);
    expect(() => validateParserResult({ status: 'needs_clarification', questions: ['a','b','c','d'] }, 'x')).toThrow();
    expect(() => validateParserResult({ status: 'needs_clarification', questions: ['a'.repeat(241)] }, 'x')).toThrow();
  });
  it('normalizes structured null Z and accepts clarification with a text-only OpenRouter request', async () => {
    const transport = async (_url: unknown, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)); expect(payload.messages[1]).toEqual({ role: 'user', content: 'Создай точки P1 и P2' }); expect(payload).not.toHaveProperty('document');
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ intent: { status: 'needs_clarification', questions: ['Координаты?'] } }) } }] }));
    };
    expect(await new OpenRouterIntentProvider('fake', 'qwen/test', transport).parseIntent({text:'Создай точки P1 и P2',signal:new AbortController().signal})).toEqual({status:'needs_clarification',questions:['Координаты?']});
    expect(validateParserResult({actions:[{type:'create_points',points:[{name:'P1',x:0,y:0,z:null}]}]}, 'Создай P1 (0,0)')).toEqual({actions:[{type:'create_points',points:[{name:'P1',x:0,y:0}]}]});
    const runner = new AiRequestRunner(new MockAiIntentProvider(() => ({actions:[{type:'create_points',points:[{name:'P1',x:1,y:2}]}]})));
    const events: string[] = []; await runner.run('Создай P1', event => events.push(event.type)); expect(events.at(-1)).toBe('failure');
  });
});
