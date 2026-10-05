import type { GeoDocument } from '../domain/model';
import { parseCommand } from '../domain/commandSchema';
import { editorReducer, type EditorAction, type EditorState } from '../store/editor';
import { AI_LIMITS, aiTaskSchema } from './intent';
import type { AiErrorCode } from './reliability';
import type { RequestEvent } from './provider';
import { resolveAiTaskPlan, refreshTask, taskCommands, type ResolvedAiTaskPlan } from './task';
export type { AiPlan, MutationPlan, ResolvedAiTaskPlan } from './task';

export type AiState = { status: 'needs_clarification'; originalText: string; questions: string[] } | { status: 'idle' } | { status: 'parsing'; id: string; text: string }
  | { status: 'preview' | 'stale'; plan: ResolvedAiTaskPlan; notice: string | null }
  | { status: 'applied'; id: string; results: ResolvedAiTaskPlan | null } | { status: 'error'; message: string; code?: AiErrorCode; id?: string; originalText?: string };
export interface ApplicationState { editor: EditorState; ai: AiState }
export type ApplicationAction = EditorAction | { type: 'ai-event'; event: RequestEvent }
  | { type: 'ai-cancel' } | { type: 'ai-choose'; name: string; entityId: string }
  | { type: 'ai-apply' } | { type: 'ai-refresh' } | { type: 'ai-offset'; actionId?: string; offset: number };
export type ExecutionGateResult = { status: 'blocked'; message: string } | { status: 'refreshed'; plan: ResolvedAiTaskPlan }
  | { status: 'execute'; commands: ReturnType<typeof parseCommand>[]; expectedDocument: GeoDocument };
