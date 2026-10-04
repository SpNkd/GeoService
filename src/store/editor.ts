import type { GeoDocument, Viewport } from '../domain/model';
import { applyCommand, type DocumentCommand } from '../domain/commands';
import { fitToBounds, panViewport, zoomAt, type ScreenPoint, type ViewSize } from '../geometry';
import { visibleBounds } from '../renderer/selectors';
import { deserializeDocument, documentFingerprint } from '../persistence/serialization';
import { commandFromOrderedPoints } from '../domain/geometryIntent';
import { validateDocument } from '../persistence/documentSchema';
import { DEFAULT_SNAP_OPTIONS, type SnapOptions } from '../snapping';

export type EditorTool = 'select' | 'pan' | 'point' | 'line' | 'polyline' | 'polygon' | 'text' | 'dimension' | 'measure';
export type PointLabelMode = 'name' | 'name-z' | 'z';
export interface EditorState {
  document: GeoDocument; viewport: Viewport; selectionId: string | null; tool: EditorTool; gridVisible: boolean;
  past: GeoDocument[]; future: GeoDocument[]; transactionBefore: GeoDocument | null; error: string | null;
  savedFingerprint: string; documentEpoch: number;
  orderedPointIds: string[]; snapOptions: SnapOptions; pointLabelMode: PointLabelMode; showLineLengths: boolean;
}
export type EditorAction =
  | { type: 'load-json'; text: string; size: ViewSize }
  | { type: 'replace-document'; document: GeoDocument; size: ViewSize }
  | { type: 'mark-saved' }
  | { type: 'execute'; command: DocumentCommand; expectedDocument?: GeoDocument }
  | { type: 'transient'; command: DocumentCommand }
  | { type: 'begin-transaction' } | { type: 'commit-transaction' } | { type: 'cancel-transaction' }
  | { type: 'undo' } | { type: 'redo' } | { type: 'clear-error' }
  | { type: 'report-error'; message: string }
  | { type: 'select'; entityId: string | null; toggle?: boolean }
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
  return entity && document.layers.find(layer => layer.id === entity.layerId)?.visible ? selectionId : null;
}
const reconcileOrdered = (document: GeoDocument, ids: string[]) => ids.filter(id => document.entities.some(entity => entity.id === id && entity.type === 'point') && reconcileSelection(document, id));

