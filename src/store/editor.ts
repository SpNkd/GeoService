import type { GeoDocument, Viewport } from '../domain/model';
import { applyCommand, applyCommandsAtomically, isLayerLocked, type DocumentCommand } from '../domain/commands';
import { fitToBounds, panViewport, zoomAt, type ScreenPoint, type ViewSize } from '../geometry';
import { visibleBounds } from '../renderer/selectors';
import { deserializeDocument, documentFingerprint } from '../persistence/serialization';
import { commandFromOrderedPoints } from '../domain/geometryIntent';
import { validateDocument } from '../persistence/documentSchema';
import { newGeometryId } from '../domain/geometryIntent';
import { DEFAULT_SNAP_OPTIONS, type SnapOptions } from '../snapping';

export type EditorTool = 'select' | 'pan' | 'point' | 'line' | 'polyline' | 'polygon' | 'text' | 'dimension' | 'measure';
export type PointLabelMode = 'name' | 'name-z' | 'z';
export interface EditorState {
  coordinateDisplay: 'model' | 'survey';
  dimensionRetarget: { dimensionId: string; endpoint: 'start' | 'end'; vertexId: string | null } | null;
  dimensionPick: { dimensionId: string; endpoint: 'start' | 'end' } | null;
  document: GeoDocument; viewport: Viewport; selectionId: string | null; selectedEntityIds: string[]; selectedLayerId: string | null; currentLayerId: string; tool: EditorTool; gridVisible: boolean;
  past: GeoDocument[]; future: GeoDocument[]; transactionBefore: GeoDocument | null; error: string | null;
  savedFingerprint: string; documentEpoch: number;
  orderedPointIds: string[]; snapOptions: SnapOptions; pointLabelMode: PointLabelMode; showLineLengths: boolean; ortho: boolean;
}
export type EditorAction =
  | { type: 'coordinate-display'; mode: 'model' | 'survey' }
  | { type: 'begin-dimension-retarget'; dimensionId: string; endpoint: 'start' | 'end' }
  | { type: 'preview-dimension-retarget'; vertexId: string | null }
  | { type: 'finish-dimension-retarget'; vertexId: string | null }
  | { type: 'begin-dimension-pick'; dimensionId: string; endpoint: 'start' | 'end' }
  | { type: 'cancel-dimension-pick' }
  | { type: 'finish-dimension-pick'; vertexId: string }
  | { type: 'load-json'; text: string; size: ViewSize }
  | { type: 'replace-document'; document: GeoDocument; size: ViewSize }
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

