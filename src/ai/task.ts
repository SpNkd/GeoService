import { dependencyIndices, type LocalAnswers, type LocalQuestion, type CoordinateProof } from './constraintSchema';
import { resolveConstraintAction, orientationQuestion,resolveConstraintReference } from './constraintResolution';
import { isProcessAction } from '../process/schema';
import { isDocumentAction } from '../documentOperations/schema';
import { resolveSpatialAction, type ArrayReady } from './spatial';
import { resolveEntityReference, type EntityReferenceContext } from './entityReferences';
import { resolveCreatePoints, resolveCreateRectangle, type PointsReady, type RectangleReady } from './construction';
import { applyCommandsAtomically, type DocumentCommand } from '../domain/commands';
import { entityPoints as importEntityPoints, type GeoDocument } from '../domain/model';
import { AI_LIMITS, aiTaskSchema, requestedPointNames, type AiAction, type AiIntent, type AiTaskIntent } from './intent';
import { pointNameIndex, resolveNamedPointReferences, resolveReferencedIntent, type BoundaryReady, type PolylineReady,
  type DimensionReady, type MeasureReady, type ResolutionFailure, type ExplicitResolutions, type PointNameIndex, type ResolvedBoundaryOutput, type ReadyResolution } from './resolver';
import { resolveBoundaryEdgeDimensions, type BulkDimensionsReady, type ResolveContext } from './dependent';
import type { LayoutAssumption } from './assumptions';
interface PlanBase { id: string; text: string; basedOnDocument: GeoDocument; choices: ExplicitResolutions }
export type AiPlan =
  | (PlanBase & {kind:'spatial-point';intent:Extract<AiAction,{type:'create_spatial_point'}>;requiresConfirmation:true;resolution:ResolutionFailure|PointsReady})
  | (PlanBase & {kind:'route';intent:Extract<AiAction,{type:'create_route'}>;requiresConfirmation:true;resolution:ResolutionFailure|PolylineReady})
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
  answers:LocalAnswers; clarifications:LocalQuestion[]; proofs:CoordinateProof[]; dependencyGraph:number[][]; timings:{dependencyMs:number;solveMs:number;routeMs:number;totalMs:number}; resolutionStatus:'RESOLVED'|'NEEDS_CLARIFICATION'|'UNSUPPORTED'|'INVALID';
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
  options: { answers?:LocalAnswers; targetLayerId?: string; selectionEntityIds?: readonly string[]; id?: string; text?: string; offsets?: ReadonlyMap<string, number>; index?: PointNameIndex; actionIds?: readonly string[]; offsetBindings?: ReadonlyMap<string, readonly string[]> } = {}): ResolvedAiTaskPlan {
  const started=performance.now(), answers=options.answers??new Map<string,string>();
  const id = options.id ?? 'task', text = options.text ?? '';
  const targetLayerId=options.targetLayerId ?? document.layers.find(l=>l.id==='boundary')?.id ?? document.layers[0]!.id;
  const selectionEntityIds=options.selectionEntityIds ?? [];
  const base = { id, text, basedOnDocument: document, choices };
  const mutationCount = task.actions.filter(action => action.type !== 'measure_between_named_points').length;
  const result: ResolvedAiTaskPlan = { ...base, answers,clarifications:[],proofs:[],dependencyGraph:task.actions.map(dependencyIndices),timings:{dependencyMs:0,solveMs:0,routeMs:0,totalMs:0},resolutionStatus:'RESOLVED',referenceEntityIds: [], targetLayerId, selectionEntityIds, task, assumptions: [], actions: [], resolution: { status: 'ready' }, mutationCount,
    generatedCommandCount: 0, projectedDocument: null, readOnlyCount: task.actions.length - mutationCount, requiresConfirmation: mutationCount > 0 };
  const parsed = aiTaskSchema.safeParse(task);
  if (!parsed.success) return { ...result,resolutionStatus:'INVALID', resolution: { status: 'invalid', message: 'Неверный semantic task или превышен budget' } };
  task = parsed.data; result.task = task;
  const createdNames = new Set(task.actions.flatMap(action => action.type === 'create_points' ? action.points.map(point => point.name) : action.type==='create_spatial_point'?[action.name]:[]));
  const names = [...new Set(task.actions.flatMap(requestedPointNames))].filter(name => !createdNames.has(name));
  const shared = resolveNamedPointReferences(names, document, choices, options.index ?? pointNameIndex(document.entities), false);
  const byName = shared.status === 'resolved' ? new Map(shared.references.map(ref => [ref.name, ref])) : null;
  // References remain anchored in the base document. Mutation outputs are projected privately in semantic order.
  let projectedDocument = document;
  const boundaryOutputs = new Map<number, ResolvedBoundaryOutput>();
  const results=new Map<number,{entity:import('../domain/model').Entity;document:GeoDocument}>();
  result.timings.dependencyMs=performance.now()-started;
  for (const [index, intent] of task.actions.entries()) {
    if(isDocumentAction(intent)||isProcessAction(intent)){result.resolution={status:'invalid',message:'Document operations use the local document resolver'};continue;}
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
    const spatialReference='reference'in intent?intent.reference:intent.type==='create_rectangle'&&intent.placement.type!=='inside_boundary'&&'reference'in intent.placement?intent.placement.reference:null;
    if(spatialReference){const ref=resolveEntityReference(spatialReference,entityContext);if(ref.status==='resolved'&&!result.referenceEntityIds.includes(ref.entity.id)) result.referenceEntityIds.push(ref.entity.id);}
    const actionStarted=performance.now();
    let orientation=intent.type==='create_rectangle'?(answers.get(`${actionId}:orientation`)??(intent.orientation==='ASK'?undefined:intent.orientation??'MODEL')):'MODEL';
    let alignmentFailure:ResolutionFailure|null=null,alignmentOrientation:string|null=null;
    if(intent.type==='create_rectangle')for(const c of intent.constraints??[])if(c.type==='alignment'){
      const ref=resolveConstraintReference(c.reference,{...entityContext,results,answers});
      if(ref.status!=='resolved'){alignmentFailure=ref;break;}
      const geometry=importEntityPoints(ref.entity,ref.document.vertices),a=geometry[0],b=geometry[1];
      if(!a||!b||Math.abs(a.x-b.x)>1e-8&&Math.abs(a.y-b.y)>1e-8){alignmentFailure={status:'unsupported',message:'Параллельное/перпендикулярное размещение пока поддерживает только осевые контуры MODEL.',alternatives:['Укажите ориентацию MODEL или поворот 90°.']};break;}
      const derived=(Math.abs(a.x-b.x)<1e-8)===(c.relation==='parallel')?'SWAPPED':'MODEL';
      const explicitOrientation=answers.get(`${actionId}:orientation`)??intent.orientation;
      if(alignmentOrientation&&alignmentOrientation!==derived){alignmentFailure={status:'invalid',message:'Несовместимые условия параллельности и перпендикулярности требуют разных ориентаций.'};break;}
      alignmentOrientation=derived;
      if(explicitOrientation&&explicitOrientation!=='ASK'&&explicitOrientation!==derived){alignmentFailure={status:'invalid',message:'Явная ориентация противоречит условию параллельности или перпендикулярности.'};break;}
      orientation=derived;
    }
    if(intent.type==='create_rectangle'&&!orientation&&!alignmentFailure){
      const checks=[intent,{...intent,width:intent.height,height:intent.width}].map(r=>resolveCreateRectangle(r,projectedDocument,boundaryOutputs,actionId,{targetLayerId,context:entityContext}));
      if(checks.every(r=>r.status!=='ready'))alignmentFailure=checks[0] as ResolutionFailure;
    }
    const rectangle=intent.type==='create_rectangle'&&orientation==='SWAPPED'?{...intent,width:intent.height,height:intent.width}:intent;
    let resolution = alignmentFailure??(intent.type==='create_rectangle'&&!orientation?{status:'needs_clarification' as const,questions:[orientationQuestion(actionId,intent.name,intent.width,intent.height)]}
      : intent.type==='create_spatial_point'||intent.type==='create_route'?resolveConstraintAction(intent,projectedDocument,{...entityContext,results,answers},actionId,targetLayerId)
      : intent.type==='create_rectangle_array'||intent.type==='create_line_along_polygon_edge'?resolveSpatialAction(intent,projectedDocument,entityContext,actionId,targetLayerId)
      : intent.type === 'create_points' ? resolveCreatePoints(intent, projectedDocument, actionId, targetLayerId)
      : intent.type === 'create_rectangle' ? resolveCreateRectangle(rectangle as Extract<AiAction,{type:'create_rectangle'}>, projectedDocument, boundaryOutputs, actionId, {targetLayerId,context:entityContext})
      : intent.type === 'create_dimensions_for_boundary_edges' ? resolveBoundaryEdgeDimensions(intent, context, actionId)
      : shared.status !== 'resolved' ? shared : newReferences.status !== 'resolved' ? newReferences : resolveReferencedIntent(intent,
        { references, geometry: references.map(ref => ref.position), warnings: shared.warnings }, projectedDocument,
        { targetLayerId, entityId: task.actions.length === 1 ? `geometry-${id}` : `geometry-${actionId}`, ...(offsetOverride === null ? {} : { offset: offsetOverride }) }));
    const elapsed=performance.now()-actionStarted;if(intent.type==='create_route')result.timings.routeMs+=elapsed;else result.timings.solveMs+=elapsed;
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
    if(resolution.status==='ready') {
      if((intent.type==='create_rectangle'||intent.type==='create_spatial_point'||intent.type==='create_route'||intent.type==='create_points')&&'geometry'in resolution){
        const proof:CoordinateProof={provenance:intent.type==='create_points'?'USER_EXPLICIT':'RESOLVER_DERIVED',actionIndex:index,constraint:resolution.explanation??(intent.type==='create_rectangle'?JSON.stringify(intent.placement):'Explicit user coordinates'),coordinates:resolution.geometry.map(p=>({x:p.x,y:p.y})),dependencies:result.dependencyGraph[index]!};
        resolution={...resolution,derivations:[proof]};result.proofs.push(proof);
      }
      const command=commandsForResolution(resolution)[0];
      const entity=command?.type==='add-entity'?command.entity:command?.type==='import-points'&&command.points.length===1?command.points[0]!.entity:null;
      if(entity)results.set(index,{entity,document:projectedDocument});
      if(intent.type==='create_rectangle'&&(intent.placement.type==='inside_boundary'||intent.orientation))result.assumptions.push({type:'spatial',message:`${intent.name}: ${orientation==='SWAPPED'?intent.height:intent.width} м по X и ${orientation==='SWAPPED'?intent.width:intent.height} м по Y; ${intent.orientation===undefined?'эскизная ориентация MODEL по порядку размеров':'выбранная ориентация'}.`});
      if(intent.type==='create_route')result.assumptions.push({type:'spatial',message:'Труба — обычная эскизная полилиния внутри границы. Отступ сооружений относится к дому и точке, а не к трубе вдоль границы. Конец — ближайшая точка контура цели.'});
    }
    if(resolution.status==='needs_clarification')result.clarifications.push(...resolution.questions);
    if (resolution.status === 'ready' && (resolution.kind === 'rectangle'||resolution.kind==='array')) result.assumptions.push(...resolution.assumptions);
    if (resolution.status === 'ready' && (resolution.kind === 'boundary' || resolution.kind === 'rectangle')) boundaryOutputs.set(index, resolution.output);
    const actionBase = { ...base, id: actionId, intent };
    switch (intent.type) {
      case 'create_spatial_point':if(resolution.status!=='ready'||resolution.kind==='points')result.actions.push({...actionBase,intent,kind:'spatial-point',requiresConfirmation:true,resolution});break;
      case 'create_route':if(resolution.status!=='ready'||resolution.kind==='polyline')result.actions.push({...actionBase,intent,kind:'route',requiresConfirmation:true,resolution});break;
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
  if(result.resolution.status==='unresolved')for(const issue of result.resolution.issues)if(issue.kind==='ambiguous')result.clarifications.push({questionId:issue.name,kind:'entity_choice',prompt:`Выберите ${issue.displayName??issue.name}`,context:'Объекты разрешаются локально; их данные не отправляются AI.',options:issue.candidates.map(c=>({value:c.entityId,label:`${c.name} · ${c.layer} · ${c.entityId}`}))});
  const fatal=result.actions.find(a=>a.resolution.status==='invalid'||a.resolution.status==='unsupported');
  if(fatal&&fatal.resolution.status!=='ready'){result.resolution=fatal.resolution;result.clarifications=[];}
  result.resolutionStatus=result.resolution.status==='ready'?'RESOLVED':result.resolution.status==='unsupported'?'UNSUPPORTED':result.resolution.status==='invalid'?'INVALID':result.clarifications.length?'NEEDS_CLARIFICATION':'INVALID';
  result.timings.totalMs=performance.now()-started;
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
  return resolveAiTaskPlan(plan.task, document, plan.choices, { answers:plan.answers,targetLayerId:plan.targetLayerId, selectionEntityIds:plan.selectionEntityIds, id: plan.id, text: plan.text, offsets, offsetBindings,
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

/** Local-only developer evidence; never added to an AI provider payload or saved document. */
export function constraintDiagnostics(plan:ResolvedAiTaskPlan) {return {resolutionStatus:plan.resolutionStatus,semanticValidation:'valid',constraintResolution:plan.resolution.status,clarificationCount:plan.clarifications.length,derivedConstraintCount:plan.proofs.filter(p=>p.provenance==='RESOLVER_DERIVED').length,dependencyGraph:plan.dependencyGraph,answers:[...plan.answers],proofs:plan.proofs,timings:plan.timings};}
