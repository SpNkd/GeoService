import { memo, useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { ScreenPoint } from '../geometry';
import type { SnapResult } from '../snapping';
import type { GeoDocument } from '../domain/model';
import type { EditorState, EditorAction } from '../store/editor';
import { editorViewDocument } from '../store/editor';
import { activeDxfViewport, activeLayout, viewportDocument } from './context';
import { bounds, fitToBounds, worldToScreen, panViewport, zoomAt, screenToWorld, type ViewSize } from '../geometry';
import { primitiveBounds } from '../vectors/geometry';
import { renderItems } from '../renderer/selectors';
import { canvasEntity } from '../renderer/hybridScene';
import { CanvasStratum } from '../renderer/CanvasStratum';
import { EntityView } from '../renderer/EntityView';
import { SelectionContours } from '../renderer/SelectionContours';
import { RasterUnderlays } from '../renderer/RasterUnderlays';
import { Canvas } from '../editor/Canvas';
import { hitOwners, normalHitStack, hitCandidateOrder, type HitCandidate } from '../editor/deepSelection';
import type { DxfViewport } from './types';
import { paperDocument, viewportVisibleIds, entityIntersectsViewport } from './selection';
import { modelViewportCamera, pointerModel, viewportScreenRect } from './camera';
interface SheetCandidate {candidate:HitCandidate;document:GeoDocument;viewportId?:string}
const ModelViewport = memo(function ModelViewport({ document, vp, paperCamera, size, active, editing, selected, panEnabled, dispatch }: {
    document: GeoDocument;
    vp: DxfViewport;
    paperCamera: GeoDocument['viewport'];
    size: ViewSize;
    active: boolean;
    editing: boolean;
    selected: readonly string[];
    panEnabled: boolean;
    dispatch: Dispatch<EditorAction>;
}) {
    const view = useMemo(() => viewportDocument(document, vp), [document, vp]), items = useMemo(() => renderItems(view), [view]), canvas = useMemo(() => items.filter(i => canvasEntity(i.entity)), [items]), svg = useMemo(() => items.filter(i => !canvasEntity(i.entity) && i.entity.type !== 'raster_underlay'), [items]), contours = useMemo(() => items.filter(i => selected.includes(i.entity.id)), [items, selected]);
    const r = viewportScreenRect(vp, paperCamera, size), visible = r.x + r.width > 0 && r.y + r.height > 0 && r.x < size.width && r.y < size.height, directCamera = useMemo(() => modelViewportCamera(vp, paperCamera, size), [vp, paperCamera, size]);
    // The source viewport extent is stable during outer-sheet motion. Keep one complete
    // surface, reuse it through SVG scaling, then refresh at resting resolution. At
    // extreme zoom use the bounded screen surface, preserving vector detail.
    const fullSurface = r.width <= 2048 && r.height <= 2048;
    const [resolution, setResolution] = useState(() => ({ width: Math.max(1, Math.ceil(Math.min(2048, r.width))), height: Math.max(1, Math.ceil(Math.min(2048, r.height))) }));
    useEffect(() => { if (!fullSurface)
        return; const timer = setTimeout(() => setResolution(previous => Math.abs(previous.width - r.width) < 1 && Math.abs(previous.height - r.height) < 1 ? previous : { width: Math.max(1, Math.ceil(r.width)), height: Math.max(1, Math.ceil(r.height)) }), 120); return () => clearTimeout(timer); }, [r.width, r.height, fullSurface]);
    const surfaceSize = fullSurface ? resolution : size, cachedCamera = useMemo(() => ({ center: vp.modelCenter, pixelsPerUnit: resolution.height / vp.viewHeight, rotationDeg: vp.twist }), [resolution, vp]), camera = fullSurface ? cachedCamera : directCamera;
    return <g data-testid="layout-viewport" data-viewport-id={vp.id} data-active={active} data-editing={editing}><svg x={r.x} y={r.y} width={r.width} height={r.height} overflow="hidden" onDoubleClick={e => { if (vp.unsupportedReason)
        return; e.stopPropagation(); dispatch({ type: 'viewport-editing', active: true, viewportId: vp.id }); }} onPointerDown={event => { if (event.button !== 0 || panEnabled)
        return; event.stopPropagation(); dispatch({ type: 'dxf-viewport', viewportId: vp.id }); if (vp.unsupportedReason)
        return; const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect(), world = pointerModel({ x: event.clientX - rect.left, y: event.clientY - rect.top }, vp, paperCamera, size), id = hitOwners(view, world, 7 / directCamera.pixelsPerUnit, directCamera.pixelsPerUnit).find(id => viewportVisibleIds(document, vp).has(id)); dispatch({ type: 'select', entityId: id ?? null, toggle: event.shiftKey }); }}>
 {vp.unsupportedReason ? <><rect width={r.width} height={r.height} fill="#eee"/><text x={8} y={20}>{vp.unsupportedReason}</text></> : visible && !editing ? <svg x={fullSurface ? 0 : -r.x} y={fullSurface ? 0 : -r.y} width={fullSurface ? r.width : size.width} height={fullSurface ? r.height : size.height} viewBox={`0 0 ${surfaceSize.width} ${surfaceSize.height}`} preserveAspectRatio="none"><RasterUnderlays document={view} viewport={camera} size={surfaceSize}/><CanvasStratum document={view} items={canvas} viewport={camera} size={surfaceSize}/>{svg.map(item => <EntityView key={item.entity.id} item={item} document={view} viewport={camera} size={surfaceSize} selected={selected.includes(item.entity.id)}/>)}{contours.length > 0 && <SelectionContours document={view} items={contours} markerIds={[]} viewport={camera} size={surfaceSize}/>}</svg> : null}
 </svg><rect x={r.x} y={r.y} width={r.width} height={r.height} fill="none" stroke={editing ? '#168453' : active ? '#277ec1' : '#aaa'} strokeWidth={active ? 2 : 1} pointerEvents="none"/></g>;
});
export function LayoutView({ state, dispatch, size, onResize, spaceHeld = false, onCursor, onSnap, onMeasure }: {
    onCursor: (point: ScreenPoint | null) => void;
    onSnap: (snap: SnapResult | null) => void;
    onMeasure: (text: string | null) => void;
    spaceHeld?: boolean;
    state: EditorState;
    dispatch: Dispatch<EditorAction>;
    size: ViewSize;
    onResize: (size: ViewSize) => void;
}) {
    const sheetCycle=useRef<{document:GeoDocument;camera:GeoDocument['viewport'];candidates:SheetCandidate[];index:number}|null>(null);
    const [cycleLabel,setCycleLabel]=useState<string|null>(null),[hover,setHover]=useState<SheetCandidate|null>(null),hoverFrame=useRef<number|null>(null);
    useEffect(()=>{if(!cycleLabel)return;const t=setTimeout(()=>setCycleLabel(null),2500);return()=>clearTimeout(t);},[cycleLabel]);
    useEffect(()=>()=>{if(hoverFrame.current!==null)cancelAnimationFrame(hoverFrame.current);},[]);
    const layout = activeLayout(state)!, ref = useRef<HTMLDivElement>(null), drag = useRef<{
        x: number;
        y: number;
    } | null>(null), frame = useRef<number | null>(null), latest = useRef(state.layoutViewport);
    const box = useMemo(() => bounds([...primitiveBounds(state.document, layout.paperPrimitives), ...layout.viewports.flatMap(v => [{ x: v.centerPaper.x - v.sizePaper.width / 2, y: v.centerPaper.y - v.sizePaper.height / 2 }, { x: v.centerPaper.x + v.sizePaper.width / 2, y: v.centerPaper.y + v.sizePaper.height / 2 }]), ...(layout.paper ? [{ x: 0, y: 0 }, { x: layout.paper.width, y: layout.paper.height }] : [])]), [layout, state.document]);
    const fitted = useMemo(() => fitToBounds(box, size, 50) ?? { center: { x: 0, y: 0 }, pixelsPerUnit: 1 }, [box, size]), paperCamera = state.layoutViewport ?? fitted;
    latest.current = paperCamera;
    const schedule = useCallback((camera: GeoDocument['viewport']) => { latest.current = camera; if (frame.current === null)
        frame.current = requestAnimationFrame(() => { frame.current = null; dispatch({ type: 'layout-camera', viewport: latest.current! }); }); }, [dispatch]);
    useEffect(() => { if (!state.layoutViewport)
        dispatch({ type: 'layout-camera', viewport: fitted }); }, [state.layoutViewport, fitted, dispatch]);
    useEffect(() => () => { if (frame.current !== null)
        cancelAnimationFrame(frame.current); }, []);
    useEffect(() => { const element = ref.current; if (!element)
        return; const wheel = (event: WheelEvent) => { if (event.target instanceof Element && event.target.closest('.drawing-canvas'))
        return; event.preventDefault(); const rect = element.getBoundingClientRect(), delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1); schedule(zoomAt(latest.current!, size, { x: event.clientX - rect.left, y: event.clientY - rect.top }, Math.exp(-Math.max(-250, Math.min(250, delta)) * .001))); }; element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel); }, [size, dispatch, schedule]);
    useEffect(() => { if (!ref.current)
        return; const observer = new ResizeObserver(([entry]) => { if (entry)
        onResize({ width: entry.contentRect.width, height: entry.contentRect.height }); }); observer.observe(ref.current); return () => observer.disconnect(); }, [onResize]);
    const document = useMemo(() => editorViewDocument({ document: state.transactionBefore ?? state.document, isolation: state.isolation }, state.transactionBefore ?? state.document, true), [state.document, state.transactionBefore, state.isolation]);
    const paper = useMemo(() => paperDocument(state.document, layout), [state.document, layout]), paperItems = useMemo(() => renderItems(paper).filter(i => !state.isolation || state.isolation.layerIds?.includes(i.layer.id) || state.isolation.entityIds.includes(i.entity.id)), [paper, state.isolation]), origin = worldToScreen({ x: box?.minX ?? 0, y: box?.maxY ?? 0 }, paperCamera, size), vp = activeDxfViewport(state), r = vp ? viewportScreenRect(vp, paperCamera, size) : null, camera = useMemo(() => vp ? modelViewportCamera(vp, paperCamera, size) : paperCamera, [vp, paperCamera, size]);
    const candidatesAt=(point:ScreenPoint):SheetCandidate[]=>{
      const visiblePaper=new Set(paperItems.map(i=>i.entity.id)),paperWorld=screenToWorld(point,paperCamera,size),hits:SheetCandidate[]=normalHitStack(paper,hitOwners(paper,paperWorld,7/paperCamera.pixelsPerUnit,paperCamera.pixelsPerUnit).filter(id=>visiblePaper.has(id)),paperWorld,5/paperCamera.pixelsPerUnit).map(candidate=>({candidate,document:paper}));
      for(const viewport of layout.viewports){if(viewport.unsupportedReason)continue;const rect=viewportScreenRect(viewport,paperCamera,size);if(point.x<rect.x||point.x>rect.x+rect.width||point.y<rect.y||point.y>rect.y+rect.height)continue;
        const view=viewportDocument(document,viewport),world=pointerModel(point,viewport,paperCamera,size),camera=modelViewportCamera(viewport,paperCamera,size),ids=hitOwners(view,world,7/camera.pixelsPerUnit,camera.pixelsPerUnit).filter(id=>entityIntersectsViewport(view,view.entities.find(e=>e.id===id)!,viewport));
        hits.push(...normalHitStack(view,ids,world,5/camera.pixelsPerUnit).map(candidate=>({candidate,document:view,viewportId:viewport.id})));
      }
      hits.sort((a,b)=>{const x=hitCandidateOrder(a.document,a.candidate),y=hitCandidateOrder(b.document,b.candidate);return x.rank-y.rank||x.area-y.area||a.candidate.ownerEntityId.localeCompare(b.candidate.ownerEntityId);});
      const seen=new Set<string>();return hits.filter(h=>{const key=h.candidate.ownerEntityId+JSON.stringify(h.candidate.selection);if(seen.has(key))return false;seen.add(key);return true;});
    };
    const selectCandidate=(hit:SheetCandidate)=>{if(hit.viewportId){dispatch({type:'dxf-viewport',viewportId:hit.viewportId});dispatch({type:'deep-select',candidate:hit.candidate,index:sheetCycle.current?.index??0,count:sheetCycle.current?.candidates.length??1});}else dispatch({type:'select-entities',entityIds:[hit.candidate.ownerEntityId]});};
    return <div className="canvas-container layout-container" ref={ref}><svg data-testid="layout-canvas" data-zoom={paperCamera.pixelsPerUnit} data-center-x={paperCamera.center.x} data-center-y={paperCamera.center.y} aria-label="Лист DXF" tabIndex={0} onPointerDownCapture={e=>{if(e.target instanceof Element&&e.target.closest('.drawing-canvas')||e.button!==0||state.tool==='pan'||spaceHeld)return;const rect=e.currentTarget.getBoundingClientRect(),point={x:e.clientX-rect.left,y:e.clientY-rect.top},candidates=candidatesAt(point);sheetCycle.current={document:state.document,camera:paperCamera,candidates,index:0};setCycleLabel(null);setHover(null);if(candidates.length){e.preventDefault();e.stopPropagation();e.currentTarget.focus({preventScroll:true});selectCandidate(candidates[0]!);}else dispatch({type:'select',entityId:null});}}
 onKeyDown={e=>{if(e.key==='Escape'){sheetCycle.current=null;setCycleLabel(null);}const c=sheetCycle.current;if(e.key==='Tab'&&state.tool==='select'&&!state.dimensionPick&&!state.connectorInteraction&&e.target===e.currentTarget&&!spaceHeld&&!state.viewportEditing&&!state.transactionBefore&&c?.document===state.document&&c.camera===paperCamera&&c.candidates.length>1&&(state.selectionId===c.candidates[c.index]!.candidate.ownerEntityId||state.selectedPaperIds.includes(c.candidates[c.index]!.candidate.ownerEntityId))){e.preventDefault();e.stopPropagation();c.index=(c.index+(e.shiftKey?-1:1)+c.candidates.length)%c.candidates.length;const h=c.candidates[c.index]!;selectCandidate(h);const entity=h.document.entities.find(x=>x.id===h.candidate.ownerEntityId)!;setCycleLabel(`${c.index+1} / ${c.candidates.length} · ${h.viewportId?'MODEL viewport':'Объект листа'} · ${entity.name} · Слой: ${h.document.layers.find(l=>l.id===entity.layerId)?.name}`);}}}
 onPointerLeave={()=>{if(hoverFrame.current!==null)cancelAnimationFrame(hoverFrame.current);hoverFrame.current=null;setHover(null);}} width={size.width} height={size.height} onPointerDown={e => { e.currentTarget.focus({ preventScroll: true }); if (e.button !== 0 || state.tool === 'pan' || spaceHeld) {
        drag.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
    } }} onPointerMove={e => { if (drag.current) {
        const delta = { x: e.clientX - drag.current.x, y: e.clientY - drag.current.y };
        drag.current = { x: e.clientX, y: e.clientY };
        setHover(null);schedule(panViewport(latest.current!, delta));
    }else if(!state.viewportEditing&&state.tool==='select'&&!spaceHeld){const rect=e.currentTarget.getBoundingClientRect(),point={x:e.clientX-rect.left,y:e.clientY-rect.top};if(hoverFrame.current!==null)cancelAnimationFrame(hoverFrame.current);hoverFrame.current=requestAnimationFrame(()=>{hoverFrame.current=null;const h=candidatesAt(point)[0]??null;setHover(previous=>previous?.candidate.ownerEntityId===h?.candidate.ownerEntityId&&previous?.viewportId===h?.viewportId?previous:h);});} }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}><rect width="100%" height="100%" fill="#dce1e5"/><rect x={origin.x} y={origin.y} width={Math.max(1, (box ? box.maxX - box.minX : 1) * paperCamera.pixelsPerUnit)} height={Math.max(1, (box ? box.maxY - box.minY : 1) * paperCamera.pixelsPerUnit)} fill="white"/>{layout.viewports.map(v => <ModelViewport key={v.id} document={document} vp={v} paperCamera={paperCamera} size={size} active={state.dxfViewportId === v.id} editing={state.viewportEditing && v.id === vp?.id} selected={state.selectedEntityIds} panEnabled={state.tool === 'pan' || spaceHeld} dispatch={dispatch}/>)}<CanvasStratum document={paper} items={paperItems} viewport={paperCamera} size={size}/>{state.selectedPaperIds.length > 0 && <SelectionContours document={paper} items={paperItems.filter(i => state.selectedPaperIds.includes(i.entity.id))} markerIds={[]} viewport={paperCamera} size={size}/>}{hover&&!state.selectedPaperIds.includes(hover.candidate.ownerEntityId)&&!state.selectedEntityIds.includes(hover.candidate.ownerEntityId)&&<g opacity={.35} data-testid="hover-contour">{hover.viewportId?(()=>{const v=layout.viewports.find(v=>v.id===hover.viewportId)!,rect=viewportScreenRect(v,paperCamera,size),camera=modelViewportCamera(v,paperCamera,size);return <svg x={rect.x} y={rect.y} width={rect.width} height={rect.height} overflow="hidden" pointerEvents="none"><g transform={`translate(${-rect.x} ${-rect.y})`}><SelectionContours document={hover.document} items={renderItems(hover.document).filter(i=>i.entity.id===hover.candidate.ownerEntityId)} viewport={camera} size={size} ownerMarkers={false}/></g></svg>;})():<SelectionContours document={paper} items={paperItems.filter(i=>i.entity.id===hover.candidate.ownerEntityId)} viewport={paperCamera} size={size} ownerMarkers={false}/>}</g>}</svg>
 {cycleLabel&&<div className="canvas-help" data-testid="selection-cycle" role="status">{cycleLabel}</div>}
 {state.viewportEditing && vp && r && <div className="active-viewport-editor" style={{ left: r.x, top: r.y, width: r.width, height: r.height }}><div style={{ position: 'absolute', left: -r.x, top: -r.y, width: size.width, height: size.height }}><Canvas state={state} dispatch={dispatch} size={size} onResize={() => { }} onCursor={onCursor} onSnap={onSnap} onMeasure={onMeasure} spaceHeld={spaceHeld} cameraOverride={camera} activeViewport={vp}/></div></div>}
 <div className="layout-note">{state.viewportEditing ? 'Редактирование модели' : 'Paper Space'} · {layout.name}{state.viewportEditing && vp ? ` · Viewport ${layout.viewports.findIndex(v => v.id === vp.id) + 1}` : ''}{state.viewportEditing && <button onClick={() => dispatch({ type: 'viewport-editing', active: false })}>Выйти в лист</button>}</div></div>;
}
