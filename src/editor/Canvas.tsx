import { useEffect, useRef, useState, type Dispatch, type PointerEvent } from 'react';
import { type ScreenPoint, type ViewSize } from '../geometry';
import type { EditorAction, EditorState } from '../store/editor';
import { renderItems } from '../renderer/selectors';
import { EntityView } from '../renderer/EntityView';
import { Grid } from '../renderer/Grid';

interface Props {
  state: EditorState; dispatch: Dispatch<EditorAction>; size: ViewSize;
  onResize: (size: ViewSize) => void; onCursor: (point: ScreenPoint | null) => void;
}
export function Canvas({ state, dispatch, size, onResize, onCursor }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ pointerId: number; last: ScreenPoint } | null>(null);
  const [space, setSpace] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { viewport } = state;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) onResize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onResize]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      onCursor(anchor);
      dispatch({ type: 'zoom', size, anchor, factor: Math.exp(-Math.max(-250, Math.min(250, delta)) * 0.002) });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [dispatch, size, onCursor]);
  useEffect(() => {
    const isInput = (target: EventTarget | null) => target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable);
    const down = (event: KeyboardEvent) => {
      if (isInput(event.target)) return;
      if (event.code === 'Space') { event.preventDefault(); setSpace(true); }
      if (event.code === 'Escape') dispatch({ type: 'select', entityId: null });
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') setSpace(false); };
    const blur = () => { setSpace(false); drag.current = null; setDragging(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [dispatch]);
  const local = (event: PointerEvent<SVGSVGElement>): ScreenPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (![0, 1, 2].includes(event.button)) return;
    event.preventDefault();
    event.currentTarget.focus();
    const target = event.target instanceof Element ? event.target.closest('[data-entity-id]') : null;
    const panning = state.tool === 'pan' || space || event.button !== 0;
    if (!panning && target) {
      dispatch({ type: 'select', entityId: target.getAttribute('data-entity-id') });
      return;
    }
    if (!panning) dispatch({ type: 'select', entityId: null });
    drag.current = { pointerId: event.pointerId, last: local(event) };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const point = local(event);
    onCursor(point);
    if (drag.current?.pointerId === event.pointerId) {
      dispatch({ type: 'pan', delta: { x: point.x - drag.current.last.x, y: point.y - drag.current.last.y } });
      drag.current.last = point;
    }
  };
  const end = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className="canvas-wrap">
    <svg ref={ref} className={`drawing-canvas ${dragging ? 'grabbing' : space || state.tool === 'pan' ? 'panning' : ''}`}
      data-testid="drawing-canvas" data-center-x={viewport.center.x} data-center-y={viewport.center.y} data-zoom={viewport.pixelsPerUnit}
      aria-label="Геодезическая схема" tabIndex={0} onPointerDown={down} onPointerMove={move}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
      onPointerLeave={() => onCursor(null)} onContextMenu={event => event.preventDefault()}>
      {state.gridVisible && <Grid viewport={viewport} size={size} />}
      {renderItems(state.document).map(item => <EntityView key={item.entity.id} item={item} viewport={viewport} size={size} selected={state.selectionId === item.entity.id} />)}
    </svg>
    <div className="canvas-caption"><span className="live-dot" /> МОДЕЛЬ <span>Метры · X / Y</span></div>
    <div className="north-arrow" aria-label="Север в направлении положительной оси Y"><b>N</b><svg width="26" height="38" viewBox="0 0 26 38" aria-hidden="true"><path d="M13 3L4 29l9-5 9 5-9-26z" fill="#405d6b" /><path d="M13 3v21l9 5z" fill="#c7d4dc" /></svg></div>
    <div className="canvas-help">Колесо — масштаб <span>·</span> Space + drag — перемещение <span>·</span> Esc — снять выбор</div>
  </div>;
}
