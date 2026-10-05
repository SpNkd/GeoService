import { documentSurveyXY } from './geometry/georeferencing';
import type { HorizontalReference } from './domain/model';
import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { bounds, fitToBounds, gridStep, screenToWorld, type ScreenPoint, type ViewSize } from './geometry';
import { formatCoordinate, formatMeasure } from './geometry/format';
import { visibleBounds } from './renderer/selectors';
import { Canvas } from './editor/Canvas';
import { initialEditorState, isDocumentDirty } from './store/editor';
import { createSampleDocument } from './sample/document';
import { LayersPanel } from './components/LayersPanel';
import { PropertyInspector } from './components/PropertyInspector';
import { Icon } from './components/Icon';
import { ImportDialog } from './components/ImportDialog';
import { createNewDocument } from './domain/newDocument';
import { persistLocalDocument, restoreLocalDocument } from './persistence/local';
import { deserializeDocument, MAX_DOCUMENT_BYTES, serializeDocument } from './persistence/serialization';
import { applyCommand } from './domain/commands';
import type { SnapResult } from './snapping';
import { applicationReducer, type ApplicationState } from './ai/workflow';
import { taskPreviews } from './ai/task';
import { AiPanel } from './components/AiPanel';
import type { PointLabelMode } from './store/editor';
import { resolveShortcut, shortcutNeedsWait, shortcutRegistry, shortcutMatchesPrefix } from './editor/shortcuts';

const GeoreferenceDialog = lazy(() => import('./components/GeoreferenceDialog').then(module => ({ default: module.GeoreferenceDialog })));

