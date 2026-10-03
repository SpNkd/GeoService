import { useCallback, useEffect, useRef, useState, type Dispatch, type FormEvent, type PointerEvent } from 'react';
import { canEditVertex, isLayerLocked } from '../domain/commands';
import { worldVertex, type Entity, type GeoDocument, type Vertex, type WorldPoint } from '../domain/model';
import { distance, screenToWorld, worldToScreen, type ScreenPoint, type ViewSize } from '../geometry';
import { renderItems } from '../renderer/selectors';
import { EntityView } from '../renderer/EntityView';
import { Grid } from '../renderer/Grid';
import type { EditorAction, EditorState, EditorTool } from '../store/editor';

interface Props { state: EditorState; dispatch: Dispatch<EditorAction>; size: ViewSize; onResize: (size: ViewSize) => void; onCursor: (point: ScreenPoint | null) => void }
type Drag = { kind: 'pan'; pointerId: number; last: ScreenPoint } | { kind: 'vertex'; pointerId: number; vertex: Vertex };
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const layerForTool = (tool: EditorTool) => tool === 'point' ? 'survey-points' : tool === 'text' ? 'annotations' : 'boundary';
const entityName = (tool: Exclude<EditorTool, 'select' | 'pan'>, n: number) => ({ point: `Точка ${n}`, line: `Линия ${n}`, polyline: `Полилиния ${n}`, polygon: `Полигон ${n}`, text: `Текст ${n}` })[tool];
function makeEntity(tool: Exclude<EditorTool, 'select' | 'pan'>, points: WorldPoint[], document: GeoDocument, content = ''): { entity: Entity; vertices: Vertex[] } {
  const vertices = points.map(point => worldVertex(newId('v'), point));
  const base = { id: newId(tool), name: entityName(tool, document.entities.length + 1), layerId: layerForTool(tool) };
  switch (tool) {
    case 'point': return { entity: { ...base, type: 'point', vertexId: vertices[0]!.id }, vertices };
    case 'line': return { entity: { ...base, type: 'line', startVertexId: vertices[0]!.id, endVertexId: vertices[1]!.id }, vertices };
    case 'polyline': return { entity: { ...base, type: 'polyline', vertexIds: vertices.map(v => v.id) as [string, string, ...string[]] }, vertices };
    case 'polygon': return { entity: { ...base, type: 'polygon', vertexIds: vertices.map(v => v.id) as [string, string, string, ...string[]] }, vertices };
    case 'text': return { entity: { ...base, type: 'text', vertexId: vertices[0]!.id, content, fontSize: 14 }, vertices };
  }
}

