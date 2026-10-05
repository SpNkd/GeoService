import { resolveSpatialAction, type ArrayReady } from './spatial';
import { resolveEntityReference, type EntityReferenceContext } from './entityReferences';
import { resolveCreatePoints, resolveCreateRectangle, type PointsReady, type RectangleReady } from './construction';
import { applyCommandsAtomically, type DocumentCommand } from '../domain/commands';
import type { GeoDocument } from '../domain/model';
import { AI_LIMITS, aiTaskSchema, requestedPointNames, type AiAction, type AiIntent, type AiTaskIntent } from './intent';
import { pointNameIndex, resolveNamedPointReferences, resolveReferencedIntent, type BoundaryReady, type PolylineReady,
  type DimensionReady, type MeasureReady, type ResolutionFailure, type ExplicitResolutions, type PointNameIndex, type ResolvedBoundaryOutput, type ReadyResolution } from './resolver';
import { resolveBoundaryEdgeDimensions, type BulkDimensionsReady, type ResolveContext } from './dependent';
import type { LayoutAssumption } from './assumptions';
interface PlanBase { id: string; text: string; basedOnDocument: GeoDocument; choices: ExplicitResolutions }
export type AiPlan =
  | (PlanBase & { kind: 'array'; intent: Extract<AiAction, { type: 'create_rectangle_array' }>; requiresConfirmation: true; resolution: ResolutionFailure | ArrayReady })
  | (PlanBase & { kind: 'edge-line'; intent: Extract<AiAction, { type: 'create_line_along_polygon_edge' }>; requiresConfirmation: true; resolution: ResolutionFailure | PolylineReady })
  | (PlanBase & { kind: 'points'; intent: Extract<AiAction, { type: 'create_points' }>; requiresConfirmation: true; resolution: ResolutionFailure | PointsReady })
  | (PlanBase & { kind: 'rectangle'; intent: Extract<AiAction, { type: 'create_rectangle' }>; requiresConfirmation: true; resolution: ResolutionFailure | RectangleReady })
  | (PlanBase & { kind: 'boundary'; intent: Extract<AiIntent, { type: 'create_boundary_from_named_points' }>; requiresConfirmation: true; resolution: ResolutionFailure | BoundaryReady })
  | (PlanBase & { kind: 'polyline'; intent: Extract<AiIntent, { type: 'create_polyline_from_named_points' }>; requiresConfirmation: true; resolution: ResolutionFailure | PolylineReady })
  | (PlanBase & { kind: 'dimension'; intent: Extract<AiIntent, { type: 'create_dimension_between_named_points' }>; requiresConfirmation: true; offsetOverride: number | null; offsetEndpoints: readonly string[] | null; resolution: ResolutionFailure | DimensionReady })
  | (PlanBase & { kind: 'measure'; intent: Extract<AiIntent, { type: 'measure_between_named_points' }>; requiresConfirmation: false; resolution: ResolutionFailure | MeasureReady })
  | (PlanBase & { kind: 'bulk-dimensions'; intent: Extract<AiAction, { type: 'create_dimensions_for_boundary_edges' }>; requiresConfirmation: true; resolution: ResolutionFailure | BulkDimensionsReady });
export type MutationPlan = Extract<AiPlan, { requiresConfirmation: true }>;

