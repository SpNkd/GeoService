import type { GeoDocument } from '../domain/model';
import { aiTaskSchema, type AiIntent, type AiTaskIntent } from './intent';
import { pointNameIndex, resolveNamedPointReferences, resolveReferencedIntent, type BoundaryReady, type PolylineReady,
  type DimensionReady, type MeasureReady, type ResolutionFailure, type ExplicitResolutions, type PointNameIndex } from './resolver';
interface PlanBase { id: string; text: string; basedOnDocument: GeoDocument; choices: ExplicitResolutions }
export type AiPlan =
  | (PlanBase & { kind: 'boundary'; intent: Extract<AiIntent, { type: 'create_boundary_from_named_points' }>; requiresConfirmation: true; resolution: ResolutionFailure | BoundaryReady })
  | (PlanBase & { kind: 'polyline'; intent: Extract<AiIntent, { type: 'create_polyline_from_named_points' }>; requiresConfirmation: true; resolution: ResolutionFailure | PolylineReady })
  | (PlanBase & { kind: 'dimension'; intent: Extract<AiIntent, { type: 'create_dimension_between_named_points' }>; requiresConfirmation: true; offsetOverride: number | null; offsetEndpoints: readonly string[] | null; resolution: ResolutionFailure | DimensionReady })
  | (PlanBase & { kind: 'measure'; intent: Extract<AiIntent, { type: 'measure_between_named_points' }>; requiresConfirmation: false; resolution: ResolutionFailure | MeasureReady });
export type MutationPlan = Extract<AiPlan, { requiresConfirmation: true }>;

export interface ResolvedAiTaskPlan extends PlanBase {
  task: AiTaskIntent;
  actions: AiPlan[];
  resolution: { status: 'ready' } | ResolutionFailure;
  mutationCount: number;
  readOnlyCount: number;
  requiresConfirmation: boolean;
}
export function resolveAiTaskPlan(task: AiTaskIntent, document: GeoDocument, choices: ExplicitResolutions = new Map(),
  options: { id?: string; text?: string; offsets?: ReadonlyMap<string, number>; index?: PointNameIndex; actionIds?: readonly string[]; offsetBindings?: ReadonlyMap<string, readonly string[]> } = {}): ResolvedAiTaskPlan {
  const id = options.id ?? 'task', text = options.text ?? '';
  const base = { id, text, basedOnDocument: document, choices };
  const mutationCount = task.actions.filter(action => action.type !== 'measure_between_named_points').length;
  const result: ResolvedAiTaskPlan = { ...base, task, actions: [], resolution: { status: 'ready' }, mutationCount,
    readOnlyCount: task.actions.length - mutationCount, requiresConfirmation: mutationCount > 0 };
  const parsed = aiTaskSchema.safeParse(task);
  if (!parsed.success) return { ...result, resolution: { status: 'invalid', message: 'Неверный semantic task или превышен budget' } };
  task = parsed.data; result.task = task;
  const names = [...new Set(task.actions.flatMap(action => action.pointNames))];
  const shared = resolveNamedPointReferences(names, document, choices, options.index ?? pointNameIndex(document.entities), false);
  const byName = shared.status === 'resolved' ? new Map(shared.references.map(ref => [ref.name, ref])) : null;
  // Only target-layer metadata accumulates. Every named reference always comes from the original document.
  let layerDocument = document;
  for (const [index, intent] of task.actions.entries()) {
    const actionId = options.actionIds?.[index] ?? `${id}-action-${index + 1}`;
    let offsetOverride = options.offsets?.get(actionId) ?? null;
    const references = byName ? intent.pointNames.map(name => byName.get(name)!) : [];
    const previousEndpoints = options.offsetBindings?.get(actionId);
    if (byName && previousEndpoints && (previousEndpoints.length !== references.length || references.some((ref, i) => ref.vertexId !== previousEndpoints[i]))) offsetOverride = null;
    const offsetEndpoints = offsetOverride === null ? null : previousEndpoints ?? (byName ? references.map(ref => ref.vertexId) : null);
    const resolution = shared.status !== 'resolved' ? shared : resolveReferencedIntent(intent,
      { references, geometry: references.map(ref => ref.position), warnings: shared.warnings }, layerDocument,
      { entityId: task.actions.length === 1 ? `geometry-${id}` : `geometry-${actionId}`, ...(offsetOverride === null ? {} : { offset: offsetOverride }) });
    const actionBase = { ...base, id: actionId, intent };
    switch (intent.type) {
      case 'create_boundary_from_named_points':
        if (resolution.status !== 'ready' || resolution.kind === 'boundary') result.actions.push({ ...actionBase, intent, kind: 'boundary', requiresConfirmation: true, resolution });
        break;
      case 'create_polyline_from_named_points':
        if (resolution.status !== 'ready' || resolution.kind === 'polyline') result.actions.push({ ...actionBase, intent, kind: 'polyline', requiresConfirmation: true, resolution });
        break;
      case 'create_dimension_between_named_points':
        if (resolution.status !== 'ready' || resolution.kind === 'dimension') result.actions.push({ ...actionBase, intent, kind: 'dimension', requiresConfirmation: true, offsetOverride, offsetEndpoints, resolution });
        break;
      case 'measure_between_named_points':
        if (resolution.status !== 'ready' || resolution.kind === 'measure') result.actions.push({ ...actionBase, intent, kind: 'measure', requiresConfirmation: false, resolution });
        break;
    }
    if (resolution.status !== 'ready' && result.resolution.status === 'ready') result.resolution = resolution;
    if (resolution.status === 'ready' && 'command' in resolution && resolution.command.type === 'add-entity' && resolution.command.layer)
      layerDocument = { ...layerDocument, layers: [...layerDocument.layers, resolution.command.layer] };
  }
  if (result.actions.length !== task.actions.length) result.resolution = { status: 'invalid', message: 'Resolver/action mismatch' };
  if (mutationCount + document.entities.length > 50000)
    result.resolution = { status: 'invalid', message: 'Превышен лимит объектов документа всем пакетом' };
  return result;
}
export function refreshTask(plan: ResolvedAiTaskPlan, document: GeoDocument): ResolvedAiTaskPlan {
  const offsets = new Map<string, number>(), offsetBindings = new Map<string, readonly string[]>();
  for (const action of plan.actions) if (action.kind === 'dimension' && action.offsetOverride !== null) {
    offsets.set(action.id, action.offsetOverride);
    if (action.offsetEndpoints) offsetBindings.set(action.id, action.offsetEndpoints);
  }
  return resolveAiTaskPlan(plan.task, document, plan.choices, { id: plan.id, text: plan.text, offsets, offsetBindings,
    actionIds: plan.actions.map(action => action.id) });
}