export function Canvas({ state, dispatch, size, onResize, onCursor }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [space, setSpace] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<WorldPoint[]>([]);
  const [drawCursor, setDrawCursor] = useState<WorldPoint | null>(null);
  const [textDraft, setTextDraft] = useState<{ point: WorldPoint; screen: ScreenPoint; content: string } | null>(null);
  const { viewport, tool, document } = state;
  const previousTool = useRef(tool);
  useEffect(() => {
    if (previousTool.current === tool) return;
    previousTool.current = tool; setDraft([]); setDrawCursor(null); setTextDraft(null);
  }, [tool]);
  const finishPath = useCallback((points: WorldPoint[] = draft) => {
    if (tool !== 'polyline' && tool !== 'polygon') return;
    if ((tool === 'polygon' && points.length < 3) || (tool === 'polyline' && points.length < 2)) { setDraft(points); return; }
    const created = makeEntity(tool, points, document);
    dispatch({ type: 'execute', command: { type: 'add-entity', ...created } });
    dispatch({ type: 'select', entityId: created.entity.id }); dispatch({ type: 'tool', tool: 'select' });
    setDraft([]); setDrawCursor(null);
  }, [dispatch, document, draft, tool]);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) onResize({ width: entry.contentRect.width, height: entry.contentRect.height }); });
    observer.observe(ref.current); return () => observer.disconnect();
  }, [onResize]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); const rect = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      onCursor(anchor); dispatch({ type: 'zoom', size, anchor, factor: Math.exp(-Math.max(-250, Math.min(250, delta)) * 0.002) });
    };
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel);
  }, [dispatch, onCursor, size]);
  useEffect(() => {
    const isInput = (target: EventTarget | null) => target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
    const down = (event: KeyboardEvent) => {
      if (!isInput(event.target) && event.code === 'Space') { event.preventDefault(); setSpace(true); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); dispatch({ type: event.shiftKey ? 'redo' : 'undo' }); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); dispatch({ type: 'redo' }); return; }
      if (isInput(event.target)) return;
      if (event.key === 'Enter' && (tool === 'polyline' || tool === 'polygon') && draft.length) { event.preventDefault(); finishPath(); }
      if (event.code === 'Escape') {
        if (draft.length || textDraft) { setDraft([]); setTextDraft(null); setDrawCursor(null); dispatch({ type: 'tool', tool: 'select' }); }
        else if (tool !== 'select') dispatch({ type: 'tool', tool: 'select' });
        else dispatch({ type: 'select', entityId: null });
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectionId) {
        const entity = document.entities.find(item => item.id === state.selectionId);
        if (entity && !isLayerLocked(document, entity)) { event.preventDefault(); dispatch({ type: 'execute', command: { type: 'delete-entity', entityId: entity.id } }); dispatch({ type: 'select', entityId: null }); }
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'v') dispatch({ type: 'tool', tool: 'select' });
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') setSpace(false); };
    const blur = () => { setSpace(false); if (drag.current?.kind === 'vertex') dispatch({ type: 'commit-transaction' }); drag.current = null; setDragging(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [dispatch, document, draft, finishPath, state.selectionId, textDraft, tool]);
  const local = (event: PointerEvent<SVGSVGElement>): ScreenPoint => { const rect = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (![0, 1, 2].includes(event.button)) return;
    event.preventDefault(); const point = local(event); onCursor(point);
    const hit = event.target instanceof Element ? event.target.closest('[data-entity-id]') : null;
    if (tool === 'pan' || space || event.button !== 0) {
      drag.current = { kind: 'pan', pointerId: event.pointerId, last: point };
      event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); event.currentTarget.focus(); return;
    }
    if (tool === 'point') {
      const created = makeEntity('point', [screenToWorld(point, viewport, size)], document);
      dispatch({ type: 'execute', command: { type: 'add-entity', ...created } }); dispatch({ type: 'select', entityId: created.entity.id }); dispatch({ type: 'tool', tool: 'select' }); return;
    }
    if (tool === 'line') {
      const world = screenToWorld(point, viewport, size);
      if (!draft.length) { setDraft([world]); setDrawCursor(world); }
      else {
        const created = makeEntity('line', [draft[0]!, world], document);
        dispatch({ type: 'execute', command: { type: 'add-entity', ...created } }); dispatch({ type: 'select', entityId: created.entity.id }); dispatch({ type: 'tool', tool: 'select' }); setDraft([]); setDrawCursor(null);
      }
      event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); return;
    }
    if (tool === 'polyline' || tool === 'polygon') {
      const world = screenToWorld(point, viewport, size); setDraft(previous => [...previous, world]); setDrawCursor(world);
      event.currentTarget.focus(); return;
    }
    if (tool === 'text') { setTextDraft({ point: screenToWorld(point, viewport, size), screen: point, content: '' }); event.currentTarget.focus(); return; }
    if (hit) {
      const entityId = hit.getAttribute('data-entity-id')!;
      const entity = document.entities.find(item => item.id === entityId);
      if (!entity) return;
      dispatch({ type: 'select', entityId }); event.currentTarget.focus();
      const handle = event.target instanceof Element ? event.target.closest('[data-vertex-handle]') : null;
      const vertexId = handle?.getAttribute('data-vertex-id') ?? (entity.type === 'point' ? entity.vertexId : null);
      if (vertexId && !isLayerLocked(document, entity) && canEditVertex(document, vertexId)) {
        dispatch({ type: 'begin-transaction' }); drag.current = { kind: 'vertex', pointerId: event.pointerId, vertex: document.vertices[vertexId]! };
        event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
      }
      return;
    }
    dispatch({ type: 'select', entityId: null }); drag.current = { kind: 'pan', pointerId: event.pointerId, last: point };
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); event.currentTarget.focus();
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const point = local(event); onCursor(point);
    if (tool === 'line' || tool === 'polyline' || tool === 'polygon') setDrawCursor(screenToWorld(point, viewport, size));
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === 'pan') { dispatch({ type: 'pan', delta: { x: point.x - active.last.x, y: point.y - active.last.y } }); active.last = point; }
    else {
      const position = screenToWorld(point, viewport, size);
      const next = active.vertex.z === undefined ? { x: position.x, y: position.y } : { x: position.x, y: position.y, z: active.vertex.z };
      dispatch({ type: 'transient', command: { type: 'update-vertex', vertexId: active.vertex.id, position: next } });
    }
  };
  const end = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === 'vertex') dispatch({ type: 'commit-transaction' });
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const completeText = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!textDraft?.content.trim()) { setTextDraft(null); dispatch({ type: 'tool', tool: 'select' }); return; }
    const created = makeEntity('text', [textDraft.point], document, textDraft.content.trim());
    dispatch({ type: 'execute', command: { type: 'add-entity', ...created } }); dispatch({ type: 'select', entityId: created.entity.id }); dispatch({ type: 'tool', tool: 'select' }); setTextDraft(null);
  };
  const color = renderItems(document).find(item => item.layer.id === layerForTool(tool))?.style.stroke ?? '#21836e';
  const previewPoints = [...draft.map(point => worldToScreen(point, viewport, size)), ...(drawCursor ? [worldToScreen(drawCursor, viewport, size)] : [])];
  const previewString = previewPoints.map(point => `${point.x},${point.y}`).join(' ');
  return <div className="canvas-wrap">
    <svg ref={ref} className={`drawing-canvas ${dragging ? 'grabbing' : space || tool === 'pan' ? 'panning' : `tool-${tool}`}`}
      data-testid="drawing-canvas" data-center-x={viewport.center.x} data-center-y={viewport.center.y} data-zoom={viewport.pixelsPerUnit}
      aria-label="Геодезическая схема" tabIndex={0} onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onLostPointerCapture={() => { if (drag.current?.kind === 'vertex') dispatch({ type: 'commit-transaction' }); drag.current = null; setDragging(false); }}
      onPointerLeave={() => { onCursor(null); if (!['line', 'polyline', 'polygon'].includes(tool)) setDrawCursor(null); }} onDoubleClick={event => {
        if (tool !== 'polyline' && tool !== 'polygon') return;
        const rect = event.currentTarget.getBoundingClientRect(); const last = screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, viewport, size);
        const points = draft.length > 1 && distance(draft[draft.length - 1]!, draft[draft.length - 2]!) < 1e-9 ? draft.slice(0, -1) : draft;
        finishPath(points.length && distance(last, points[points.length - 1]!) < 1e-9 ? points : [...points, last]);
      }} onContextMenu={event => event.preventDefault()}>
      {state.gridVisible && <Grid viewport={viewport} size={size} />}
      {renderItems(document).map(item => <EntityView key={item.entity.id} item={item} document={document} viewport={viewport} size={size} selected={state.selectionId === item.entity.id} />)}
      {draft.length > 0 && <g className="drawing-preview" pointerEvents="none" stroke={color} strokeWidth={1.5} strokeDasharray="5 4" fill={`${color}20`}>
        {tool === 'line' && previewPoints.length > 1 && <line x1={previewPoints[0]!.x} y1={previewPoints[0]!.y} x2={previewPoints[1]!.x} y2={previewPoints[1]!.y} />}
        {tool === 'polyline' && previewPoints.length > 1 && <polyline points={previewString} fill="none" />}
        {tool === 'polygon' && previewPoints.length > 1 && <polygon points={previewString} />}
        {previewPoints.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={3} fill="white" />)}
      </g>}
    </svg>
    {textDraft && <form className="text-entry" style={{ left: Math.min(textDraft.screen.x + 8, size.width - 230), top: Math.min(textDraft.screen.y + 8, size.height - 60) }} onSubmit={completeText} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setTextDraft(null); dispatch({ type: 'tool', tool: 'select' }); } }}>
      <label>Текстовая аннотация<input autoFocus aria-label="Текст аннотации" value={textDraft.content} onChange={event => setTextDraft({ ...textDraft, content: event.target.value })} placeholder="Введите подпись" /></label><button type="submit">Готово</button><button type="button" onClick={() => { setTextDraft(null); dispatch({ type: 'tool', tool: 'select' }); }}>Отмена</button>
    </form>}
    <div className="canvas-caption"><span className="live-dot" /> МОДЕЛЬ <span>Метры · X / Y</span></div>
    <div className="north-arrow" aria-label="Север в направлении положительной оси Y"><b>N</b><svg width="26" height="38" viewBox="0 0 26 38" aria-hidden="true"><path d="M13 3L4 29l9-5 9 5-9-26z" fill="#405d6b" /><path d="M13 3v21l9 5z" fill="#c7d4dc" /></svg></div>
    <div className="canvas-help">{tool === 'line' && draft.length ? 'Линия: выберите конечную точку · Esc отмена' : tool === 'polygon' || tool === 'polyline' ? `${tool === 'polygon' ? 'Полигон' : 'Полилиния'} · клики добавляют вершины · Enter завершает · Esc отмена` : 'Колесо — масштаб · Space + drag — перемещение · Esc — Select'}</div>
  </div>;
}