export interface ResolvedAiTaskPlan extends PlanBase {
  referenceEntityIds: string[];
  targetLayerId: string;
  selectionEntityIds: readonly string[];
  assumptions: LayoutAssumption[];
  task: AiTaskIntent;
  actions: AiPlan[];
  resolution: { status: 'ready' } | ResolutionFailure;
  mutationCount: number;
  generatedCommandCount: number;
  projectedDocument: GeoDocument | null;
  readOnlyCount: number;
  requiresConfirmation: boolean;
}
export function resolveAiTaskPlan(task: AiTaskIntent, document: GeoDocument, choices: ExplicitResolutions = new Map(),
  options: { targetLayerId?: string; selectionEntityIds?: readonly string[]; id?: string; text?: string; offsets?: ReadonlyMap<string, number>; index?: PointNameIndex; actionIds?: readonly string[]; offsetBindings?: ReadonlyMap<string, readonly string[]> } = {}): ResolvedAiTaskPlan {
  const id = options.id ?? 'task', text = options.text ?? '';
  const targetLayerId=options.targetLayerId ?? document.layers.find(l=>l.id==='boundary')?.id ?? document.layers[0]!.id;
  const selectionEntityIds=options.selectionEntityIds ?? [];
  const base = { id, text, basedOnDocument: document, choices };
  const mutationCount = task.actions.filter(action => action.type !== 'measure_between_named_points').length;
  const result: ResolvedAiTaskPlan = { ...base, referenceEntityIds: [], targetLayerId, selectionEntityIds, task, assumptions: [], actions: [], resolution: { status: 'ready' }, mutationCount,
    generatedCommandCount: 0, projectedDocument: null, readOnlyCount: task.actions.length - mutationCount, requiresConfirmation: mutationCount > 0 };
  const parsed = aiTaskSchema.safeParse(task);
  if (!parsed.success) return { ...result, resolution: { status: 'invalid', message: 'Неверный semantic task или превышен budget' } };
  task = parsed.data; result.task = task;
  const createdNames = new Set(task.actions.flatMap(action => action.type === 'create_points' ? action.points.map(point => point.name) : []));
  const names = [...new Set(task.actions.flatMap(requestedPointNames))].filter(name => !createdNames.has(name));
  const shared = resolveNamedPointReferences(names, document, choices, options.index ?? pointNameIndex(document.entities), false);
  const byName = shared.status === 'resolved' ? new Map(shared.references.map(ref => [ref.name, ref])) : null;
  // References remain anchored in the base document. Mutation outputs are projected privately in semantic order.
  let projectedDocument = document;
  const boundaryOutputs = new Map<number, ResolvedBoundaryOutput>();
  for (const [index, intent] of task.actions.entries()) {
    const actionId = options.actionIds?.[index] ?? `${id}-action-${index + 1}`;
    let offsetOverride = options.offsets?.get(actionId) ?? null;
    const newReferences = resolveNamedPointReferences(requestedPointNames(intent).filter(name => createdNames.has(name)), projectedDocument, choices, pointNameIndex(projectedDocument.entities), false);
    const available = new Map(byName ?? []);
    if (newReferences.status === 'resolved') for (const ref of newReferences.references) available.set(ref.name, ref);
    const references = requestedPointNames(intent).map(name => available.get(name)).filter((ref): ref is NonNullable<typeof ref> => Boolean(ref));
    const previousEndpoints = options.offsetBindings?.get(actionId);
    if (byName && previousEndpoints && (previousEndpoints.length !== references.length || references.some((ref, i) => ref.vertexId !== previousEndpoints[i]))) offsetOverride = null;
    const offsetEndpoints = offsetOverride === null ? null : previousEndpoints ?? (byName ? references.map(ref => ref.vertexId) : null);
    const context: ResolveContext = { targetLayerId, baseDocument: document, projectedDocument, boundaryOutputs, referenceResolutions: byName ?? new Map() };
    const entityContext:EntityReferenceContext={baseDocument:document,projectedDocument,outputs:boundaryOutputs,choices,selectionEntityIds};
    const spatialReference='reference'in intent?intent.reference:intent.type==='create_rectangle'&&'reference'in intent.placement?intent.placement.reference:null;
    if(spatialReference){const ref=resolveEntityReference(spatialReference,entityContext);if(ref.status==='resolved'&&!result.referenceEntityIds.includes(ref.entity.id)) result.referenceEntityIds.push(ref.entity.id);}
    let resolution = intent.type==='create_rectangle_array'||intent.type==='create_line_along_polygon_edge'?resolveSpatialAction(intent,projectedDocument,entityContext,actionId,targetLayerId)
      : intent.type === 'create_points' ? resolveCreatePoints(intent, projectedDocument, actionId, targetLayerId)
      : intent.type === 'create_rectangle' ? resolveCreateRectangle(intent, projectedDocument, boundaryOutputs, actionId, {targetLayerId,context:entityContext})
      : intent.type === 'create_dimensions_for_boundary_edges' ? resolveBoundaryEdgeDimensions(intent, context, actionId)
      : shared.status !== 'resolved' ? shared : newReferences.status !== 'resolved' ? newReferences : resolveReferencedIntent(intent,
        { references, geometry: references.map(ref => ref.position), warnings: shared.warnings }, projectedDocument,
        { targetLayerId, entityId: task.actions.length === 1 ? `geometry-${id}` : `geometry-${actionId}`, ...(offsetOverride === null ? {} : { offset: offsetOverride }) });
    if(resolution.status==='ready' && intent.type!=='measure_between_named_points' && !document.layers.some(l=>l.id===targetLayerId&&l.visible&&!l.locked)) resolution={status:'invalid',message:'Выберите видимый незаблокированный слой новых объектов.'};
    if (resolution.status === 'ready') {
      const commands = commandsForResolution(resolution);
      result.generatedCommandCount += commands.length;
      if (result.generatedCommandCount > AI_LIMITS.generatedCommands) resolution = { status: 'invalid',
        message: `Пакет из ${result.generatedCommandCount} команд превышает лимит ${AI_LIMITS.generatedCommands}` };
      else if (commands.length) {
        try { projectedDocument = applyCommandsAtomically(projectedDocument, commands); }
        catch (error) { resolution = { status: 'invalid', message: error instanceof Error ? error.message : 'Не удалось построить projected document' }; }
      }
    }
    if (resolution.status === 'ready' && (resolution.kind === 'rectangle'||resolution.kind==='array')) result.assumptions.push(...resolution.assumptions);
    if (resolution.status === 'ready' && (resolution.kind === 'boundary' || resolution.kind === 'rectangle')) boundaryOutputs.set(index, resolution.output);
    const actionBase = { ...base, id: actionId, intent };
    switch (intent.type) {
      case 'create_rectangle_array': if(resolution.status!=='ready'||resolution.kind==='array') result.actions.push({...actionBase,intent,kind:'array',requiresConfirmation:true,resolution}); break;
      case 'create_line_along_polygon_edge': if(resolution.status!=='ready'||resolution.kind==='polyline') result.actions.push({...actionBase,intent,kind:'edge-line',requiresConfirmation:true,resolution}); break;
      case 'create_points': if (resolution.status !== 'ready' || resolution.kind === 'points') result.actions.push({ ...actionBase, intent, kind: 'points', requiresConfirmation: true, resolution }); break;
      case 'create_rectangle': if (resolution.status !== 'ready' || resolution.kind === 'rectangle') result.actions.push({ ...actionBase, intent, kind: 'rectangle', requiresConfirmation: true, resolution }); break;
      case 'create_dimensions_for_boundary_edges':
        if (resolution.status !== 'ready' || resolution.kind === 'bulk-dimensions') result.actions.push({ ...actionBase, intent, kind: 'bulk-dimensions', requiresConfirmation: true, resolution });
        break;
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
  }
  if (result.actions.length !== task.actions.length) result.resolution = { status: 'invalid', message: 'Resolver/action mismatch' };
  if (result.resolution.status === 'ready') result.projectedDocument = projectedDocument;
  return result;
}
export function commandsForResolution(resolution: ArrayReady | BulkDimensionsReady | ReadyResolution): DocumentCommand[] {
  return resolution.kind === 'array' ? resolution.rectangles.map(r=>r.command) : resolution.kind === 'bulk-dimensions' ? resolution.dimensions.map(dimension => dimension.command)
    : 'command' in resolution ? [resolution.command] : [];
}
export const taskCommands = (plan: ResolvedAiTaskPlan) => plan.actions.flatMap(action => action.resolution.status === 'ready' ? commandsForResolution(action.resolution) : []);
export function refreshTask(plan: ResolvedAiTaskPlan, document: GeoDocument): ResolvedAiTaskPlan {
  const offsets = new Map<string, number>(), offsetBindings = new Map<string, readonly string[]>();
  for (const action of plan.actions) if (action.kind === 'dimension' && action.offsetOverride !== null) {
    offsets.set(action.id, action.offsetOverride);
    if (action.offsetEndpoints) offsetBindings.set(action.id, action.offsetEndpoints);
  }
  return resolveAiTaskPlan(plan.task, document, plan.choices, { targetLayerId:plan.targetLayerId, selectionEntityIds:plan.selectionEntityIds, id: plan.id, text: plan.text, offsets, offsetBindings,
    actionIds: plan.actions.map(action => action.id) });
}

/** Compose existing renderer data; bulk has no separate SVG implementation. */
export function taskPreviews(plan: ResolvedAiTaskPlan): { id: string; result: ReadyResolution }[] {
  if (plan.resolution.status !== 'ready') return [];
  const previews: { id: string; result: ReadyResolution }[] = [];
  for (const action of plan.actions) if (action.resolution.status === 'ready') {
    if (action.resolution.kind === 'bulk-dimensions') action.resolution.dimensions.forEach((result, index) => previews.push({ id: `${action.id}-edge-${index + 1}`, result }));
    else if(action.resolution.kind==='array') action.resolution.rectangles.forEach((result,index)=>previews.push({id:`${action.id}-item-${index+1}`,result}));
    else previews.push({ id: action.id, result: action.resolution });
  }
  return previews;
}
