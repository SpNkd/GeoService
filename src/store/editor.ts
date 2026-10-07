import { activeLayout } from '../layouts/context';
import {activeDxfViewport} from '../layouts/context';
import {modelViewportCamera,navigationFromCamera,type ViewportNavigation} from '../layouts/camera';
import { viewRotation } from '../view/projection';
import { selectionPaperBounds, paperDocument, paperEntityId, resolveSelectionScope, type SelectionScope } from '../layouts/selection';
import { projectSelectionTransform, resolveSelectionTransform, selectionPivot, AXON_ROTATE_MESSAGE } from '../domain/selectionTransform';
import { styleKeysFor, capturedStyle, type StyleOverrides } from '../styles/model';
import { projectedSceneBounds, projectionOrigin } from '../view/geometry';
import type { AxonOrientation, ProjectionContext, RenderCamera } from '../view/projection';
import { connectorVisible, portTargetError } from '../connectors/model';
import type { ConnectorEndpoint } from '../domain/model';
import { NESTED_MOVE_MESSAGE, resolveDeepSelection, type DeepSelection } from '../editor/deepSelection';
import { requireSymbol } from '../symbols/registry';
import { nextSymbolRotation } from '../symbols/types';
import { layerBounds } from '../geometry/entityBounds';
import type { GeoDocument, Viewport } from '../domain/model';
import { applyCommand, applyCommandsAtomically, isLayerLocked, type DocumentCommand } from '../domain/commands';
import { fitRotatedBounds, fitToBounds, panViewport, zoomAt, type ScreenPoint, type ViewSize } from '../geometry';
import { selectionBounds, visibleBounds, renderItems } from '../renderer/selectors';
import { deserializeDocument, documentFingerprint } from '../persistence/serialization';
import { commandFromOrderedPoints } from '../domain/geometryIntent';
import { validateDocument } from '../persistence/documentSchema';
import { newGeometryId } from '../domain/geometryIntent';
import { DEFAULT_SNAP_OPTIONS, type SnapOptions } from '../snapping';

import { resolveSelectionMove, projectSelectionMove, type ResolvedSelectionMove, type Translation } from '../domain/selectionMove';

export type EditorTool = 'select' | 'pan' | 'point' | 'line' | 'polyline' | 'polygon' | 'text' | 'dimension' | 'measure' | 'symbol' | 'connector';
export type PointLabelMode = 'name' | 'name-z' | 'z';
export type ConnectorInteraction = {kind:'create';start:ConnectorEndpoint;target:ConnectorEndpoint|null} | {kind:'retarget';entityId:string;endpoint:'start'|'end';target:ConnectorEndpoint|null};
export const AXON_EDIT_MESSAGE='Перемещение в аксонометрии пока выполняется через точные координаты X/Y/Z. Для свободного перемещения используйте вид План.';
export interface EditorState {
  viewportEditing:boolean;
  viewportNavigation?:ViewportNavigation|null;
  selectedPaperIds:string[];
  selectionScopeLabel:string|null;
  viewAlign: {axis:'horizontal'|'vertical';first:import('../domain/model').WorldPoint|null}|null;
  currentStyle:StyleOverrides;
  styleClipboard:StyleOverrides|null;
  rotateInputOpen:boolean;
  rotateInputFocusEpoch:number;
  selectionRotate:{resolved:ResolvedSelectionMove;pivot:import('../domain/model').WorldPoint;angleDeg:number;previewDocument:GeoDocument}|null;
  layoutViewport:Viewport|null;
  layoutId:string|null;
  dxfViewportId:string|null;
  modelViewMode:'plan'|'axonometric';
  layerPanelFilter:import('../layouts/layers').LayerFilter;
  viewMode:'plan'|'axonometric';
  projection:ProjectionContext;
  planViewport:Viewport|null;
  axonViewport:Viewport|null;
  connectorInteraction:ConnectorInteraction|null;
  isolation: {entityIds:readonly string[];layerIds?:readonly string[];label:string} | null;
  deepSelection: DeepSelection | null;
  hitStackStatus: {index:number;count:number} | null;
  symbolPlacement: { libraryId: string; symbolId: string; rotationDeg: number } | null;
  marqueeActive: boolean;
  moveInputOpen: boolean;
  moveInputFocusEpoch: number;
  selectionMove: { resolved: ResolvedSelectionMove; delta: Translation; previewDocument: GeoDocument } | null;
  coordinateDisplay: 'model' | 'survey';
  dimensionRetarget: { dimensionId: string; endpoint: 'start' | 'end'; vertexId: string | null } | null;
  dimensionPick: { dimensionId: string; endpoint: 'start' | 'end' } | null;
  document: GeoDocument; viewport: Viewport; selectionId: string | null; selectedEntityIds: string[]; selectedLayerId: string | null; currentLayerId: string; tool: EditorTool; gridVisible: boolean;
  past: GeoDocument[]; future: GeoDocument[]; transactionBefore: GeoDocument | null; error: string | null;
  savedFingerprint: string; documentEpoch: number;
  orderedPointIds: string[]; snapOptions: SnapOptions; pointLabelMode: PointLabelMode; showLineLengths: boolean; ortho: boolean;
}
export const editorCamera=(state:Pick<EditorState,'viewport'|'viewMode'|'projection'>):RenderCamera=>state.viewMode==='plan'?state.viewport:{...state.viewport,projection:state.projection};
export type EditorAction =
  | {type:'selection-scope';scope:SelectionScope}
  | {type:'viewport-editing';active:boolean;viewportId?:string}
  | {type:'view-angle';angle:number}
  | {type:'align-view';axis:'horizontal'|'vertical'|null}
  | {type:'align-view-point';point:import('../domain/model').WorldPoint}
  | {type:'current-style';patch:StyleOverrides}
  | {type:'apply-selection-style';patch:StyleOverrides}
  | {type:'copy-style';entityId:string}
  | {type:'paste-style'}
  | {type:'open-rotate-input'} | {type:'close-rotate-input'}
  | {type:'begin-selection-rotate';entityIds:string[]}
  | {type:'preview-selection-rotate';angleDeg:number}
  | {type:'finish-selection-rotate'}
  | {type:'fit-dxf-viewport';layoutId:string;viewportId:string;size:ViewSize}
  | {type:'layout-camera';viewport:Viewport}
  | {type:'dxf-layout';layoutId:string|null;size:ViewSize}
  | {type:'dxf-viewport';viewportId:string}
  | {type:'layer-panel-filter';filter:import('../layouts/layers').LayerFilter}
  | {type:'isolate-layers';layerIds:readonly string[];label:string}
  | {type:'view-mode';mode:'plan'|'axonometric';orientation?:AxonOrientation;size:ViewSize}
  | {type:'fit-view';size:ViewSize}
  | {type:'pick-connector-port';target:ConnectorEndpoint}
  | {type:'begin-connector-retarget';entityId:string;endpoint:'start'|'end'}
  | {type:'preview-connector-port';target:ConnectorEndpoint|null}
  | {type:'finish-connector-retarget';target:ConnectorEndpoint|null}
  | {type:'cancel-connector'}
  | {type:'select-entities';entityIds:readonly string[]}
  | {type:'fit-entities';entityIds:readonly string[];size:ViewSize}
  | {type:'isolate-entities';entityIds:readonly string[];label:string}
  | {type:'exit-isolation'}
  | { type: 'deep-select'; candidate: {ownerEntityId:string;selection:DeepSelection|null}; index:number;count:number }
  | { type: 'choose-symbol'; libraryId: string; symbolId: string }
  | { type: 'rotate-symbol' }
  | { type: 'fit-layer'; layerId: string; size: ViewSize }
  | { type: 'begin-marquee' } | { type: 'cancel-marquee' }
  | { type: 'finish-marquee'; entityIds: string[]; mode: 'replace' | 'add' | 'toggle' }
  | { type: 'open-move-input' } | { type: 'close-move-input' }
  | { type: 'begin-selection-move'; entityIds: string[] }
  | { type: 'preview-selection-move'; delta: Translation }
  | { type: 'finish-selection-move' }
  | { type: 'coordinate-display'; mode: 'model' | 'survey' }
  | { type: 'begin-dimension-retarget'; dimensionId: string; endpoint: 'start' | 'end' }
  | { type: 'preview-dimension-retarget'; vertexId: string | null }
  | { type: 'finish-dimension-retarget'; vertexId: string | null }
  | { type: 'begin-dimension-pick'; dimensionId: string; endpoint: 'start' | 'end' }
  | { type: 'cancel-dimension-pick' }
  | { type: 'finish-dimension-pick'; vertexId: string }
  | { type: 'load-json'; text: string; size: ViewSize }
  | { type: 'replace-document'; document: GeoDocument; size: ViewSize; currentLayerId?: string; dirty?: boolean }
  | { type: 'mark-saved' }
  | { type: 'execute'; command: DocumentCommand; expectedDocument?: GeoDocument }
  | { type: 'execute-batch'; commands: readonly DocumentCommand[]; expectedDocument?: GeoDocument }
  | { type: 'transient'; command: DocumentCommand }
  | { type: 'begin-transaction' } | { type: 'commit-transaction' } | { type: 'cancel-transaction' }
  | { type: 'undo' } | { type: 'redo' } | { type: 'clear-error' }
  | { type: 'report-error'; message: string }
  | { type: 'select'; entityId: string | null; toggle?: boolean }
  | { type: 'create-layer' } | { type: 'toggle-ortho' }
  | { type: 'select-layer'; layerId: string }
  | { type: 'select-layer-objects'; layerId: string }
  | { type: 'from-selected-points'; kind: 'polyline' | 'polygon' }
  | { type: 'snap-options'; patch: Partial<SnapOptions> }
  | { type: 'point-labels'; mode: PointLabelMode } | { type: 'toggle-line-lengths' }
  | { type: 'viewport'; viewport: Viewport } | { type: 'pan'; delta: ScreenPoint }
  | { type: 'zoom'; anchor: ScreenPoint; size: ViewSize; factor: number }
  | { type: 'tool'; tool: EditorTool } | { type: 'toggle-grid' };