export function initialEditorState(document: GeoDocument): EditorState {
  return { document, viewport: { ...document.viewport, center: { ...document.viewport.center } }, selectionId: null, tool: 'select', gridVisible: true,
    past: [], future: [], transactionBefore: null, error: null, savedFingerprint: documentFingerprint(document), documentEpoch: 0,
    orderedPointIds: [], snapOptions: { ...DEFAULT_SNAP_OPTIONS }, pointLabelMode: 'name-z', showLineLengths: false };
}
export const isDocumentDirty = (state: Pick<EditorState, 'document' | 'savedFingerprint'> & Partial<Pick<EditorState, 'transactionBefore'>>) =>
  Boolean(state.transactionBefore && state.document !== state.transactionBefore) || documentFingerprint(state.document) !== state.savedFingerprint;
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'mark-saved': return { ...state, savedFingerprint: documentFingerprint(state.document) };
    case 'snap-options': return { ...state, snapOptions: { ...state.snapOptions, ...action.patch } };
    case 'point-labels': return { ...state, pointLabelMode: action.mode };
    case 'toggle-line-lengths': return { ...state, showLineLengths: !state.showLineLengths };
    case 'from-selected-points': {
      try {
        const command = commandFromOrderedPoints(state.document, state.orderedPointIds, action.kind);
        const next = editorReducer(state, { type: 'execute', command });
        return next.error || command.type !== 'add-entity' ? next : { ...next, selectionId: command.entity.id, orderedPointIds: [], tool: 'select' };
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
    case 'execute': {
      if (action.expectedDocument && (state.transactionBefore || state.document !== action.expectedDocument)) {
        return { ...state, error: 'Документ изменился или активна транзакция. Пересчитайте план.' };
      }
      if (state.transactionBefore) return state;
      try {
        const document = applyCommand(state.document, action.command);
        if (document === state.document) return { ...state, error: null };
        const hiddenSelection = action.command.type === 'set-layer-visibility' && !action.command.visible
          && state.document.entities.find(item => item.id === state.selectionId)?.layerId === action.command.layerId;
        return { ...state, document, past: pushHistory(state.past, state.document), future: [],
          selectionId: hiddenSelection ? null : reconcileSelection(document, state.selectionId), orderedPointIds: reconcileOrdered(document, state.orderedPointIds), error: null };
      } catch (error) {
        return { ...state, error: error instanceof Error ? error.message : 'Не удалось изменить документ' };
      }
    }
    case 'transient': {
      if (!state.transactionBefore) return state;
      try {
        if (action.command.type !== 'update-vertex' && action.command.type !== 'move-vertex') throw new Error('Транзакция допускает только изменение координат');
        return { ...state, document: applyCommand(state.document, action.command), error: null };
      }
      catch (error) { return { ...state, error: error instanceof Error ? error.message : 'Не удалось изменить документ' }; }
    }
    case 'begin-transaction': return state.transactionBefore ? state : { ...state, transactionBefore: state.document };
    case 'commit-transaction': {
      const before = state.transactionBefore;
      return !before ? state : { ...state, past: state.document === before ? state.past : pushHistory(state.past, before),
        future: state.document === before ? state.future : [], transactionBefore: null };
    }
    case 'cancel-transaction': return state.transactionBefore ? { ...state, document: state.transactionBefore, transactionBefore: null, error: null } : state;
    case 'undo': {
      if (state.transactionBefore && state.document !== state.transactionBefore) {
        return { ...state, document: state.transactionBefore, future: [state.document], transactionBefore: null, error: null };
      }
      if (state.transactionBefore) return editorReducer({ ...state, transactionBefore: null }, action);
      if (!state.past.length) return state;
      const document = state.past[state.past.length - 1]!;
      return { ...state, document, past: state.past.slice(0, -1), future: [...state.future, state.document],
        selectionId: reconcileSelection(document, state.selectionId), orderedPointIds: reconcileOrdered(document, state.orderedPointIds), error: null };
    }
    case 'redo': {
      if (!state.future.length || state.transactionBefore) return state;
      const document = state.future[state.future.length - 1]!;
      return { ...state, document, past: pushHistory(state.past, state.document), future: state.future.slice(0, -1),
        selectionId: reconcileSelection(document, state.selectionId), orderedPointIds: reconcileOrdered(document, state.orderedPointIds), error: null };
    }
    case 'clear-error': return { ...state, error: null };
    case 'report-error': return { ...state, error: action.message };
    case 'select': {
      if (action.entityId === null) return { ...state, selectionId: null, orderedPointIds: [] };
      const entity = state.document.entities.find(item => item.id === action.entityId);
      const layer = state.document.layers.find(item => item.id === entity?.layerId);
      if (!layer?.visible) return state;
      const orderedPointIds = action.toggle && entity?.type === 'point'
        ? state.orderedPointIds.includes(entity.id) ? state.orderedPointIds.filter(id => id !== entity.id) : [...state.orderedPointIds, entity.id]
        : entity?.type === 'point' ? [entity.id] : [];
      return { ...state, selectionId: action.toggle && entity?.type === 'point' ? orderedPointIds[orderedPointIds.length - 1] ?? null : action.entityId, orderedPointIds };
    }
    case 'viewport': return { ...state, viewport: action.viewport };
    case 'pan': return { ...state, viewport: panViewport(state.viewport, action.delta) };
    case 'zoom': return { ...state, viewport: zoomAt(state.viewport, action.size, action.anchor, action.factor) };
    case 'tool': return { ...state, tool: action.tool };
    case 'toggle-grid': return { ...state, gridVisible: !state.gridVisible };
  }
}
