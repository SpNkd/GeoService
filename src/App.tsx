import type { TopologyPreview } from './renderer/TopologyOverlay';
import { SettingsCenter, type SettingsSection } from './components/SettingsCenter';
import { getPreferences, updatePreferences, usePreferences } from './preferences/store';
import { Dialog } from './components/Dialog';
import { activeEditorDialog } from './editor/dialogs';
import type { GeoDocument } from './domain/model';
import type { SemanticKnowledge } from './semantics/model';
import { EditorDock } from './components/EditorDock';
import { CloseButton } from './components/IconButton';
import { useEditorFocus, shortcutSuppressed } from './editor/focus';
import { ViewOrientation } from './components/ViewOrientation';
import { ResponsiveToolbar } from './components/ResponsiveToolbar';
import { DxfViews } from './components/DxfViews';
import { CurrentStyle } from './components/StyleEditor';
import { LayoutView } from './layouts/LayoutView';
import { assetRegistry } from './assets/registry';
import { newGeometryId } from './domain/geometryIntent';
import { activeLayout } from './layouts/context';
import { DocumentSearch } from './components/DocumentSearch';
import { CursorReadout, type CursorReadoutHandle } from './components/CursorReadout';
import { entityPoints, type HorizontalReference } from './domain/model';
import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { bounds, fitToBounds, gridStep, type ScreenPoint, type ViewSize } from './geometry';
import { formatMeasure } from './geometry/format';
import { visibleBounds } from './renderer/selectors';
import { SymbolPalette } from './components/SymbolPalette';
import { Canvas } from './editor/Canvas';
import { initialEditorState, isDocumentDirty } from './store/editor';
import { createSampleDocument } from './sample/document';
import { LayersPanel } from './components/LayersPanel';
import { PropertyInspector } from './components/PropertyInspector';
import { Icon } from './components/Icon';
import { ImportDialog } from './components/ImportDialog';
import { createNewDocument } from './domain/newDocument';
import { AutosaveError, getAutosaveInfo, loadAutosave, saveAutosave, type AutosaveInfo } from './persistence/autosave';
import { assertDocumentByteSize, deserializeDocument, serializeDocument } from './persistence/serialization';
import { applyCommand, applyCommandsAtomically } from './domain/commands';
import type { SnapResult } from './snapping';
import { applicationReducer, type ApplicationState } from './ai/workflow';
import { taskPreviews } from './ai/task';
import { AiPanel } from './components/AiPanel';
import type { PointLabelMode } from './store/editor';
import { resolveShortcut, shortcutNeedsWait, shortcutRegistry, shortcutMatchesPrefix } from './editor/shortcuts';

const TopologyDialog=lazy(()=>import('./components/TopologyDialog').then(m=>({default:m.TopologyDialog})));
const PdfImportDialog=lazy(()=>import('./components/PdfImportDialog').then(module=>({default:module.PdfImportDialog})));
const SemanticLearningDialog = lazy(() => import('./components/SemanticLearningDialog').then(module => ({ default: module.SemanticLearningDialog })));
const ImageVectorizationDialog = lazy(() => import('./components/ImageVectorizationDialog').then(module => ({ default: module.ImageVectorizationDialog })));
const DxfDialog = lazy(() => import('./components/DxfDialog').then(module => ({ default: module.DxfDialog })));
const GeoreferenceDialog = lazy(() => import('./components/GeoreferenceDialog').then(module => ({ default: module.GeoreferenceDialog })));
const storageFailureMessage = (failure: AutosaveError, startup = false) => {
  if (failure.code === 'CORRUPTED_AUTOSAVE') return failure.message;
  if (failure.code === 'VALIDATION_FAILED') return 'Локальный документ не прошёл проверку и не был восстановлен. Открыт демодокумент.';
  if (failure.code === 'INDEXEDDB_UNAVAILABLE') return startup
    ? 'Автосохранение не загружено: IndexedDB недоступен. Открыт демодокумент; продолжайте работу и сохраняйте JSON вручную.'
    : 'Автосохранение не выполнено: IndexedDB недоступен. Документ остаётся открыт. Сохраните JSON вручную.';
  if (failure.code === 'QUOTA_EXCEEDED') return startup
    ? 'Автосохранение не загружено: превышена квота IndexedDB. Открыт демодокумент; сохраните JSON вручную.'
    : 'Автосохранение не выполнено: превышена квота IndexedDB. Документ остаётся открыт. Сохраните JSON вручную.';
  return startup
    ? `Автосохранение не загружено (${failure.code}). Документ остаётся открыт; проверьте локальное хранилище.`
    : `Автосохранение не выполнено (${failure.code}). Документ остаётся открыт. Сохраните JSON вручную.`;
};

