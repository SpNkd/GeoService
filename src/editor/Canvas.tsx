import { memo, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type PointerEvent } from 'react';
import { documentModelFrame, modelToSurveyXY, surveyNorthDirection } from '../geometry/georeferencing';
import { canEditVertex, isLayerLocked } from '../domain/commands';
import { entityVertexIds, type HorizontalReference, type Vertex, type WorldPoint } from '../domain/model';
import { createGeometryCommand, newGeometryId, type DrawingKind, type GeometryAnchor } from '../domain/geometryIntent';
import { distance, screenToWorld, worldToScreen, type ScreenPoint, type ViewSize } from '../geometry';
import { constrainAngle } from '../geometry/constraints';
import { dimensionOffset, measurePair } from '../geometry/survey';
import { formatAzimuth, formatDistance } from '../geometry/format';
import { createSnapProvider, findSnapCandidate, type SnapResult } from '../snapping';
import { renderItems } from '../renderer/selectors';
import { EntityView } from '../renderer/EntityView';
import type { ReadyResolution } from '../ai/resolver';
import { AiPreviewView } from '../renderer/AiPreviewView';
import { GeometryPath, MeasurementLine } from '../renderer/PreviewPrimitives';
import { DimensionView } from '../renderer/DimensionView';
import { Grid } from '../renderer/Grid';
import type { EditorAction, EditorState } from '../store/editor';

interface Props {
  onPickPoint?: ((id: string) => void) | undefined; referencePreview?: HorizontalReference | undefined;
  state: EditorState; dispatch: Dispatch<EditorAction>; size: ViewSize; onResize: (size: ViewSize) => void;
  onCursor: (point: ScreenPoint | null) => void; onSnap: (snap: SnapResult | null) => void; onMeasure: (text: string | null) => void; disabled?: boolean; spaceHeld?: boolean; sequenceHint?: string; aiPreview?: { id: string; result: ReadyResolution }[];
}
type Drag = { kind: 'pan'; pointerId: number; last: ScreenPoint } | { kind: 'vertex'; pointerId: number; vertex: Vertex } | { kind: 'text'; pointerId: number; entityId: string; vertexId: string; start: WorldPoint; pointerStart: WorldPoint } | { kind: 'label'; pointerId: number; entityId: string; start: WorldPoint; dx: number; dy: number } | { kind: 'dimension' | 'dimension-text'; pointerId: number; entityId: string; a: WorldPoint; b: WorldPoint; offset: number; pointerOffset: number };
type MoveInput = { point: ScreenPoint; pointerId: number; shiftKey: boolean };