function matchesDeepAttribute(state:EditorState,command:DocumentCommand):boolean {
  const selection=state.deepSelection;
  if(!selection?.attribute||command.type!=='update-block-attribute'||command.entityId!==selection.ownerEntityId||command.tag!==selection.attributeTag||selection.primitivePath.length!==1||command.attributeIndex!==selection.primitivePath[0])return false;
  const resolved=resolveDeepSelection(state.document,selection);
  return resolved?.primitive.kind==='text'&&resolved.primitive.source?.originalType==='ATTRIB'&&resolved.primitive.attributeTag===command.tag&&(command.sourceHandle===undefined||resolved.primitive.source.handle===command.sourceHandle);
}

const HISTORY_LIMIT = 100;
const pushHistory = (past: GeoDocument[], document: GeoDocument) => [...past.slice(-(HISTORY_LIMIT - 1)), document];
function reconcileSelection(document: GeoDocument, selectionId: string | null): string | null {
  if (!selectionId) return null;
  const entity = document.entities.find(item => item.id === selectionId);
  if (!entity || entity.visible===false || !document.layers.find(layer => layer.id === entity.layerId)?.visible) return null;
  if(entity.type==='connector'&&!connectorVisible(document,entity))return null;
  if (entity.type === 'label') {
    const target = document.entities.find(item => item.id === entity.targetId);
    if (!target || !document.layers.find(layer => layer.id === target.layerId)?.visible) return null;
  }
  return selectionId;
}
const reconcileOrdered = (document: GeoDocument, ids: string[]) => ids.filter(id => document.entities.some(entity => entity.id === id && entity.type === 'point') && reconcileSelection(document, id));

function reconcileLayers(document: GeoDocument, state: EditorState) {
  return { currentLayerId: document.layers.some(layer => layer.id === state.currentLayerId) ? state.currentLayerId : document.layers.find(layer => layer.visible && !layer.locked)?.id ?? document.layers[0]!.id,
    selectedLayerId: document.layers.some(layer => layer.id === state.selectedLayerId) ? state.selectedLayerId : null };
}

export function initialEditorState(document: GeoDocument): EditorState {
  const currentLayerId = document.layers.find(layer => layer.id === 'boundary' && !layer.locked)?.id ?? document.layers.find(layer => !layer.locked)?.id ?? document.layers[0]!.id;
  return { viewportEditing:false,selectedPaperIds:[],selectionScopeLabel:null,viewAlign:null,currentStyle:{},styleClipboard:null,rotateInputOpen:false,rotateInputFocusEpoch:0,selectionRotate:null,layoutViewport:null,layoutId:null,dxfViewportId:null,modelViewMode:'plan',layerPanelFilter:'all',viewMode:'plan',projection:{orientation:'NE',origin:{x:0,y:0,z:0}},planViewport:null,axonViewport:null,connectorInteraction:null,isolation:null, deepSelection: null, hitStackStatus: null, symbolPlacement: null, marqueeActive: false, moveInputFocusEpoch: 0, moveInputOpen: false, selectionMove: null, coordinateDisplay: 'model', dimensionRetarget: null, dimensionPick: null, document, viewport: { ...document.viewport, center: { ...document.viewport.center } }, selectionId: null, selectedEntityIds: [], selectedLayerId: null, currentLayerId, tool: 'select', gridVisible: true,
    past: [], future: [], transactionBefore: null, error: null, savedFingerprint: documentFingerprint(document), documentEpoch: 0,
    orderedPointIds: [], snapOptions: { ...DEFAULT_SNAP_OPTIONS }, pointLabelMode: 'name-z', showLineLengths: false, ortho: false };
}
export const isDocumentDirty = (state: Pick<EditorState, 'document' | 'savedFingerprint'> & Partial<Pick<EditorState, 'transactionBefore'>>) =>
  Boolean(state.transactionBefore && state.document !== state.transactionBefore) || documentFingerprint(state.document) !== state.savedFingerprint;
