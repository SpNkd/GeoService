import { expect, test, type Page } from '@playwright/test';
import { autosaveSnapshot } from './helpers/autosave';
import { createDiagnostic, type AiDiagnostic } from '../src/ai/reliability';
import { DEFAULT_PRIMARY_MODEL, DEFAULT_FALLBACK_MODELS } from '../server/aiConfig';

const text = 'Нарисуй участок 20x30 м, в центре дом 6x5 м и проставь размеры дома';
const semantic = { actions: [
  { type: 'create_rectangle', name: 'Участок', width: 20, height: 30, placement: { type: 'local_origin' } },
  { type: 'create_rectangle', name: 'Дом', width: 6, height: 5, placement: { type: 'centered_in_action_result', polygonActionIndex: 0 } },
  { type: 'create_dimensions_for_boundary_edges', boundaryActionIndex: 1 },
] };
async function setup(page: Page, scenario: 'success' | 'unsupported' | '502' | 'timeout' | 'retry' | 'fallback') {
  await page.route('**/api/ai/config', route => route.fulfill({ json: { mode: 'mock' } }));
  await page.route('**/api/ai/resolution', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/ai/intent', route => {
    const id = route.request().headers()['x-ai-trace-id']!;
    expect(route.request().postDataJSON()).toEqual({ text });
    const result = scenario === 'unsupported' ? { status: 'unsupported' } : semantic;
    const diagnostic: AiDiagnostic = { ...createDiagnostic(id, text, 'mock', DEFAULT_PRIMARY_MODEL, DEFAULT_FALLBACK_MODELS), rawResponse: 'Bearer should-never-copy sk-or-v1-mock-secret', schemaStatus: 'valid', parsedResult: result, latencyMs: 40, httpStatus: 200,
      attempts: [{ attempt: 1, requestedModel: DEFAULT_PRIMARY_MODEL, actualModel: DEFAULT_PRIMARY_MODEL, httpStatus: 200, latencyMs: 40 }] };
    if (scenario === 'retry') diagnostic.attempts = [{ attempt: 1, requestedModel: DEFAULT_PRIMARY_MODEL, httpStatus: 503, latencyMs: 10, errorCode: 'UPSTREAM_5XX' }, { attempt: 2, requestedModel: DEFAULT_PRIMARY_MODEL, actualModel: DEFAULT_PRIMARY_MODEL, httpStatus: 200, latencyMs: 30 }];
    if (scenario === 'fallback') { diagnostic.actualModel = DEFAULT_FALLBACK_MODELS[0]!; diagnostic.actualProvider = 'MockFallback'; diagnostic.attempts[0]!.actualModel = diagnostic.actualModel; }
    if (scenario === '502' || scenario === 'timeout') { diagnostic.schemaStatus = 'pending'; diagnostic.errorCode = scenario === '502' ? 'UPSTREAM_5XX' : 'TIMEOUT'; diagnostic.httpStatus = scenario === '502' ? 502 : 504;
      return route.fulfill({ status: diagnostic.httpStatus, json: { error: { code: diagnostic.errorCode }, diagnostics: diagnostic } }); }
    return route.fulfill({ json: { result, diagnostics: diagnostic } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Новый документ', exact: true }).click();
  await expect(page.getByText('MOCK · демо')).toBeVisible();
  const before = await autosaveSnapshot(page);
  await page.getByRole('textbox', { name: 'Запрос', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  return before;
}
for (const scenario of ['success', 'unsupported', '502', 'timeout', 'retry', 'fallback'] as const) {
  test(`AI reliability deterministic mock: ${scenario}`, async ({ page }) => {
    const before = await setup(page, scenario);
    const diagnostics = page.getByTestId('ai-diagnostics'); await diagnostics.locator(':scope > summary').click();
    const record = page.getByTestId('ai-diagnostic'); await expect(record).toHaveCount(1);
    await record.locator(':scope > summary').click();
    await expect(record).toContainText('"provider": "mock"'); await expect(record).toContainText('ai-');
    if (['success', 'retry', 'fallback'].includes(scenario)) {
      await expect(page.getByTestId('ai-plan')).toContainText('3 actions');
      await expect(page.getByRole('button', { name: 'Apply 6 changes', exact: true })).toBeEnabled();
      await expect(record).toContainText('"resolverStatus": "ready"');
      if (scenario === 'retry') await expect(record).toContainText('"attempt": 2');
      if (scenario === 'fallback') await expect(record).toContainText('MockFallback');
    } else {
      const alert = page.getByRole('alert');
      await expect(alert).toContainText(scenario === 'unsupported' ? 'Эта команда пока не поддерживается' : scenario === 'timeout' ? 'не ответил вовремя' : 'AI недоступен временно');
      if (scenario !== 'unsupported') { await expect(alert).not.toContainText('не поддерживается'); await expect(page.getByRole('button', { name: 'Повторить запрос', exact: true })).toBeVisible(); await expect(page.getByText('Подробнее', { exact: true })).toBeVisible(); }
      await expect(page.getByTestId('ai-ghost')).toHaveCount(0);
    }
    expect(await autosaveSnapshot(page)).toEqual(before);
    await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeDisabled();
    await page.screenshot({ path: `test-results/ai-reliability-${scenario}.png`, fullPage: true });
  });
}
test('retry button retries the same failed text and produces a preview without Apply', async ({ page }) => {
  await setup(page, '502'); await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute('**/api/ai/intent'); await page.route('**/api/ai/intent', route => { expect(route.request().postDataJSON()).toEqual({ text }); return route.fulfill({ json: semantic }); });
  await page.getByRole('textbox', { name: 'Запрос', exact: true }).fill('другой запрос');
  await page.getByRole('button', { name: 'Повторить запрос', exact: true }).click();
  await expect(page.getByTestId('ai-plan')).toContainText(text);
  await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(0);
});

test('Copy diagnostics is redacted and includes trace and resolver status', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await setup(page, 'success'); await expect(page.getByTestId('ai-plan')).toBeVisible();
  await page.getByTestId('ai-diagnostics').locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Copy diagnostics', exact: true }).click();
  await expect(page.getByText('Скопировано', { exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('ai-'); expect(copied).toContain('ready'); expect(copied).toContain('[REDACTED]');
  expect(copied).not.toContain('should-never-copy'); expect(copied).not.toContain('mock-secret');
});

test('real provider manual smoke (opt-in): trace, exact semantic preview, no mutation', async ({ page }) => {
  test.skip(process.env.AI_REAL_BROWSER_SMOKE !== '1', 'Paid network smoke requires explicit opt-in');
  await page.goto('/'); await expect(page.getByText('OpenRouter', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Новый документ', exact: true }).click();
  const before = await autosaveSnapshot(page);
  await page.getByRole('textbox', { name: 'Запрос', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await expect(page.getByTestId('ai-plan')).toContainText('3 actions', { timeout: 35000 });
  await expect(page.getByRole('button', { name: 'Apply 6 changes', exact: true })).toBeEnabled();
  const diagnostics = page.getByTestId('ai-diagnostics'); await diagnostics.locator(':scope > summary').click();
  const record = page.getByTestId('ai-diagnostic'); await record.locator(':scope > summary').click();
  await expect(record).toContainText('"provider": "openrouter"'); await expect(record).toContainText('"resolverStatus": "ready"');
  await expect(record).toContainText('"localValidationStatus": "valid"');
  expect(await autosaveSnapshot(page)).toEqual(before);
  await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/ai-reliability-real.png', fullPage: true });
});
