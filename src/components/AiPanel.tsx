import { ProcessPreview } from './ProcessPreview';
import type { ViewSize } from '../geometry';
import { DocumentOperationsPreview } from './DocumentOperationsPreview';
import { lazy, Suspense, memo, useEffect, useMemo, useState, type Dispatch, type FormEvent } from 'react';
import { AiRequestRunner, HttpAiIntentProvider, providerModeSchema, type AiIntentProvider, type ProviderMode } from '../ai/provider';
import { AI_LIMITS, readBoundedJson, utf8Bytes } from '../ai/intent';
import type { AiState, ApplicationAction } from '../ai/workflow';
import type { ResolvedReference } from '../ai/resolver';
import { AiPlanMetrics } from './AiPlanMetrics';
import { formatDistance } from '../geometry/format';
import type { AiDiagnostic } from '../ai/reliability';
import { anchorLabels, formatAssumption } from '../ai/assumptions';
import { spatialFrame } from '../geometry/spatialLayout';
import { MAX_DIMENSION_OFFSET } from '../ai/resolver';

const Diagnostics = import.meta.env.DEV ? lazy(() => import('./AiDiagnostics')) : null;
const operationLabels = { array:'массив прямоугольников', 'edge-line':'линия вдоль стороны', points: 'создать точки', rectangle: 'создать прямоугольник', 'bulk-dimensions': 'размеры всех сторон границы', boundary: 'создать границу', polyline: 'создать полилинию', dimension: 'поставить размер', measure: 'измерить расстояние' };
const defaultProvider = new HttpAiIntentProvider();
const coordinates = (point: ResolvedReference) => `X ${point.position.x} · Y ${point.position.y}${point.position.z === undefined ? '' : ` · Z ${point.position.z}`}`;
interface Props { size:ViewSize; ai: AiState; dispatch: Dispatch<ApplicationAction>; transactionActive: boolean; documentEpoch: number; provider?: AiIntentProvider }
export const AiPanel = memo(function AiPanel({ size, ai, dispatch, transactionActive, documentEpoch, provider = defaultProvider }: Props) {
  const [text, setText] = useState('Создай границу по точкам P1, P2, P3 и P4');
  const [lastDiagnostic, setLastDiagnostic] = useState<AiDiagnostic | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState('');
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
  const run = (requestText: string) => { void runner.run(requestText, event => {
    if (import.meta.env.DEV && event.diagnostics) setLastDiagnostic(event.diagnostics);
    dispatch({ type: 'ai-event', event });
  }); };
  const generate = (event: FormEvent) => { event.preventDefault();
    const requestText = ai.status === 'needs_clarification' ? `${ai.originalText}\nУточнение пользователя: ${clarificationAnswer}` : text;
    setClarificationAnswer('');
    run(requestText); };
  const preview = ai.status === 'preview' || ai.status === 'stale' ? ai : ai.status === 'applied' && ai.results ? { plan: ai.results, notice: null } : null;
  const resolution = preview?.plan.resolution;
  const cancel = () => { runner.cancel(); dispatch({ type: 'ai-cancel' }); };
  return <section className="ai-panel" aria-label="AI Assistant">
    <div className="ai-heading"><h2>AI Assistant</h2><span className="ai-mode">{mode === 'mock' ? 'MOCK · демо' : mode === 'openai' ? 'OpenAI' : mode === 'openrouter' ? 'OpenRouter' : 'Не подключён'}</span></div>
    <p className="ai-caption">Геометрия · операции над документом · технологические схемы</p>
    <form onSubmit={generate}>
      <label htmlFor="ai-request">Запрос</label>
      <textarea id="ai-request" value={text} maxLength={AI_LIMITS.requestBytes} onChange={event => setText(event.target.value)} rows={3} />
      {ai.status === 'needs_clarification' && <div className="ai-clarification" data-testid="ai-clarification"><strong>Нужно уточнение</strong><ul>{ai.questions.map((question, index) => <li key={index}>{question}</li>)}</ul><label>Ответ на уточнение<textarea aria-label="Ответ на уточнение" value={clarificationAnswer} onChange={event => setClarificationAnswer(event.target.value)} rows={2} /></label></div>}
      <div className="ai-actions"><button className="primary-button" type="submit" disabled={mode === 'disabled' || !(ai.status === 'needs_clarification' ? clarificationAnswer.trim() : text.trim()) || utf8Bytes(text) > AI_LIMITS.requestBytes}>Generate plan</button>
        <button type="button" className="tool-button compact" onClick={cancel}>Cancel</button></div>
    </form>
    <p className="ai-privacy">{mode === 'mock' ? 'Демо: фиксированные ответы, без LLM. ' : ''}Отправляется только текст запроса. Точки и объекты разрешаются локально; слои и выделение не отправляются.</p>
    {mode === 'disabled' && <p className="ai-message">AI не подключён. Запустите mock demo или настройте серверный провайдер по README.</p>}
    <div aria-live="polite" aria-atomic="false">
      {ai.status === 'parsing' && <p className="ai-message">Разбираем запрос… Можно отправить новый или отменить.</p>}
      {ai.status === 'error' && <div className="ai-error-state"><p className="ai-error" role="alert">{ai.message}</p>
        {ai.code !== 'UNSUPPORTED' && <button type="button" className="tool-button compact" onClick={() => run(ai.originalText ?? text)}>Повторить запрос</button>}
        {import.meta.env.DEV && <details><summary>Подробнее</summary><p>{ai.id} · {ai.code ?? 'LOCAL_VALIDATION_ERROR'}</p></details>}
      </div>}
      {(ai.status==='document-preview'||ai.status==='document-stale')&&<DocumentOperationsPreview ai={ai} dispatch={dispatch} size={size} transactionActive={transactionActive}/>}
      {(ai.status==='process-preview'||ai.status==='process-stale')&&<ProcessPreview ai={ai} dispatch={dispatch} transactionActive={transactionActive} size={size}/>}
      {ai.status==='process-applied'&&<p role="status">{ai.text}</p>}
      {ai.status==='document-applied'&&<p role="status">{ai.text}</p>}
      {ai.status === 'applied' && <p className="ai-message">Изменения применены. Undo отменит их одной операцией.</p>}
      {preview && <div className="ai-preview" data-testid="ai-plan" data-status={ai.status}>
        <label>Слой новых объектов<select aria-label="Слой новых объектов" value={preview.plan.targetLayerId} disabled={ai.status!=='preview'||transactionActive} onChange={e=>dispatch({type:'ai-target-layer',layerId:e.target.value})}>{!preview.plan.basedOnDocument.layers.some(l=>l.id===preview.plan.targetLayerId&&l.visible&&!l.locked)&&<option value={preview.plan.targetLayerId}>Выберите доступный слой</option>}{preview.plan.basedOnDocument.layers.filter(l=>l.visible&&!l.locked).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <strong>AI Plan · {preview.plan.actions.length} actions</strong><p className="ai-request-summary">{preview.plan.text}</p>
        <p>Направления: {spatialFrame(preview.plan.basedOnDocument).name}</p>
        <p>Changes: {preview.plan.generatedCommandCount} · Measurements: {preview.plan.readOnlyCount}</p>
        {preview.plan.assumptions.length > 0 && <div className="ai-assumptions" data-testid="ai-assumptions"><strong>Предположения</strong><ul>{preview.plan.assumptions.map((assumption, index) => <li key={index}>{formatAssumption(assumption)}</li>)}</ul></div>}
        {preview.notice && <p className="ai-message" role="status">{preview.notice}</p>}
        {resolution?.status === 'invalid' && <p className="ai-error">{resolution.message}</p>}
        {resolution?.status === 'unresolved' && resolution.issues.map(issue => <div key={issue.name} className="ai-issue">
          {issue.kind === 'missing' ? <p className="ai-error">{issue.displayName??issue.name} — {issue.scope==='entity'?'объект':'точка'} не найден{issue.scope==='entity'?'':'а'}.</p> : <>
            <p>{issue.displayName??issue.name} найдено в {issue.candidates.length} экземплярах</p>
            <label>Выберите {issue.scope==='entity'?'объект':'точку'}<select aria-label={`Разрешить ${issue.name}`} value={preview.plan.choices.get(issue.name) ?? ''}
              disabled={ai.status === 'stale' || transactionActive} onChange={event => dispatch({ type: 'ai-choose', name: issue.name, entityId: event.target.value })}>
              <option value="" disabled>Не выбрана</option>{issue.candidates.map(point => <option key={point.entityId} value={point.entityId}>{point.entityType ? `${point.name} · ${point.entityType} · bounds ${point.bounds?.minX},${point.bounds?.minY}–${point.bounds?.maxX},${point.bounds?.maxY}` : coordinates(point)} · {point.layer} · {point.entityId}</option>)}
            </select></label>
          </>}
        </div>)}
        {preview.plan.actions.map((action, index) => {
          const result = action.resolution;
          return <div key={action.id} className="ai-action" data-testid="ai-action" data-action-id={action.id}>
            <strong>{index + 1}. Интерпретация: {operationLabels[action.kind]}</strong>
            <p>{action.kind === 'bulk-dimensions' ? `Граница: результат Action ${action.intent.boundaryActionIndex + 1}` : action.kind === 'points' ? `${action.intent.points.length} точек с явно заданными координатами` : action.kind === 'rectangle' ? `${action.intent.name}: ${action.intent.width} × ${action.intent.height} м · ${action.intent.placement.type === 'centered_in_action_result' ? 'По центру Action ' + (action.intent.placement.polygonActionIndex + 1) : action.intent.placement.type === 'anchored_in_action_result' ? `${anchorLabels[action.intent.placement.anchor]} часть Action ${action.intent.placement.polygonActionIndex + 1}` : action.intent.placement.type}` : action.kind==='array'?`${action.intent.nameBase}: ${action.intent.count} × ${action.intent.width}×${action.intent.height} м`:action.kind==='edge-line'?`${action.intent.name}: ${action.intent.side}, ${action.intent.offsetMeters} м ${action.intent.offsetSide}`:action.intent.pointNames.join(' → ')}</p>
            {(result.status === 'invalid' || result.status === 'blocked') && <p className="ai-error">{result.message}</p>}
            {result.status === 'ready' && <>
              {result.kind==='array'? <ol>{result.rectangles.map((r,i)=><li key={i}>{r.command.type==='add-entity'?r.command.entity.name:''}: {r.width}×{r.height} м</li>)}</ol> : result.kind === 'bulk-dimensions' ? <ol className="ai-points" data-testid="ai-edge-list">{result.dimensions.map((edge, index) =>
                <li key={index}>{edge.references[0]!.name} → {edge.references[1]!.name}: {formatDistance(edge.metrics.horizontal)}</li>)}</ol>
                : <ol className="ai-points">{result.references.map((point, index) => <li key={`${point.entityId}:${point.vertexId}:${index}`}><b>{result.kind === 'dimension' || result.kind === 'measure' ? `${index === 0 ? 'From' : 'To'}: ` : ''}{point.name}</b><small>{coordinates(point)}</small><small>{point.layer} · {point.entityId}</small></li>)}</ol>}
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
          onClick={() => dispatch({ type: 'ai-apply' })}>{preview.plan.generatedCommandCount <= 1 ? 'Apply' : `Apply ${preview.plan.generatedCommandCount} changes`}</button> : <button type="button" className="tool-button compact" onClick={cancel}>Clear</button>}
          {ai.status === 'stale' && <button type="button" className="tool-button compact" disabled={transactionActive} onClick={() => dispatch({ type: 'ai-refresh' })}>Пересчитать план</button>}
        </div>
      </div>}
    </div>
    {Diagnostics && <Suspense fallback={null}><Diagnostics record={lastDiagnostic} ai={ai} /></Suspense>}
  </section>;
});
