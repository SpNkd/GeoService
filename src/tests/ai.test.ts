import { describe, expect, it, vi } from 'vitest';
import { AI_LIMITS, aiIntentSchema, aiRequestSchema, readBoundedJson, validateParserResult } from '../ai/intent';
import { resolveCreateBoundaryIntent, buildPointNameIndex, pointNameIndex } from '../ai/resolver';
import { AiRequestRunner, HttpAiIntentProvider, MockAiIntentProvider, type RequestEvent } from '../ai/provider';
import { applicationReducer, mutationExecutionGate, type AiPlan, type ApplicationState } from '../ai/workflow';
import { createSampleDocument } from '../sample/document';
import { initialEditorState, isDocumentDirty, editorReducer } from '../store/editor';
import { commandFromOrderedPoints } from '../domain/geometryIntent';
import { applyCommand } from '../domain/commands';
import { OpenAIIntentProvider, OPENAI_OUTPUT_SCHEMA, PARSER_PROMPT, developmentMockProvider } from '../../server/ai';
import type { GeoDocument } from '../domain/model';
import { serializeDocument, deserializeDocument } from '../persistence/serialization';

const intent = (pointNames = ['P1', 'P2', 'P3', 'P4']) => aiIntentSchema.parse({ type: 'create_boundary_from_named_points', pointNames });
const text = 'Создай границу по точкам P1, P2, P3 и P4';
function drawing(): GeoDocument {
  const doc = createSampleDocument();
  return { ...doc, entities: doc.entities.filter(entity => entity.type === 'point' && entity.name.startsWith('P')),
    vertices: Object.fromEntries(Object.entries(doc.vertices).filter(([id]) => id.startsWith('v-p'))) };
}
function state(doc = drawing()): ApplicationState { return { editor: initialEditorState(doc), ai: { status: 'idle' } }; }
function preview(app = state(), names?: string[]): ApplicationState {
  return applicationReducer(applicationReducer(app, { type: 'ai-event', event: { type: 'start', id: 'request-1', text } }),
    { type: 'ai-event', event: { type: 'result', id: 'request-1', result: intent(names) } });
}
function plan(app: ApplicationState): Extract<AiPlan, {kind: 'boundary'}> {
  if (app.ai.status !== 'preview' && app.ai.status !== 'stale') throw new Error('Expected preview'); if (app.ai.plan.kind !== 'boundary') throw new Error('Expected boundary'); return app.ai.plan;
}
function ready(doc = drawing(), names?: string[]) {
  const result = resolveCreateBoundaryIntent(intent(names), doc);
  if (result.status !== 'ready') throw new Error(`Expected ready: ${JSON.stringify(result)}`); return result;
}

describe('AI intent trust boundary', () => {
  it('mock parses the Russian fixture and preserves order', async () => {
    const raw = await developmentMockProvider().parseIntent({ text, signal: new AbortController().signal });
    expect(validateParserResult(raw, text)).toEqual(intent());
  });
  it.each([{ names: [] }, { names: ['P1'] }, { names: ['P1', 'P2'] }])('rejects fewer than three names: $names', ({ names }) => {
    expect(aiIntentSchema.safeParse({ type: 'create_boundary_from_named_points', pointNames: names }).success).toBe(false);
  });
  it('accepts trimmed Cyrillic, numeric and hyphenated names in exact order', () => {
    expect(intent([' Т1 ', 'КН-4', '123', 'A-12']).pointNames).toEqual(['Т1', 'КН-4', '123', 'A-12']);
    expect(validateParserResult(intent(['Т1', 'КН-4', '123']), 'Создай границу Т1 КН-4 123')).toEqual(intent(['Т1', 'КН-4', '123']));
  });
  it.each([{ type: 'delete', pointNames: ['P1', 'P2', 'P3'] }, { ...intent(), vertexIds: ['a'] },
    { ...intent(), coordinates: [1, 2] }, { ...intent(), entityIds: ['p1'] }, { ...intent(), patch: {} },
    { ...intent(), pointNames: Array(501).fill('P1') }, { ...intent(), pointNames: ['x'.repeat(129), 'P2', 'P3'] }])('rejects unsupported fields/type/budget', raw => {
    expect(aiIntentSchema.safeParse(raw).success).toBe(false);
  });
  it('bounds UTF-8 request bytes and forbids a document field', () => {
    expect(aiRequestSchema.safeParse({ text: 'Я'.repeat(4097) }).success).toBe(false);
    expect(aiRequestSchema.safeParse({ text, document: drawing() }).success).toBe(false);
  });
  it('rejects hallucination even when P4 exists, out-of-order names and substring P1 in P12', () => {
    expect(() => validateParserResult(intent(), 'Создай границу P1 P2 P3')).toThrow('P4');
    expect(() => validateParserResult(intent(['P2', 'P1', 'P3']), 'P1 P2 P3')).toThrow('порядок');
    expect(() => validateParserResult(intent(['P1', 'P2', 'P3']), 'P12 P2 P3')).toThrow('P1');
  });
  it('rejects unknown fields on unsupported and bounds output', () => {
    expect(() => validateParserResult({ status: 'unsupported', command: {} }, text)).toThrow('intent');
    expect(() => validateParserResult({ data: 'x'.repeat(AI_LIMITS.responseBytes) }, text)).toThrow('лимит');
  });
  it('bounds streamed output without Content-Length and rejects invalid JSON', async () => {
    await expect(readBoundedJson(new Response('x'.repeat(100)), 50)).rejects.toThrow('лимит');
    await expect(readBoundedJson(new Response('{broken'))).rejects.toThrow('JSON');
    await expect(readBoundedJson(new Response('{}', { headers: { 'Content-Length': '1000' } }), 50)).rejects.toThrow('лимит');
  });
});

