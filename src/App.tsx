import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { fitToBounds, gridStep, screenToWorld, type ScreenPoint, type ViewSize } from './geometry';
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

export default function App() {
  const [startup] = useState(() => {
    try { return restoreLocalDocument(localStorage, createSampleDocument); }
    catch { return { document: createSampleDocument(), notice: 'Локальное сохранение недоступно. Используйте JSON Save.', dirty: false }; }
  });
  const [application, dispatch] = useReducer(applicationReducer, startup.document, (document): ApplicationState => ({
    editor: { ...initialEditorState(document), ...(startup.dirty ? { savedFingerprint: '' } : {}) }, ai: { status: 'idle' } }));
  const state = application.editor;
  const aiTask = application.ai.status === 'preview' ? application.ai.plan : application.ai.status === 'applied' ? application.ai.results : null;
  const aiPreview = aiTask?.resolution.status === 'ready' && !state.transactionBefore
    ? taskPreviews(aiTask) : [];
  const [notice, setNotice] = useState(startup.notice);
  const [fileError, setFileError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [snapStatus, setSnapStatus] = useState<SnapResult | null>(null);
  const [measurementStatus, setMeasurementStatus] = useState<string | null>(null);
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
  const fitted = useRef(false);
  const onResize = useCallback((next: ViewSize) => {
    setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    if (!fitted.current && next.width > 0 && next.height > 0) {
      const viewport = fitToBounds(visibleBounds(committed), next, 85);
      if (viewport) { dispatch({ type: 'viewport', viewport }); fitted.current = true; }
    }
  }, [committed]);
  const fit = () => {
    const viewport = fitToBounds(visibleBounds(state.document), size, 85);
    if (viewport) dispatch({ type: 'viewport', viewport });
  };
  const save = () => {
    try {
      const text = serializeDocument(state.document);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `${state.document.metadata.title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'geoservice-document'}.json`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      dispatch({ type: 'mark-saved' }); setFileError(null); setNotice('JSON сохранён.');
    } catch (error) { setFileError(error instanceof Error ? error.message : 'Не удалось сохранить JSON'); }
  };
  const zoom = (factor: number) => dispatch({ type: 'zoom', size, anchor: { x: size.width / 2, y: size.height / 2 }, factor });
  const step = gridStep(state.viewport.pixelsPerUnit);
  const selected = state.document.entities.find(entity => entity.id === state.selectionId);
  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="/" aria-label="GeoService — начало"><span className="brand-mark"><Icon name="crosshair" size={24} /></span>Geo<span>Service</span></a>
      <div className="header-divider" /><div className="document-title"><strong>{state.document.metadata.title}{dirty && <span className="dirty-mark" aria-label="Есть несохранённые изменения"> *</span>}</strong><span>Геодезическая схема · X Easting / Y Northing / Z Height</span></div>
      <span className="header-version">Редактор · 0.3</span>
    </header>
    <nav className="toolbar" aria-label="Инструменты редактора">
      <div className="tool-group document-tools">
        <button className="tool-button compact" aria-label="Новый документ" onClick={() => {
          if (dirty && !window.confirm('Создать новую схему? Изменения текущего документа не сохранены в JSON.')) return;
          dispatch({ type: 'replace-document', document: createNewDocument(), size }); setFileError(null); setNotice('Создана пустая схема.');
        }}>New</button>
        <button className="tool-button compact" aria-label="Открыть JSON" onClick={() => openInput.current?.click()}>Open</button>
        <button className="tool-button compact" aria-label="Сохранить JSON" onClick={save}>Save</button>
        <button className="tool-button compact import-button" aria-label="Импорт координат" onClick={() => { dispatch({ type: 'tool', tool: 'select' }); setImportOpen(true); }}>Import</button>
      </div><div className="toolbar-divider" />
      <div className="tool-group">
        {([['select', 'cursor', 'Выбор'], ['point', 'point', 'Точка'], ['line', 'line', 'Линия'], ['polyline', 'line', 'Полилиния'], ['polygon', 'polygon', 'Полигон'], ['text', 'text', 'Текст'], ['dimension', 'dimension', 'Размер'], ['measure', 'measure', 'Измерение'], ['pan', 'hand', 'Панорама']] as const).map(([tool, icon, label]) =>
          <button key={tool} className={`tool-button compact ${state.tool === tool ? 'active' : ''}`} aria-label={`Инструмент: ${label}`} aria-pressed={state.tool === tool} title={`${label} · ${tool === 'point' ? 'один клик' : tool === 'line' ? 'два клика' : tool === 'polyline' || tool === 'polygon' ? 'Enter завершает' : 'Выбрать объект'}`} onClick={() => dispatch({ type: 'tool', tool })}><Icon name={icon} size={16} />{label}</button>)
        }
      </div><div className="toolbar-divider" />
      <button className="tool-button compact" aria-label="Отменить" title="Отменить · ⌘/Ctrl+Z" disabled={!state.past.length || Boolean(state.transactionBefore)} onClick={() => dispatch({ type: 'undo' })}><Icon name="undo" size={16} />Undo</button>
      <button className="tool-button compact" aria-label="Повторить" title="Повторить · ⌘/Ctrl+Shift+Z" disabled={!state.future.length || Boolean(state.transactionBefore)} onClick={() => dispatch({ type: 'redo' })}><Icon name="redo" size={16} />Redo</button>
      <div className="toolbar-divider" /><button className="tool-button compact" onClick={fit}><Icon name="fit" size={16} />Вписать</button>
      <button className={`icon-button ${state.gridVisible ? 'grid-active' : ''}`} aria-label="Сетка" aria-pressed={state.gridVisible} onClick={() => dispatch({ type: 'toggle-grid' })}><Icon name="grid" size={16} /></button>
      <span className="toolbar-context">{state.document.coordinateSystem.name ?? 'Система координат'} · м</span>
    </nav>
    <div className="survey-controls" aria-label="Привязки и подписи">
      <button className={`tool-button compact ${state.snapOptions.enabled ? 'active' : ''}`} aria-label="Привязки" aria-pressed={state.snapOptions.enabled} onClick={() => dispatch({ type: 'snap-options', patch: { enabled: !state.snapOptions.enabled } })}>SNAP {state.snapOptions.enabled ? 'ON' : 'OFF'}</button>
      <details className="survey-settings"><summary>Типы привязок</summary><div>
        {(['vertex', 'midpoint', 'grid'] as const).map(type => <label key={type}><input type="checkbox" checked={state.snapOptions[type]} onChange={event => dispatch({ type: 'snap-options', patch: { [type]: event.target.checked } })} />{type === 'vertex' ? 'Vertex' : type === 'midpoint' ? 'Midpoint' : 'Grid'}</label>)}
        <small>Допуск 10 px · скрытые слои исключены</small>
      </div></details>
      <label>Подписи точек <select aria-label="Подписи точек" value={state.pointLabelMode} onChange={event => dispatch({ type: 'point-labels', mode: event.target.value as PointLabelMode })}><option value="name">Имя</option><option value="name-z">Имя + Z</option><option value="z">Только Z</option></select></label>
      <label><input type="checkbox" checked={state.showLineLengths} onChange={() => dispatch({ type: 'toggle-line-lengths' })} />Длины линий</label>
      <span>Shift + клик: выбрать точки по порядку</span>
    </div>
    <main className="workspace"><LayersPanel state={state} dispatch={dispatch} /><div className="drawing-area">
      <Canvas key={state.documentEpoch} state={state} dispatch={dispatch} size={size} onResize={onResize} onCursor={setCursor} onSnap={setSnapStatus} onMeasure={setMeasurementStatus} disabled={importOpen} aiPreview={aiPreview} />
      <div className="zoom-controls"><button className="icon-button" aria-label="Увеличить" onClick={() => zoom(1.25)}><Icon name="plus" /></button><button className="icon-button" aria-label="Уменьшить" onClick={() => zoom(0.8)}><Icon name="minus" /></button><button className="icon-button" aria-label="Вписать схему в вид" onClick={fit}><Icon name="fit" /></button></div>
      <div className="scale-bar" aria-label={`Масштабная линейка ${step} метров`}><span>{formatMeasure(step, step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0)} м</span><div style={{ width: step * state.viewport.pixelsPerUnit }} /></div>
    </div><div className="right-column"><PropertyInspector state={state} dispatch={dispatch} /><AiPanel ai={application.ai} dispatch={dispatch} transactionActive={Boolean(state.transactionBefore)} documentEpoch={state.documentEpoch} /></div></main>
    <footer className="status-bar"><span className={`status-ready ${state.error ? 'status-error' : ''}`} data-testid="editor-error"><span className={state.error ? 'error-dot' : 'live-dot'} />{state.error ?? (measurementStatus ?? (snapStatus ? `SNAP: ${snapStatus.metadata.label}` : null)) ?? (selected ? `Выбрано: ${selected.name}` : 'Готов к работе')}</span>
      <div className="status-coordinates"><Icon name="crosshair" size={14} /><span>X <b data-testid="cursor-x">{cursorWorld ? formatCoordinate(cursorWorld.x) : '—'}</b></span><span>Y <b data-testid="cursor-y">{cursorWorld ? formatCoordinate(cursorWorld.y) : '—'}</b></span><span>м</span></div>
      <span className="status-grid">Шаг сетки: {formatMeasure(step, step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0)} м</span><span className="status-zoom" data-testid="zoom-label">{formatMeasure(state.viewport.pixelsPerUnit)} px/м</span>
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
