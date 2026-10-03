import type { GeoDocument, Viewport } from '../domain/model';
import { applyCommand, type DocumentCommand } from '../domain/commands';
import { panViewport, zoomAt, type ScreenPoint, type ViewSize } from '../geometry';

export type EditorTool = 'select' | 'pan' | 'point' | 'line' | 'polyline' | 'polygon' | 'text';
export interface EditorState {
  document: GeoDocument; viewport: Viewport; selectionId: string | null; tool: EditorTool; gridVisible: boolean;
  past: GeoDocument[]; future: GeoDocument[]; transactionBefore: GeoDocument | null; error: string | null;
}
export type EditorAction =
  | { type: 'execute'; command: DocumentCommand }
  | { type: 'transient'; command: DocumentCommand }
  | { type: 'begin-transaction' } | { type: 'commit-transaction' } | { type: 'cancel-transaction' }
  | { type: 'undo' } | { type: 'redo' } | { type: 'clear-error' }
  | { type: 'select'; entityId: string | null }
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

export function initialEditorState(document: GeoDocument): EditorState {
  return { document, viewport: { ...document.viewport, center: { ...document.viewport.center } }, selectionId: null, tool: 'select', gridVisible: true,
    past: [], future: [], transactionBefore: null, error: null };
}
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'execute': {
      if (state.transactionBefore) return state;
      try {
        const document = applyCommand(state.document, action.command);
        if (document === state.document) return { ...state, error: null };
        const hiddenSelection = action.command.type === 'set-layer-visibility' && !action.command.visible
          && state.document.entities.find(item => item.id === state.selectionId)?.layerId === action.command.layerId;
        return { ...state, document, past: pushHistory(state.past, state.document), future: [],
          selectionId: hiddenSelection ? null : reconcileSelection(document, state.selectionId), error: null };
      } catch (error) {
        return { ...state, error: error instanceof Error ? error.message : 'Не удалось изменить документ' };
      }
    }
    case 'transient': {
      if (!state.transactionBefore) return state;
      try { return { ...state, document: applyCommand(state.document, action.command), error: null }; }
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
        selectionId: reconcileSelection(document, state.selectionId), error: null };
    }
    case 'redo': {
      if (!state.future.length || state.transactionBefore) return state;
      const document = state.future[state.future.length - 1]!;
      return { ...state, document, past: pushHistory(state.past, state.document), future: state.future.slice(0, -1),
        selectionId: reconcileSelection(document, state.selectionId), error: null };
    }
    case 'clear-error': return { ...state, error: null };
    case 'select': {
      if (action.entityId === null) return { ...state, selectionId: null };
      const entity = state.document.entities.find(item => item.id === action.entityId);
      const layer = state.document.layers.find(item => item.id === entity?.layerId);
      return layer?.visible ? { ...state, selectionId: action.entityId } : state;
    }
    case 'viewport': return { ...state, viewport: action.viewport };
    case 'pan': return { ...state, viewport: panViewport(state.viewport, action.delta) };
    case 'zoom': return { ...state, viewport: zoomAt(state.viewport, action.size, action.anchor, action.factor) };
    case 'tool': return { ...state, tool: action.tool, error: null };
    case 'toggle-grid': return { ...state, gridVisible: !state.gridVisible };
  }
}