const HISTORY_LIMIT = 100;
const pushHistory = (past: GeoDocument[], document: GeoDocument) => [...past.slice(-(HISTORY_LIMIT - 1)), document];
function reconcileSelection(document: GeoDocument, selectionId: string | null): string | null {
  if (!selectionId) return null;
  const entity = document.entities.find(item => item.id === selectionId);
  if (!entity || !document.layers.find(layer => layer.id === entity.layerId)?.visible) return null;
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
  return { coordinateDisplay: 'model', dimensionRetarget: null, dimensionPick: null, document, viewport: { ...document.viewport, center: { ...document.viewport.center } }, selectionId: null, selectedEntityIds: [], selectedLayerId: null, currentLayerId, tool: 'select', gridVisible: true,
    past: [], future: [], transactionBefore: null, error: null, savedFingerprint: documentFingerprint(document), documentEpoch: 0,
    orderedPointIds: [], snapOptions: { ...DEFAULT_SNAP_OPTIONS }, pointLabelMode: 'name-z', showLineLengths: false, ortho: false };
}
export const isDocumentDirty = (state: Pick<EditorState, 'document' | 'savedFingerprint'> & Partial<Pick<EditorState, 'transactionBefore'>>) =>
  Boolean(state.transactionBefore && state.document !== state.transactionBefore) || documentFingerprint(state.document) !== state.savedFingerprint;
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
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
        return { ...initialEditorState(document), documentEpoch: state.documentEpoch + 1,
          viewport: fitToBounds(visibleBounds(document), action.size, 85) ?? document.viewport };
      } catch (error) { return { ...state, error: error instanceof Error ? error.message : 'Не удалось открыть документ' }; }
    }
    case 'execute-batch':
    case 'execute': {
      if (action.expectedDocument && (state.transactionBefore || state.document !== action.expectedDocument)) {
        return { ...state, error: 'Документ изменился или активна транзакция. Пересчитайте план.' };
      }
      if (state.transactionBefore) return state;
      try {
        const document = action.type === 'execute-batch' ? applyCommandsAtomically(state.document, action.commands) : applyCommand(state.document, action.command);
        if (document === state.document) return { ...state, error: null };
        const hiddenSelection = action.type === 'execute' && action.command.type === 'set-layer-visibility' && !action.command.visible
          && state.document.entities.find(item => item.id === state.selectionId)?.layerId === action.command.layerId;
        return { ...state, ...reconcileLayers(document, state), document, past: pushHistory(state.past, state.document), future: [],
          selectionId: hiddenSelection ? null : reconcileSelection(document, state.selectionId), selectedEntityIds: hiddenSelection ? [] : state.selectedEntityIds.filter(id => reconcileSelection(document, id) !== null), orderedPointIds: reconcileOrdered(document, state.orderedPointIds), error: null };
      } catch (error) {
        return { ...state, error: error instanceof Error ? error.message : 'Не удалось изменить документ' };
      }
    }
    case 'transient': {
      if (!state.transactionBefore) return state;
      try {
        if (action.command.type !== 'update-vertex' && action.command.type !== 'move-vertex' && action.command.type !== 'move-text'
          && !(action.command.type === 'update-entity' && action.command.patch.template === undefined && action.command.patch.content === undefined && action.command.patch.name === undefined && action.command.patch.fontSize === undefined)) throw new Error('Транзакция допускает только изменение координат и смещений');
        return { ...state, document: applyCommand(state.document, action.command), error: null };
      }
      catch (error) { return { ...state, error: error instanceof Error ? error.message : 'Не удалось изменить документ' }; }
    }
    case 'begin-transaction': return state.transactionBefore ? state : { ...state, transactionBefore: state.document };
    case 'commit-transaction': {
      if (state.dimensionRetarget) return { ...state, transactionBefore: null, dimensionRetarget: null };
      const before = state.transactionBefore;
      return !before ? state : { ...state, past: state.document === before ? state.past : pushHistory(state.past, before),
        future: state.document === before ? state.future : [], transactionBefore: null };
    }
    case 'cancel-transaction': return state.transactionBefore ? { ...state, document: state.transactionBefore, transactionBefore: null, dimensionRetarget: null, error: null } : state;
    case 'undo': {
      if (state.dimensionRetarget) return { ...state, transactionBefore: null, dimensionRetarget: null };
      if (state.dimensionPick) return { ...state, dimensionPick: null };
      if (state.transactionBefore && state.document !== state.transactionBefore) {
        return { ...state, document: state.transactionBefore, future: [state.document], transactionBefore: null, error: null };
      }
      if (state.transactionBefore) return editorReducer({ ...state, transactionBefore: null }, action);
      if (!state.past.length) return state;
      const document = state.past[state.past.length - 1]!;
      return { ...state, ...reconcileLayers(document, state), document, past: state.past.slice(0, -1), future: [...state.future, state.document],
        selectionId: reconcileSelection(document, state.selectionId), selectedEntityIds: state.selectedEntityIds.filter(id => reconcileSelection(document, id) !== null), orderedPointIds: reconcileOrdered(document, state.orderedPointIds), error: null };
    }
    case 'redo': {
      if (state.dimensionRetarget || state.dimensionPick) return { ...state, transactionBefore: null, dimensionRetarget: null, dimensionPick: null };
      if (!state.future.length || state.transactionBefore) return state;
      const document = state.future[state.future.length - 1]!;
      return { ...state, ...reconcileLayers(document, state), document, past: pushHistory(state.past, state.document), future: state.future.slice(0, -1),
        selectionId: reconcileSelection(document, state.selectionId), selectedEntityIds: state.selectedEntityIds.filter(id => reconcileSelection(document, id) !== null), orderedPointIds: reconcileOrdered(document, state.orderedPointIds), error: null };
    }
    case 'clear-error': return { ...state, error: null };
    case 'report-error': return { ...state, error: action.message };
    case 'select': {
      if (action.entityId === null) return { ...state, selectionId: null, selectedEntityIds: [], selectedLayerId: null, orderedPointIds: [], dimensionPick: null };
      const entity = state.document.entities.find(item => item.id === action.entityId);
      const layer = state.document.layers.find(item => item.id === entity?.layerId);
      if (!layer?.visible) return state;
      const orderedPointIds = action.toggle && entity?.type === 'point'
        ? state.orderedPointIds.includes(entity.id) ? state.orderedPointIds.filter(id => id !== entity.id) : [...state.orderedPointIds, entity.id]
        : entity?.type === 'point' ? [entity.id] : [];
      const selectionId = action.toggle && entity?.type === 'point' ? orderedPointIds[orderedPointIds.length - 1] ?? null : action.entityId;
      const selectedEntityIds = action.toggle && entity?.type === 'point' ? (selectionId ? [...new Set([...state.selectedEntityIds.filter(id => id !== action.entityId), ...(orderedPointIds.includes(action.entityId) ? [action.entityId] : [])])] : []) : [action.entityId];
      return { ...state, selectionId, selectedEntityIds, selectedLayerId: null, orderedPointIds };
    }
    case 'select-layer': return state.document.layers.some(layer => layer.id === action.layerId)
      ? { ...state, currentLayerId: action.layerId, selectedLayerId: action.layerId, selectionId: null, selectedEntityIds: [], orderedPointIds: [] } : state;
    case 'select-layer-objects': {
      if (!state.document.layers.some(layer => layer.id === action.layerId)) return state;
      const ids = state.document.entities.filter(entity => entity.layerId === action.layerId).map(entity => entity.id);
      return { ...state, currentLayerId: action.layerId, selectedLayerId: null, selectedEntityIds: ids, selectionId: ids[0] ?? null, orderedPointIds: [] };
    }
    case 'viewport': return { ...state, viewport: action.viewport };
    case 'pan': return { ...state, viewport: panViewport(state.viewport, action.delta) };
    case 'zoom': return { ...state, viewport: zoomAt(state.viewport, action.size, action.anchor, action.factor) };
    case 'tool': return { ...state, tool: action.tool };
    case 'toggle-grid': return { ...state, gridVisible: !state.gridVisible };
  }
}
