/** Opt-in paid real smoke: AI_REAL_SMOKE=1 npm run bench:ai-reliability. Never part of CI. */
import { test, expect } from 'vitest';
import { loadEnv } from 'vite';
import { writeFileSync, readFileSync } from 'node:fs';
import { OpenRouterIntentProvider } from '../server/ai';
import { DEFAULT_PRIMARY_MODEL, DEFAULT_FALLBACK_MODELS, routingConfig } from '../server/aiConfig';
import { HttpAiIntentProvider, validateReliableResult, type AiIntentProvider } from '../src/ai/provider';
import { createDiagnostic, newTraceId, safeDiagnostic } from '../src/ai/reliability';
import { createNewDocument } from '../src/domain/newDocument';
import { resolveAiTaskPlan } from '../src/ai/task';

const fixtures = [
  ['A', 'Нарисуй участок 20x30 м, в центре дом 6x5 м и проставь размеры дома'],
  ['B', 'Нарисуй участок 20 на 30 метров. В центре размести дом размером 6 на 5 и покажи размеры дома.'],
  ['C', 'Сделай прямоугольный участок 30×20 м, по центру дом 5×6, проставь размеры дома.'],
  ['D', 'Создай P1 (0,0), P2 (20,0), P3 (20,10), P4 (0,10) и построй границу.'],
  ['E', 'Нарисуй участок, дом 6×4, грядки и газовую трубу с запада.'],
] as const;
function correct(label: string, result: ReturnType<typeof validateReliableResult>, id: string, text: string) {
  if (label === 'E') return 'status' in result && ['unsupported', 'needs_clarification'].includes(result.status);
  if (!('actions' in result)) return false;
  const plan = resolveAiTaskPlan(result, createNewDocument(), new Map(), { id, text });
  if (plan.resolution.status !== 'ready') return false;
  if (label === 'D') {
    const [points, boundary] = result.actions;
    return result.actions.length === 2 && points?.type === 'create_points' && points.points.length === 4 && boundary?.type === 'create_boundary_from_named_points'
      && JSON.stringify(boundary.pointNames) === JSON.stringify(['P1', 'P2', 'P3', 'P4']) && plan.generatedCommandCount === 2;
  }
  const [site, house, dimensions] = result.actions;
  const c = label === 'C';
  return result.actions.length === 3 && site?.type === 'create_rectangle' && site.width === (c ? 30 : 20) && site.height === (c ? 20 : 30) && site.placement.type === 'local_origin'
    && house?.type === 'create_rectangle' && house.width === (c ? 5 : 6) && house.height === (c ? 6 : 5) && house.placement.type === 'centered_in_action_result' && house.placement.polygonActionIndex === 0
    && dimensions?.type === 'create_dimensions_for_boundary_edges' && dimensions.boundaryActionIndex === 1 && plan.generatedCommandCount === 6
    && plan.actions[2]?.resolution.status === 'ready' && plan.actions[2].resolution.kind === 'bulk-dimensions' && plan.actions[2].resolution.dimensions.length === 4;
}
test.skipIf(process.env.AI_REAL_SMOKE !== '1')('real routing 5×A–E plus isolated same-fixture model comparison', async () => {
  const env = loadEnv('development', process.cwd(), ''); expect(Boolean(env.OPENROUTER_API_KEY)).toBe(true);
  const key = env.OPENROUTER_API_KEY!;
  const rows: unknown[] = [];
  const run = async (group: string, label: string, text: string, iteration: number, provider: AiIntentProvider) => {
    const traceId = newTraceId(), controller = new AbortController(), started = performance.now();
    let diagnostic = createDiagnostic(traceId, text);
    let semanticCorrect = false, validStructuredOutput = false, errorCode: string | null = null;
    try {
      const result = validateReliableResult(await provider.parseIntent({ text, traceId, signal: controller.signal, onDiagnostic: record => { diagnostic = record; } }), text);
      validStructuredOutput = true; semanticCorrect = correct(label, result, traceId, text);
      if ('actions' in result) diagnostic.resolverStatus = resolveAiTaskPlan(result, createNewDocument(), new Map(), { id: traceId, text }).resolution.status;
    } catch (error) { errorCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNCLASSIFIED'; }
    const row = { group, label, iteration, validStructuredOutput, semanticCorrect, errorCode, latencyMs: Math.round(performance.now() - started), diagnostics: safeDiagnostic(diagnostic, [key]) };
    rows.push(row);
    writeFileSync('docs/audit-results/ai-reliability.json', JSON.stringify({ timestamp: new Date().toISOString(), primary: DEFAULT_PRIMARY_MODEL, fallbacks: DEFAULT_FALLBACK_MODELS, rows }, null, 2));
    console.info(JSON.stringify({ group, label, iteration, semanticCorrect, validStructuredOutput, errorCode, latencyMs: row.latencyMs, status: diagnostic.httpStatus, model: diagnostic.actualModel, provider: diagnostic.actualProvider, attempts: diagnostic.attempts.length }));
  };
  const endpoint = new HttpAiIntentProvider((input, init) => fetch(new URL(String(input), 'http://127.0.0.1:5173'), init));
  // At most two concurrent user requests, each independently bounded to two HTTP attempts.
  for (let iteration = 1; iteration <= 5; iteration++) for (let index = 0; index < fixtures.length; index += 2)
    await Promise.all(fixtures.slice(index, index + 2).map(([label, text]) => run('configured-routing', label, text, iteration, endpoint)));
  for (const model of [DEFAULT_PRIMARY_MODEL, ...DEFAULT_FALLBACK_MODELS]) for (let index = 0; index < fixtures.length; index += 2)
    await Promise.all(fixtures.slice(index, index + 2).map(([label, text]) => run(model, label, text, 1, new OpenRouterIntentProvider(key, model, undefined, [], 30000, routingConfig(env)))));
  expect(rows).toHaveLength(35);
}, 1100000);

test.skipIf(process.env.AI_REASSESS_SMOKE !== '1')('reassess saved smoke results with corrected packet-command expectation (no network)', () => {
  const path = 'docs/audit-results/ai-reliability.json';
  const report = JSON.parse(readFileSync(path, 'utf8'));
  for (const row of report.rows) {
    const fixture = fixtures.find(([label]) => label === row.label)!;
    if (row.validStructuredOutput) row.semanticCorrect = correct(row.label, validateReliableResult(row.diagnostics.parsedResult, fixture[1]), row.diagnostics.traceId, fixture[1]);
  }
  writeFileSync(path, JSON.stringify(report, null, 2));
  expect(report.rows.length).toBeGreaterThanOrEqual(35);
});
