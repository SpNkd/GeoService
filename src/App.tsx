import { useCallback, useReducer, useRef, useState } from 'react';
import { fitToBounds, gridStep, screenToWorld, type ScreenPoint, type ViewSize } from './geometry';
import { formatCoordinate, formatMeasure } from './geometry/format';
import { visibleBounds } from './renderer/selectors';
import { Canvas } from './editor/Canvas';
import { editorReducer, initialEditorState } from './store/editor';
import { createSampleDocument } from './sample/document';
import { LayersPanel } from './components/LayersPanel';
import { PropertyInspector } from './components/PropertyInspector';
import { Icon } from './components/Icon';

export default function App() {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => initialEditorState(createSampleDocument()));
  const [size, setSize] = useState<ViewSize>({ width: 1, height: 1 });
  const [cursor, setCursor] = useState<ScreenPoint | null>(null);
  const cursorWorld = cursor ? screenToWorld(cursor, state.viewport, size) : null;
  const fitted = useRef(false);
  const onResize = useCallback((next: ViewSize) => {
    setSize(next);
    if (!fitted.current && next.width > 0 && next.height > 0) {
      const viewport = fitToBounds(visibleBounds(state.document), next, 85);
      if (viewport) { dispatch({ type: 'viewport', viewport }); fitted.current = true; }
    }
  }, [state.document]);
  const fit = () => {
    const viewport = fitToBounds(visibleBounds(state.document), size, 85);
    if (viewport) dispatch({ type: 'viewport', viewport });
  };
  const zoom = (factor: number) => dispatch({ type: 'zoom', size, anchor: { x: size.width / 2, y: size.height / 2 }, factor });
  const step = gridStep(state.viewport.pixelsPerUnit);
  const selected = state.document.entities.find(entity => entity.id === state.selectionId);
  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="/" aria-label="GeoService — начало"><span className="brand-mark"><Icon name="crosshair" size={24} /></span>Geo<span>Service</span></a>
      <div className="header-divider" /><div className="document-title"><strong>{state.document.metadata.title}</strong><span>Геодезическая схема</span></div>
      <span className="demo-label">ДЕМОДОКУМЕНТ</span><span className="header-version">Редактор · 0.1</span>
    </header>
    <nav className="toolbar" aria-label="Инструменты редактора">
      <div className="tool-group">
        {([['select', 'cursor', 'Выбор'], ['point', 'point', 'Точка'], ['line', 'line', 'Линия'], ['polyline', 'line', 'Полилиния'], ['polygon', 'polygon', 'Полигон'], ['text', 'text', 'Текст'], ['pan', 'hand', 'Панорама']] as const).map(([tool, icon, label]) =>
          <button key={tool} className={`tool-button compact ${state.tool === tool ? 'active' : ''}`} aria-label={`Инструмент: ${label}`} aria-pressed={state.tool === tool} title={`${label} · ${tool === 'point' ? 'один клик' : tool === 'line' ? 'два клика' : tool === 'polyline' || tool === 'polygon' ? 'Enter завершает' : 'Выбрать объект'}`} onClick={() => dispatch({ type: 'tool', tool })}><Icon name={icon} size={16} />{label}</button>)
        }
      </div><div className="toolbar-divider" />
      <button className="tool-button compact" aria-label="Отменить" title="Отменить · ⌘/Ctrl+Z" disabled={!state.past.length || Boolean(state.transactionBefore)} onClick={() => dispatch({ type: 'undo' })}><Icon name="undo" size={16} />Undo</button>
      <button className="tool-button compact" aria-label="Повторить" title="Повторить · ⌘/Ctrl+Shift+Z" disabled={!state.future.length || Boolean(state.transactionBefore)} onClick={() => dispatch({ type: 'redo' })}><Icon name="redo" size={16} />Redo</button>
      <div className="toolbar-divider" /><button className="tool-button compact" onClick={fit}><Icon name="fit" size={16} />Вписать</button>
      <button className={`icon-button ${state.gridVisible ? 'grid-active' : ''}`} aria-label="Сетка" aria-pressed={state.gridVisible} onClick={() => dispatch({ type: 'toggle-grid' })}><Icon name="grid" size={16} /></button>
      <span className="toolbar-context">{state.document.coordinateSystem.name ?? 'Система координат'} · м</span>
    </nav>
    <main className="workspace"><LayersPanel state={state} dispatch={dispatch} /><div className="drawing-area">
      <Canvas state={state} dispatch={dispatch} size={size} onResize={onResize} onCursor={setCursor} />
      <div className="zoom-controls"><button className="icon-button" aria-label="Увеличить" onClick={() => zoom(1.25)}><Icon name="plus" /></button><button className="icon-button" aria-label="Уменьшить" onClick={() => zoom(0.8)}><Icon name="minus" /></button><button className="icon-button" aria-label="Вписать схему в вид" onClick={fit}><Icon name="fit" /></button></div>
      <div className="scale-bar" aria-label={`Масштабная линейка ${step} метров`}><span>{formatMeasure(step, step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0)} м</span><div style={{ width: step * state.viewport.pixelsPerUnit }} /></div>
    </div><PropertyInspector state={state} dispatch={dispatch} /></main>
    <footer className="status-bar"><span className={`status-ready ${state.error ? 'status-error' : ''}`} data-testid="editor-error"><span className={state.error ? 'error-dot' : 'live-dot'} />{state.error ?? (selected ? `Выбрано: ${selected.name}` : 'Готов к работе')}</span>
      <div className="status-coordinates"><Icon name="crosshair" size={14} /><span>X <b data-testid="cursor-x">{cursorWorld ? formatCoordinate(cursorWorld.x) : '—'}</b></span><span>Y <b data-testid="cursor-y">{cursorWorld ? formatCoordinate(cursorWorld.y) : '—'}</b></span><span>м</span></div>
      <span className="status-grid">Шаг сетки: {formatMeasure(step, step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0)} м</span><span className="status-zoom" data-testid="zoom-label">{formatMeasure(state.viewport.pixelsPerUnit)} px/м</span>
    </footer>
  </div>;
}
