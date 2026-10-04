import type { GeoDocument } from '../domain/model';
import { parseCommand } from '../domain/commandSchema';
import { editorReducer, type EditorAction, type EditorState } from '../store/editor';
import type { AiIntent } from './intent';
import type { RequestEvent } from './provider';
import { pointNameIndex, resolveIntent, type BoundaryReady, type PolylineReady, type DimensionReady, type MeasureReady,
  type ResolutionFailure, type ExplicitResolutions } from './resolver';

interface PlanBase { id: string; text: string; basedOnDocument: GeoDocument; choices: ExplicitResolutions }
export type AiPlan =
  | (PlanBase & { kind: 'boundary'; intent: Extract<AiIntent, { type: 'create_boundary_from_named_points' }>; requiresConfirmation: true; resolution: ResolutionFailure | BoundaryReady })
  | (PlanBase & { kind: 'polyline'; intent: Extract<AiIntent, { type: 'create_polyline_from_named_points' }>; requiresConfirmation: true; resolution: ResolutionFailure | PolylineReady })
  | (PlanBase & { kind: 'dimension'; intent: Extract<AiIntent, { type: 'create_dimension_between_named_points' }>; requiresConfirmation: true; offsetOverride: number | null; resolution: ResolutionFailure | DimensionReady })
  | (PlanBase & { kind: 'measure'; intent: Extract<AiIntent, { type: 'measure_between_named_points' }>; requiresConfirmation: false; resolution: ResolutionFailure | MeasureReady });
export type MutationPlan = Extract<AiPlan, { requiresConfirmation: true }>;
export type AiState = { status: 'idle' } | { status: 'parsing'; id: string; text: string }
  | { status: 'preview' | 'stale'; plan: AiPlan; notice: string | null }
  | { status: 'applied'; id: string } | { status: 'error'; message: string };
export interface ApplicationState { editor: EditorState; ai: AiState }
export type ApplicationAction = EditorAction | { type: 'ai-event'; event: RequestEvent }
  | { type: 'ai-cancel' } | { type: 'ai-choose'; name: string; entityId: string }
  | { type: 'ai-apply' } | { type: 'ai-refresh' } | { type: 'ai-offset'; offset: number };
function resolvePlan(seed: PlanBase & { intent: AiIntent }, document: GeoDocument, offsetOverride: number | null = null): AiPlan {
  const base = { ...seed, basedOnDocument: document };
  const resolution = resolveIntent(seed.intent, document, seed.choices, { entityId: `geometry-${seed.id}`, index: pointNameIndex(document.entities),
    ...(offsetOverride === null ? {} : { offset: offsetOverride }) });
  // The union preserves operation-specific ready data; failures are shared across all kinds.
  switch (seed.intent.type) {
    case 'create_boundary_from_named_points':
      if (resolution.status !== 'ready' || resolution.kind === 'boundary') return { ...base, intent: seed.intent, kind: 'boundary', requiresConfirmation: true, resolution };
      break;
    case 'create_polyline_from_named_points':
      if (resolution.status !== 'ready' || resolution.kind === 'polyline') return { ...base, intent: seed.intent, kind: 'polyline', requiresConfirmation: true, resolution };
      break;
    case 'create_dimension_between_named_points':
      if (resolution.status !== 'ready' || resolution.kind === 'dimension') return { ...base, intent: seed.intent, kind: 'dimension', requiresConfirmation: true, offsetOverride, resolution };
      break;
    case 'measure_between_named_points':
      if (resolution.status !== 'ready' || resolution.kind === 'measure') return { ...base, intent: seed.intent, kind: 'measure', requiresConfirmation: false, resolution };
      break;
  }
  throw new Error('Resolver/intent mismatch');
}
const refreshPlan = (plan: AiPlan, document: GeoDocument) => resolvePlan(plan, document, plan.kind === 'dimension' ? plan.offsetOverride : null);
export type ExecutionGateResult = { status: 'blocked'; message: string } | { status: 'refreshed'; plan: AiPlan }
  | { status: 'execute'; command: ReturnType<typeof parseCommand>; expectedDocument: GeoDocument };
/** Explicit application gate. It authorizes an existing command, never mutates the document. */
export function mutationExecutionGate(plan: MutationPlan, editor: EditorState): ExecutionGateResult {
  if (editor.transactionBefore) return { status: 'blocked', message: 'Завершите редактирование координат перед Apply.' };
  if (plan.basedOnDocument !== editor.document) return { status: 'refreshed', plan: refreshPlan(plan, editor.document) };
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
        intent: event.result, choices: new Map(), basedOnDocument: state.editor.document }, state.editor.transactionBefore ?? state.editor.document) } };
    }
    case 'ai-choose': {
      if (state.ai.status !== 'preview' || state.editor.transactionBefore) return state;
      const choices = new Map(state.ai.plan.choices); choices.set(action.name, action.entityId);
      return { ...state, ai: { status: 'preview', notice: state.ai.notice,
        plan: refreshPlan({ ...state.ai.plan, choices }, state.editor.document) } };
    }
    case 'ai-refresh': {
      if ((state.ai.status !== 'preview' && state.ai.status !== 'stale') || state.editor.transactionBefore) return state;
      return { ...state, ai: { status: 'preview', notice: 'Документ изменился. План пересчитан. Подтвердите обновлённый план.',
        plan: refreshPlan(state.ai.plan, state.editor.document) } };
    }
    case 'ai-offset': {
      if (state.ai.status !== 'preview' || state.ai.plan.kind !== 'dimension' || state.editor.transactionBefore) return state;
      return { ...state, ai: { ...state.ai, plan: resolvePlan(state.ai.plan, state.editor.document, action.offset) } };
    }
    case 'ai-apply': {
      if (state.ai.status !== 'preview' && state.ai.status !== 'stale') return state;
      if (!state.ai.plan.requiresConfirmation) return state;
      const gate = mutationExecutionGate(state.ai.plan, state.editor);
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
        ? state.ai.plan.requiresConfirmation
          ? { ...state.ai, status: 'stale' as const, notice: 'Документ изменился. Пересчитайте план перед Apply.' }
          : { status: 'preview' as const, plan: refreshPlan(state.ai.plan, editor.transactionBefore ?? editor.document), notice: 'Измерение обновлено по текущему документу.' }
        : state.ai;
      return { editor, ai };
    }
  }
}