export default function App() {
  useEditorFocus();
  const preferences=usePreferences();
  const [settingsSection,setSettingsSection]=useState<SettingsSection|null>(null);
  const [startupDocument] = useState(createSampleDocument);
  const [application, dispatch] = useReducer(applicationReducer, startupDocument, (document): ApplicationState => ({ editor: {...initialEditorState(document),gridVisible:getPreferences().gridVisible,ortho:getPreferences().ortho,snapOptions:{...initialEditorState(document).snapOptions,enabled:getPreferences().snapEnabled,grid:getPreferences().snapGrid,gridStep:getPreferences().gridStep}}, ai: { status: 'idle' } }));
  const state = application.editor;
  const transformPanel=state.rotateInputOpen||state.moveInputOpen||!!state.selectionMove||!!state.selectionRotate;
  useEffect(()=>{if(transformPanel)updatePreferences({rightTab:'properties'});},[transformPanel]);
  const editorRef=useRef(state);editorRef.current=state;
  const [size,setSize]=useState<ViewSize>({width:1,height:1});
  const [hydrationDone,setHydrationDone]=useState(false);
  const [persistence,setPersistence]=useState<{state:'initializing'|'saving'|'saved'|'error';info?:AutosaveInfo;message?:string}>({state:'initializing'});
  const skipNextAutosave=useRef(false),autosaveRevision=useRef(0),autosaveTimer=useRef<number|null>(null),pendingAutosave=useRef(false);
  const sizeRef=useRef(size);sizeRef.current=size;
  const latestCommitted=useRef({document:state.document,dirty:false});
  const preferenceSync=useRef({preferences,gridVisible:state.gridVisible,ortho:state.ortho,snap:state.snapOptions,epoch:state.documentEpoch});
  useEffect(()=>{const previous=preferenceSync.current;preferenceSync.current={preferences,gridVisible:state.gridVisible,ortho:state.ortho,snap:state.snapOptions,epoch:state.documentEpoch};
    if(previous.preferences!==preferences||previous.epoch!==state.documentEpoch){if(preferences.gridVisible!==state.gridVisible)dispatch({type:'toggle-grid'});if(preferences.ortho!==state.ortho)dispatch({type:'toggle-ortho'});if(preferences.snapEnabled!==state.snapOptions.enabled||preferences.snapGrid!==state.snapOptions.grid||preferences.gridStep!==state.snapOptions.gridStep)dispatch({type:'snap-options',patch:{enabled:preferences.snapEnabled,grid:preferences.snapGrid,gridStep:preferences.gridStep}});}
    else if(previous.gridVisible!==state.gridVisible||previous.ortho!==state.ortho||previous.snap!==state.snapOptions)updatePreferences({gridVisible:state.gridVisible,ortho:state.ortho,snapEnabled:state.snapOptions.enabled,snapGrid:state.snapOptions.grid,gridStep:state.snapOptions.gridStep??1});
  },[preferences,state.gridVisible,state.ortho,state.snapOptions,state.documentEpoch]);
  useEffect(() => { let active=true; void loadAutosave().then(restored=>{if(!active)return;if(restored){skipNextAutosave.current=true;dispatch({type:'replace-document',document:restored.document,size:sizeRef.current,dirty:restored.dirty});setPersistence({state:'saved',info:{id:'current',persistenceVersion:1,schemaVersion:2,savedAt:restored.savedAt,approximateSerializedBytes:restored.approximateSerializedBytes,entityCount:restored.document.entities.length,dirty:restored.dirty,...(restored.document.sources?.[0]?.format?{sourceFormat:restored.document.sources[0].format}:{})}});}else setPersistence({state:'saved'});setHydrationDone(true);}).catch(error=>{if(!active)return;skipNextAutosave.current=true;const failure=error instanceof AutosaveError?error:new AutosaveError('OPEN_FAILED','IndexedDB не удалось открыть.');const message=storageFailureMessage(failure,true);setNotice(message);setPersistence({state:'error',message});setHydrationDone(true);});return()=>{active=false;};},[]);
  const aiTask = application.ai.status === 'preview' ? application.ai.plan : application.ai.status === 'applied' ? application.ai.results : null;
  const aiPreview = useMemo(() => aiTask?.resolution.status === 'ready' && !state.transactionBefore
    ? taskPreviews(aiTask) : [], [aiTask, state.transactionBefore]);
  const [notice, setNotice] = useState<string|null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [georeferenceOpen, setGeoreferenceOpen] = useState(false);
  const [pickingControl, setPickingControl] = useState<0 | 1 | null>(null);
  const [pickedControl, setPickedControl] = useState<{ slot: 0 | 1; id: string } | null>(null);
  const [referencePreview, setReferencePreview] = useState<HorizontalReference | null>(null);
  const closeGeoreference = useCallback(() => { setGeoreferenceOpen(false); setPickingControl(null); setPickedControl(null); setReferencePreview(null); }, []);
  const [dxfOpen,setDxfOpen]=useState(false);
  const [pdfFile,setPdfFile]=useState<File|null>(null);
  const [imageOpen,setImageOpen]=useState(false);
  const [topologyOpen,setTopologyOpen]=useState(false),[topologyPreview,setTopologyPreview]=useState<TopologyPreview|null>(null);
  const fitTopology=useCallback((points:{x:number;y:number}[])=>{const b=bounds(points);if(!b)return;const span=Math.max(b.maxX-b.minX,b.maxY-b.minY,2),margin=span*.1;const viewport=fitToBounds({minX:b.minX-margin,minY:b.minY-margin,maxX:b.maxX+margin,maxY:b.maxY+margin},sizeRef.current,85);if(viewport)dispatch({type:'viewport',viewport});},[]);
  const [semanticMode,setSemanticMode]=useState<'teach'|'manage'|null>(null);
  const [semanticPreview,setSemanticPreview]=useState<readonly string[]>([]);
  const openTeach=useCallback(()=>{setSpaceHeld(false);setSemanticMode('teach');},[]);
  const closeSemantic=useCallback(()=>setSemanticMode(null),[]);
  const applySemantic=useCallback((knowledge:SemanticKnowledge,expectedDocument:GeoDocument)=>{
    const current=editorRef.current;
    if(current.document!==expectedDocument||current.transactionBefore)throw new Error('Документ изменился. Откройте обучение заново.');
    applyCommand(current.document,{type:'set-semantic-knowledge',knowledge});
    dispatch({type:'execute',expectedDocument,command:{type:'set-semantic-knowledge',knowledge}});
    setSemanticMode(null);
  },[]);
  const selectSemantic=useCallback((ids:readonly string[])=>dispatch({type:'select-entities',entityIds:ids}),[]);
  const fitSemantic=useCallback((ids:readonly string[])=>dispatch({type:'fit-entities',entityIds:ids,size:sizeRef.current}),[]);
  const [importOpen, setImportOpen] = useState(false);
  const [snapStatus, setSnapStatus] = useState<SnapResult | null>(null);
  const [measurementStatus, setMeasurementStatus] = useState<string | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [sequenceHint, setSequenceHint] = useState('');
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const keyBuffer = useRef<string[]>([]), sequenceTimer = useRef<number | null>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const committed = state.transactionBefore ?? state.document;
  const committedDirty = useMemo(() => isDocumentDirty({ document: committed, savedFingerprint: state.savedFingerprint }), [committed, state.savedFingerprint]);
  const dirty = committedDirty || Boolean(state.transactionBefore && state.document !== committed);
  latestCommitted.current={document:committed,dirty:committedDirty};
  useEffect(()=>{if(!hydrationDone)return;if(skipNextAutosave.current){skipNextAutosave.current=false;return;}const revision=++autosaveRevision.current;pendingAutosave.current=true;setPersistence(previous=>previous.state==='error'?previous:{state:'saving'});if(autosaveTimer.current!==null)window.clearTimeout(autosaveTimer.current);autosaveTimer.current=window.setTimeout(()=>{autosaveTimer.current=null;void saveAutosave(committed,committedDirty).then(record=>{if(revision!==autosaveRevision.current||!record)return;pendingAutosave.current=false;void getAutosaveInfo().then(info=>{if(revision===autosaveRevision.current)setPersistence(info?{state:'saved',info}:{state:'saved'});}).catch(()=>{if(revision===autosaveRevision.current)setPersistence({state:'saved'});});}).catch(error=>{if(revision!==autosaveRevision.current)return;pendingAutosave.current=false;const failure=error instanceof AutosaveError?error:new AutosaveError('WRITE_FAILED','Ошибка IndexedDB.');const message=storageFailureMessage(failure);setPersistence({state:'error',message});setNotice(message);});},500);return()=>{if(autosaveTimer.current!==null){window.clearTimeout(autosaveTimer.current);autosaveTimer.current=null;}};},[committed,committedDirty,hydrationDone]);
  useEffect(()=>{if(!hydrationDone)return;const flush=()=>{if(!pendingAutosave.current)return;if(autosaveTimer.current!==null)window.clearTimeout(autosaveTimer.current);autosaveTimer.current=null;const current=latestCommitted.current;void saveAutosave(current.document,current.dirty);};window.addEventListener('pagehide',flush);return()=>window.removeEventListener('pagehide',flush);},[hydrationDone]);
  const cursorReadout=useRef<CursorReadoutHandle>(null);
  const setCursor=useCallback((point:ScreenPoint|null)=>cursorReadout.current?.update(point),[]);

  const fitted = useRef(false);
  const onResize = useCallback((next: ViewSize) => {
    setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    if (!fitted.current && next.width > 0 && next.height > 0) {
      const viewport = fitToBounds(visibleBounds(committed), next, 85);
      if (viewport) { dispatch({ type: 'viewport', viewport }); fitted.current = true; }
    }
  }, [committed]);
  const openCalibration = useCallback(() => { dispatch({type:'tool',tool:'select'}); setGeoreferenceOpen(true); },[dispatch]);
  const fit = useCallback(() => {
    dispatch({type:'fit-view',size});
  }, [dispatch, size]);
  const save = useCallback(() => {
    try {
      const text = serializeDocument(state.document);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `${state.document.metadata.title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'geoservice-document'}.json`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      dispatch({ type: 'mark-saved' }); setFileError(null); setNotice(state.document.entities.some(e=>e.type==='raster_underlay')?'JSON сохранён. JSON не включает файлы подложек.':'JSON сохранён.');
    } catch (error) { setFileError(error instanceof Error ? error.message : 'Не удалось сохранить JSON'); }
  }, [dispatch, state.document]);
  const startNew = useCallback(() => {
    if (dirty && !window.confirm('Создать новую схему? Изменения текущего документа не сохранены в JSON.')) return;
    dispatch({ type: 'replace-document', document: createNewDocument(), size }); setFileError(null); setNotice('Создана пустая схема.');
  }, [dirty, dispatch, size]);
  const runShortcut = useCallback((id: string) => {
    switch (id) {
      case 'connector': case 'select': case 'line': case 'point': case 'polyline': case 'polygon': case 'text': case 'dimension': case 'measure':
        dispatch({ type: 'tool', tool: id }); break;
      case 'rotate-selection': dispatch({type:'open-rotate-input'});break;
      case 'copy-style':if(state.selectionId)dispatch({type:'copy-style',entityId:state.selectionId});break;
      case 'rotate-symbol': dispatch({ type: 'rotate-symbol' }); break;
      case 'move': dispatch({ type: 'open-move-input' }); break;
      case 'ortho': dispatch({ type: 'toggle-ortho' }); break;
      case 'fit': case 'fit-extents': fit(); break;
      case 'save': save(); break;
      case 'open': openInput.current?.click(); break;
      case 'new': startNew(); break;
      case 'undo': dispatch({ type: 'undo' }); break;
      case 'redo': case 'redo-y': dispatch({ type: 'redo' }); break;
      case 'delete': {
        if(state.deepSelection){dispatch({type:'report-error',message:'Элемент является частью блока. Для перемещения выберите экземпляр блока.'});break;}
        const ids = state.selectedEntityIds.length ? state.selectedEntityIds : state.selectionId ? [state.selectionId] : [];
        const selected = new Set(ids);
        const deletions = state.document.entities.filter(entity => selected.has(entity.id) && !(entity.type === 'label' && selected.has(entity.targetId))).sort((a,b)=>Number(b.type==='connector')-Number(a.type==='connector')).map(entity => ({ type: 'delete-entity' as const, entityId: entity.id }));
        if (deletions.length) { dispatch({ type: 'execute-batch', commands: deletions }); dispatch({ type: 'select', entityId: null }); }
        break;
      }
      case 'cancel': {const transient=new Event('geoservice:escape',{cancelable:true});window.dispatchEvent(transient);if(transient.defaultPrevented)break;if(state.viewportEditing&&state.tool==='select'){dispatch({type:'viewport-editing',active:false});break;}}setSymbolsOpen(false); dispatch({ type: 'tool', tool: 'select' });
        if (state.dimensionPick) dispatch({ type: 'cancel-dimension-pick' });
        else if (!state.dimensionRetarget && !state.selectionMove && !state.selectionRotate && !state.marqueeActive) dispatch({ type: 'select', entityId: null });
        dispatch({ type: 'close-move-input' });dispatch({type:'close-rotate-input'}); break;
      case 'help': setShortcutsOpen(true); break;
    }
  }, [dispatch, fit, save, startNew, state]);
  useEffect(() => {
    const clearSequence = () => { keyBuffer.current = []; setSequenceHint(''); if (sequenceTimer.current !== null) window.clearTimeout(sequenceTimer.current); sequenceTimer.current = null; };
    const executeBuffer = () => { const match = resolveShortcut(keyBuffer.current); clearSequence(); if (match) runShortcut(match.id); };
    const suppressed=shortcutSuppressed;
    const keydown = (event: KeyboardEvent) => {
      if(activeEditorDialog()) return;
      if (!hydrationDone) { event.preventDefault(); return; }
      if (state.dimensionPick) {
        if (event.key === 'Escape') { event.preventDefault(); dispatch({ type: 'cancel-dimension-pick' }); return; }
        if (event.metaKey || event.ctrlKey) { if (['s', 'o', 'n', 'z', 'y'].includes(event.key.toLowerCase())) event.preventDefault(); return; }
        if (!suppressed(event.target,event.key)) event.preventDefault();
        return;
      }
      if(semanticMode){if(event.key==='Escape'){event.preventDefault();setSemanticMode(null);}if(event.metaKey||event.ctrlKey)event.preventDefault();return;}
      if(imageOpen){if(event.key==='Escape'){event.preventDefault();setImageOpen(false);}if(event.metaKey||event.ctrlKey)event.preventDefault();return;}
      if(dxfOpen){if(event.key==='Escape'){event.preventDefault();setDxfOpen(false);}if(event.metaKey||event.ctrlKey)event.preventDefault();return;}
      if (georeferenceOpen) {
        if (event.key === 'Escape') { event.preventDefault(); if (pickingControl !== null) setPickingControl(null); else closeGeoreference(); }
        if (event.metaKey || event.ctrlKey) { if (['s', 'o', 'n', 'z', 'y'].includes(event.key.toLowerCase())) event.preventDefault(); }
        return;
      }
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){event.preventDefault();updatePreferences({rightTab:'search'});requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('.document-search input')?.focus({preventScroll:true}));return;}
      if (suppressed(event.target,event.key)) { clearSequence(); return; }
      if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); setSpaceHeld(true); return; }
      if (event.metaKey || event.ctrlKey) {
        clearSequence(); const key = event.key.toLowerCase();
        if (key === 's' || key === 'o' || key === 'n' || key === 'z' || key === 'y') {
          event.preventDefault(); runShortcut(key === 's' ? 'save' : key === 'o' ? 'open' : key === 'n' ? 'new' : key === 'y' ? 'redo-y' : event.shiftKey ? 'redo' : 'undo');
        }
        return;
      }
      if (event.altKey || event.repeat) return;
      if (event.key === 'F8') { event.preventDefault(); clearSequence(); runShortcut('ortho'); return; }
      if (event.key === 'Escape' && state.viewAlign) {event.preventDefault();dispatch({type:'align-view',axis:null});return;}
      if (event.key === 'Escape') { clearSequence(); if (shortcutsOpen) setShortcutsOpen(false); else runShortcut('cancel'); event.preventDefault(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { clearSequence(); event.preventDefault(); runShortcut('delete'); return; }
      const key = event.key === '?' ? '?' : /^[a-z]$/i.test(event.key) && !event.shiftKey ? event.key.toUpperCase() : null;
      if (!key) return;
      // R rotates an insertion ghost immediately; RO applies to a document selection.
      if(key==='R'&&state.symbolPlacement){event.preventDefault();clearSequence();runShortcut('rotate-symbol');return;}
      const candidate = [...keyBuffer.current, key];
      if (!shortcutMatchesPrefix(candidate)) {
        const fallback = resolveShortcut(keyBuffer.current); clearSequence(); if (fallback) runShortcut(fallback.id);
        const fresh = [key]; if (shortcutMatchesPrefix(fresh)) { keyBuffer.current = fresh; setSequenceHint(key); sequenceTimer.current = window.setTimeout(executeBuffer, 900); }
        return;
      }
      // A shortcut may focus an input (M); suppress its default text insertion.
      event.preventDefault();
      keyBuffer.current = candidate; setSequenceHint(candidate.join(''));
      if (sequenceTimer.current !== null) window.clearTimeout(sequenceTimer.current);
      if (shortcutNeedsWait(candidate)) sequenceTimer.current = window.setTimeout(executeBuffer, 900); else executeBuffer();
    };
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') setSpaceHeld(false); };
    const blur = () => { setSpaceHeld(false); clearSequence(); };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); clearSequence(); };
  }, [semanticMode, state, shortcutsOpen, dirty, size, runShortcut, dxfOpen, imageOpen, georeferenceOpen, pickingControl, closeGeoreference, hydrationDone]);
  const fittedAiTask = useRef<string | null>(null);
  useEffect(() => {
    if (aiTask?.resolution.status !== 'ready' || aiTask.id === fittedAiTask.current || !aiTask.requiresConfirmation || size.width <= 1) return;
    const viewport = fitToBounds(bounds([...taskPreviews(aiTask).flatMap(preview => preview.result.geometry), ...aiTask.referenceEntityIds.flatMap(id=>{const entity=aiTask.basedOnDocument.entities.find(e=>e.id===id);return entity?entityPoints(entity,aiTask.basedOnDocument.vertices):[];})]), size, 100);
    if (viewport&&state.viewMode==='plan') { dispatch({ type: 'viewport', viewport }); fittedAiTask.current = aiTask.id; }
  }, [aiTask, size, state.viewMode]);
  const zoom = (factor: number) => dispatch({ type: 'zoom', size, anchor: { x: size.width / 2, y: size.height / 2 }, factor });
  const step = gridStep(state.viewport.pixelsPerUnit);
  const selected = state.document.entities.find(entity => entity.id === state.selectionId);
  if(!hydrationDone)return <main className="persistence-startup" role="status">Восстановление документа…</main>;
  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="./" aria-label="GeoService — начало"><span className="brand-mark"><Icon name="crosshair" size={24} /></span>Geo<span>Service</span></a>
      <div className="header-divider" /><div className="document-title"><strong>{state.document.metadata.title}{dirty && <span className="dirty-mark" aria-label="Есть несохранённые изменения"> *</span>}</strong><span>MODEL X / Y / Z · Survey E / N · абсолютная H</span></div>
      <span className="header-version">Редактор · 0.3</span>
    </header>
    <ResponsiveToolbar inert={georeferenceOpen || dxfOpen || imageOpen || topologyOpen || !!semanticMode}>
      <div className="tool-group document-tools">
        <button className="tool-button compact" aria-label="Новый документ" title="Новый документ · Ctrl/Cmd+N" onClick={startNew}><Icon name="new" size={16} />New</button>
        <button className="tool-button compact" aria-label="Открыть JSON" title="Открыть JSON · Ctrl/Cmd+O" onClick={() => openInput.current?.click()}><Icon name="open" size={16} />Open</button>
        <button className="tool-button compact" aria-label="Сохранить JSON" title="Сохранить JSON · Ctrl/Cmd+S" onClick={save}><Icon name="save" size={16} />Save</button>
        <button className="tool-button compact" onClick={()=>{dispatch({type:'tool',tool:'select'});setDxfOpen(true);}}><Icon name="import" size={16} />DXF</button>
        <label className="tool-button compact" role="button" tabIndex={0} aria-label="Добавить подложку" onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.currentTarget.querySelector('input')?.click();}}}>Подложка<input style={{display:'none'}} aria-label="Импорт подложки" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" disabled={!hydrationDone||!!state.layoutId||state.viewMode!=='plan'||!!state.transactionBefore} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){setSpaceHeld(false);setPdfFile(file);return;}const document=state.document,viewport=state.viewport,layer=document.layers.find(l=>l.id===state.currentLayerId);if(!layer||layer.locked||!layer.visible){setNotice('Выберите видимый незаблокированный слой.');return;}void assetRegistry.import(file).then(asset=>{const current=editorRef.current;if(current.document!==document||current.transactionBefore||current.layoutId||current.viewMode!=='plan'){assetRegistry.releaseBitmap(asset.assetId);throw new Error('Вид или документ изменился во время импорта. Повторите импорт.');}const id=newGeometryId('underlay'),width=size.width/viewport.pixelsPerUnit*.65;dispatch({type:'execute',expectedDocument:document,command:{type:'add-entity',vertices:[],entity:{id,type:'raster_underlay',name:asset.originalName,assetId:asset.assetId,assetMetadata:asset,layerId:layer.id,position:{x:viewport.center.x,y:viewport.center.y},width,height:width*asset.heightPx/asset.widthPx,rotationDeg:0,opacity:.6,locked:false}}});dispatch({type:'tool',tool:'select'});dispatch({type:'select',entityId:id});setNotice('Подложка добавлена. Угловые ручки сохраняют пропорции; Shift — свободный размер.');}).catch(error=>setNotice(error instanceof Error?error.message:String(error)));}}/></label>
        <button className="tool-button compact" aria-label="AI Assistant" onClick={()=>updatePreferences({rightTab:'ai'})}>AI</button>
        <button className="tool-button compact" aria-label="Векторизация изображения" disabled={!!state.transactionBefore || !!state.layoutId || state.viewMode!=='plan'} onClick={()=>{dispatch({type:'tool',tool:'select'});setImageOpen(true);}}>Векторизация изображения</button>
        <button className="tool-button compact import-button" aria-label="Импорт координат" onClick={() => { dispatch({ type: 'tool', tool: 'select' }); setImportOpen(true); }}><Icon name="import" size={16} />Import</button>
      </div><div className="toolbar-divider" />
      <div className="tool-group">
        {([['select', 'cursor', 'Выбор'], ['point', 'point', 'Точка'], ['line', 'line', 'Линия'], ['connector', 'line', 'Соединение'], ['polyline', 'line', 'Полилиния'], ['polygon', 'polygon', 'Полигон'], ['text', 'text', 'Текст'], ['dimension', 'dimension', 'Размер'], ['measure', 'measure', 'Измерение'], ['pan', 'hand', 'Панорама']] as const).map(([tool, icon, label]) => {
          const shortcutId = tool;
          const shortcut = shortcutRegistry.find(entry => entry.id === shortcutId)?.label;
          return <button key={tool} className={`tool-button compact ${state.tool === tool ? 'active' : ''}`} aria-label={`Инструмент: ${label}`} aria-pressed={state.tool === tool} title={`${label}${shortcut ? ` · ${shortcut}` : ''}`} onClick={() => dispatch({ type: 'tool', tool })}><Icon name={icon} size={16} />{label}</button>;
        })}
      </div><div className="toolbar-divider" />
      <button className="tool-button compact" aria-label="Повернуть выделенное" title="Точный поворот · RO" disabled={!!state.transactionBefore} onClick={()=>dispatch({type:'open-rotate-input'})}><Icon name="rotate" size={16} />Rotate…</button>
      <button className="tool-button compact" aria-label="Переместить выбор" title="Переместить выбор · M" disabled={!state.selectedEntityIds.length || Boolean(state.transactionBefore)} onClick={() => dispatch({ type: 'open-move-input' })}><Icon name="move" size={16} />Move…</button>
      <button className="tool-button compact" aria-label="Отменить" title="Отменить · ⌘/Ctrl+Z" disabled={!state.past.length || Boolean(state.transactionBefore)} onClick={() => dispatch({ type: 'undo' })}><Icon name="undo" size={16} />Undo</button>
      <button className="tool-button compact" aria-label="Повторить" title="Повторить · ⌘/Ctrl+Shift+Z" disabled={!state.future.length || Boolean(state.transactionBefore)} onClick={() => dispatch({ type: 'redo' })}><Icon name="redo" size={16} />Redo</button>

      <button className="tool-button compact" aria-label="Настройки" onClick={()=>{setSpaceHeld(false);setSettingsSection('general');}}>Настройки ⚙</button>
      <button className="tool-button compact" aria-label="Научить GeoService" disabled={!state.selectedEntityIds.length||!!state.deepSelection||!!state.selectedPaperIds.length||!!state.transactionBefore} onClick={openTeach}>Научить GeoService</button>
      <button className="tool-button compact" aria-label="Восстановить связи" disabled={!!state.transactionBefore||!!state.layoutId||state.viewMode!=='plan'} onClick={()=>{setSpaceHeld(false);dispatch({type:'tool',tool:'select'});setTopologyOpen(true);}}>Восстановить связи</button>
      <button className="tool-button compact" aria-label="Смысл / категории" disabled={!!state.transactionBefore} onClick={()=>{setSpaceHeld(false);setSemanticMode('manage');}}>Смысл / категории</button>
      <button className="icon-button" aria-label="Горячие клавиши" title="Горячие клавиши · ?" onClick={() => setShortcutsOpen(true)}>?</button>

      <button className="tool-button compact" aria-pressed={symbolsOpen || state.tool === 'symbol'} onClick={() => setSymbolsOpen(!symbolsOpen)}><Icon name="symbol" size={16} />Символы</button>
      <span className="toolbar-context">Слой: {state.document.layers.find(layer => layer.id === state.currentLayerId)?.name ?? '—'} · {state.document.coordinateSystem.name ?? 'Система координат'} · м</span>
    </ResponsiveToolbar>
    <div inert={georeferenceOpen || dxfOpen || imageOpen || topologyOpen || !!semanticMode} className="survey-controls" aria-label="Привязки и подписи">
      <button className={`tool-button compact ${state.snapOptions.enabled ? 'active' : ''}`} aria-label="Привязки" aria-pressed={state.snapOptions.enabled} onClick={() => dispatch({ type: 'snap-options', patch: { enabled: !state.snapOptions.enabled } })}>SNAP {state.snapOptions.enabled ? 'ON' : 'OFF'}</button>
      <details className="survey-settings" data-popup><summary>Типы привязок</summary><div>
        {(['vertex', 'midpoint', 'grid'] as const).map(type => <label key={type}><input type="checkbox" checked={state.snapOptions[type]} onChange={event => dispatch({ type: 'snap-options', patch: { [type]: event.target.checked } })} />{type === 'vertex' ? 'Vertex' : type === 'midpoint' ? 'Midpoint' : 'Grid'}</label>)}
        <small>Допуск 10 px · скрытые слои исключены</small>
      </div></details>
      <label>Сетка <input className="snap-step-input" aria-label="Шаг привязки сетки" type="number" min="0.000001" step="any" list="snap-steps" value={state.snapOptions.gridStep ?? 1} onChange={event => { const gridStep = Number(event.target.value); if (gridStep > 0 && Number.isFinite(gridStep)) dispatch({ type: 'snap-options', patch: { gridStep } }); }} /> м</label><datalist id="snap-steps">{[0.1, 0.25, 0.5, 1, 2, 5, 10, 20].map(step => <option key={step} value={step} />)}</datalist>
      <button className={`tool-button compact ${state.ortho ? 'active' : ''}`} aria-label="Ортогональный режим" aria-pressed={state.ortho} title="ORTHO · F8" onClick={() => dispatch({ type: 'toggle-ortho' })}>ORTHO {state.ortho ? 'ON' : 'OFF'}</button>
      <ViewOrientation state={state} dispatch={dispatch}/><CurrentStyle state={state} dispatch={dispatch}/>
      {state.document.dxfLayouts?.length? <label className="view-select">DXF: <select aria-label="DXF контекст" value={state.layoutId??'model'} onChange={e=>dispatch({type:'dxf-layout',layoutId:e.target.value==='model'?null:e.target.value,size})}><option value="model">Model</option>{state.document.dxfLayouts.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>:null}
      {activeLayout(state)&&<label>Viewport: <select aria-label="DXF viewport" value={state.dxfViewportId??''} onChange={e=>dispatch({type:'dxf-viewport',viewportId:e.target.value})}>{activeLayout(state)!.viewports.map(v=><option key={v.id} value={v.id}>{v.number}{v.unsupportedReason?' · ограничение':''}</option>)}</select></label>}
      <label className="view-select">Вид: <select aria-label="Вид" disabled={!!state.layoutId} title={state.layoutId?'Листы DXF отображаются в плане; для аксонометрии выберите Model':undefined} value={state.viewMode==='plan'?'plan':state.projection.orientation} onChange={event=>dispatch({type:'view-mode',mode:event.target.value==='plan'?'plan':'axonometric',...(event.target.value==='plan'?{}:{orientation:event.target.value as 'NE'|'NW'|'SE'|'SW'}),size})}><option value="plan">План</option><option value="NE">Аксонометрия СВ</option><option value="NW">Аксонометрия СЗ</option><option value="SE">Аксонометрия ЮВ</option><option value="SW">Аксонометрия ЮЗ</option></select></label><label>Координаты <select aria-label="Отображение координат" value={state.coordinateDisplay} onChange={event => dispatch({ type: 'coordinate-display', mode: event.target.value as 'model' | 'survey' })}><option value="model">Model · X/Y</option><option value="survey">Survey · E/N</option></select></label>
      <label>Подписи точек <select aria-label="Подписи точек" value={state.pointLabelMode} onChange={event => dispatch({ type: 'point-labels', mode: event.target.value as PointLabelMode })}><option value="name">Имя</option><option value="name-z">Имя + Z</option><option value="z">Только Z</option></select></label>
      <label><input type="checkbox" checked={state.showLineLengths} onChange={() => dispatch({ type: 'toggle-line-lengths' })} />Длины линий</label>
    </div>
    <main className="workspace" inert={imageOpen || topologyOpen || !!semanticMode}><EditorDock side="left"><DxfViews state={state} dispatch={dispatch} size={size}/><LayersPanel inert={georeferenceOpen || dxfOpen || imageOpen || topologyOpen || !!semanticMode} state={state} dispatch={dispatch} onCalibrate={openCalibration} size={size} /></EditorDock><div className="drawing-area">
      {state.layoutId?<LayoutView key={state.documentEpoch} state={state} dispatch={dispatch} size={size} onResize={onResize} spaceHeld={spaceHeld} onCursor={setCursor} onSnap={setSnapStatus} onMeasure={setMeasurementStatus} documentHighlightIds={semanticMode?semanticPreview:undefined}/>:<Canvas key={state.documentEpoch} state={state} dispatch={dispatch} size={size} onResize={onResize} onCursor={setCursor} onSnap={setSnapStatus} onMeasure={setMeasurementStatus} disabled={!!semanticMode || imageOpen || topologyOpen || dxfOpen || importOpen || (georeferenceOpen && pickingControl === null)} topologyPreview={topologyPreview} referencePreview={referencePreview ?? undefined} onPickPoint={pickingControl === null ? undefined : id => { setPickedControl({ slot: pickingControl, id }); setPickingControl(null); }} spaceHeld={spaceHeld} sequenceHint={sequenceHint} aiPreview={aiPreview} processPreview={application.ai.status==='process-preview'&&!state.transactionBefore?application.ai.plan:undefined} documentHighlightIds={semanticMode?semanticPreview:application.ai.status==='document-preview'&&!state.transactionBefore?application.ai.plan.matchedEntityIds:application.ai.status==='document-applied'?application.ai.resultPlan?.matchedEntityIds:undefined} aiReferenceIds={application.ai.status==='preview'?application.ai.plan.referenceEntityIds:undefined} />}
      {state.isolation&&<div className="isolation-banner" role="status">Изоляция: {state.isolation.label} <button type="button" onClick={()=>dispatch({type:'exit-isolation'})}>Выйти из изоляции</button></div>}
      <div className="zoom-controls"><button className="icon-button" aria-label="Увеличить" onClick={() => zoom(1.25)}><Icon name="plus" /></button><button className="icon-button" aria-label="Уменьшить" onClick={() => zoom(0.8)}><Icon name="minus" /></button><button className="icon-button" aria-label="Вписать схему в вид" title="Вписать · F / ZE" onClick={fit}><Icon name="fit" /></button><button className="icon-button" aria-label="Сетка" disabled={!!state.layoutId&&!state.viewportEditing} aria-pressed={state.gridVisible&&(!state.layoutId||state.viewportEditing)} title={state.layoutId&&!state.viewportEditing?'Сетка MODEL доступна в активном viewport':'Сетка'} onClick={()=>dispatch({type:'toggle-grid'})}><Icon name="grid"/></button></div>
      {!state.layoutId&&<div className="scale-bar" aria-label={`Масштабная линейка ${step} метров`}><span>{formatMeasure(step, step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0)} м</span><div style={{ width: step * state.viewport.pixelsPerUnit }} /></div>}
    </div><EditorDock side="right"><div inert={georeferenceOpen || dxfOpen || imageOpen || topologyOpen || !!semanticMode} className="right-dock-panels"><div className="scope-summary" hidden={!state.selectionScopeLabel&&!state.selectedPaperIds.length}>{state.selectionScopeLabel} · MODEL: {state.selectedEntityIds.length} · Paper Space только чтение: {state.selectedPaperIds.length}</div><PropertyInspector onTeach={openTeach} state={state} dispatch={dispatch} size={size} /><DocumentSearch state={state} document={state.document} dispatch={dispatch} size={size} transactionActive={Boolean(state.transactionBefore)}/><AiPanel onSettings={()=>setSettingsSection('ai')} size={size} ai={application.ai} dispatch={dispatch} transactionActive={Boolean(state.transactionBefore)} documentEpoch={state.documentEpoch} /></div></EditorDock></main>
    <footer className="status-bar"><span className={`status-ready ${state.error ? 'status-error' : ''}`} data-testid="editor-error"><span className={state.error ? 'error-dot' : 'live-dot'} />{state.error ?? (state.dimensionPick ? `Выберите существующую вершину для ${state.dimensionPick.endpoint === 'start' ? 'начала' : 'конца'} размера · Esc отмена` : null) ?? (sequenceHint ? `${sequenceHint}…` : measurementStatus ?? (snapStatus ? `SNAP: ${snapStatus.metadata.label}` : null)) ?? (state.selectionMove ? `Перемещение: ΔX ${formatMeasure(state.selectionMove.delta.x)} · ΔY ${formatMeasure(state.selectionMove.delta.y)} м${state.selectionMove.resolved.affectedEntityIds.length ? ` · затронет ${state.selectionMove.resolved.affectedEntityIds.length} связанных объектов` : ''}` : state.selectedEntityIds.length > 1 ? `Выбрано: ${state.selectedEntityIds.length} объектов` : selected ? `Выбрано: ${selected.name}` : 'Готов к работе')}</span>
      <CursorReadout ref={cursorReadout} state={state} size={size}/>
      <span className="status-grid">Привязка: {state.snapOptions.gridStep ?? 1} м · ORTHO {state.ortho ? 'ON' : 'OFF'}</span><span className={`persistence-status${persistence.state==='error'?' error':''}`} data-testid="persistence-status" role="status" title={persistence.info?`${persistence.info.entityCount} объектов · ${(persistence.info.approximateSerializedBytes/1024**2).toFixed(2)} MiB · ${persistence.info.savedAt}`:persistence.message}>{persistence.state==='saving'?'Сохранение…':persistence.state==='error'?'Автосохранение не выполнено':'Сохранено локально'}</span><span className="status-zoom" data-testid="zoom-label">{state.layoutId?'Paper Space':`${formatMeasure(state.viewport.pixelsPerUnit)} px/м`}</span>
    </footer>
    <input ref={openInput} type="file" accept=".json,application/json" aria-label="Файл GeoDocument" hidden onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      try {
        assertDocumentByteSize(file.size);
        const loaded = deserializeDocument(await file.text());
        if (dirty && !window.confirm('Открыть другой документ? Текущие изменения не сохранены в JSON.')) return;
        dispatch({ type: 'replace-document', document: loaded, size }); setFileError(null); setNotice('Документ открыт.');
      } catch (error) { setFileError(error instanceof Error ? error.message : 'Не удалось прочитать JSON'); }
    }} />
    {(fileError || notice) && <div className={`document-notice ${fileError ? 'error' : ''}`} role={fileError ? 'alert' : 'status'}><span>{fileError ?? notice}</span><CloseButton label="Закрыть сообщение" onClick={() => { setFileError(null); setNotice(null); }}/></div>}
    {pdfFile&&<Suspense fallback={<Dialog title="Импорт PDF" onClose={()=>setPdfFile(null)}><p>Загрузка…</p></Dialog>}><PdfImportDialog file={pdfFile} document={state.document} layerId={state.currentLayerId} onClose={()=>setPdfFile(null)} onApply={(commands,expectedDocument,rasterId)=>{const current=editorRef.current;if(current.document!==expectedDocument||current.transactionBefore||current.layoutId||current.viewMode!=='plan')throw new Error('Документ или вид изменился. Повторите импорт.');applyCommandsAtomically(expectedDocument,commands);dispatch({type:'execute-batch',commands,expectedDocument});setPdfFile(null);if(rasterId){dispatch({type:'select',entityId:rasterId});setImageOpen(true);}setNotice('PDF импортирован локально. Один шаг Undo.');}}/></Suspense>}
    {settingsSection&&<SettingsCenter ai={application.ai} section={settingsSection} onClose={()=>setSettingsSection(null)}/>}
    {imageOpen && <Suspense fallback={<Dialog title="Векторизация изображения" onClose={()=>setImageOpen(false)}><p>Загрузка…</p></Dialog>}><ImageVectorizationDialog document={state.document} currentLayerId={state.currentLayerId} selectionId={state.selectionId} onClose={()=>setImageOpen(false)} onApply={(commands,expectedDocument)=>{const current=editorRef.current;if(current.document!==expectedDocument||current.transactionBefore||current.layoutId||current.viewMode!=='plan')throw new Error('Документ или вид изменился. Откройте обработку заново.');applyCommandsAtomically(expectedDocument,commands);dispatch({type:'execute-batch',commands,expectedDocument});setImageOpen(false);setNotice(`Векторизация применена: ${commands.filter(c=>c.type==='add-entity').length} объектов. Один шаг Undo; подложка сохранена.`);}} /></Suspense>}
    {dxfOpen && <Suspense fallback={<Dialog title="Открыть DXF" onClose={()=>setDxfOpen(false)}><p>Загрузка…</p></Dialog>}><DxfDialog onClose={()=>setDxfOpen(false)} onApply={plan=>{if(dirty&&!window.confirm('Открыть другой документ? Текущие изменения не сохранены в JSON.'))return;dispatch({type:'replace-document',document:plan.document,size,currentLayerId:plan.currentLayerId});setDxfOpen(false);setFileError(null);setNotice(`DXF открыт: ${plan.document.entities.length} объектов, ${plan.report.warnings.length} предупреждений.`);}} /></Suspense>}
    {symbolsOpen && <SymbolPalette onClose={() => setSymbolsOpen(false)} onChoose={(libraryId, symbolId) => { dispatch({ type: 'choose-symbol', libraryId, symbolId }); setSymbolsOpen(false); }} />}
    {semanticMode&&<Suspense fallback={<Dialog title="Научить GeoService" onClose={closeSemantic}><p>Загрузка…</p></Dialog>}><SemanticLearningDialog document={state.document} selectionIds={state.selectedEntityIds} mode={semanticMode} onClose={closeSemantic} onApply={applySemantic} onPreview={setSemanticPreview} onSelect={selectSemantic} onFit={fitSemantic}/></Suspense>}
    {topologyOpen&&<Suspense fallback={<Dialog title="Восстановить связи" onClose={()=>setTopologyOpen(false)}><p>Загрузка…</p></Dialog>}><TopologyDialog document={state.document} selectionIds={state.selectedEntityIds} layerId={state.currentLayerId} onPreview={setTopologyPreview} onFit={fitTopology} onClose={()=>setTopologyOpen(false)} onApply={(commands,expectedDocument)=>{const current=editorRef.current;if(current.document!==expectedDocument||current.transactionBefore||current.layoutId||current.viewMode!=='plan')throw new Error('Документ или вид изменился. Откройте восстановление заново.');applyCommandsAtomically(expectedDocument,commands);dispatch({type:'execute-batch',commands,expectedDocument});setTopologyOpen(false);setNotice(`Восстановлено связей: ${commands.filter(c=>c.type==='add-entity').length}. Один шаг Undo.`);}}/></Suspense>}
    {shortcutsOpen && <Dialog title="Keyboard shortcuts" size="lg" onClose={()=>setShortcutsOpen(false)}>{(['Tools', 'Navigation', 'File', 'Edit'] as const).map(group => <div key={group}><h3>{group}</h3><dl>{shortcutRegistry.filter(entry => entry.group === group).map(entry => <Fragment key={entry.id}><dt>{entry.description}</dt><dd>{entry.label}</dd></Fragment>)}</dl></div>)}</Dialog>}
    {georeferenceOpen && <Suspense fallback={<Dialog title="Горизонтальная привязка" onClose={closeGeoreference}><p>Загрузка…</p></Dialog>}><GeoreferenceDialog document={state.document} picking={pickingControl} picked={pickedControl} onPick={setPickingControl} onPreview={setReferencePreview} onClose={closeGeoreference} onApply={command => { dispatch({ type: 'execute', command }); closeGeoreference(); }} /></Suspense>}
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