export default function App() {
  const [startup] = useState(() => {
    try { return restoreLocalDocument(localStorage, createSampleDocument); }
    catch { return { document: createSampleDocument(), notice: 'Локальное сохранение недоступно. Используйте JSON Save.', dirty: false }; }
  });
  const [application, dispatch] = useReducer(applicationReducer, startup.document, (document): ApplicationState => ({
    editor: { ...initialEditorState(document), ...(startup.dirty ? { savedFingerprint: '' } : {}) }, ai: { status: 'idle' } }));
  const state = application.editor;
  useEffect(() => { try { const step = Number(localStorage.getItem('geoservice.snap-step')); if (Number.isFinite(step) && step > 0) dispatch({ type: 'snap-options', patch: { gridStep: step } }); } catch { /* local preferences are optional */ } }, []);
  useEffect(() => { try { localStorage.setItem('geoservice.snap-step', String(state.snapOptions.gridStep ?? 1)); } catch { /* optional */ } }, [state.snapOptions.gridStep]);
  const aiTask = application.ai.status === 'preview' ? application.ai.plan : application.ai.status === 'applied' ? application.ai.results : null;
  const aiPreview = aiTask?.resolution.status === 'ready' && !state.transactionBefore
    ? taskPreviews(aiTask) : [];
  const [notice, setNotice] = useState(startup.notice);
  const [fileError, setFileError] = useState<string | null>(null);
  const [georeferenceOpen, setGeoreferenceOpen] = useState(false);
  const [pickingControl, setPickingControl] = useState<0 | 1 | null>(null);
  const [pickedControl, setPickedControl] = useState<{ slot: 0 | 1; id: string } | null>(null);
  const [referencePreview, setReferencePreview] = useState<HorizontalReference | null>(null);
  const closeGeoreference = useCallback(() => { setGeoreferenceOpen(false); setPickingControl(null); setPickedControl(null); setReferencePreview(null); }, []);
  const [importOpen, setImportOpen] = useState(false);
  const [snapStatus, setSnapStatus] = useState<SnapResult | null>(null);
  const [measurementStatus, setMeasurementStatus] = useState<string | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [sequenceHint, setSequenceHint] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const keyBuffer = useRef<string[]>([]), sequenceTimer = useRef<number | null>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const committed = state.transactionBefore ?? state.document;
  const committedDirty = useMemo(() => isDocumentDirty({ document: committed, savedFingerprint: state.savedFingerprint }), [committed, state.savedFingerprint]);
  const dirty = committedDirty || Boolean(state.transactionBefore && state.document !== committed);
  useEffect(() => {
    try { const error = persistLocalDocument(localStorage, committed, committedDirty); if (error) setNotice(error); }
    catch { setNotice('Локальное сохранение недоступно. Сохраните JSON вручную.'); }
  }, [committed, committedDirty]); // A drag keeps transactionBefore stable; only its final commit is persisted.
  const [size, setSize] = useState<ViewSize>({ width: 1, height: 1 });
  const [cursor, setCursor] = useState<ScreenPoint | null>(null);
  const cursorWorld = cursor ? screenToWorld(cursor, state.viewport, size) : null;
  const cursorSurvey = cursorWorld && state.coordinateDisplay === 'survey' ? documentSurveyXY(state.document, cursorWorld) : null;
  const fitted = useRef(false);
  const onResize = useCallback((next: ViewSize) => {
    setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    if (!fitted.current && next.width > 0 && next.height > 0) {
      const viewport = fitToBounds(visibleBounds(committed), next, 85);
      if (viewport) { dispatch({ type: 'viewport', viewport }); fitted.current = true; }
    }
  }, [committed]);
  const fit = useCallback(() => {
    const viewport = fitToBounds(visibleBounds(state.document), size, 85);
    if (viewport) dispatch({ type: 'viewport', viewport });
  }, [dispatch, size, state.document]);
  const save = useCallback(() => {
    try {
      const text = serializeDocument(state.document);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `${state.document.metadata.title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'geoservice-document'}.json`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      dispatch({ type: 'mark-saved' }); setFileError(null); setNotice('JSON сохранён.');
    } catch (error) { setFileError(error instanceof Error ? error.message : 'Не удалось сохранить JSON'); }
  }, [dispatch, state.document]);
  const startNew = useCallback(() => {
    if (dirty && !window.confirm('Создать новую схему? Изменения текущего документа не сохранены в JSON.')) return;
    dispatch({ type: 'replace-document', document: createNewDocument(), size }); setFileError(null); setNotice('Создана пустая схема.');
  }, [dirty, dispatch, size]);
  const runShortcut = useCallback((id: string) => {
    switch (id) {
      case 'select': case 'line': case 'point': case 'polyline': case 'polygon': case 'text': case 'dimension': case 'measure':
        dispatch({ type: 'tool', tool: id }); break;
      case 'move': dispatch({ type: 'open-move-input' }); break;
      case 'ortho': dispatch({ type: 'toggle-ortho' }); break;
      case 'fit': case 'fit-extents': fit(); break;
      case 'save': save(); break;
      case 'open': openInput.current?.click(); break;
      case 'new': startNew(); break;
      case 'undo': dispatch({ type: 'undo' }); break;
      case 'redo': case 'redo-y': dispatch({ type: 'redo' }); break;
      case 'delete': {
        const ids = state.selectedEntityIds.length ? state.selectedEntityIds : state.selectionId ? [state.selectionId] : [];
        const selected = new Set(ids);
        const deletions = state.document.entities.filter(entity => selected.has(entity.id) && !(entity.type === 'label' && selected.has(entity.targetId))).map(entity => ({ type: 'delete-entity' as const, entityId: entity.id }));
        if (deletions.length) { dispatch({ type: 'execute-batch', commands: deletions }); dispatch({ type: 'select', entityId: null }); }
        break;
      }
      case 'cancel': window.dispatchEvent(new Event('geoservice:escape')); dispatch({ type: 'tool', tool: 'select' });
        if (state.dimensionPick) dispatch({ type: 'cancel-dimension-pick' });
        else if (!state.dimensionRetarget && !state.selectionMove) dispatch({ type: 'select', entityId: null });
        dispatch({ type: 'close-move-input' }); break;
      case 'help': setShortcutsOpen(true); break;
    }
  }, [dispatch, fit, save, startNew, state]);
  useEffect(() => {
    const clearSequence = () => { keyBuffer.current = []; setSequenceHint(''); if (sequenceTimer.current !== null) window.clearTimeout(sequenceTimer.current); sequenceTimer.current = null; };
    const executeBuffer = () => { const match = resolveShortcut(keyBuffer.current); clearSequence(); if (match) runShortcut(match.id); };
    const suppressed = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [data-shortcut-suppressed]'));
    const keydown = (event: KeyboardEvent) => {
      if (state.dimensionPick) {
        if (event.key === 'Escape') { event.preventDefault(); dispatch({ type: 'cancel-dimension-pick' }); return; }
        if (event.metaKey || event.ctrlKey) { if (['s', 'o', 'n', 'z', 'y'].includes(event.key.toLowerCase())) event.preventDefault(); return; }
        if (!suppressed(event.target)) event.preventDefault();
        return;
      }
      if (georeferenceOpen) {
        if (event.key === 'Escape') { event.preventDefault(); if (pickingControl !== null) setPickingControl(null); else closeGeoreference(); }
        if (event.metaKey || event.ctrlKey) { if (['s', 'o', 'n', 'z', 'y'].includes(event.key.toLowerCase())) event.preventDefault(); }
        return;
      }
      if (event.code === 'Space' && !suppressed(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); setSpaceHeld(true); return; }
      if (event.metaKey || event.ctrlKey) {
        clearSequence(); const key = event.key.toLowerCase();
        if (key === 's' || key === 'o' || key === 'n' || key === 'z' || key === 'y') {
          event.preventDefault(); runShortcut(key === 's' ? 'save' : key === 'o' ? 'open' : key === 'n' ? 'new' : key === 'y' ? 'redo-y' : event.shiftKey ? 'redo' : 'undo');
        }
        return;
      }
      if (suppressed(event.target)) { clearSequence(); return; }
      if (event.altKey || event.repeat) return;
      if (event.key === 'F8') { event.preventDefault(); clearSequence(); runShortcut('ortho'); return; }
      if (event.key === 'Escape') { clearSequence(); if (shortcutsOpen) setShortcutsOpen(false); else runShortcut('cancel'); event.preventDefault(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { clearSequence(); event.preventDefault(); runShortcut('delete'); return; }
      const key = event.key === '?' ? '?' : /^[a-z]$/i.test(event.key) && !event.shiftKey ? event.key.toUpperCase() : null;
      if (!key) return;
      const candidate = [...keyBuffer.current, key];
      if (!shortcutMatchesPrefix(candidate)) {
        const fallback = resolveShortcut(keyBuffer.current); clearSequence(); if (fallback) runShortcut(fallback.id);
        const fresh = [key]; if (shortcutMatchesPrefix(fresh)) { keyBuffer.current = fresh; setSequenceHint(key); sequenceTimer.current = window.setTimeout(executeBuffer, 900); }
        return;
      }
      keyBuffer.current = candidate; setSequenceHint(candidate.join(''));
      if (sequenceTimer.current !== null) window.clearTimeout(sequenceTimer.current);
      if (shortcutNeedsWait(candidate)) sequenceTimer.current = window.setTimeout(executeBuffer, 900); else executeBuffer();
    };
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') setSpaceHeld(false); };
    const blur = () => { setSpaceHeld(false); clearSequence(); };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); clearSequence(); };
  }, [state, shortcutsOpen, dirty, size, runShortcut, georeferenceOpen, pickingControl, closeGeoreference]);
  const fittedAiTask = useRef<string | null>(null);
  useEffect(() => {
    if (aiTask?.resolution.status !== 'ready' || aiTask.id === fittedAiTask.current || !aiTask.requiresConfirmation || size.width <= 1) return;
    const viewport = fitToBounds(bounds(taskPreviews(aiTask).flatMap(preview => preview.result.geometry)), size, 100);
    if (viewport) { dispatch({ type: 'viewport', viewport }); fittedAiTask.current = aiTask.id; }
  }, [aiTask, size]);
  const zoom = (factor: number) => dispatch({ type: 'zoom', size, anchor: { x: size.width / 2, y: size.height / 2 }, factor });
  const step = gridStep(state.viewport.pixelsPerUnit);
  const selected = state.document.entities.find(entity => entity.id === state.selectionId);
  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="/" aria-label="GeoService — начало"><span className="brand-mark"><Icon name="crosshair" size={24} /></span>Geo<span>Service</span></a>
      <div className="header-divider" /><div className="document-title"><strong>{state.document.metadata.title}{dirty && <span className="dirty-mark" aria-label="Есть несохранённые изменения"> *</span>}</strong><span>MODEL X / Y / Z · Survey E / N · абсолютная H</span></div>
      <span className="header-version">Редактор · 0.3</span>
    </header>
    <nav inert={georeferenceOpen} className="toolbar" aria-label="Инструменты редактора">
      <div className="tool-group document-tools">
        <button className="tool-button compact" aria-label="Новый документ" title="Новый документ · Ctrl/Cmd+N" onClick={startNew}>New</button>
        <button className="tool-button compact" aria-label="Открыть JSON" title="Открыть JSON · Ctrl/Cmd+O" onClick={() => openInput.current?.click()}>Open</button>
        <button className="tool-button compact" aria-label="Сохранить JSON" title="Сохранить JSON · Ctrl/Cmd+S" onClick={save}>Save</button>
        <button className="tool-button compact import-button" aria-label="Импорт координат" onClick={() => { dispatch({ type: 'tool', tool: 'select' }); setImportOpen(true); }}>Import</button>
      </div><div className="toolbar-divider" />
      <div className="tool-group">
        {([['select', 'cursor', 'Выбор'], ['point', 'point', 'Точка'], ['line', 'line', 'Линия'], ['polyline', 'line', 'Полилиния'], ['polygon', 'polygon', 'Полигон'], ['text', 'text', 'Текст'], ['dimension', 'dimension', 'Размер'], ['measure', 'measure', 'Измерение'], ['pan', 'hand', 'Панорама']] as const).map(([tool, icon, label]) => {
          const shortcutId = tool;
          const shortcut = shortcutRegistry.find(entry => entry.id === shortcutId)?.label;
          return <button key={tool} className={`tool-button compact ${state.tool === tool ? 'active' : ''}`} aria-label={`Инструмент: ${label}`} aria-pressed={state.tool === tool} title={`${label}${shortcut ? ` · ${shortcut}` : ''}`} onClick={() => dispatch({ type: 'tool', tool })}><Icon name={icon} size={16} />{label}</button>;
        })}
      </div><div className="toolbar-divider" />
      <button className="tool-button compact" aria-label="Переместить выбор" title="Переместить выбор · M" disabled={!state.selectedEntityIds.length || Boolean(state.transactionBefore)} onClick={() => dispatch({ type: 'open-move-input' })}>Move…</button>
      <button className="tool-button compact" aria-label="Отменить" title="Отменить · ⌘/Ctrl+Z" disabled={!state.past.length || Boolean(state.transactionBefore)} onClick={() => dispatch({ type: 'undo' })}><Icon name="undo" size={16} />Undo</button>
      <button className="tool-button compact" aria-label="Повторить" title="Повторить · ⌘/Ctrl+Shift+Z" disabled={!state.future.length || Boolean(state.transactionBefore)} onClick={() => dispatch({ type: 'redo' })}><Icon name="redo" size={16} />Redo</button>
      <div className="toolbar-divider" /><button className="tool-button compact" title="Вписать · F / ZE" onClick={fit}><Icon name="fit" size={16} />Вписать</button>
      <button className="icon-button" aria-label="Горячие клавиши" title="Горячие клавиши · ?" onClick={() => setShortcutsOpen(true)}>?</button>
      <button className={`icon-button ${state.gridVisible ? 'grid-active' : ''}`} aria-label="Сетка" aria-pressed={state.gridVisible} onClick={() => dispatch({ type: 'toggle-grid' })}><Icon name="grid" size={16} /></button>
      <span className="toolbar-context">Слой: {state.document.layers.find(layer => layer.id === state.currentLayerId)?.name ?? '—'} · {state.document.coordinateSystem.name ?? 'Система координат'} · м</span>
    </nav>
    <div inert={georeferenceOpen} className="survey-controls" aria-label="Привязки и подписи">
      <button className={`tool-button compact ${state.snapOptions.enabled ? 'active' : ''}`} aria-label="Привязки" aria-pressed={state.snapOptions.enabled} onClick={() => dispatch({ type: 'snap-options', patch: { enabled: !state.snapOptions.enabled } })}>SNAP {state.snapOptions.enabled ? 'ON' : 'OFF'}</button>
      <details className="survey-settings"><summary>Типы привязок</summary><div>
        {(['vertex', 'midpoint', 'grid'] as const).map(type => <label key={type}><input type="checkbox" checked={state.snapOptions[type]} onChange={event => dispatch({ type: 'snap-options', patch: { [type]: event.target.checked } })} />{type === 'vertex' ? 'Vertex' : type === 'midpoint' ? 'Midpoint' : 'Grid'}</label>)}
        <small>Допуск 10 px · скрытые слои исключены</small>
      </div></details>
      <label>Сетка <input className="snap-step-input" aria-label="Шаг привязки сетки" type="number" min="0.000001" step="any" list="snap-steps" value={state.snapOptions.gridStep ?? 1} onChange={event => { const gridStep = Number(event.target.value); if (gridStep > 0 && Number.isFinite(gridStep)) dispatch({ type: 'snap-options', patch: { gridStep } }); }} /> м</label><datalist id="snap-steps">{[0.1, 0.25, 0.5, 1, 2, 5, 10, 20].map(step => <option key={step} value={step} />)}</datalist>
      <button className={`tool-button compact ${state.ortho ? 'active' : ''}`} aria-label="Ортогональный режим" aria-pressed={state.ortho} title="ORTHO · F8" onClick={() => dispatch({ type: 'toggle-ortho' })}>ORTHO {state.ortho ? 'ON' : 'OFF'}</button>
      <label>Координаты <select aria-label="Отображение координат" value={state.coordinateDisplay} onChange={event => dispatch({ type: 'coordinate-display', mode: event.target.value as 'model' | 'survey' })}><option value="model">Model · X/Y</option><option value="survey">Survey · E/N</option></select></label>
      <label>Подписи точек <select aria-label="Подписи точек" value={state.pointLabelMode} onChange={event => dispatch({ type: 'point-labels', mode: event.target.value as PointLabelMode })}><option value="name">Имя</option><option value="name-z">Имя + Z</option><option value="z">Только Z</option></select></label>
      <label><input type="checkbox" checked={state.showLineLengths} onChange={() => dispatch({ type: 'toggle-line-lengths' })} />Длины линий</label>
      <span>Shift + клик: добавить в выбор</span>
    </div>
    <main className="workspace"><LayersPanel inert={georeferenceOpen} state={state} dispatch={dispatch} onCalibrate={() => { dispatch({ type: 'tool', tool: 'select' }); setGeoreferenceOpen(true); }} /><div className="drawing-area">
      <Canvas key={state.documentEpoch} state={state} dispatch={dispatch} size={size} onResize={onResize} onCursor={setCursor} onSnap={setSnapStatus} onMeasure={setMeasurementStatus} disabled={importOpen || (georeferenceOpen && pickingControl === null)} referencePreview={referencePreview ?? undefined} onPickPoint={pickingControl === null ? undefined : id => { setPickedControl({ slot: pickingControl, id }); setPickingControl(null); }} spaceHeld={spaceHeld} sequenceHint={sequenceHint} aiPreview={aiPreview} />
      <div className="zoom-controls"><button className="icon-button" aria-label="Увеличить" onClick={() => zoom(1.25)}><Icon name="plus" /></button><button className="icon-button" aria-label="Уменьшить" onClick={() => zoom(0.8)}><Icon name="minus" /></button><button className="icon-button" aria-label="Вписать схему в вид" onClick={fit}><Icon name="fit" /></button></div>
      <div className="scale-bar" aria-label={`Масштабная линейка ${step} метров`}><span>{formatMeasure(step, step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0)} м</span><div style={{ width: step * state.viewport.pixelsPerUnit }} /></div>
    </div><div inert={georeferenceOpen} className="right-column"><PropertyInspector state={state} dispatch={dispatch} /><AiPanel ai={application.ai} dispatch={dispatch} transactionActive={Boolean(state.transactionBefore)} documentEpoch={state.documentEpoch} /></div></main>
    <footer className="status-bar"><span className={`status-ready ${state.error ? 'status-error' : ''}`} data-testid="editor-error"><span className={state.error ? 'error-dot' : 'live-dot'} />{state.error ?? (state.dimensionPick ? `Выберите существующую вершину для ${state.dimensionPick.endpoint === 'start' ? 'начала' : 'конца'} размера · Esc отмена` : null) ?? (sequenceHint ? `${sequenceHint}…` : measurementStatus ?? (snapStatus ? `SNAP: ${snapStatus.metadata.label}` : null)) ?? (state.selectionMove ? `Перемещение: ΔX ${formatMeasure(state.selectionMove.delta.x)} · ΔY ${formatMeasure(state.selectionMove.delta.y)} м${state.selectionMove.resolved.affectedEntityIds.length ? ` · затронет ${state.selectionMove.resolved.affectedEntityIds.length} связанных объектов` : ''}` : state.selectedEntityIds.length > 1 ? `Выбрано: ${state.selectedEntityIds.length} объектов` : selected ? `Выбрано: ${selected.name}` : 'Готов к работе')}</span>
      <div className="status-coordinates"><Icon name="crosshair" size={14} /><span>{state.coordinateDisplay === 'model' ? 'X' : 'E'} <b data-testid="cursor-x">{state.coordinateDisplay === 'model' ? cursorWorld ? formatCoordinate(cursorWorld.x) : '—' : cursorSurvey ? formatCoordinate(cursorSurvey.e) : '—'}</b></span><span>{state.coordinateDisplay === 'model' ? 'Y' : 'N'} <b data-testid="cursor-y">{state.coordinateDisplay === 'model' ? cursorWorld ? formatCoordinate(cursorWorld.y) : '—' : cursorSurvey ? formatCoordinate(cursorSurvey.n) : '—'}</b></span><span>м</span></div>
      <span className="status-grid">Привязка: {state.snapOptions.gridStep ?? 1} м · ORTHO {state.ortho ? 'ON' : 'OFF'}</span><span className="status-zoom" data-testid="zoom-label">{formatMeasure(state.viewport.pixelsPerUnit)} px/м</span>
    </footer>
    <input ref={openInput} type="file" accept=".json,application/json" aria-label="Файл GeoDocument" hidden onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      try {
        if (file.size > MAX_DOCUMENT_BYTES) throw new Error('JSON превышает лимит 10 МБ');
        const loaded = deserializeDocument(await file.text());
        if (dirty && !window.confirm('Открыть другой документ? Текущие изменения не сохранены в JSON.')) return;
        dispatch({ type: 'replace-document', document: loaded, size }); setFileError(null); setNotice('Документ открыт.');
      } catch (error) { setFileError(error instanceof Error ? error.message : 'Не удалось прочитать JSON'); }
    }} />
    {(fileError || notice) && <div className={`document-notice ${fileError ? 'error' : ''}`} role={fileError ? 'alert' : 'status'}><span>{fileError ?? notice}</span><button aria-label="Закрыть сообщение" onClick={() => { setFileError(null); setNotice(null); }}>×</button></div>}
    {shortcutsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShortcutsOpen(false); }}><section className="shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title"><h2 id="shortcuts-title">Keyboard shortcuts</h2>{(['Tools', 'Navigation', 'File', 'Edit'] as const).map(group => <div key={group}><h3>{group}</h3><dl>{shortcutRegistry.filter(entry => entry.group === group).map(entry => <Fragment key={entry.id}><dt>{entry.description}</dt><dd>{entry.label}</dd></Fragment>)}</dl></div>)}<button onClick={() => setShortcutsOpen(false)}>Закрыть · Esc</button></section></div>}
    {georeferenceOpen && <Suspense fallback={<div className="modal-backdrop"><p>Открываю привязку…</p></div>}><GeoreferenceDialog document={state.document} picking={pickingControl} picked={pickedControl} onPick={setPickingControl} onPreview={setReferencePreview} onClose={closeGeoreference} onApply={command => { dispatch({ type: 'execute', command }); closeGeoreference(); }} /></Suspense>}
    {importOpen && <ImportDialog document={state.document} onClose={() => setImportOpen(false)} onImport={command => {
      // Preflight keeps validation errors in the open import dialog; the reducer owns the actual mutation.
      const candidate = applyCommand(state.document, command);
      dispatch({ type: 'execute', command });
      const viewport = fitToBounds(visibleBounds(candidate), size, 85);
      if (viewport) dispatch({ type: 'viewport', viewport });
      setImportOpen(false); setFileError(null); setNotice('Координаты импортированы. Undo отменит весь импорт.');
    }} />}
  </div>;
}