describe('pure name resolver', () => {
  it('reuses manual topology in order, derives metrics, leaves inputs unchanged', () => {
    const doc = drawing(), before = serializeDocument(doc), ai = ready(doc);
    const manual = commandFromOrderedPoints(doc, ['p1', 'p2', 'p3', 'p4'], 'polygon');
    expect(ai.command.type === 'add-entity' && ai.command.entity).toMatchObject(manual.type === 'add-entity' ? { ...manual.entity, id: expect.any(String) } : {});
    expect(ai.command.type === 'add-entity' && ai.command.vertices).toEqual([]);
    expect(ai.area).toBe(2400); expect(ai.perimeter).toBe(200);
    expect(serializeDocument(doc)).toBe(before); expect(ready(doc)).toEqual(ai);
  });
  it('supports real coordinates without precision loss', () => {
    const doc = drawing(); for (const vertex of Object.values(doc.vertices)) { vertex.x += 561341.234123456; vertex.y += 6187345.221234567; }
    const result = ready(doc); expect(result.geometry[0]).toEqual({ x: 562341.234123456, y: 6189345.221234567, z: 152.34 });
    expect(result.area).toBeCloseTo(2400, 6); expect(result.perimeter).toBeCloseTo(200, 6);
  });
  it('missing names block the entire command and exact case is significant', () => {
    expect(resolveCreateBoundaryIntent(intent(['P1', 'P2', 'P999']), drawing())).toEqual({ status: 'unresolved', issues: [{ kind: 'missing', name: 'P999' }] });
    expect(resolveCreateBoundaryIntent(intent(['p1', 'P2', 'P3']), drawing()).status).toBe('unresolved');
  });
  it('never selects the first duplicate; explicit choice includes XY/Z/layer and validates current name', () => {
    const doc = drawing(); doc.entities.push({ ...doc.entities[0]!, id: 'duplicate' });
    const resolution = resolveCreateBoundaryIntent(intent(), doc);
    expect(resolution).toMatchObject({ status: 'unresolved', issues: [{ kind: 'ambiguous', name: 'P1', candidates: [
      { entityId: 'p1', position: { x: 1000, y: 2000, z: 152.34 }, layer: 'Геодезические точки' }, { entityId: 'duplicate' } ] }] });
    expect(resolveCreateBoundaryIntent(intent(), doc, new Map([['P1', 'duplicate']])).status).toBe('ready');
    expect(resolveCreateBoundaryIntent(intent(), doc, new Map([['P1', 'p2']])).status).toBe('invalid');
  });
  it('rejects duplicates in request, including trim, and shared vertices under different names', () => {
    expect(resolveCreateBoundaryIntent(intent(['P1', ' P1 ', 'P3']), drawing()).status).toBe('invalid');
    const doc = drawing(); const p2 = doc.entities[1]!; if (p2.type === 'point') p2.vertexId = 'v-p1';
    expect(resolveCreateBoundaryIntent(intent(), doc).status).toBe('invalid');
  });
  it('rejects self intersection and zero area', () => {
    expect(resolveCreateBoundaryIntent(intent(['P1', 'P3', 'P2', 'P4']), drawing())).toMatchObject({ status: 'invalid', message: expect.stringContaining('самопересекается') });
    const doc = drawing(); doc.vertices['v-p3']!.y = 2000;
    expect(resolveCreateBoundaryIntent(intent(['P1', 'P2', 'P3']), doc).status).toBe('invalid');
  });
  it.each(['locked', 'visible'] as const)('blocks inaccessible boundary target: %s', key => {
    const doc = drawing(); doc.layers[0]![key] = key === 'locked';
    expect(resolveCreateBoundaryIntent(intent(), doc).status).toBe('invalid');
  });
  it('creates missing boundary layer atomically with existing style', () => {
    const doc = drawing(); doc.layers = doc.layers.filter(layer => layer.id !== 'boundary'); const result = ready(doc);
    expect(result.command).toMatchObject({ layer: { id: 'boundary', styleId: 'boundary', locked: false, visible: true } });
    const app = applicationReducer(preview(state(doc)), { type: 'ai-apply' });
    expect(app.editor.past).toHaveLength(1); expect(app.editor.document.layers.some(layer => layer.id === 'boundary')).toBe(true);
    expect(applicationReducer(app, { type: 'undo' }).editor.document.layers).toEqual(doc.layers);
  });
  it('includes hidden duplicate points and permits locked references with warnings', () => {
    const doc = drawing(); doc.layers.find(layer => layer.id === 'survey-points')!.visible = false;
    doc.layers.find(layer => layer.id === 'survey-points')!.locked = true;
    const result = ready(doc); expect(result.warnings.join(' ')).toContain('скрыт'); expect(result.warnings.join(' ')).toContain('заблокированных');
    expect(applyCommand(doc, result.command).entities).toHaveLength(5);
    doc.entities.push({ ...doc.entities[0]!, id: 'duplicate', layerId: 'annotations' });
    expect(resolveCreateBoundaryIntent(intent(), doc).status).toBe('unresolved');
  });
  it('indexes names once per immutable entity array, not per coordinate drag', () => {
    const doc = drawing(), index = pointNameIndex(doc.entities);
    const moved = applyCommand(doc, { type: 'move-vertex', vertexId: 'v-p1', delta: { x: 1, y: 0 } });
    expect(pointNameIndex(moved.entities)).toBe(index);
    const renamed = applyCommand(moved, { type: 'update-entity', entityId: 'p1', patch: { name: 'Т1' } });
    expect(pointNameIndex(renamed.entities)).not.toBe(index);
    expect(buildPointNameIndex(renamed.entities).get('Т1')?.[0]?.id).toBe('p1');
  });
});

