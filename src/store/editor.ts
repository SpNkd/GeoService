import type { GeoDocument, Viewport } from '../domain/model';
import { applyCommand, type DocumentCommand } from '../domain/commands';
import { panViewport, zoomAt, type ScreenPoint, type ViewSize } from '../geometry';

export interface EditorState {
  document: GeoDocument;
  viewport: Viewport;
  selectionId: string | null;
  tool: 'select' | 'pan';
  gridVisible: boolean;
}
export type EditorAction =
  | { type: 'command'; command: DocumentCommand }
  | { type: 'select'; entityId: string | null }
  | { type: 'viewport'; viewport: Viewport }
  | { type: 'pan'; delta: ScreenPoint }
  | { type: 'zoom'; anchor: ScreenPoint; size: ViewSize; factor: number }
  | { type: 'tool'; tool: EditorState['tool'] }
  | { type: 'toggle-grid' };

export function initialEditorState(document: GeoDocument): EditorState {
  return { document, viewport: { ...document.viewport, center: { ...document.viewport.center } }, selectionId: null, tool: 'select', gridVisible: true };
}
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'command': {
      const document = applyCommand(state.document, action.command);
      const selected = document.entities.find(entity => entity.id === state.selectionId);
      const layer = document.layers.find(item => item.id === selected?.layerId);
      return { ...state, document, selectionId: layer?.visible && !layer.locked ? state.selectionId : null };
    }
    case 'select': {
      if (action.entityId === null) return { ...state, selectionId: null };
      const entity = state.document.entities.find(item => item.id === action.entityId);
      const layer = state.document.layers.find(item => item.id === entity?.layerId);
      return layer?.visible && !layer.locked ? { ...state, selectionId: action.entityId } : state;
    }
    case 'viewport': return { ...state, viewport: action.viewport };
    case 'pan': return { ...state, viewport: panViewport(state.viewport, action.delta) };
    case 'zoom': return { ...state, viewport: zoomAt(state.viewport, action.size, action.anchor, action.factor) };
    case 'tool': return { ...state, tool: action.tool };
    case 'toggle-grid': return { ...state, gridVisible: !state.gridVisible };
  }
}