/** One authorization gate; actual mutation belongs to the editor's general atomic batch capability. */
export function mutationExecutionGate(plan: ResolvedAiTaskPlan, editor: EditorState): ExecutionGateResult {
  if (editor.transactionBefore) return { status: 'blocked', message: 'Завершите редактирование координат перед Apply.' };
  if (plan.basedOnDocument !== editor.document) return { status: 'refreshed', plan: refreshTask(plan, editor.document) };
  if (!aiTaskSchema.safeParse(plan.task).success || plan.resolution.status !== 'ready' || !plan.mutationCount
    || plan.actions.length !== plan.task.actions.length || plan.actions.some(action => action.resolution.status !== 'ready'))
    return { status: 'blocked', message: 'Сначала разрешите все точки и ошибки плана.' };
  const commands = taskCommands(plan).map(parseCommand);
  if (commands.length !== plan.generatedCommandCount || commands.length > AI_LIMITS.generatedCommands || !plan.projectedDocument)
    return { status: 'blocked', message: 'Неверный пакет команд' };
  return { status: 'execute', commands, expectedDocument: editor.document };
}
export function applicationReducer(state: ApplicationState, action: ApplicationAction): ApplicationState {
  switch (action.type) {
    case 'ai-cancel': return { ...state, ai: { status: 'idle' } };
    case 'ai-event': {
      const event = action.event;
      if (event.type === 'start') return { ...state, ai: { status: 'parsing', id: event.id, text: event.text } };
      if (state.ai.status !== 'parsing' || state.ai.id !== event.id) return state;
      if (event.type === 'failure') return { ...state, ai: { status: 'error', message: event.message, ...(event.code ? { code: event.code } : {}), id: event.id, originalText: state.ai.text } };
      if ('status' in event.result && event.result.status === 'needs_clarification') return { ...state, ai: { status: 'needs_clarification', originalText: state.ai.text, questions: event.result.questions } };
      if ('status' in event.result) return { ...state, ai: { status: 'error', message: 'Эта команда пока не поддерживается.', code: 'UNSUPPORTED', id: event.id, originalText: state.ai.text } };
      return { ...state, ai: { status: 'preview', notice: null, plan: resolveAiTaskPlan(event.result,
        state.editor.transactionBefore ?? state.editor.document, new Map(), { id: event.id, text: state.ai.text }) } };
    }
    case 'ai-choose': {
      if (state.ai.status !== 'preview' || state.editor.transactionBefore) return state;
      const choices = new Map(state.ai.plan.choices); choices.set(action.name, action.entityId);
      return { ...state, ai: { status: 'preview', notice: state.ai.notice,
        plan: refreshTask({ ...state.ai.plan, choices }, state.editor.document) } };
    }
    case 'ai-refresh': {
      if ((state.ai.status !== 'preview' && state.ai.status !== 'stale') || state.editor.transactionBefore) return state;
      return { ...state, ai: { status: 'preview', notice: 'Документ изменился. План пересчитан. Подтвердите обновлённый план.',
        plan: refreshTask(state.ai.plan, state.editor.document) } };
    }
    case 'ai-offset': {
      if (state.ai.status !== 'preview' || state.editor.transactionBefore) return state;
      const plan = state.ai.plan, selected = plan.actions.find(item => action.actionId ? item.id === action.actionId : item.kind === 'dimension');
      if (selected?.kind !== 'dimension') return state;
      const offsets = new Map(plan.actions.flatMap(item => item.kind === 'dimension' && item.offsetOverride !== null ? [[item.id, item.offsetOverride] as const] : []));
      offsets.set(selected.id, action.offset);
      const offsetBindings = new Map(plan.actions.flatMap(item => item.kind === 'dimension' && item.offsetEndpoints ? [[item.id, item.offsetEndpoints] as const] : []));
      if (selected.resolution.status === 'ready') offsetBindings.set(selected.id, selected.resolution.references.map(ref => ref.vertexId));
      return { ...state, ai: { ...state.ai, plan: resolveAiTaskPlan(plan.task, state.editor.document, plan.choices, { id: plan.id, text: plan.text, offsets, offsetBindings }) } };
    }
    case 'ai-apply': {
      if ((state.ai.status !== 'preview' && state.ai.status !== 'stale') || !state.ai.plan.requiresConfirmation) return state;
      const gate = mutationExecutionGate(state.ai.plan, state.editor);
      if (gate.status === 'blocked') return { ...state, ai: { ...state.ai, notice: gate.message } };
      if (gate.status === 'refreshed' || state.ai.status === 'stale') return applicationReducer(state, { type: 'ai-refresh' });
      const editor = editorReducer(state.editor, { type: 'execute-batch', commands: gate.commands, expectedDocument: gate.expectedDocument });
      if (editor.error || editor.document === state.editor.document) return { ...state, editor,
        ai: { ...state.ai, notice: editor.error ?? 'Команда не выполнена. Пересчитайте план.' } };
      const actions = state.ai.plan.task.actions.filter(item => item.type === 'measure_between_named_points');
      const results = actions.length ? resolveAiTaskPlan({ actions }, editor.document, state.ai.plan.choices,
        { id: state.ai.plan.id, text: state.ai.plan.text, actionIds: state.ai.plan.actions.filter(item => !item.requiresConfirmation).map(item => item.id) }) : null;
      return { editor, ai: { status: 'applied', id: state.ai.plan.id, results } };
    }
    default: {
      const editor = editorReducer(state.editor, action);
      if (editor === state.editor) return state;
      if (editor.documentEpoch !== state.editor.documentEpoch) return { editor, ai: { status: 'idle' } };
      const committed = editor.transactionBefore ?? editor.document;
      const changed = committed !== (state.editor.transactionBefore ?? state.editor.document);
      let ai = state.ai;
      if (changed && (ai.status === 'preview' || ai.status === 'stale')) ai = ai.plan.requiresConfirmation
        ? { ...ai, status: 'stale', notice: 'Документ изменился. Пересчитайте план перед Apply.' }
        : { status: 'preview', plan: refreshTask(ai.plan, committed), notice: 'Измерение обновлено по текущему документу.' };
      else if (changed && ai.status === 'applied' && ai.results) ai = { ...ai, results: refreshTask(ai.results, committed) };
      return { editor, ai };
    }
  }
}