describe('preview, gate and history', () => {
  it('Generate/Cancel/errors have no document, history, dirty or persistence side effects', () => {
    const initial = state(), generated = preview(initial);
    expect(generated.editor).toBe(initial.editor); expect(isDocumentDirty(generated.editor)).toBe(false);
    expect(serializeDocument(generated.editor.document)).toBe(serializeDocument(initial.editor.document));
    expect(applicationReducer(generated, { type: 'ai-cancel' }).editor).toBe(initial.editor);
    const started = applicationReducer(initial, { type: 'ai-event', event: { type: 'start', id: 'a', text } });
    for (const event of [{ type: 'failure', id: 'a', message: 'error' } as const, { type: 'result', id: 'a', result: { status: 'unsupported' } } as const]) {
      expect(applicationReducer(started, { type: 'ai-event', event }).editor).toBe(initial.editor);
    }
  });
  it('Apply creates one polygon and one history entry; Undo/Redo preserve IDs and shared refs; Save/Open round trips', () => {
    const generated = preview(), applied = applicationReducer(generated, { type: 'ai-apply' });
    expect(applied.ai.status).toBe('applied'); expect(applied.editor.past).toHaveLength(1); expect(isDocumentDirty(applied.editor)).toBe(true);
    expect(applied.editor.document.entities.filter(entity => entity.type === 'point')).toHaveLength(4);
    expect(Object.keys(applied.editor.document.vertices)).toEqual(Object.keys(generated.editor.document.vertices));
    const polygon = applied.editor.document.entities.at(-1)!; expect(polygon).toMatchObject({ type: 'polygon', vertexIds: ['v-p1', 'v-p2', 'v-p3', 'v-p4'] });
    const undone = applicationReducer(applied, { type: 'undo' }); expect(undone.editor.document).toBe(generated.editor.document);
    expect(isDocumentDirty(undone.editor)).toBe(false);
    const redone = applicationReducer(undone, { type: 'redo' }); expect(redone.editor.document.entities.at(-1)).toEqual(polygon);
    expect(deserializeDocument(serializeDocument(redone.editor.document))).toEqual(redone.editor.document);
  });
  it('stale preview cannot execute; Apply refreshes and requires a second explicit confirmation', () => {
    const generated = preview(), oldPlan = plan(generated);
    const moved = applicationReducer(generated, { type: 'execute', command: { type: 'move-vertex', vertexId: 'v-p1', delta: { x: 5, y: 0 } } });
    expect(moved.ai.status).toBe('stale'); expect(mutationExecutionGate(oldPlan, moved.editor).status).toBe('refreshed');
    const refreshed = applicationReducer(moved, { type: 'ai-apply' });
    expect(refreshed.editor).toBe(moved.editor); expect(refreshed.ai.status).toBe('preview');
    const resolved = plan(refreshed).resolution; expect(resolved.status === 'ready' && resolved.geometry[0]?.x).toBe(1005);
    expect(applicationReducer(refreshed, { type: 'ai-apply' }).editor.document.entities).toHaveLength(5);
  });
  it('stale recomputation detects new ambiguity or a locked target', () => {
    const generated = preview();
    const locked = applicationReducer(generated, { type: 'execute', command: { type: 'set-layer-lock', layerId: 'boundary', locked: true } });
    const refreshed = applicationReducer(locked, { type: 'ai-refresh' });
    expect(plan(refreshed).resolution.status).toBe('invalid');
    expect(applicationReducer(refreshed, { type: 'ai-apply' }).editor.document).toBe(locked.editor.document);
    const duplicate = applicationReducer(generated, { type: 'execute', command: { type: 'add-entity', vertices: [], entity: { type: 'point', name: 'P1', id: 'other', vertexId: 'v-p1', layerId: 'survey-points' } } });
    expect(plan(applicationReducer(duplicate, { type: 'ai-refresh' })).resolution.status).toBe('unresolved');
  });
  it('gate and guarded existing execute reject active transactions or changed snapshot', () => {
    const generated = preview(), dragging = applicationReducer(generated, { type: 'begin-transaction' });
    expect(mutationExecutionGate(plan(dragging), dragging.editor).status).toBe('blocked');
    expect(applicationReducer(dragging, { type: 'ai-apply' }).editor).toBe(dragging.editor);
    const command = ready().command;
    expect(editorReducer(dragging.editor, { type: 'execute', command, expectedDocument: generated.editor.document }).error).toContain('транзакция');
    const changed = editorReducer(generated.editor, { type: 'execute', command: { type: 'move-vertex', vertexId: 'v-p1', delta: { x: 1, y: 0 } } });
    expect(editorReducer(changed, { type: 'execute', command, expectedDocument: generated.editor.document }).document).toBe(changed.document);
  });
  it('gate still runtime-validates ready commands and no second apply is possible', () => {
    const generated = preview(), valid = plan(generated);
    if (valid.resolution.status !== 'ready') throw new Error('ready');
    const corrupt = { ...valid, resolution: { ...valid.resolution, command: { ...valid.resolution.command, injected: true } } };
    expect(() => mutationExecutionGate(corrupt, generated.editor)).toThrow('Неверная команда');
    const applied = applicationReducer(generated, { type: 'ai-apply' }); expect(applicationReducer(applied, { type: 'ai-apply' })).toBe(applied);
  });
  it('replacement resets preview and ignores response from an obsolete request', () => {
    const generated = preview(); const replaced = applicationReducer(generated, { type: 'replace-document', document: drawing(), size: { width: 800, height: 600 } });
    expect(replaced.ai.status).toBe('idle');
    expect(applicationReducer(replaced, { type: 'ai-event', event: { type: 'result', id: 'request-1', result: intent() } })).toBe(replaced);
  });
});