export const Canvas = memo(function Canvas({ state, dispatch, size, onResize, onCursor, onSnap, onMeasure, disabled = false, spaceHeld = false, sequenceHint = '', aiPreview = [], onPickPoint, referencePreview }: Props) {
  const ref = useRef<SVGSVGElement>(null), drag = useRef<Drag | null>(null);
  const lastTextClick = useRef<{ entityId: string; at: number; point: ScreenPoint } | null>(null);
  const frame = useRef<number | null>(null), pending = useRef<MoveInput | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<GeometryAnchor[]>([]);
  const [drawCursor, setDrawCursor] = useState<WorldPoint | null>(null);
  const [snap, setSnap] = useState<SnapResult | null>(null);
  const [textDraft, setTextDraft] = useState<{ anchor: GeometryAnchor; screen: ScreenPoint; content: string } | null>(null);
  const [editingText, setEditingText] = useState<{ entityId: string; content: string; screen: ScreenPoint } | null>(null);
  const { viewport, tool, document } = state;
  const committed = state.transactionBefore ?? document;
  const provider = useMemo(() => createSnapProvider(committed), [committed]);
  const items = useMemo(() => renderItems(document), [document]);
  const previousTool = useRef(tool);
  const announceSnap = useCallback((result: SnapResult | null) => { setSnap(result); onSnap(result); }, [onSnap]);
  useEffect(() => {
    if (previousTool.current !== tool) { previousTool.current = tool; setDraft([]); setDrawCursor(null); setTextDraft(null); onMeasure(null); }
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null; pending.current = null;
    announceSnap(null);
  }, [tool, state.snapOptions, announceSnap, onMeasure]);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  useEffect(() => { onMeasure(null); onSnap(null); }, [onMeasure, onSnap]);
  useEffect(() => {
    const cancelTransient = () => {
      if (drag.current && drag.current.kind !== 'pan') dispatch({ type: 'cancel-transaction' });
      drag.current = null; setDragging(false); setDraft([]); setTextDraft(null); setEditingText(null); setDrawCursor(null); announceSnap(null); onMeasure(null);
    };
    window.addEventListener('geoservice:escape', cancelTransient);
    return () => window.removeEventListener('geoservice:escape', cancelTransient);
  }, [announceSnap, dispatch, onMeasure]);
  const create = useCallback((kind: DrawingKind, anchors: GeometryAnchor[], offset = 0, content = '') => {
    try {
      const command = createGeometryCommand(document, kind, anchors, { offset, content, ...(kind !== 'dimension' ? { layerId: state.currentLayerId } : {}) });
      dispatch({ type: 'execute', command });
      if (command.type === 'add-entity') dispatch({ type: 'select', entityId: command.entity.id });
      dispatch({ type: 'tool', tool: 'select' }); setDraft([]); setDrawCursor(null);
    } catch (error) { dispatch({ type: 'report-error', message: error instanceof Error ? error.message : 'Не удалось построить объект' }); }
  }, [dispatch, document, state.currentLayerId]);
  const finishPath = useCallback((points: GeometryAnchor[] = draft) => {
    if (tool !== 'polyline' && tool !== 'polygon') return;
    if (points.length < (tool === 'polygon' ? 3 : 2)) return;
    create(tool, points);
  }, [create, draft, tool]);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) onResize({ width: entry.contentRect.width, height: entry.contentRect.height }); });
    observer.observe(ref.current); return () => observer.disconnect();
  }, [onResize]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (disabled) return;
      event.preventDefault(); const rect = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      announceSnap(null); onCursor(anchor); dispatch({ type: 'zoom', size, anchor, factor: Math.exp(-Math.max(-250, Math.min(250, delta)) * 0.002) });
    };
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel);
  }, [announceSnap, disabled, dispatch, onCursor, size]);
  const anchorAt = (point: ScreenPoint, exclude?: string, shiftKey = false): GeometryAnchor => {
    const raw = screenToWorld(point, viewport, size);
    const result = findSnapCandidate(raw, provider, viewport, state.snapOptions, exclude);
    const origin = draft.at(-1)?.position;
    if (origin && ['line', 'polyline', 'polygon'].includes(tool) && (shiftKey || state.ortho) && result?.type !== 'vertex') {
      announceSnap(null); return { position: constrainAngle(origin, raw, shiftKey ? 45 : 90) };
    }
    announceSnap(result);
    return { position: result?.worldPosition ?? raw, ...(result?.sourceVertexId ? { vertexId: result.sourceVertexId } : {}) };
  };
  const processMove = (input: MoveInput) => {
    const { point, pointerId, shiftKey } = input;
    if (disabled) return;
    onCursor(point);
    const active = drag.current;
    if (active?.kind === 'pan') {
      if (active.pointerId === pointerId) { dispatch({ type: 'pan', delta: { x: point.x - active.last.x, y: point.y - active.last.y } }); active.last = point; }
      announceSnap(null); return;
    }
    if (onPickPoint) { announceSnap(null); return; }
    if (active?.kind === 'vertex' && active.pointerId === pointerId) {
      const position = anchorAt(point, active.vertex.id).position;
      dispatch({ type: 'transient', command: { type: 'update-vertex', vertexId: active.vertex.id,
        position: { x: position.x, y: position.y, ...(active.vertex.z === undefined ? {} : { z: active.vertex.z }) } } });
      return;
    }
    if (active?.kind === 'text' && active.pointerId === pointerId) {
      const world = screenToWorld(point, viewport, size);
      dispatch({ type: 'transient', command: { type: 'move-text', entityId: active.entityId, vertexId: active.vertexId,
        position: { x: active.start.x + world.x - active.pointerStart.x, y: active.start.y + world.y - active.pointerStart.y, ...(active.start.z === undefined ? {} : { z: active.start.z }) } } });
      return;
    }
    if (active?.kind === 'label' && active.pointerId === pointerId) {
      const world = screenToWorld(point, viewport, size);
      dispatch({ type: 'transient', command: { type: 'update-entity', entityId: active.entityId,
        patch: { dx: active.dx + world.x - active.start.x, dy: active.dy + world.y - active.start.y } } });
      return;
    }
    if (active?.kind === 'dimension' && active.pointerId === pointerId) {
      const cursor = screenToWorld(point, viewport, size);
      dispatch({ type: 'transient', command: { type: 'update-entity', entityId: active.entityId,
        patch: { offset: active.offset + dimensionOffset(active.a, active.b, cursor) - active.pointerOffset } } });
      return;
    }
    if (active?.kind === 'dimension-text' && active.pointerId === pointerId) {
      const cursor = screenToWorld(point, viewport, size), dx = active.b.x - active.a.x, dy = active.b.y - active.a.y;
      const squaredLength = dx * dx + dy * dy;
      if (!(squaredLength > 0) || !Number.isFinite(squaredLength)) return;
      const t = ((cursor.x - active.a.x) * dx + (cursor.y - active.a.y) * dy) / squaredLength;
      dispatch({ type: 'transient', command: { type: 'update-entity', entityId: active.entityId, patch: { textPosition: Math.max(0.05, Math.min(0.95, t)) } } }); return;
    }
    if (['point', 'line', 'polyline', 'polygon', 'dimension', 'measure', 'text'].includes(tool)) setDrawCursor(anchorAt(point, undefined, shiftKey).position);
    else announceSnap(null);
  };
  const flushMove = () => {
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    const input = pending.current; pending.current = null;
    if (input) processMove(input);
  };
  const local = (event: PointerEvent<SVGSVGElement>): ScreenPoint => { const rect = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (disabled || ![0, 1, 2].includes(event.button)) return;
    flushMove(); event.preventDefault(); const point = local(event); onCursor(point);
    const hit = event.target instanceof Element ? event.target.closest('[data-entity-id]') : null;
    event.currentTarget.focus();
    if (tool === 'pan' || spaceHeld || event.button !== 0) {
      drag.current = { kind: 'pan', pointerId: event.pointerId, last: point };
      event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); return;
    }
    if (onPickPoint) { const entity = document.entities.find(item => item.id === hit?.getAttribute('data-entity-id')); if (entity?.type === 'point') onPickPoint(entity.id); return; }
    if (tool === 'point') { create('point', [anchorAt(point)]); return; }
    if (tool === 'line') {
      const anchor = anchorAt(point, undefined, event.shiftKey);
      if (!draft.length) { setDraft([anchor]); setDrawCursor(anchor.position); } else create('line', [draft[0]!, anchor]);
      return;
    }
    if (tool === 'dimension') {
      const anchor = anchorAt(point, undefined, event.shiftKey);
      if (draft.length < 2) { setDraft([...draft, anchor]); setDrawCursor(anchor.position); }
      else create('dimension', draft, dimensionOffset(draft[0]!.position, draft[1]!.position, anchor.position));
      return;
    }
    if (tool === 'measure') {
      const anchor = anchorAt(point, undefined, event.shiftKey);
      const points = draft.length === 1 ? [...draft, anchor] : [anchor];
      setDraft(points); setDrawCursor(anchor.position);
      return;
    }
    if (tool === 'polyline' || tool === 'polygon') { const anchor = anchorAt(point, undefined, event.shiftKey); setDraft(previous => [...previous, anchor]); setDrawCursor(anchor.position); return; }
    if (tool === 'text') { setTextDraft({ anchor: anchorAt(point), screen: point, content: '' }); return; }
    // Active geometry handles outrank wide annotation hit areas at the same screen position.
    if (!event.shiftKey) for (const entity of document.entities) {
      if (!state.selectedEntityIds.includes(entity.id) || !['line', 'polyline', 'polygon'].includes(entity.type) || isLayerLocked(document, entity)) continue;
      for (const vertexId of entityVertexIds(entity)) {
        const vertex = document.vertices[vertexId]!, screen = worldToScreen(vertex, viewport, size);
        if (Math.abs(screen.x - point.x) > 6 || Math.abs(screen.y - point.y) > 6 || !canEditVertex(document, vertexId)) continue;
        dispatch({ type: 'select', entityId: entity.id }); dispatch({ type: 'begin-transaction' });
        drag.current = { kind: 'vertex', pointerId: event.pointerId, vertex };
        event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); return;
      }
    }
    if (hit) {
      const entityId = hit.getAttribute('data-entity-id')!;
      const entity = document.entities.find(item => item.id === entityId);
      if (!entity) return;
      dispatch({ type: 'select', entityId, toggle: event.shiftKey });
      if (event.shiftKey) return;
      if (entity.type === 'text' && !isLayerLocked(document, entity)) {
        const previous = lastTextClick.current, now = performance.now();
        if (previous?.entityId === entity.id && now - previous.at < 450 && Math.hypot(point.x - previous.point.x, point.y - previous.point.y) < 8) {
          lastTextClick.current = null; setEditingText({ entityId: entity.id, content: entity.content, screen: point }); return;
        }
        lastTextClick.current = { entityId: entity.id, at: now, point };
      }
      if (entity.type === 'text' && !isLayerLocked(document, entity)) {
        const vertex = document.vertices[entity.vertexId]!;
        dispatch({ type: 'begin-transaction' });
        drag.current = { kind: 'text', pointerId: event.pointerId, entityId, vertexId: newGeometryId('v'), start: { x: vertex.x, y: vertex.y, ...(vertex.z === undefined ? {} : { z: vertex.z }) }, pointerStart: screenToWorld(point, viewport, size) };
        event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); return;
      }
      if (entity.type === 'label' && !isLayerLocked(document, entity)) {
        dispatch({ type: 'begin-transaction' });
        drag.current = { kind: 'label', pointerId: event.pointerId, entityId, start: screenToWorld(point, viewport, size), dx: entity.dx, dy: entity.dy };
        event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); return;
      }
      if (entity.type === 'dimension' && !isLayerLocked(document, entity)) {
        const a = document.vertices[entity.startVertexId]!, b = document.vertices[entity.endVertexId]!;
        dispatch({ type: 'begin-transaction' });
        drag.current = { kind: event.target instanceof Element && event.target.closest('[data-dimension-text-handle]') ? 'dimension-text' : 'dimension', pointerId: event.pointerId, entityId, a, b, offset: entity.offset, pointerOffset: dimensionOffset(a, b, screenToWorld(point, viewport, size)) };
        event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); return;
      }
      const handle = event.target instanceof Element ? event.target.closest('[data-vertex-handle]') : null;
      const vertexId = handle?.getAttribute('data-vertex-id') ?? (entity.type === 'point' ? entity.vertexId : null);
      if (vertexId && !isLayerLocked(document, entity) && canEditVertex(document, vertexId)) {
        dispatch({ type: 'begin-transaction' }); drag.current = { kind: 'vertex', pointerId: event.pointerId, vertex: document.vertices[vertexId]! };
        event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
      }
      return;
    }
    dispatch({ type: 'select', entityId: null }); drag.current = { kind: 'pan', pointerId: event.pointerId, last: point };
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    pending.current = { point: local(event), pointerId: event.pointerId, shiftKey: event.shiftKey };
    if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; const input = pending.current; pending.current = null; if (input) processMove(input); });
  };
  const end = (event: PointerEvent<SVGSVGElement>) => {
    flushMove(); const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind !== 'pan') dispatch({ type: 'commit-transaction' });
    drag.current = null; setDragging(false); announceSnap(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const completeText = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!textDraft?.content.trim()) { setTextDraft(null); dispatch({ type: 'tool', tool: 'select' }); return; }
    create('text', [textDraft.anchor], 0, textDraft.content.trim()); setTextDraft(null);
  };
  const measurement = tool === 'measure' && draft.length ? measurePair(draft[0]!.position, draft[1]?.position ?? drawCursor ?? draft[0]!.position) : null;
  const measurementStatus = measurement ? `D=${formatDistance(measurement.horizontal)} · ΔX=${formatDistance(measurement.delta.x)} · ΔY=${formatDistance(measurement.delta.y)} · Az=${formatAzimuth(measurement.azimuth)}` : null;
  useEffect(() => onMeasure(measurementStatus), [measurementStatus, onMeasure]);
  const previewPoints = [...draft.map(anchor => worldToScreen(anchor.position, viewport, size)), ...(drawCursor && !(tool === 'measure' && draft.length === 2) ? [worldToScreen(drawCursor, viewport, size)] : [])];
  const snapScreen = snap ? worldToScreen(snap.worldPosition, viewport, size) : null;
  const reference = referencePreview ?? document.horizontalReference;
  const north = surveyNorthDirection(reference?.transform);
  const surveyAvailable = Boolean(reference) || documentModelFrame(document) === 'projected';
  return <div className="canvas-wrap">
    <svg ref={ref} className={`drawing-canvas ${dragging ? 'grabbing' : spaceHeld || tool === 'pan' ? 'panning' : `tool-${tool}`}`}
      data-testid="drawing-canvas" data-center-x={viewport.center.x} data-center-y={viewport.center.y} data-zoom={viewport.pixelsPerUnit}
      aria-label="Геодезическая схема" tabIndex={0} onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onKeyDown={event => { if (event.key === 'Enter' && (tool === 'polyline' || tool === 'polygon') && draft.length) { event.preventDefault(); finishPath(); } }}
      onLostPointerCapture={() => { if (drag.current && drag.current.kind !== 'pan') dispatch({ type: 'commit-transaction' }); drag.current = null; setDragging(false); }}
      onPointerLeave={() => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; pending.current = null; onCursor(null); announceSnap(null); }}
      onDoubleClick={event => {
        if (disabled || onPickPoint) return;
        const hit = event.target instanceof Element ? event.target.closest('[data-entity-id]') : null;
        if (tool === 'select' && hit) {
          const entity = document.entities.find(item => item.id === hit.getAttribute('data-entity-id'));
          if (entity?.type === 'text' && !isLayerLocked(document, entity)) { const rect = event.currentTarget.getBoundingClientRect(); setEditingText({ entityId: entity.id, content: entity.content, screen: { x: event.clientX - rect.left, y: event.clientY - rect.top } }); }
          return;
        }
        if (tool !== 'polyline' && tool !== 'polygon') return;
        const rect = event.currentTarget.getBoundingClientRect(); const last = anchorAt({ x: event.clientX - rect.left, y: event.clientY - rect.top }, undefined, event.shiftKey);
        const points = draft.length > 1 && distance(draft[draft.length - 1]!.position, draft[draft.length - 2]!.position) < 1e-9 ? draft.slice(0, -1) : draft;
        finishPath(points.length && distance(last.position, points[points.length - 1]!.position) < 1e-9 ? points : [...points, last]);
      }} onContextMenu={event => event.preventDefault()}>
      {state.gridVisible && <Grid viewport={viewport} size={size} snapStep={state.snapOptions.gridStep ?? 1} />}
      {items.map(item => <EntityView key={item.entity.id} item={item} document={document} viewport={viewport} size={size}
        selected={state.selectedEntityIds.includes(item.entity.id) || state.orderedPointIds.includes(item.entity.id)}
        {...(state.orderedPointIds.length > 1 && state.orderedPointIds.includes(item.entity.id) ? { order: state.orderedPointIds.indexOf(item.entity.id) + 1 } : {})}
        pointLabelMode={state.pointLabelMode} showLineLengths={state.showLineLengths} />)}
      {reference && <g className="control-preview" pointerEvents="none" data-testid="control-markers">{reference.controls.map((control, i) => {
        const vertex = document.vertices[control.vertexId]!, p = worldToScreen(vertex, viewport, size), survey = modelToSurveyXY(vertex, reference.transform);
        return <g key={control.pointEntityId}><circle cx={p.x} cy={p.y} r={11} fill="none" stroke="#b77922" strokeWidth={2} strokeDasharray={referencePreview ? '3 3' : undefined} /><text x={p.x + 15} y={p.y - 12}>{i === 0 ? 'A' : 'B'} · E {survey.e.toFixed(3)} · N {survey.n.toFixed(3)}</text></g>;
      })}</g>}
      {aiPreview.map((action, index) => <AiPreviewView key={action.id} result={action.result} viewport={viewport} size={size} actionNumber={aiPreview.length > 1 ? index + 1 : undefined} />)}
      {draft.length > 0 && <g className="drawing-preview" pointerEvents="none" stroke="#21836e" strokeWidth={1.5} strokeDasharray="5 4" fill="#21836e20">
        {(tool === 'line' || tool === 'measure') && previewPoints.length > 1 && <MeasurementLine a={previewPoints[0]!} b={previewPoints[tool === 'measure' && draft.length === 2 ? 1 : previewPoints.length - 1]!} />}
        {tool === 'polyline' && <GeometryPath points={previewPoints} closed={false} fill="none" />}
        {tool === 'polygon' && <GeometryPath points={previewPoints} closed />}
        {previewPoints.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={3} fill="white" />)}
      </g>}
      {tool === 'dimension' && draft.length >= 2 && <DimensionView a={draft[0]!.position} b={draft[1]!.position} offset={dimensionOffset(draft[0]!.position, draft[1]!.position, drawCursor ?? draft[1]!.position)} viewport={viewport} size={size} preview />}
      {snap && snapScreen && <g className="snap-indicator" data-testid="snap-indicator" data-snap-type={snap.type} data-source-vertex={snap.sourceVertexId} pointerEvents="none" stroke="#c18430" fill="white" strokeWidth={1.7}>
        {snap.type === 'vertex' ? <rect x={snapScreen.x - 5} y={snapScreen.y - 5} width={10} height={10} /> : snap.type === 'midpoint' ? <path d={`M${snapScreen.x},${snapScreen.y - 6}l6,11h-12z`} /> : <circle cx={snapScreen.x} cy={snapScreen.y} r={4} />}
        <text x={snapScreen.x + 12} y={snapScreen.y + 25} stroke="none" fill="#8b632f">{snap.metadata.label}</text>
      </g>}
    </svg>
    {measurement && <div className="measurement-readout" data-testid="measurement-readout"><strong>Measure · {draft.length === 2 ? 'Готово' : 'Выберите вторую точку'}</strong>
      <span>Horizontal: <b>{formatDistance(measurement.horizontal)}</b></span><span>ΔX: {formatDistance(measurement.delta.x)}</span><span>ΔY: {formatDistance(measurement.delta.y)}</span>
      <span>Azimuth: {formatAzimuth(measurement.azimuth)}</span>{measurement.delta.z !== undefined && <><span>ΔZ: {formatDistance(measurement.delta.z)}</span><span>3D: {formatDistance(measurement.spatial!)}</span></>}<small>Esc — очистить · история не изменяется</small></div>}
    {textDraft && <form className="text-entry" style={{ left: Math.min(textDraft.screen.x + 8, size.width - 230), top: Math.min(textDraft.screen.y + 8, size.height - 60) }} onSubmit={completeText} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setTextDraft(null); dispatch({ type: 'tool', tool: 'select' }); } }}>
      <label>Текстовая аннотация<input autoFocus aria-label="Текст аннотации" value={textDraft.content} onChange={event => setTextDraft({ ...textDraft, content: event.target.value })} placeholder="Введите подпись" /></label><button type="submit">Готово</button><button type="button" onClick={() => { setTextDraft(null); dispatch({ type: 'tool', tool: 'select' }); }}>Отмена</button>
    </form>}
    {editingText && <form className="text-entry inline-text-editor" style={{ left: Math.min(editingText.screen.x + 8, size.width - 230), top: Math.min(editingText.screen.y + 8, size.height - 60) }} onSubmit={event => { event.preventDefault(); if (editingText.content.trim()) dispatch({ type: 'execute', command: { type: 'update-entity', entityId: editingText.entityId, patch: { content: editingText.content } } }); setEditingText(null); ref.current?.focus(); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditingText(null); ref.current?.focus(); } }}>
      <label>Редактировать текст<input autoFocus aria-label="Редактировать текст" value={editingText.content} onChange={event => setEditingText({ ...editingText, content: event.target.value })} /></label><button type="submit">Готово</button><button type="button" onClick={() => setEditingText(null)}>Отмена</button>
    </form>}
    <div className="canvas-caption"><span className="live-dot" /> МОДЕЛЬ <span>Метры · X / Y</span></div>
    <div className="north-arrow" aria-label={surveyAvailable ? "Survey North в MODEL viewport" : "Ось MODEL +Y; Survey не задан"} data-testid="north-arrow" data-screen-x={north.screen.x} data-screen-y={north.screen.y} data-preview={Boolean(referencePreview)}><b>{surveyAvailable ? 'N' : '+Y'}</b><svg width="44" height="44" viewBox="-22 -22 44 44" aria-hidden="true"><g transform={`rotate(${north.rotationDegrees})`}><path d="M0 -18L-7 13l7-5 7 5z" fill="#405d6b" /><path d="M0 -18v26l7 5z" fill="#c7d4dc" /></g></svg></div>
    <div className="canvas-help">{sequenceHint ? `${sequenceHint}…` : tool === 'dimension' ? `Размер: ${draft.length < 2 ? 'выберите две точки' : 'укажите offset размерной линии'} · Esc отмена` : tool === 'measure' ? 'Measure: две точки · Esc очистить' : tool === 'line' && draft.length ? 'Линия: выберите конечную точку · Esc отмена' : tool === 'polygon' || tool === 'polyline' ? `${tool === 'polygon' ? 'Полигон' : 'Полилиния'} · клики добавляют вершины · Enter завершает · Esc отмена` : `Текущий слой: ${document.layers.find(layer => layer.id === state.currentLayerId)?.name ?? '—'} · Shift + клик — точки по порядку · Колесо — масштаб · Space + drag — вид`}</div>
  </div>;
});
