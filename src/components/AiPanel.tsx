import { memo, useEffect, useMemo, useState, type Dispatch, type FormEvent } from 'react';
import { AiRequestRunner, HttpAiIntentProvider, providerModeSchema, type AiIntentProvider, type ProviderMode } from '../ai/provider';
import { AI_LIMITS, readBoundedJson, utf8Bytes } from '../ai/intent';
import type { AiState, ApplicationAction } from '../ai/workflow';
import type { ResolvedReference } from '../ai/resolver';
import { AiPlanMetrics } from './AiPlanMetrics';
import { MAX_DIMENSION_OFFSET } from '../ai/resolver';

const operationLabels = { boundary: 'создать границу', polyline: 'создать полилинию', dimension: 'поставить размер', measure: 'измерить расстояние' };
const defaultProvider = new HttpAiIntentProvider();
const coordinates = (point: ResolvedReference) => `X ${point.position.x} · Y ${point.position.y}${point.position.z === undefined ? '' : ` · Z ${point.position.z}`}`;
interface Props { ai: AiState; dispatch: Dispatch<ApplicationAction>; transactionActive: boolean; documentEpoch: number; provider?: AiIntentProvider }
export const AiPanel = memo(function AiPanel({ ai, dispatch, transactionActive, documentEpoch, provider = defaultProvider }: Props) {
  const [text, setText] = useState('Создай границу по точкам P1, P2, P3 и P4');
  const [mode, setMode] = useState<ProviderMode>('disabled');
  const runner = useMemo(() => new AiRequestRunner(provider), [provider]);
  useEffect(() => () => runner.cancel(), [runner]);
  useEffect(() => { runner.cancel(); }, [runner, documentEpoch]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/ai/config', { signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const raw = await readBoundedJson(response, 1024);
      const parsed = providerModeSchema.safeParse(raw && typeof raw === 'object' && 'mode' in raw ? raw.mode : null);
      if (parsed.success && !controller.signal.aborted) setMode(parsed.data);
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  const generate = (event: FormEvent) => { event.preventDefault();
    void runner.run(text, event => dispatch({ type: 'ai-event', event })); };
  const preview = ai.status === 'preview' || ai.status === 'stale' ? ai : ai.status === 'applied' && ai.results ? { plan: ai.results, notice: null } : null;
  const resolution = preview?.plan.resolution;
  const cancel = () => { runner.cancel(); dispatch({ type: 'ai-cancel' }); };
  return <section className="ai-panel" aria-label="AI Assistant">
    <div className="ai-heading"><h2>AI Assistant</h2><span className="ai-mode">{mode === 'mock' ? 'MOCK · демо' : mode === 'openai' ? 'OpenAI' : mode === 'openrouter' ? 'OpenRouter' : 'Не подключён'}</span></div>
    <p className="ai-caption">Граница · полилиния · размер · измерение</p>
    <form onSubmit={generate}>
      <label htmlFor="ai-request">Запрос</label>
      <textarea id="ai-request" value={text} maxLength={AI_LIMITS.requestBytes} onChange={event => setText(event.target.value)} rows={3} />
      <div className="ai-actions"><button className="primary-button" type="submit" disabled={mode === 'disabled' || !text.trim() || utf8Bytes(text) > AI_LIMITS.requestBytes}>Generate plan</button>
        <button type="button" className="tool-button compact" onClick={cancel}>Cancel</button></div>
    </form>
    <p className="ai-privacy">{mode === 'mock' ? 'Демо: фиксированные ответы, без LLM. ' : ''}Отправляется только текст запроса. Точки разрешаются локально.</p>
    {mode === 'disabled' && <p className="ai-message">AI не подключён. Запустите mock demo или настройте серверный провайдер по README.</p>}
    <div aria-live="polite" aria-atomic="false">
      {ai.status === 'parsing' && <p className="ai-message">Разбираем запрос… Можно отправить новый или отменить.</p>}
      {ai.status === 'error' && <p className="ai-error" role="alert">{ai.message}</p>}
      {ai.status === 'applied' && <p className="ai-message">Изменения применены. Undo отменит их одной операцией.</p>}
      {preview && <div className="ai-preview" data-testid="ai-plan" data-status={ai.status}>
        <strong>AI Plan · {preview.plan.actions.length} actions</strong><p className="ai-request-summary">{preview.plan.text}</p>
        <p>Changes: {preview.plan.mutationCount} · Measurements: {preview.plan.readOnlyCount}</p>
        {preview.notice && <p className="ai-message" role="status">{preview.notice}</p>}
        {resolution?.status === 'invalid' && <p className="ai-error">{resolution.message}</p>}
        {resolution?.status === 'unresolved' && resolution.issues.map(issue => <div key={issue.name} className="ai-issue">
          {issue.kind === 'missing' ? <p className="ai-error">{issue.name} — точка не найдена.</p> : <>
            <p>{issue.name} найдено в {issue.candidates.length} экземплярах</p>
            <label>Выберите точку<select aria-label={`Разрешить ${issue.name}`} value={preview.plan.choices.get(issue.name) ?? ''}
              disabled={ai.status === 'stale' || transactionActive} onChange={event => dispatch({ type: 'ai-choose', name: issue.name, entityId: event.target.value })}>
              <option value="" disabled>Не выбрана</option>{issue.candidates.map(point => <option key={point.entityId} value={point.entityId}>{coordinates(point)} · {point.layer} · {point.entityId}</option>)}
            </select></label>
          </>}
        </div>)}
        {preview.plan.actions.map((action, index) => {
          const result = action.resolution;
          return <div key={action.id} className="ai-action" data-testid="ai-action" data-action-id={action.id}>
            <strong>{index + 1}. Интерпретация: {operationLabels[action.kind]}</strong>
            <p>{action.intent.pointNames.join(' → ')}</p>
            {result.status === 'invalid' && <p className="ai-error">{result.message}</p>}
            {result.status === 'ready' && <>
              <ol className="ai-points">{result.references.map((point, index) => <li key={point.entityId}><b>{result.kind === 'dimension' || result.kind === 'measure' ? `${index === 0 ? 'From' : 'To'}: ` : ''}{point.name}</b><small>{coordinates(point)}</small><small>{point.layer} · {point.entityId}</small></li>)}</ol>
              <dl className="ai-metrics"><AiPlanMetrics result={result} /></dl>
              {result.warnings.map(warning => <p key={warning} className="ai-message">{warning}</p>)}
            </>}
            {action.kind === 'dimension' && <label>Offset (м)<input aria-label="Offset (м)" type="number" step="0.1" min={-MAX_DIMENSION_OFFSET} max={MAX_DIMENSION_OFFSET}
              value={Number.isFinite(action.offsetOverride ?? (result.status === 'ready' && result.kind === 'dimension' ? result.offset : 0))
                ? action.offsetOverride ?? (result.status === 'ready' && result.kind === 'dimension' ? result.offset : 0) : ''}
              disabled={ai.status === 'stale' || transactionActive} onChange={event => dispatch({ type: 'ai-offset', actionId: action.id, offset: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>}
          </div>;
        })}
        {transactionActive && preview.plan.requiresConfirmation && <p className="ai-message">Завершите редактирование координат перед Apply.</p>}
        <div className="ai-actions">{preview.plan.requiresConfirmation ? <button className="primary-button" type="button" disabled={ai.status !== 'preview' || resolution?.status !== 'ready' || transactionActive}
          onClick={() => dispatch({ type: 'ai-apply' })}>{preview.plan.mutationCount === 1 ? 'Apply' : `Apply ${preview.plan.mutationCount} changes`}</button> : <button type="button" className="tool-button compact" onClick={cancel}>Clear</button>}
          {ai.status === 'stale' && <button type="button" className="tool-button compact" disabled={transactionActive} onClick={() => dispatch({ type: 'ai-refresh' })}>Пересчитать план</button>}
        </div>
      </div>}
    </div>
  </section>;
});