describe('providers and request lifecycle', () => {
  it('HTTP sends only bounded user text, never document or IDs', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(intent())));
    const result = await new HttpAiIntentProvider(transport).parseIntent({ text, signal: new AbortController().signal });
    expect(result).toEqual(intent()); expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({ text });
  });
  it('OpenAI uses structured output with server key/model, text only, no retention request; validates output', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ intent: intent() }) }] } ] })));
    expect(await new OpenAIIntentProvider('test-key', 'test-model', transport).parseIntent({ text, signal: new AbortController().signal })).toEqual(intent());
    const options = transport.mock.calls[0]?.[1], payload = JSON.parse(String(options?.body));
    expect(payload).toEqual({ model: 'test-model', store: false, instructions: PARSER_PROMPT, input: text, max_output_tokens: 12000,
      text: { format: { type: 'json_schema', name: 'boundary_intent', strict: true, schema: OPENAI_OUTPUT_SCHEMA } } });
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer test-key' });
  });
  it.each([{ status: 'incomplete', output: [] }, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{broken' }] }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ intent: { ...intent(), vertexIds: ['v-p1'] } }) }] }] }])('rejects incomplete, refusal, malformed and injected upstream output', async response => {
    await expect(new OpenAIIntentProvider('test-key', 'model', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response))))
      .parseIntent({ text, signal: new AbortController().signal })).rejects.toThrow();
  });
  it('real provider errors never fall back to mock or expose upstream error text', async () => {
    const provider = new OpenAIIntentProvider('secret-test', 'model', vi.fn<typeof fetch>().mockResolvedValue(new Response('sensitive upstream text', { status: 401 })));
    await expect(provider.parseIntent({ text, signal: new AbortController().signal })).rejects.toThrow('OpenAI недоступен');
    await expect(new OpenAIIntentProvider('', '', vi.fn()).parseIntent({ text, signal: new AbortController().signal })).rejects.toThrow('Настройте');
  });
  it('A finishing after B cannot overwrite B, even if provider ignores abort', async () => {
    let a!: (raw: unknown) => void, b!: (raw: unknown) => void;
    const events: RequestEvent[] = [], signals: AbortSignal[] = [];
    const runner = new AiRequestRunner(new MockAiIntentProvider(request => { signals.push(request.signal); return new Promise(resolve => { if (signals.length === 1) a = resolve; else b = resolve; }); }));
    const first = runner.run(text, event => events.push(event)), second = runner.run(text, event => events.push(event));
    expect(signals[0]?.aborted).toBe(true); b(intent()); await second; a({ status: 'unsupported' }); await first;
    expect(events.map(event => event.type)).toEqual(['start', 'start', 'result']);
    expect(events.at(-1)?.id).toBe(events[1]?.id);
  });
  it('cancel/unmount ignores delayed result and timeout reports an actionable error', async () => {
    let finish!: (raw: unknown) => void; const events: RequestEvent[] = [];
    const runner = new AiRequestRunner(new MockAiIntentProvider(() => new Promise(resolve => { finish = resolve; })));
    const pending = runner.run(text, event => events.push(event)); runner.cancel(); finish(intent()); await pending;
    expect(events.map(event => event.type)).toEqual(['start']);
    const timeoutEvents: RequestEvent[] = [];
    await new AiRequestRunner(new MockAiIntentProvider(() => new Promise(() => {})), 5).run(text, event => timeoutEvents.push(event));
    expect(timeoutEvents.at(-1)).toMatchObject({ type: 'failure', message: expect.stringContaining('вовремя') });
  });
  it.each([new Error('network error'), { ...intent(), patch: {} }])('errors or malformed outputs stay outside the editor', async output => {
    let app = state(); const initial = app.editor;
    await new AiRequestRunner(new MockAiIntentProvider(() => { if (output instanceof Error) throw output; return output; })).run(text, event => { app = applicationReducer(app, { type: 'ai-event', event }); });
    expect(app.ai.status).toBe('error'); expect(app.editor).toBe(initial);
  });
});