const layerViewCommands = new Set<DocumentCommand['type']>(['set-layer-visibility', 'set-layer-lock', 'set-layer-style', 'reset-layer-style', 'create-layer', 'move-layer', 'update-layer']);
function reconcilePaperSelection(document: GeoDocument, state: EditorState) {
  if (!state.selectedPaperIds.length) return state.selectedPaperIds;
  const layout = document.dxfLayouts?.find(l => l.id === state.layoutId);
  const visible = new Set(layout ? renderItems(paperDocument(document, layout)).map(item => item.entity.id) : []);
  return state.selectedPaperIds.filter(id => visible.has(id));
}
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if(state.viewMode==='axonometric'&&['begin-selection-move','begin-dimension-pick','begin-dimension-retarget','begin-connector-retarget'].includes(action.type))return {...state,error:AXON_EDIT_MESSAGE};
  const layerOnly = action.type === 'execute' ? layerViewCommands.has(action.command.type) : action.type === 'execute-batch' && action.commands.every(c => layerViewCommands.has(c.type));
  if(state.selectedPaperIds.length&&!layerOnly&&['execute','execute-batch','transient','begin-selection-move','begin-selection-rotate','apply-selection-style','paste-style'].includes(action.type))return {...state,error:'В выборе есть объекты Paper Space только для чтения. Выберите объекты MODEL отдельно.'};
  switch (action.type) {
    case 'selection-scope':{if(state.transactionBefore)return state;const result=resolveSelectionScope(action.scope.kind==='model-all'?state.document:editorViewDocument(state,state.document,true),action.scope,state);return {...state,selectedEntityIds:result.modelIds,selectedPaperIds:result.paperIds,selectionId:result.modelIds.length===1?result.modelIds[0]!:null,selectionScopeLabel:result.label,deepSelection:null,error:null};}
    case 'viewport-editing':{if(state.transactionBefore)return state;const vp=state.document.dxfLayouts?.find(l=>l.id===state.layoutId)?.viewports.find(v=>v.id===(action.viewportId??state.dxfViewportId));return action.active&&(!vp||vp.unsupportedReason)?{...state,error:vp?.unsupportedReason??'Выберите поддерживаемый MODEL viewport.'}:{...state,viewportNavigation:null,viewportEditing:action.active,dxfViewportId:vp?.id??state.dxfViewportId,tool:'select',deepSelection:null,selectedPaperIds:[],viewAlign:null,error:null};}
    case 'view-angle':return state.layoutId||state.viewMode!=='plan'||state.transactionBefore||!Number.isFinite(action.angle)?state:{...state,viewport:{...state.viewport,rotationDeg:((action.angle%360)+360)%360} as RenderCamera,viewAlign:null};
    case 'align-view':return state.layoutId||state.viewMode!=='plan'||state.transactionBefore?state:{...state,viewAlign:action.axis?{axis:action.axis,first:null}:null,tool:'select'};
    case 'align-view-point':{const align=state.viewAlign;if(!align)return state;if(!align.first)return {...state,viewAlign:{...align,first:action.point}};const dx=action.point.x-align.first.x,dy=action.point.y-align.first.y;if(Math.hypot(dx,dy)<1e-9)return {...state,error:'Точки направления должны различаться.'};return editorReducer(state,{type:'view-angle',angle:(align.axis==='vertical'?90:0)-Math.atan2(dy,dx)*180/Math.PI});}

    case 'apply-selection-style':{
      const selected=state.document.entities.filter(e=>state.selectedEntityIds.includes(e.id)),keys=Object.keys(action.patch),targets=selected.filter(e=>keys.every(k=>styleKeysFor(e).includes(k as keyof import('../styles/model').StyleValues)));
      if(!targets.length)return {...state,error:'Выбор не поддерживает это свойство стиля.'};const next=editorReducer(state,{type:'execute',command:{type:'set-entity-style',entityIds:targets.map(e=>e.id),patch:action.patch}});
      return !next.error&&targets.length<selected.length?{...next,error:`Стиль применён; пропущено несовместимых объектов: ${selected.length-targets.length}.`}:next;
    }
    case 'current-style':return {...state,currentStyle:{...state.currentStyle,...action.patch}};
    case 'copy-style':{const e=state.document.entities.find(e=>e.id===action.entityId);return e?{...state,styleClipboard:capturedStyle(e,state.document),error:null}:state;}
    case 'paste-style':{
      if(!state.styleClipboard)return {...state,error:'Сначала скопируйте стиль объекта.'};
      const selected=state.document.entities.filter(e=>state.selectedEntityIds.includes(e.id)),keys=Object.keys(state.styleClipboard);
      const commands=selected.map(e=>({type:'set-entity-style' as const,entityIds:[e.id],patch:Object.fromEntries(keys.filter(k=>styleKeysFor(e).includes(k as keyof import('../styles/model').StyleValues)).map(k=>[k,state.styleClipboard![k as keyof StyleOverrides]]))})).filter(c=>Object.keys(c.patch).length);
      const skipped=selected.length-commands.length;if(!commands.length)return {...state,error:'Выбранные объекты не поддерживают скопированный стиль.'};
      const next=editorReducer(state,{type:'execute-batch',commands});return skipped&&!next.error?{...next,error:`Стиль применён; пропущено несовместимых объектов: ${skipped}.`}:next;
    }
    case 'open-rotate-input':return {...state,rotateInputOpen:true,rotateInputFocusEpoch:state.rotateInputFocusEpoch+1,tool:'select'};
    case 'close-rotate-input':return {...state,rotateInputOpen:false};
    case 'begin-selection-rotate':{
      if(state.layoutId&&!state.viewportEditing||state.viewMode!=='plan')return {...state,error:AXON_ROTATE_MESSAGE};
      if(state.deepSelection)return {...state,error:NESTED_MOVE_MESSAGE};if(state.transactionBefore)return state;
      try{const resolved=resolveSelectionTransform(state.document,action.entityIds,'rotate'),pivot=selectionPivot(state.document,action.entityIds);return {...state,selectionRotate:{resolved,pivot,angleDeg:0,previewDocument:state.document},transactionBefore:state.document,error:null};}catch(error){return {...state,error:error instanceof Error?error.message:String(error)};}
    }
    case 'preview-selection-rotate':{
      const rotation=state.selectionRotate;if(!rotation)return state;
      try{return {...state,selectionRotate:{...rotation,angleDeg:action.angleDeg,previewDocument:projectSelectionTransform(state.document,rotation.resolved,{kind:'rotate',pivot:rotation.pivot,angleDeg:action.angleDeg})},error:null};}catch(error){return {...state,error:String(error)};}
    }
    case 'finish-selection-rotate':{
      const r=state.selectionRotate;if(!r)return state;
      return editorReducer({...state,selectionRotate:null,transactionBefore:null},{type:'execute',command:{type:'transform-selection',entityIds:r.resolved.entityIds,transform:{kind:'rotate',pivot:r.pivot,angleDeg:r.angleDeg}}});
    }
    case 'fit-dxf-viewport':{
      if(state.transactionBefore)return state;const next=state.layoutId===action.layoutId?state:editorReducer(state,{type:'dxf-layout',layoutId:action.layoutId,size:action.size}),v=next.document.dxfLayouts?.find(l=>l.id===action.layoutId)?.viewports.find(v=>v.id===action.viewportId);if(!v)return state;
      const viewport=fitToBounds({minX:v.centerPaper.x-v.sizePaper.width/2,maxX:v.centerPaper.x+v.sizePaper.width/2,minY:v.centerPaper.y-v.sizePaper.height/2,maxY:v.centerPaper.y+v.sizePaper.height/2},action.size,55);
      return {...next,viewportNavigation:null,dxfViewportId:v.id,layoutViewport:viewport??next.layoutViewport,viewportEditing:next.viewportEditing&&!v.unsupportedReason,deepSelection:null};
    }
    case 'layout-camera':return state.layoutId?{...state,layoutViewport:action.viewport}:state;
    case 'layer-panel-filter':return {...state,layerPanelFilter:action.filter};
    case 'isolate-layers':return {...state,isolation:{entityIds:[],layerIds:[...new Set(action.layerIds)],label:action.label}};
    case 'dxf-viewport':{const layout=state.document.dxfLayouts?.find(l=>l.id===state.layoutId);return !state.transactionBefore&&layout?.viewports.some(v=>v.id===action.viewportId)?{...state,viewportNavigation:null,dxfViewportId:action.viewportId,viewportEditing:state.viewportEditing&&!layout.viewports.find(v=>v.id===action.viewportId)?.unsupportedReason,deepSelection:null}:state;}
    case 'dxf-layout':{
      if(state.transactionBefore)return {...state,error:'Завершите редактирование перед сменой листа.'};
      if(action.layoutId===null){const next={...state,layoutId:null,dxfViewportId:null,layoutViewport:null,viewportEditing:false,selectedPaperIds:[],viewAlign:null};return editorReducer(next,{type:'view-mode',mode:state.modelViewMode,size:action.size});}
      const layout=state.document.dxfLayouts?.find(l=>l.id===action.layoutId);if(!layout)return state;
      const mode=state.layoutId?state.modelViewMode:state.viewMode,next=editorReducer({...state,layoutId:null},{type:'view-mode',mode:'plan',size:action.size});
      return {...next,layoutViewport:null,layoutId:layout.id,viewportEditing:false,selectedPaperIds:[],viewAlign:null,dxfViewportId:layout.viewports[0]?.id??null,modelViewMode:mode,tool:'select',error:null};
    }
    case 'view-mode': {
      if(state.layoutId&&action.mode==='axonometric')return {...state,error:'Листы DXF отображаются в плане. Для аксонометрии выберите Model.'};
      if(state.transactionBefore)return {...state,error:'Завершите текущее редактирование перед сменой вида.'};
      const orientation=action.orientation??state.projection.orientation;
      if(action.mode===state.viewMode&&(action.mode==='plan'||orientation===state.projection.orientation))return state;
      const first=state.axonViewport===null&&state.viewMode==='plan';
      const projection={orientation,origin:first?projectionOrigin(editorViewDocument(state)):state.projection.origin};
      const changed=orientation!==state.projection.orientation;
      const viewport=action.mode==='plan'?(state.planViewport??state.viewport):(!first&&!changed?(state.axonViewport??state.viewport):(fitToBounds(projectedSceneBounds(editorViewDocument(state),projection),action.size,85)??{center:{x:0,y:0},pixelsPerUnit:40}));
      return {...state,viewMode:action.mode,projection,viewport,planViewport:state.viewMode==='plan'?state.viewport:state.planViewport,axonViewport:state.viewMode==='axonometric'?state.viewport:state.axonViewport,tool:'select',symbolPlacement:null,connectorInteraction:null,dimensionPick:null,deepSelection:null,hitStackStatus:null,error:null};
    }
    case 'fit-view': {if(state.layoutId)return state.viewportEditing?{...state,viewportNavigation:null}:{...state,layoutViewport:null};const doc=editorViewDocument(state),box=state.viewMode==='axonometric'?projectedSceneBounds(doc,state.projection):visibleBounds(doc),viewport=fitRotatedBounds(box,action.size,state.viewMode==='plan'?viewRotation(state.viewport):0,85);return viewport?{...state,viewport}:state;}

    case 'cancel-connector':return state.connectorInteraction?{...state,connectorInteraction:null,transactionBefore:null,error:null}:state;
    case 'preview-connector-port':return state.connectorInteraction?{...state,connectorInteraction:{...state.connectorInteraction,target:action.target}}:state;
    case 'begin-connector-retarget':{
      const e=state.document.entities.find(e=>e.id===action.entityId);
      if(!e||e.type!=='connector'||state.transactionBefore||isLayerLocked(state.document,e))return state;
      return {...state,tool:'select',deepSelection:null,dimensionPick:null,selectionId:e.id,selectedEntityIds:[e.id],connectorInteraction:{kind:'retarget',entityId:e.id,endpoint:action.endpoint,target:null},transactionBefore:state.document,error:null};
    }
    case 'finish-connector-retarget':{
      const interaction=state.connectorInteraction;if(interaction?.kind!=='retarget')return state;
      const base={...state,connectorInteraction:null,transactionBefore:null};
      if(!action.target)return {...base,error:'Выберите совместимый свободный порт.'};
      return editorReducer(base,{type:'execute',expectedDocument:state.transactionBefore??state.document,command:{type:'retarget-connector',entityId:interaction.entityId,endpoint:interaction.endpoint,target:action.target}});
    }
    case 'pick-connector-port':{
      const interaction=state.connectorInteraction;
      if(interaction?.kind==='retarget')return editorReducer(state,{type:'finish-connector-retarget',target:action.target});
      if(state.tool!=='connector'||state.transactionBefore&&!interaction)return state;
      const layer=state.document.layers.find(l=>l.id===state.currentLayerId);
      if(!layer||layer.locked||!layer.visible)return {...state,error:'Текущий слой скрыт или заблокирован. Выберите доступный слой.'};
      const error=portTargetError(state.document,action.target,interaction?.start);
      if(error)return {...state,error};
      if(!interaction)return {...state,connectorInteraction:{kind:'create',start:{...action.target},target:null},transactionBefore:state.document,error:null};
      const entity={id:newGeometryId('connector'),name:'Соединение',type:'connector' as const,layerId:layer.id,start:interaction.start,end:action.target,routing:'orthogonal' as const};
      const next=editorReducer({...state,connectorInteraction:null,transactionBefore:null},{type:'execute',expectedDocument:state.transactionBefore??state.document,command:{type:'add-entity',entity,vertices:[]}});
      return next.error?next:{...next,tool:'select',selectionId:entity.id,selectedEntityIds:[entity.id]};
    }

    case 'select-entities': {
      state={...state,selectedPaperIds:[],selectionScopeLabel:null};
      if(state.transactionBefore)return state;
      const requested=new Set(action.entityIds),ids=state.document.entities.filter(e=>requested.has(e.id)).map(e=>e.id);
      const paperIds=(state.document.dxfLayouts??[]).flatMap(l=>l.paperPrimitives.map((_,i)=>paperEntityId(l,i))).filter(id=>requested.has(id));
      return {...state,selectedPaperIds:paperIds,selectedEntityIds:ids,selectionId:ids.at(-1)??null,orderedPointIds:[],selectedLayerId:null,deepSelection:null,hitStackStatus:null,tool:'select',error:null};
    }
    case 'fit-entities': if(state.viewportEditing&&state.layoutViewport){const vp=activeDxfViewport(state),paper=state.layoutViewport;if(vp){const width=vp.sizePaper.width*paper.pixelsPerUnit,height=vp.sizePaper.height*paper.pixelsPerUnit,fit=fitRotatedBounds(selectionBounds(state.document,action.entityIds),{width,height},vp.twist,20);return fit?{...state,viewportNavigation:{viewportId:vp.id,modelCenter:fit.center,scale:fit.pixelsPerUnit/paper.pixelsPerUnit}}:state;}}if(state.layoutId){const layout=state.document.dxfLayouts?.find(l=>l.id===state.layoutId);const box=layout?selectionPaperBounds(state.document,layout,action.entityIds,state.viewportEditing?state.dxfViewportId??undefined:undefined):null,viewport=fitToBounds(box,action.size,55);return viewport?{...state,layoutViewport:viewport}:{...state,error:'Объекты вне текущего листа. Выберите Model для показа.'};} {const viewport=state.viewMode==='axonometric'?fitToBounds(projectedSceneBounds(state.document,state.projection,action.entityIds),action.size,85):fitRotatedBounds(selectionBounds(state.document,action.entityIds),action.size,viewRotation(state.viewport),85);return viewport?{...state,viewport}:state;}
    case 'isolate-entities': {
      if(state.transactionBefore)return state;
      const known=new Set(state.document.entities.map(e=>e.id)),entityIds=[...new Set(action.entityIds)].filter(id=>known.has(id));
      if(!entityIds.length)return state;
      return {...state,isolation:{entityIds,label:action.label},deepSelection:null,hitStackStatus:null};
    }
    case 'exit-isolation':return {...state,isolation:null,deepSelection:null,hitStackStatus:null,selectionId:reconcileSelection(state.document,state.selectionId),selectedEntityIds:state.selectedEntityIds.filter(id=>reconcileSelection(state.document,id)!==null)};
    case 'deep-select': {
      const layout=activeLayout(state),paper=layout?paperDocument(state.document,layout):null;
      if(paper?.entities.some(e=>e.id===action.candidate.ownerEntityId)&&!state.transactionBefore){if(action.candidate.selection&&!resolveDeepSelection(paper,action.candidate.selection))return state;return {...state,selectionId:null,selectedEntityIds:[],selectedLayerId:null,selectedPaperIds:[action.candidate.ownerEntityId],deepSelection:action.candidate.selection,hitStackStatus:{index:action.index,count:action.count},error:null};}
      const id=reconcileSelection(editorViewDocument(state),action.candidate.ownerEntityId);
      if(!id || state.transactionBefore || action.candidate.selection && !resolveDeepSelection(state.document, action.candidate.selection))return state;
      return {...state,selectedPaperIds:[],selectionScopeLabel:null,selectionId:id,selectedEntityIds:[id],selectedLayerId:null,orderedPointIds:[],deepSelection:action.candidate.selection,hitStackStatus:{index:action.index,count:action.count},moveInputOpen:false,error:null};
    }
    case 'fit-layer': if(state.viewportEditing)return editorReducer(state,{type:'fit-entities',entityIds:state.document.entities.filter(e=>e.layerId===action.layerId).map(e=>e.id),size:action.size});if(state.layoutId)return {...state,layoutViewport:null}; { const viewport = state.viewMode==='axonometric'?fitToBounds(projectedSceneBounds(state.document,state.projection,undefined,action.layerId),action.size,85):fitRotatedBounds(layerBounds(state.document,action.layerId),action.size,viewRotation(state.viewport),85); return viewport ? { ...state, viewport } : state; }
    case 'choose-symbol': {
      if(state.viewMode==='axonometric')return {...state,error:AXON_EDIT_MESSAGE};
      if (state.transactionBefore) return state;
      try { const definition = requireSymbol(action.libraryId, action.symbolId); return { ...state, tool: 'symbol', symbolPlacement: { libraryId: action.libraryId, symbolId: action.symbolId, rotationDeg: definition.allowedRotations?.[0] ?? 0 }, error: null }; }
      catch (error) { return { ...state, error: error instanceof Error ? error.message : 'Символ не найден' }; }
    }
    case 'rotate-symbol': {
      if (state.transactionBefore) return state;
      if (state.tool === 'symbol' && state.symbolPlacement) {
        const placement = state.symbolPlacement, allowed = requireSymbol(placement.libraryId, placement.symbolId).allowedRotations;
        const rotationDeg = nextSymbolRotation(placement.rotationDeg, allowed);
        return { ...state, symbolPlacement: { ...placement, rotationDeg } };
      }
      if (state.selectedEntityIds.length !== 1) return state;
      const entity = state.document.entities.find(e => e.id === state.selectedEntityIds[0]);
      return entity?.type === 'symbol' ? editorReducer(state, { type: 'execute', command: { type: 'update-entity', entityId: entity.id, patch: { rotationDeg: nextSymbolRotation(entity.rotationDeg, requireSymbol(entity.libraryId, entity.symbolId).allowedRotations) } } }) : state;
    }
    case 'begin-marquee': return { ...state, deepSelection:null,hitStackStatus:null, marqueeActive: true };
    case 'cancel-marquee': return { ...state, marqueeActive: false };
    case 'finish-marquee': {
      const hits = action.entityIds.filter(id => reconcileSelection(editorViewDocument(state),id));
      const selected = new Set(action.mode === 'replace' ? [] : state.selectedEntityIds);
      for (const id of hits) { if(action.mode === 'toggle' && selected.has(id)) selected.delete(id); else selected.add(id); }
      const selectedEntityIds = [...selected];
      const oldOrder = action.mode === 'replace' ? [] : state.orderedPointIds.filter(id=>selected.has(id));
      const newPoints = selectedEntityIds.filter(id=>!oldOrder.includes(id) && state.document.entities.some(e=>e.id===id && e.type==='point'));
      return { ...state, selectedPaperIds:action.mode==='replace'?[]:state.selectedPaperIds,selectionScopeLabel:null, marqueeActive:false, selectedEntityIds, selectionId:selectedEntityIds.at(-1)??null, selectedLayerId:null, orderedPointIds:[...oldOrder,...newPoints] };
    }
    case 'open-move-input': if(state.deepSelection)return {...state,error:NESTED_MOVE_MESSAGE}; return state.transactionBefore ? state : { ...state, moveInputOpen: true, moveInputFocusEpoch: state.moveInputFocusEpoch + 1, tool: 'select', symbolPlacement: null };
    case 'close-move-input': return { ...state, moveInputOpen: false };
    case 'begin-selection-move': {
      if(state.deepSelection)return {...state,error:NESTED_MOVE_MESSAGE};
      if (state.transactionBefore || state.dimensionPick) return state;
      try {
        const resolved = resolveSelectionMove(state.document, action.entityIds);
        return { ...state, selectionMove: { resolved, delta: { x: 0, y: 0 }, previewDocument: state.document }, transactionBefore: state.document, error: null };
      } catch (error) { return { ...state, error: error instanceof Error ? error.message : 'Нельзя переместить выбор' }; }
    }
    case 'preview-selection-move': {
      const move = state.selectionMove;
      if (!move) return state;
      try {
        const previewDocument = projectSelectionMove(state.document, move.resolved, action.delta);
        return { ...state, selectionMove: { ...move, delta: { ...action.delta }, previewDocument }, error: null };
      } catch (error) { return { ...state, selectionMove: { ...move, delta: { x: 0, y: 0 }, previewDocument: state.document }, error: error instanceof Error ? error.message : 'Нельзя переместить выбор' }; }
    }
    case 'finish-selection-move': {
      const move = state.selectionMove;
      if (!move) return state;
      try {
        const document = applyCommand(state.document, { type: 'move-entities', entityIds: move.resolved.entityIds, delta: move.delta });
        return { ...state, document, past: document === state.document ? state.past : pushHistory(state.past, state.document), future: document === state.document ? state.future : [],
          selectionMove: null, transactionBefore: null, error: state.error };
      } catch (error) { return { ...state, selectionMove: null, transactionBefore: null, error: error instanceof Error ? error.message : 'Нельзя переместить выбор' }; }
    }
    case 'coordinate-display': return { ...state, coordinateDisplay: action.mode };
    case 'begin-dimension-retarget': {
      const dimension = state.document.entities.find(entity => entity.id === action.dimensionId);
      if (!dimension || dimension.type !== 'dimension' || isLayerLocked(state.document, dimension) || state.transactionBefore) return state;
      return { ...state, selectionId: dimension.id, selectedEntityIds: [dimension.id], dimensionPick: null,
        dimensionRetarget: { dimensionId: dimension.id, endpoint: action.endpoint, vertexId: null }, transactionBefore: state.document, error: null };
    }
    case 'preview-dimension-retarget': return state.dimensionRetarget ? { ...state, dimensionRetarget: { ...state.dimensionRetarget, vertexId: action.vertexId } } : state;
    case 'finish-dimension-retarget': {
      const preview = state.dimensionRetarget;
      if (!preview) return state;
      if (!action.vertexId) return { ...state, transactionBefore: null, dimensionRetarget: null, error: 'Отпустите grip на существующей вершине.' };
      try {
        const command: DocumentCommand = { type: 'update-dimension-reference', dimensionId: preview.dimensionId, endpoint: preview.endpoint, vertexId: action.vertexId };
        const document = applyCommand(state.document, command);
        return document === state.document
          ? { ...state, transactionBefore: null, dimensionRetarget: null, error: null }
          : { ...state, document, past: pushHistory(state.past, state.document), future: [], transactionBefore: null, dimensionRetarget: null, dimensionPick: null, error: null };
      } catch (error) {
        return { ...state, transactionBefore: null, dimensionRetarget: null, error: error instanceof Error ? error.message : 'Нельзя изменить привязку размера' };
      }
    }
    case 'begin-dimension-pick': {
      const dimension = state.document.entities.find(entity => entity.id === action.dimensionId);
      if (!dimension || dimension.type !== 'dimension' || isLayerLocked(state.document, dimension) || state.transactionBefore) return state;
      return { ...state, selectionId: dimension.id, selectedEntityIds: [dimension.id], dimensionRetarget: null, dimensionPick: { dimensionId: dimension.id, endpoint: action.endpoint }, error: null };
    }
    case 'cancel-dimension-pick': return state.dimensionPick ? { ...state, dimensionPick: null } : state;
    case 'finish-dimension-pick': {
      const pick = state.dimensionPick;
      if (!pick) return state;
      try {
        const document = applyCommand(state.document, { type: 'update-dimension-reference', ...pick, vertexId: action.vertexId });
        return { ...state, document, past: document === state.document ? state.past : pushHistory(state.past, state.document),
          future: document === state.document ? state.future : [], dimensionPick: null, error: null };
      } catch (error) {
        return { ...state, dimensionPick: null, error: error instanceof Error ? error.message : 'Нельзя изменить привязку размера' };
      }
    }
    case 'toggle-ortho': return { ...state, ortho: !state.ortho };
    case 'create-layer': {
      let name = 'Новый слой', suffix = 2;
      while (state.document.layers.some(layer => layer.name === name)) name = `Новый слой ${suffix++}`;
      const layer = { id: newGeometryId('layer'), name, visible: true, locked: false, order: Math.max(...state.document.layers.map(layer => layer.order)) + 1, styleId: state.document.styles[0]!.id };
      const next = editorReducer(state, { type: 'execute', command: { type: 'create-layer', layer } });
      return next.error ? next : editorReducer(next, { type: 'select-layer', layerId: layer.id });
    }
    case 'mark-saved': return { ...state, savedFingerprint: documentFingerprint(state.document) };
    case 'snap-options': return action.patch.gridStep !== undefined && (!Number.isFinite(action.patch.gridStep) || action.patch.gridStep <= 0) ? state : { ...state, snapOptions: { ...state.snapOptions, ...action.patch } };
    case 'point-labels': return { ...state, pointLabelMode: action.mode };
    case 'toggle-line-lengths': return { ...state, showLineLengths: !state.showLineLengths };
    case 'from-selected-points': {
      try {
        const command = commandFromOrderedPoints(state.document, state.orderedPointIds, action.kind, state.currentLayerId);
        const next = editorReducer(state, { type: 'execute', command });
        return next.error || command.type !== 'add-entity' ? next : { ...next, selectionId: command.entity.id, selectedEntityIds: [command.entity.id], selectedLayerId: null, orderedPointIds: [], tool: 'select' };
      } catch (error) { return { ...state, error: error instanceof Error ? error.message : 'Не удалось построить геометрию' }; }
    }
    case 'load-json': {
      try { return editorReducer(state, { type: 'replace-document', document: deserializeDocument(action.text), size: action.size }); }
      catch (error) { return { ...state, error: error instanceof Error ? error.message : 'Не удалось открыть документ' }; }
    }
    case 'replace-document': {
      try {
        const document = validateDocument(action.document); // Own the validated data; do not retain caller payload references.
        if(action.currentLayerId&&!document.layers.some(l=>l.id===action.currentLayerId))throw new Error('Imported current layer is missing');
        return { ...initialEditorState(document), ...(action.currentLayerId?{currentLayerId:action.currentLayerId}:{}), ...(action.dirty?{savedFingerprint:''}:{}), documentEpoch: state.documentEpoch + 1,
          viewport: fitToBounds(visibleBounds(document), action.size, 85) ?? document.viewport };
      } catch (error) { return { ...state, error: error instanceof Error ? error.message : 'Не удалось открыть документ' }; }
    }
    case 'execute-batch':
    case 'execute': {
      if(state.deepSelection){if(action.type==='execute-batch'||!['set-layer-visibility','set-layer-lock','move-layer','create-layer'].includes(action.command.type)&&!matchesDeepAttribute(state,action.command))return {...state,error:NESTED_MOVE_MESSAGE};if(!matchesDeepAttribute(state,action.command))state={...state,deepSelection:null,hitStackStatus:null};}
      if (action.expectedDocument && (state.transactionBefore || state.document !== action.expectedDocument)) {
        return { ...state, error: 'Документ изменился или активна транзакция. Пересчитайте план.' };
      }
      if (state.transactionBefore) return state;
      try {
        const styled=(command:DocumentCommand):DocumentCommand=>{if(command.type!=='add-entity'||command.entity.style||command.entity.source)return command;const style=Object.fromEntries(Object.entries(state.currentStyle).filter(([k])=>styleKeysFor(command.entity).includes(k as keyof import('../styles/model').StyleValues)));return Object.keys(style).length?{...command,entity:{...command.entity,style}}:command;};
        const document = action.type === 'execute-batch' ? applyCommandsAtomically(state.document, action.commands.map(styled)) : applyCommand(state.document, styled(action.command));
        if (document === state.document) return { ...state, error: null };
        const hiddenSelection = action.type === 'execute' && action.command.type === 'set-layer-visibility' && !action.command.visible
          && state.document.entities.find(item => item.id === state.selectionId)?.layerId === action.command.layerId;
        return { ...state, ...reconcileLayers(document, state), selectedPaperIds:reconcilePaperSelection(document,state), document, past: pushHistory(state.past, state.document), future: [],
          selectionId: hiddenSelection ? null : reconcileSelection(document, state.selectionId), selectedEntityIds: hiddenSelection ? [] : state.selectedEntityIds.filter(id => reconcileSelection(document, id) !== null), orderedPointIds: reconcileOrdered(document, state.orderedPointIds), error: null };
      } catch (error) {
        return { ...state, error: error instanceof Error ? error.message : 'Не удалось изменить документ' };
      }
    }
    case 'transient': {
      if (state.selectionRotate || state.selectionMove || state.connectorInteraction) return state;
      if (!state.transactionBefore) return state;
      try {
        if (action.command.type !== 'update-underlay' && action.command.type !== 'update-vertex' && action.command.type !== 'move-vertex' && action.command.type !== 'move-text'
          && !(action.command.type==='update-block-attribute'&&action.command.patch.value===undefined&&matchesDeepAttribute(state,action.command))
          && !(action.command.type === 'update-entity' && action.command.patch.template === undefined && action.command.patch.content === undefined && action.command.patch.name === undefined && action.command.patch.fontSize === undefined)) throw new Error('Транзакция допускает только изменение координат и смещений');
        return { ...state, document: applyCommand(state.document, action.command), error: null };
      }
      catch (error) { return { ...state, error: error instanceof Error ? error.message : 'Не удалось изменить документ' }; }
    }
    case 'begin-transaction': if(state.deepSelection&&!state.deepSelection.attribute)return {...state,error:NESTED_MOVE_MESSAGE}; return state.transactionBefore ? state : { ...state, transactionBefore: state.document };
    case 'commit-transaction': {
      if(state.connectorInteraction)return editorReducer(state,{type:'cancel-connector'});
      if(state.selectionRotate)return editorReducer(state,{type:'finish-selection-rotate'});
      if (state.selectionMove) return editorReducer(state, { type: 'finish-selection-move' });
      if (state.dimensionRetarget) return { ...state, transactionBefore: null, dimensionRetarget: null };
      const before = state.transactionBefore;
      return !before ? state : { ...state, past: state.document === before ? state.past : pushHistory(state.past, before),
        future: state.document === before ? state.future : [], transactionBefore: null };
    }
    case 'cancel-transaction': return state.transactionBefore ? { ...state, document: state.transactionBefore, transactionBefore: null, dimensionRetarget: null, connectorInteraction:null,selectionRotate:null,selectionMove: null, error: null } : state;
    case 'undo': {
      if(state.connectorInteraction)return editorReducer(state,{type:'cancel-connector'});
      state={...state,deepSelection:null,hitStackStatus:null};
      if(state.selectionRotate)return {...state,selectionRotate:null,transactionBefore:null,error:null};
      if (state.selectionMove) return { ...state, selectionMove: null, transactionBefore: null, error: null };
      if (state.dimensionRetarget) return { ...state, transactionBefore: null, dimensionRetarget: null };
      if (state.dimensionPick) return { ...state, dimensionPick: null };
      if (state.transactionBefore && state.document !== state.transactionBefore) {
        return { ...state, document: state.transactionBefore, future: [state.document], transactionBefore: null, error: null };
      }
      if (state.transactionBefore) return editorReducer({ ...state, transactionBefore: null }, action);
      if (!state.past.length) return state;
      const document = state.past[state.past.length - 1]!;
      return { ...state, ...reconcileLayers(document, state), selectedPaperIds:reconcilePaperSelection(document,state), document, past: state.past.slice(0, -1), future: [...state.future, state.document],
        selectionId: reconcileSelection(document, state.selectionId), selectedEntityIds: state.selectedEntityIds.filter(id => reconcileSelection(document, id) !== null), orderedPointIds: reconcileOrdered(document, state.orderedPointIds), error: null };
    }
    case 'redo': {
      if(state.connectorInteraction)return editorReducer(state,{type:'cancel-connector'});
      state={...state,deepSelection:null,hitStackStatus:null};
      if(state.selectionRotate)return {...state,selectionRotate:null,transactionBefore:null,error:null};
      if (state.selectionMove) return { ...state, selectionMove: null, transactionBefore: null, error: null };
      if (state.dimensionRetarget || state.dimensionPick) return { ...state, transactionBefore: null, dimensionRetarget: null, dimensionPick: null };
      if (!state.future.length || state.transactionBefore) return state;
      const document = state.future[state.future.length - 1]!;
      return { ...state, ...reconcileLayers(document, state), selectedPaperIds:reconcilePaperSelection(document,state), document, past: pushHistory(state.past, state.document), future: state.future.slice(0, -1),
        selectionId: reconcileSelection(document, state.selectionId), selectedEntityIds: state.selectedEntityIds.filter(id => reconcileSelection(document, id) !== null), orderedPointIds: reconcileOrdered(document, state.orderedPointIds), error: null };
    }
    case 'clear-error': return { ...state, error: null };
    case 'report-error': return { ...state, error: action.message };
    case 'select': {
      state={...state,selectedPaperIds:[],selectionScopeLabel:null};
      state={...state,deepSelection:null,hitStackStatus:null};
      if (action.entityId === null) return { ...state, selectionId: null, selectedEntityIds: [], selectedLayerId: null, orderedPointIds: [], dimensionPick: null };
      const entity = state.document.entities.find(item => item.id === action.entityId);
      if (!entity || !reconcileSelection(editorViewDocument(state),entity.id)) return state;
      const orderedPointIds = action.toggle && entity?.type === 'point'
        ? state.orderedPointIds.includes(entity.id) ? state.orderedPointIds.filter(id => id !== entity.id) : [...state.orderedPointIds, entity.id]
        : action.toggle ? state.orderedPointIds : entity?.type === 'point' ? [entity.id] : [];
      const selectedEntityIds = action.toggle ? state.selectedEntityIds.includes(entity!.id)
        ? state.selectedEntityIds.filter(id => id !== entity!.id) : [...state.selectedEntityIds, entity!.id] : [action.entityId];
      const selectionId = action.toggle ? selectedEntityIds.at(-1) ?? null : action.entityId;
      return { ...state, selectionId, selectedEntityIds, selectedLayerId: null, orderedPointIds };
    }
    case 'select-layer': return state.document.layers.some(layer => layer.id === action.layerId)
      ? { ...state, selectedPaperIds:[],selectionScopeLabel:null,deepSelection:null,hitStackStatus:null,currentLayerId: action.layerId, selectedLayerId: action.layerId, selectionId: null, selectedEntityIds: [], orderedPointIds: [], moveInputOpen: false } : state;
    case 'select-layer-objects': {
      if (!state.document.layers.some(layer => layer.id === action.layerId)) return state;
      const ids = state.document.entities.filter(entity => entity.layerId === action.layerId).map(entity => entity.id);
      return { ...state, selectedPaperIds:[],selectionScopeLabel:null,deepSelection:null,hitStackStatus:null,currentLayerId: action.layerId, selectedLayerId: null, selectedEntityIds: ids, selectionId: ids[0] ?? null, orderedPointIds: [] };
    }
    case 'viewport': return { ...state, viewport: action.viewport };
    case 'pan': if(state.viewportEditing&&state.layoutViewport){const vp=activeDxfViewport(state);if(vp)return {...state,viewportNavigation:navigationFromCamera(vp,panViewport(modelViewportCamera(vp,state.layoutViewport),action.delta),state.layoutViewport)};}if(state.layoutId)return state.layoutViewport?{...state,layoutViewport:panViewport(state.layoutViewport,action.delta)}:state;return { ...state, viewport: panViewport(state.viewport, action.delta) };
    case 'zoom': if(state.viewportEditing&&state.layoutViewport){const vp=activeDxfViewport(state);if(vp)return {...state,viewportNavigation:navigationFromCamera(vp,zoomAt(modelViewportCamera(vp,state.layoutViewport),action.size,action.anchor,action.factor),state.layoutViewport)};}if(state.layoutId)return state.layoutViewport?{...state,layoutViewport:zoomAt(state.layoutViewport,action.size,action.anchor,action.factor)}:state;return { ...state, viewport: zoomAt(state.viewport, action.size, action.anchor, action.factor) };
    case 'tool': if(state.viewMode==='axonometric'&&!['select','pan'].includes(action.tool))return {...state,error:AXON_EDIT_MESSAGE}; state=editorReducer(state,{type:'cancel-connector'}); return { ...state,deepSelection:null,hitStackStatus:null, tool: action.tool, symbolPlacement: action.tool === 'symbol' ? state.symbolPlacement : null };
    case 'toggle-grid': return { ...state, gridVisible: !state.gridVisible };
  }
}

