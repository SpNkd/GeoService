import type { DocumentCommand } from '../domain/commands';
import { parseCommand } from '../domain/commandSchema';
import { getVertex, vertexPoint, type GeoDocument, type PointEntity, type WorldPoint } from '../domain/model';
import { pathLength, polygonArea } from '../geometry';
import { polygonSelfIntersects } from '../geometry/survey';
import { aiIntentSchema, type AiIntent } from './intent';

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
// Immutable entity-array identity changes on rename/import/delete, but stays stable during coordinate drags.
const indexes = new WeakMap<GeoDocument['entities'], PointNameIndex>();
export function pointNameIndex(entities: GeoDocument['entities']): PointNameIndex {
  let index = indexes.get(entities);
  if (!index) { index = buildPointNameIndex(entities); indexes.set(entities, index); }
  return index;
}
export interface ResolvedReference { name: string; entityId: string; vertexId: string; position: WorldPoint; layer: string }
export type ResolutionIssue = { kind: 'missing'; name: string } | { kind: 'ambiguous'; name: string; candidates: ResolvedReference[] };
export type BoundaryResolution =
  | { status: 'unresolved'; issues: ResolutionIssue[] }
  | { status: 'invalid'; message: string }
  | { status: 'ready'; references: ResolvedReference[]; geometry: WorldPoint[]; perimeter: number; area: number;
      targetLayer: 'boundary'; command: DocumentCommand; warnings: string[] };

/** Pure. Runtime IDs are supplied by the application; the default allocation is deterministic. */
export function resolveCreateBoundaryIntent(raw: AiIntent, document: GeoDocument, choices: ExplicitResolutions = new Map(),
  options: { entityId?: string; index?: PointNameIndex } = {}): BoundaryResolution {
  const parsed = aiIntentSchema.safeParse(raw);
  if (!parsed.success) return { status: 'invalid', message: 'Неверный intent создания границы' };
  const intent = parsed.data;
  if (new Set(intent.pointNames).size !== intent.pointNames.length) return { status: 'invalid', message: 'Имена точек в запросе повторяются' };
  const index = options.index ?? buildPointNameIndex(document.entities);
  const layers = new Map(document.layers.map(layer => [layer.id, layer]));
  const reference = (entity: PointEntity): ResolvedReference => ({ name: entity.name.trim(), entityId: entity.id, vertexId: entity.vertexId,
    position: vertexPoint(getVertex(document.vertices, entity.vertexId)), layer: layers.get(entity.layerId)?.name ?? entity.layerId });
  const issues: ResolutionIssue[] = [], points: PointEntity[] = [];
  for (const name of intent.pointNames) {
    const candidates = index.get(name) ?? [];
    const choice = choices.get(name);
    const chosen = choice ? candidates.find(candidate => candidate.id === choice) : undefined;
    if (choice && !chosen) return { status: 'invalid', message: `Выбранная точка «${name}» больше не соответствует имени. Отмените план и уточните запрос.` };
    if (!candidates.length) issues.push({ kind: 'missing', name });
    else if (candidates.length > 1 && !chosen) issues.push({ kind: 'ambiguous', name, candidates: candidates.map(reference) });
    else points.push(chosen ?? candidates[0]!);
  }
  if (issues.length) return { status: 'unresolved', issues };
  if (new Set(points.map(point => point.vertexId)).size !== points.length) return { status: 'invalid', message: 'Точки ссылаются на повторяющиеся вершины' };
  const references = points.map(reference), geometry = references.map(item => item.position);
  if (polygonSelfIntersects(geometry)) return { status: 'invalid', message: 'Граница самопересекается. Измените порядок точек.' };
  const area = polygonArea(geometry), perimeter = pathLength(geometry, true);
  if (!Number.isFinite(area) || !Number.isFinite(perimeter) || area <= 0) return { status: 'invalid', message: 'Граница имеет нулевую площадь или неконечные метрики' };
  const target = layers.get('boundary');
  if (target && (!target.visible || target.locked)) return { status: 'invalid', message: 'Слой boundary скрыт или заблокирован. Сделайте его видимым и доступным.' };
  const style = document.styles.find(style => style.id === 'boundary') ?? document.styles[0];
  if (!target && !style) return { status: 'invalid', message: 'Нет стиля для нового слоя boundary' };
  if (document.entities.length >= 50000 || (!target && document.layers.length >= 1000)) return { status: 'invalid', message: 'Превышен лимит объектов или слоёв документа' };
  const ids = new Set(document.entities.map(entity => entity.id));
  let suffix = document.entities.length + 1, entityId = options.entityId ?? `polygon-boundary-${suffix}`;
  while (!options.entityId && ids.has(entityId)) entityId = `polygon-boundary-${++suffix}`;
  if (ids.has(entityId)) return { status: 'invalid', message: 'ID границы уже используется' };
  const warnings = points.filter(point => !layers.get(point.layerId)?.visible).map(point => `«${point.name}»: исходный слой скрыт`);
  if (points.some(point => layers.get(point.layerId)?.locked)) warnings.push('Есть точки в заблокированных слоях: используем ссылки, координаты не изменяем.');
  if (!target) warnings.push('Слой boundary будет создан вместе с границей.');
  const command = parseCommand({ type: 'add-entity', vertices: [], entity: { type: 'polygon', id: entityId,
    name: `Граница ${document.entities.length + 1}`, layerId: 'boundary', vertexIds: points.map(point => point.vertexId) },
    ...(!target ? { layer: { id: 'boundary', name: 'Граница участка', visible: true, locked: false,
      order: Math.max(-1, ...document.layers.map(layer => layer.order)) + 1, styleId: style!.id } } : {}) });
  return { status: 'ready', references, geometry, area, perimeter, targetLayer: 'boundary', command, warnings };
}
