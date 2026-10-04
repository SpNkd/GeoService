import type { GeoDocument } from '../domain/model';
import { parseCommand } from '../domain/commandSchema';
import { editorReducer, type EditorAction, type EditorState } from '../store/editor';
import type { AiIntent } from './intent';
import type { RequestEvent } from './provider';
import { pointNameIndex, resolveCreateBoundaryIntent, type BoundaryResolution, type ExplicitResolutions } from './resolver';

export interface AiPlan { id: string; text: string; intent: AiIntent; basedOnDocument: GeoDocument;
  choices: ExplicitResolutions; resolution: BoundaryResolution }
export type AiState = { status: 'idle' } | { status: 'parsing'; id: string; text: string }
  | { status: 'preview' | 'stale'; plan: AiPlan; notice: string | null }
  | { status: 'applied'; id: string } | { status: 'error'; message: string };
export interface ApplicationState { editor: EditorState; ai: AiState }
export type ApplicationAction = EditorAction | { type: 'ai-event'; event: RequestEvent }
  | { type: 'ai-cancel' } | { type: 'ai-choose'; name: string; entityId: string }
  | { type: 'ai-apply' } | { type: 'ai-refresh' };
function resolvePlan(plan: Omit<AiPlan, 'resolution' | 'basedOnDocument'>, document: GeoDocument): AiPlan {
  return { ...plan, basedOnDocument: document, resolution: resolveCreateBoundaryIntent(plan.intent, document, plan.choices,
    { entityId: `polygon-${plan.id}`, index: pointNameIndex(document.entities) }) };
}
export type ExecutionGateResult = { status: 'blocked'; message: string } | { status: 'refreshed'; plan: AiPlan }
  | { status: 'execute'; command: ReturnType<typeof parseCommand>; expectedDocument: GeoDocument };
/** Explicit application gate. It authorizes an existing command, never mutates the document. */
export function boundaryExecutionGate(plan: AiPlan, editor: EditorState): ExecutionGateResult {
  if (editor.transactionBefore) return { status: 'blocked', message: 'Завершите редактирование координат перед Apply.' };
  if (plan.basedOnDocument !== editor.document) return { status: 'refreshed', plan: resolvePlan(plan, editor.document) };
  if (plan.resolution.status !== 'ready') return { status: 'blocked', message: 'Сначала разрешите все точки и ошибки плана.' };
  return { status: 'execute', command: parseCommand(plan.resolution.command), expectedDocument: editor.document };
}
export function applicationReducer(state: ApplicationState, action: ApplicationAction): ApplicationState {
  switch (action.type) {
    case 'ai-cancel': return { ...state, ai: { status: 'idle' } };
    case 'ai-event': {
      const event = action.event;
      if (event.type === 'start') return { ...state, ai: { status: 'parsing', id: event.id, text: event.text } };
      if (state.ai.status !== 'parsing' || state.ai.id !== event.id) return state;
      if (event.type === 'failure') return { ...state, ai: { status: 'error', message: event.message } };
      if ('status' in event.result) return { ...state, ai: { status: 'error', message: 'Эта команда пока не поддерживается.' } };
      return { ...state, ai: { status: 'preview', notice: null, plan: resolvePlan({ id: event.id, text: state.ai.text,
        intent: event.result, choices: new Map() }, state.editor.transactionBefore ?? state.editor.document) } };
    }
    case 'ai-choose': {
      if (state.ai.status !== 'preview' || state.editor.transactionBefore) return state;
      const choices = new Map(state.ai.plan.choices); choices.set(action.name, action.entityId);
      return { ...state, ai: { status: 'preview', notice: state.ai.notice,
        plan: resolvePlan({ ...state.ai.plan, choices }, state.editor.document) } };
    }
    case 'ai-refresh': {
      if ((state.ai.status !== 'preview' && state.ai.status !== 'stale') || state.editor.transactionBefore) return state;
      return { ...state, ai: { status: 'preview', notice: 'Документ изменился. План пересчитан. Подтвердите обновлённый план.',
        plan: resolvePlan(state.ai.plan, state.editor.document) } };
    }
    case 'ai-apply': {
      if (state.ai.status !== 'preview' && state.ai.status !== 'stale') return state;
      const gate = boundaryExecutionGate(state.ai.plan, state.editor);
      if (gate.status === 'blocked') return { ...state, ai: { ...state.ai, notice: gate.message } };
      if (gate.status === 'refreshed' || state.ai.status === 'stale') return applicationReducer(state, { type: 'ai-refresh' });
      const editor = editorReducer(state.editor, { type: 'execute', command: gate.command, expectedDocument: gate.expectedDocument });
      if (editor.error || editor.document === state.editor.document) return { ...state, editor,
        ai: { ...state.ai, notice: editor.error ?? 'Команда не выполнена. Пересчитайте план.' } };
      return { editor, ai: { status: 'applied', id: state.ai.plan.id } };
    }
    default: {
      const editor = editorReducer(state.editor, action);
      if (editor === state.editor) return state;
      if (editor.documentEpoch !== state.editor.documentEpoch) return { editor, ai: { status: 'idle' } };
      const changed = (editor.transactionBefore ?? editor.document) !== (state.editor.transactionBefore ?? state.editor.document);
      const ai = changed && (state.ai.status === 'preview' || state.ai.status === 'stale')
        ? { ...state.ai, status: 'stale' as const, notice: 'Документ изменился. Пересчитайте план перед Apply.' } : state.ai;
      return { editor, ai };
    }
  }
}