const isolatedViews=new WeakMap<GeoDocument,WeakMap<object,GeoDocument>>();
const globallyVisibleIsolatedViews=new WeakMap<GeoDocument,WeakMap<object,GeoDocument>>();
/** Ephemeral owner filter; canonical layer visibility and document/history/autosave are untouched. */
export function editorViewDocument(state:Pick<EditorState,'document'|'isolation'>,document:GeoDocument=state.document,respectGlobalVisibility=false):GeoDocument {
  if(!state.isolation)return document;
  const views=respectGlobalVisibility?globallyVisibleIsolatedViews:isolatedViews;let cache=views.get(document);if(!cache){cache=new WeakMap();views.set(document,cache);}const cached=cache.get(state.isolation);if(cached)return cached;
  if(state.isolation.layerIds){const layers=new Set(state.isolation.layerIds);const view={...document,layers:document.layers.map(l=>!layers.has(l.id)&&l.visible?{...l,visible:false}:l)};cache.set(state.isolation,view);return view;}
  const ids=new Set(state.isolation.entityIds),targets=new Set(document.entities.flatMap(e=>!ids.has(e.id)?[]:e.type==='label'?[e.targetId]:e.type==='connector'?[e.start.symbolEntityId,e.end.symbolEntityId]:[]));
  const view={...document,entities:document.entities.filter(e=>ids.has(e.id)||targets.has(e.id)).map(e=>ids.has(e.id)?!respectGlobalVisibility&&e.visible===false?{...e,visible:true}:e:{...e,visible:false}),layers:respectGlobalVisibility?document.layers:document.layers.map(l=>l.visible?l:{...l,visible:true})};cache.set(state.isolation,view);return view;
}
