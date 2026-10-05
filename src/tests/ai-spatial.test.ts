import { describe, expect, it } from 'vitest';
import { resolvePlacement, rectangleInsidePolygon, type LayoutAnchor } from '../geometry/autoPlacement';
import { aiTaskSchema, validateParserResult, type AiTaskIntent } from '../ai/intent';
import { formatAssumption } from '../ai/assumptions';
import { taskPreviews } from '../ai/task';
import { createNewDocument } from '../domain/newDocument';
import { initialEditorState } from '../store/editor';
import { applicationReducer, type ApplicationState } from '../ai/workflow';
import { AiRequestRunner, HttpAiIntentProvider, MockAiIntentProvider } from '../ai/provider';
import { OpenRouterIntentProvider, OpenAIIntentProvider, OPENAI_OUTPUT_SCHEMA } from '../../server/ai';
import type { AiDiagnostic } from '../ai/reliability';

const northText = 'Создай участок 20×30, на севере участка поставь дом 5×6 и проставь размеры дома';
const northTask: AiTaskIntent = { actions: [
  { type: 'create_rectangle', name: 'Участок', width: 20, height: 30, placement: { type: 'local_origin' } },
  { type: 'create_rectangle', name: 'Дом', width: 5, height: 6, placement: { type: 'anchored_in_action_result', anchor: 'north', polygonActionIndex: 0 } },
  { type: 'create_dimensions_for_boundary_edges', boundaryActionIndex: 1 },
] };
const clarification = { intent: { status: 'needs_clarification', questions: ['Уточните точное положение дома на севере участка: расстояние от северной границы и смещение по ширине.'] }, unsupported: false };
const parent = { minX: 0, minY: 0, maxX: 20, maxY: 30 }, child = { width: 5, height: 6 };
const placements: [LayoutAnchor, number, number][] = [['center',7.5,12],['north',7.5,23],['south',7.5,1],['east',14,12],['west',1,12],['north_east',14,23],['north_west',1,23],['south_east',14,1],['south_west',1,1]];
function preview(task = northTask): ApplicationState {
  const state: ApplicationState = { editor: initialEditorState(createNewDocument()), ai: { status: 'idle' } };
  const started = applicationReducer(state, { type: 'ai-event', event: { type: 'start', id: 'spatial', text: northText } });
  return applicationReducer(started, { type: 'ai-event', event: { type: 'result', id: 'spatial', result: task } });
}
describe('shared provider clarification contract', () => {
  it('parses the exact reported response on server, client, runner and diagnostics', async () => {
    expect(validateParserResult(clarification, northText)).toEqual(clarification.intent);
    let diagnostics: AiDiagnostic | undefined;
    const provider = new OpenRouterIntentProvider('fake', 'qwen/test', async () => new Response(JSON.stringify({ model: 'qwen/test', provider: 'local-test', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(clarification) } }] })));
    expect(await provider.parseIntent({ text: northText, signal: new AbortController().signal, onDiagnostic: d => { diagnostics = d; } })).toEqual(clarification.intent);
    expect(diagnostics).toMatchObject({ schemaStatus: 'valid', localValidationStatus: 'valid', actionCount: 0 });
    expect(diagnostics).not.toHaveProperty('errorCode');
    const openai = new OpenAIIntentProvider('fake', 'local', async () => new Response(JSON.stringify({ status: 'completed', output: [{type:'message',content:[{type:'output_text',text:JSON.stringify(clarification)}]}] })));
    expect(await openai.parseIntent({text:northText,signal:new AbortController().signal})).toEqual(clarification.intent);
    const http = new HttpAiIntentProvider(async () => new Response(JSON.stringify(clarification)));
    let state = preview(); const before = state.editor;
    await new AiRequestRunner(http).run(northText, event => { state = applicationReducer(state,{type:'ai-event',event}); });
    expect(state.ai.status).toBe('needs_clarification'); expect(state.editor).toBe(before);
    expect(OPENAI_OUTPUT_SCHEMA.required).toEqual(['intent','unsupported']);
    const malformed = new OpenAIIntentProvider('fake','local',async () => new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{broken'}]}]})));
    await expect(malformed.parseIntent({text:northText,signal:new AbortController().signal})).rejects.toMatchObject({code:'INVALID_STRUCTURED_OUTPUT'});
  });
  it('supports all states and strict legacy compatibility; rejects contradictions and malformed values', () => {
    expect(validateParserResult({ intent: northTask, unsupported: false }, northText)).toEqual(northTask);
    expect(validateParserResult({ intent: null, unsupported: true }, northText)).toEqual({status:'unsupported'});
    expect(validateParserResult({ intent: northTask }, northText)).toEqual(northTask);
    for (const bad of [{...clarification,unsupported:true},{...clarification,extra:0},{intent:null,unsupported:false}, {unsupported:false}, {intent:{}}, {intent:[northTask]}, {intent:{...clarification.intent,extra:0}}, {intent:{actions:[{...northTask.actions[1],inset:1}]}}, {intent:{actions:[{...northTask.actions[0],sizeSource:null,extra:true}]}}])
      expect(() => validateParserResult(bad, northText)).toThrow(expect.objectContaining({code:'INVALID_STRUCTURED_OUTPUT'}));
  });
  it('keeps provider failures distinct and clarification side effect free', async () => {
    const provider = new OpenRouterIntentProvider('fake','local',async () => new Response('',{status:401}));
    await expect(provider.parseIntent({text:northText,signal:new AbortController().signal})).rejects.toMatchObject({code:'AUTH_ERROR'});
    let state = preview(); const editor = state.editor;
    await new AiRequestRunner(new MockAiIntentProvider(() => ({intent:{status:'needs_clarification',questions:['Укажите X/Y точки P1.']},unsupported:false}))).run('Создай точку P1',event => {state=applicationReducer(state,{type:'ai-event',event});});
    expect(state.ai.status).toBe('needs_clarification'); expect(state.editor).toBe(editor);
    expect(preview().ai.status).toBe('preview');
  });
});
describe('deterministic AUTO LAYOUT INSET', () => {
  it.each(placements)('%s is contained with exact origin (%s,%s), independent of viewport', (anchor,x,y) => {
    const expected = resolvePlacement(parent,child,anchor); expect(expected).toMatchObject({status:'ready',origin:{x,y}});
    expect(resolvePlacement(parent,child,anchor)).toEqual(expected);
    expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0); expect(x+5).toBeLessThanOrEqual(20); expect(y+6).toBeLessThanOrEqual(30);
    expect(resolvePlacement({minX:100,minY:-100,maxX:120,maxY:-70},child,anchor)).toMatchObject({origin:{x:x+100,y:y-100}});
  });
  it('clamps nominal inset in metres, reduces it explicitly for tight fit, and rejects invalid/oversized geometry', () => {
    expect(resolvePlacement({minX:0,minY:0,maxX:5,maxY:5},{width:2,height:2},'north')).toMatchObject({nominalInset:0.5,insetY:0.5});
    expect(resolvePlacement({minX:0,minY:0,maxX:100,maxY:100},child,'north')).toMatchObject({nominalInset:2,insetY:2});
    expect(resolvePlacement(parent,{width:20,height:29},'north_east')).toMatchObject({insetX:0,insetY:0.5});
    expect(resolvePlacement({minX:0,minY:0,maxX:5,maxY:5},{width:8,height:6},'north')).toMatchObject({status:'invalid',message:'Объект 8×6 м не помещается внутри участка 5×5 м.'});
    for (const width of [0,-1,Infinity,NaN]) expect(resolvePlacement(parent,{width,height:6},'north').status).toBe('invalid');
  });
  it('checks concave parent perimeter, including a notch between child corners and boundary contact', () => {
    const rect = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
    expect(rectangleInsidePolygon(rect,rect)).toBe(true);
    const notch = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:6,y:10},{x:6,y:5},{x:4,y:5},{x:4,y:10},{x:0,y:10}];
    expect(rectangleInsidePolygon(rect,notch)).toBe(false);
    expect(rectangleInsidePolygon([{x:1,y:1},{x:3,y:1},{x:3,y:4},{x:1,y:4}],notch)).toBe(true);
  });
});
describe('projected placement, assumptions and one atomic Apply', () => {
  it('resolves parent → north house → four dimensions without document mutation; Undo/Redo once preserves IDs', () => {
    const state = preview(); if (state.ai.status !== 'preview') throw new Error();
    const plan = state.ai.plan; expect(plan.resolution.status).toBe('ready'); expect(plan.generatedCommandCount).toBe(6);
    expect(state.editor.document.entities).toHaveLength(0); expect(state.editor.past).toHaveLength(0); expect(taskPreviews(plan)).toHaveLength(6);
    const house = plan.actions[1]!.resolution; if(house.status !== 'ready' || house.kind !== 'rectangle') throw new Error();
    expect(house.geometry).toEqual([{x:7.5,y:23},{x:12.5,y:23},{x:12.5,y:29},{x:7.5,y:29}]);
    const bulk = plan.actions[2]!.resolution; if(bulk.status !== 'ready' || bulk.kind !== 'bulk-dimensions') throw new Error();
    expect(bulk.dimensions.map(d=>d.metrics.horizontal)).toEqual([5,6,5,6]);
    expect(plan.assumptions).toMatchObject([{type:'local_origin'},{type:'relative_placement',anchor:'north'},{type:'auto_layout_inset',nominal:1,x:0,y:1},{type:'sketch_layout'}]);
    expect(plan.assumptions.map(formatAssumption).join(' ')).toContain('По горизонтали объект центрирован');
    expect(plan.assumptions.map(formatAssumption).join(' ')).toContain('северной границы: 1.0 м');
    const applied = applicationReducer(state,{type:'ai-apply'}); expect(applied.editor.past).toHaveLength(1); expect(applied.editor.document).toEqual(plan.projectedDocument);
    expect(JSON.stringify(applied.editor.document)).not.toContain('auto_layout_inset');
    const undone = applicationReducer(applied,{type:'undo'}); expect(undone.editor.document).toBe(state.editor.document);
    expect(applicationReducer(undone,{type:'redo'}).editor.document).toEqual(applied.editor.document);
  });
  it('blocks all commands and ghosts when child does not fit; verifies strict backward polygon references', () => {
    const task = structuredClone(northTask); Object.assign(task.actions[0]!,{width:5,height:5}); Object.assign(task.actions[1]!,{width:8,height:6});
    const state=preview(task); if(state.ai.status !== 'preview') throw new Error();
    expect(state.ai.plan.resolution.status).toBe('invalid'); expect(state.ai.plan.projectedDocument).toBeNull(); expect(taskPreviews(state.ai.plan)).toEqual([]);
    expect(applicationReducer(state,{type:'ai-apply'}).editor).toBe(state.editor);
    for(const polygonActionIndex of [1,2,-1]) { const bad = structuredClone(northTask); Object.assign((bad.actions[1] as {placement:object}).placement,{polygonActionIndex}); expect(aiTaskSchema.safeParse(bad).success).toBe(false); }
    const nonPolygon = structuredClone(northTask); nonPolygon.actions[0]={type:'create_points',points:[{name:'P1',x:0,y:0}]}; expect(aiTaskSchema.safeParse(nonPolygon).success).toBe(false);
  });
  it('accepts provider-normalized word dimensions with source evidence; numeric hallucinations cannot bypass validation', () => {
    const task = structuredClone(northTask); Object.assign(task.actions[0]!,{sizeSource:'двадцать на тридцать'}); Object.assign(task.actions[1]!,{sizeSource:'пять на шесть'});
    expect(validateParserResult(task,'Создай участок двадцать на тридцать метров, дом пять на шесть на севере, размеры дома')).toEqual(task);
    expect(() => validateParserResult(task,northText)).not.toThrow();
    expect(() => validateParserResult(task,'Создай участок, дом на севере')).toThrow();
    const bad = structuredClone(northTask); Object.assign(bad.actions[1]!,{width:9,sizeSource:'5 на 6'});
    for (const sizeSource of ['5 на 6', '5 на 6 метров']) { Object.assign(bad.actions[1]!,{sizeSource}); expect(() => validateParserResult(bad,'Участок 20 на 30, дом 5 на 6 метров на севере')).toThrow(expect.objectContaining({code:'LOCAL_VALIDATION_ERROR'})); }
  });
});
