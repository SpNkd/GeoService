import type { PointsReady, RectangleReady } from './construction';
import type { DocumentCommand } from '../domain/commands';
import { parseCommand } from '../domain/commandSchema';
import { getVertex, vertexPoint, type GeoDocument, type PointEntity, type WorldPoint } from '../domain/model';
import { pathLength, polygonArea } from '../geometry';
import { measurePair, polygonSelfIntersects } from '../geometry/survey';
import { aiIntentSchema, createBoundaryIntentSchema, type AiIntent } from './intent';

export type ExplicitResolutions = ReadonlyMap<string, string>;
export type PointNameIndex = ReadonlyMap<string, readonly PointEntity[]>;
export function buildPointNameIndex(entities: GeoDocument['entities']): PointNameIndex {
  const index = new Map<string, PointEntity[]>();
  for (const entity of entities) if (entity.type === 'point') {
    const name = entity.name.trim(), matches = index.get(name);
    if (matches) matches.push(entity); else index.set(name, [entity]);
  }
  return index;
}
const indexes = new WeakMap<GeoDocument['entities'], PointNameIndex>();
const entityIds = new WeakMap<GeoDocument['entities'], ReadonlySet<string>>();
export function pointNameIndex(entities: GeoDocument['entities']): PointNameIndex {
  let index = indexes.get(entities);
  if (!index) { index = buildPointNameIndex(entities); indexes.set(entities, index); }
  return index;
}
function idsFor(entities: GeoDocument['entities']) {
  let ids = entityIds.get(entities);
  if (!ids || ids.size !== entities.length) { ids = new Set(entities.map(entity => entity.id)); entityIds.set(entities, ids); }
  return ids;
}
export interface ResolvedReference { name: string; entityId: string; vertexId: string; position: WorldPoint; layer: string }
export type ResolutionIssue = { kind: 'missing'; name: string } | { kind: 'ambiguous'; name: string; candidates: ResolvedReference[] };
export type ResolutionFailure = { status: 'blocked'; dependencyIndex: number; message: string } | { status: 'unresolved'; issues: ResolutionIssue[] } | { status: 'invalid'; message: string };
export interface References { references: ResolvedReference[]; geometry: WorldPoint[]; warnings: string[] }
export type ReferenceResolution = ResolutionFailure | ({ status: 'resolved' } & References);
export interface ResolvedPolygonOutput { readonly kind: 'created_polygon'; readonly entityId: string;
  readonly vertexIds: readonly string[]; readonly references: readonly ResolvedReference[] }
export type ResolvedBoundaryOutput = ResolvedPolygonOutput;
export type BoundaryReady = { status: 'ready'; kind: 'boundary'; perimeter: number; area: number; output: ResolvedBoundaryOutput; targetLayer: 'boundary'; command: DocumentCommand } & References;
export type PolylineReady = { status: 'ready'; kind: 'polyline'; length: number; segments: number; targetLayer: 'boundary'; command: DocumentCommand } & References;
export type DimensionReady = { status: 'ready'; kind: 'dimension'; metrics: ReturnType<typeof measurePair>; offset: number; targetLayer: 'dimensions'; command: DocumentCommand } & References;
export type MeasureReady = { status: 'ready'; kind: 'measure'; metrics: ReturnType<typeof measurePair> } & References;
export type ReadyResolution = BoundaryReady | PolylineReady | DimensionReady | MeasureReady | PointsReady | RectangleReady;
export type Resolution = ResolutionFailure | ReadyResolution;
export type BoundaryResolution = ResolutionFailure | BoundaryReady;
export type ResolverOptions = { entityId?: string; index?: PointNameIndex; offset?: number };

/** Exact, ordered and pure; every operation shares missing/ambiguous/hidden/locked semantics. */
export function resolveNamedPointReferences(pointNames: readonly string[], document: GeoDocument,
  choices: ExplicitResolutions = new Map(), index = buildPointNameIndex(document.entities), distinctVertices = true): ReferenceResolution {
  const names = pointNames.map(name => name.trim());
  if (new Set(names).size !== names.length) return { status: 'invalid', message: 'Имена точек в запросе повторяются' };
  const layers = new Map(document.layers.map(layer => [layer.id, layer]));
  const reference = (entity: PointEntity): ResolvedReference => ({ name: entity.name.trim(), entityId: entity.id, vertexId: entity.vertexId,
    position: vertexPoint(getVertex(document.vertices, entity.vertexId)), layer: layers.get(entity.layerId)?.name ?? entity.layerId });
  const issues: ResolutionIssue[] = [], points: PointEntity[] = [];
  for (const name of names) {
    const candidates = index.get(name) ?? [], choice = choices.get(name);
    const chosen = choice ? candidates.find(candidate => candidate.id === choice) : undefined;
    if (choice && !chosen) return { status: 'invalid', message: `Выбранная точка «${name}» больше не соответствует имени. Отмените план и уточните запрос.` };
    if (!candidates.length) issues.push({ kind: 'missing', name });
    else if (candidates.length > 1 && !chosen) issues.push({ kind: 'ambiguous', name, candidates: candidates.map(reference) });
    else points.push(chosen ?? candidates[0]!);
  }
  if (issues.length) return { status: 'unresolved', issues };
  if (distinctVertices && new Set(points.map(point => point.vertexId)).size !== points.length) return { status: 'invalid', message: 'Точки ссылаются на повторяющиеся вершины' };
  const references = points.map(reference);
  const warnings = points.filter(point => !layers.get(point.layerId)?.visible).map(point => `«${point.name}»: исходный слой скрыт`);
  if (points.some(point => layers.get(point.layerId)?.locked)) warnings.push('Есть точки в заблокированных слоях: используем ссылки, координаты не изменяем.');
  return { status: 'resolved', references, geometry: references.map(item => item.position), warnings };
}
/** Presentation in metres; signed user overrides are local, finite and bounded. */
export const defaultDimensionOffset = (distance: number) => Math.min(10, Math.max(0.5, distance * 0.1));
export const MAX_DIMENSION_OFFSET = 10000;

function mutationCommand(document: GeoDocument, kind: 'boundary' | 'polyline' | 'dimension', refs: References, options: ResolverOptions):
  { command: DocumentCommand; warnings: string[] } | { message: string } {
  const layerId = kind === 'dimension' ? 'dimensions' : 'boundary';
  const target = document.layers.find(layer => layer.id === layerId);
  if (target && (!target.visible || target.locked)) return { message: `Слой ${layerId} скрыт или заблокирован. Сделайте его видимым и доступным.` };
  const style = document.styles.find(style => style.id === (kind === 'dimension' ? 'annotation' : 'boundary')) ?? document.styles[0];
  if (!target && !style) return { message: `Нет стиля для нового слоя ${layerId}` };
  if (document.entities.length >= 50000 || (!target && document.layers.length >= 1000)) return { message: 'Превышен лимит объектов или слоёв документа' };
  const ids = idsFor(document.entities), type = kind === 'boundary' ? 'polygon' : kind;
  let suffix = document.entities.length + 1, entityId = options.entityId ?? `${type}-${layerId}-${suffix}`;
  while (!options.entityId && ids.has(entityId)) entityId = `${type}-${layerId}-${++suffix}`;
  if (ids.has(entityId)) return { message: 'ID объекта уже используется' };
  const base = { id: entityId, layerId, name: `${kind === 'boundary' ? 'Граница' : kind === 'dimension' ? 'Размер' : 'Полилиния'} ${document.entities.length + 1}` };
  const command = parseCommand({ type: 'add-entity', vertices: [], entity: kind === 'dimension'
    ? { ...base, type: 'dimension', startVertexId: refs.references[0]!.vertexId, endVertexId: refs.references[1]!.vertexId, offset: options.offset }
    : { ...base, type, vertexIds: refs.references.map(point => point.vertexId) },
    ...(!target ? { layer: { id: layerId, name: kind === 'dimension' ? 'Размеры' : 'Граница участка', visible: true, locked: false,
      order: Math.max(-1, ...document.layers.map(layer => layer.order)) + 1, styleId: style!.id } } : {}) });
  return { command, warnings: [...refs.warnings, ...(!target ? [`Слой ${layerId} будет создан вместе с объектом.`] : [])] };
}
function boundary(refs: References, document: GeoDocument, options: ResolverOptions): BoundaryResolution {
  if (polygonSelfIntersects(refs.geometry)) return { status: 'invalid', message: 'Граница самопересекается. Измените порядок точек.' };
  const area = polygonArea(refs.geometry), perimeter = pathLength(refs.geometry, true);
  if (!Number.isFinite(area) || !Number.isFinite(perimeter) || area <= 0) return { status: 'invalid', message: 'Граница имеет нулевую площадь или неконечные метрики' };
  const mutation = mutationCommand(document, 'boundary', refs, options);
  if ('message' in mutation) return { status: 'invalid', message: mutation.message };
  if (mutation.command.type !== 'add-entity') throw new Error('Boundary output/command mismatch');
  const output: ResolvedBoundaryOutput = { kind: 'created_polygon', entityId: mutation.command.entity.id,
    vertexIds: refs.references.map(ref => ref.vertexId), references: refs.references };
  return { ...refs, ...mutation, status: 'ready', kind: 'boundary', area, perimeter, output, targetLayer: 'boundary' };
}
function polyline(refs: References, document: GeoDocument, options: ResolverOptions): ResolutionFailure | PolylineReady {
  const length = pathLength(refs.geometry);
  if (!Number.isFinite(length)) return { status: 'invalid', message: 'Неконечная длина полилинии' };
  const mutation = mutationCommand(document, 'polyline', refs, options);
  if ('message' in mutation) return { status: 'invalid', message: mutation.message };
  return { ...refs, ...mutation, status: 'ready', kind: 'polyline', length, segments: refs.references.length - 1, targetLayer: 'boundary' };
}
function pair(refs: References) {
  const metrics = measurePair(refs.geometry[0]!, refs.geometry[1]!);
  return metrics.horizontal > 0 && Object.values(metrics.delta).every(Number.isFinite) && Number.isFinite(metrics.horizontal)
    && (metrics.spatial === null || Number.isFinite(metrics.spatial)) ? metrics : null;
}
function dimension(refs: References, document: GeoDocument, options: ResolverOptions): ResolutionFailure | DimensionReady {
  const metrics = pair(refs);
  if (!metrics) return { status: 'invalid', message: 'Требуются две разные точки с ненулевым горизонтальным расстоянием' };
  const offset = options.offset ?? defaultDimensionOffset(metrics.horizontal);
  if (!Number.isFinite(offset) || Math.abs(offset) > MAX_DIMENSION_OFFSET) return { status: 'invalid', message: 'Смещение должно быть конечным и не превышать ±10000 м' };
  const mutation = mutationCommand(document, 'dimension', refs, { ...options, offset });
  if ('message' in mutation) return { status: 'invalid', message: mutation.message };
  return { ...refs, ...mutation, status: 'ready', kind: 'dimension', metrics, offset, targetLayer: 'dimensions' };
}
function measure(refs: References): ResolutionFailure | MeasureReady {
  const metrics = pair(refs);
  return metrics ? { ...refs, status: 'ready', kind: 'measure', metrics }
    : { status: 'invalid', message: 'Требуются две разные точки с ненулевым горизонтальным расстоянием' };
}
export function resolveIntent(raw: AiIntent, document: GeoDocument, choices: ExplicitResolutions = new Map(), options: ResolverOptions = {}): Resolution {
  const parsed = aiIntentSchema.safeParse(raw);
  if (!parsed.success) return { status: 'invalid', message: 'Неверный intent' };
  const refs = resolveNamedPointReferences(parsed.data.pointNames, document, choices, options.index);
  if (refs.status !== 'resolved') return refs;
  return resolveReferencedIntent(parsed.data, refs, document, options);
}
export function resolveReferencedIntent(intent: AiIntent, refs: References, document: GeoDocument, options: ResolverOptions = {}): Resolution {
  if (new Set(refs.references.map(ref => ref.name)).size !== refs.references.length) return { status: 'invalid', message: 'Имена точек в запросе повторяются' };
  if (new Set(refs.references.map(ref => ref.vertexId)).size !== refs.references.length) return { status: 'invalid', message: 'Точки ссылаются на повторяющиеся вершины' };
  switch (intent.type) {
    case 'create_boundary_from_named_points': return boundary(refs, document, options);
    case 'create_polyline_from_named_points': return polyline(refs, document, options);
    case 'create_dimension_between_named_points': return dimension(refs, document, options);
    case 'measure_between_named_points': return measure(refs);
  }
}
/** Existing boundary entry point retains its narrow runtime contract. */
export function resolveCreateBoundaryIntent(raw: AiIntent, document: GeoDocument, choices: ExplicitResolutions = new Map(), options: ResolverOptions = {}): BoundaryResolution {
  if (!createBoundaryIntentSchema.safeParse(raw).success) return { status: 'invalid', message: 'Неверный intent создания границы' };
  const result = resolveIntent(raw, document, choices, options);
  if (result.status !== 'ready' || result.kind === 'boundary') return result;
  return { status: 'invalid', message: 'Неверный intent создания границы' };
}
