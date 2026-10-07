import { insetPlacement,additionalPlacement } from './constraintGeometry';
import { entityPoints } from '../domain/model';
import { spatialFrame, spatialRectangle } from '../geometry/spatialLayout';
import { resolveEntityReference, type EntityReferenceContext } from './entityReferences';
import type { DocumentCommand } from '../domain/commands';
import { getVertex, worldVertex, type GeoDocument, type Layer, type WorldPoint } from '../domain/model';
import { labelAnchor } from '../geometry/labels';
import { bounds, pathLength, polygonArea } from '../geometry';
import { resolvePlacement, rectangleInsidePolygon } from '../geometry/autoPlacement';
import type { LayoutAssumption } from './assumptions';
import type { AiAction } from './intent';
import type { ResolvedBoundaryOutput, References, ResolutionFailure } from './resolver';

export type PointsReady = References & { status: 'ready'; kind: 'points'; command: DocumentCommand; targetLayer: string };
export type RectangleReady = References & { status: 'ready'; kind: 'rectangle'; command: DocumentCommand; targetLayer: string;
  width: number; height: number; area: number; perimeter: number; output: ResolvedBoundaryOutput; assumptions: LayoutAssumption[] };
function targetLayer(document: GeoDocument, id: string, name: string): { layer: Layer; addition?: Layer } | ResolutionFailure {
  const existing = document.layers.find(layer => layer.id === id);
  if (existing && (!existing.visible || existing.locked)) return { status: 'invalid', message: `Слой ${existing.name} скрыт или заблокирован` };
  if (existing) return { layer: existing };
  const layer: Layer = { id, name, visible: true, locked: false, order: Math.max(...document.layers.map(layer => layer.order)) + 1,
    styleId: document.styles.find(style => style.id === (id === 'survey-points' ? 'survey-point' : id === 'buildings' ? 'building' : 'boundary'))?.id ?? document.styles[0]!.id };
  return { layer, addition: layer };
}
export function resolveCreatePoints(intent: Extract<AiAction, { type: 'create_points' }>, document: GeoDocument, actionId: string, targetLayerId?: string): PointsReady | ResolutionFailure {
  if(targetLayerId && !document.layers.some(l=>l.id===targetLayerId)) return {status:'invalid',message:'Выберите существующий слой новых объектов.'};
  const names = intent.points.map(point => point.name);
  if (new Set(names).size !== names.length) return { status: 'invalid', message: 'Имена создаваемых точек повторяются' };
  const existing = new Set(document.entities.filter(entity => entity.type === 'point').map(entity => entity.name.trim()));
  const duplicate = names.find(name => existing.has(name));
  if (duplicate) return { status: 'invalid', message: `Точка «${duplicate}» уже существует. Укажите другое имя.` };
  const target = targetLayer(document, targetLayerId ?? 'survey-points', 'Геодезические точки'); if ('status' in target) return target;
  const points = intent.points.map((point, index) => ({ entity: { id: `${actionId}-point-${index + 1}`, type: 'point' as const, name: point.name,
    layerId: target.layer.id, vertexId: `${actionId}-vertex-${index + 1}` }, vertex: worldVertex(`${actionId}-vertex-${index + 1}`, { x: point.x, y: point.y, ...(point.z === undefined ? {} : { z: point.z }) }) }));
  const references = points.map(({ entity, vertex }) => ({ name: entity.name, entityId: entity.id, vertexId: vertex.id, position: { x: vertex.x, y: vertex.y, ...(vertex.z === undefined ? {} : { z: vertex.z }) }, layer: target.layer.name }));
  return { status: 'ready', kind: 'points', references, geometry: references.map(ref => ref.position), warnings: [], targetLayer: target.layer.id,
    command: { type: 'import-points', points, ...(target.addition ? { layer: target.addition } : {}) } };
}
export function resolveCreateRectangle(intent: Extract<AiAction, { type: 'create_rectangle' }>, document: GeoDocument,
  outputs: ReadonlyMap<number, ResolvedBoundaryOutput>, actionId: string, options: {targetLayerId?: string; context?: EntityReferenceContext} = {}): RectangleReady | ResolutionFailure {
  if(options.targetLayerId && !document.layers.some(l=>l.id===options.targetLayerId)) return {status:'invalid',message:'Выберите существующий слой новых объектов.'};
  const placement = intent.placement, assumptions: LayoutAssumption[] = [];
  let origin: WorldPoint, parentGeometry: WorldPoint[] | null = null;
  if (placement.type === 'lower_left') origin = { x: placement.x, y: placement.y };
  else if (placement.type === 'local_origin') { origin = { x: 0, y: 0 }; assumptions.push({ type: 'local_origin', objectName: intent.name }); }
  else if (placement.type === 'center') origin = { x: placement.x - intent.width / 2, y: placement.y - intent.height / 2 };
  else if(placement.type==='inside_boundary') {
    if(!options.context)return {status:'invalid',message:'Нет локального контекста границы'};
    const reference=placement.reference.kind==='action'?{kind:'prior_action_result' as const,actionIndex:placement.reference.actionIndex}:placement.reference;
    const ref=resolveEntityReference(reference,options.context,true);if(ref.status!=='resolved')return ref;
    parentGeometry=entityPoints(ref.entity,ref.document.vertices);
    const solved=insetPlacement(placement,parentGeometry,intent.width,intent.height);if('message'in solved)return solved.unsupported?{status:'unsupported',message:solved.message,alternatives:['Используйте прямоугольную границу в осях MODEL.']}:{status:'invalid',message:solved.message};
    origin=solved.origin;assumptions.push({type:'spatial',message:`${intent.name}: ${solved.explanation}`});
  }
  else if (placement.type === 'relative_to_entity' || placement.type === 'inside_entity') {
    if (!options.context) return {status:'invalid',message:'Нет локального контекста ссылки'};
    const ref=resolveEntityReference(placement.reference,options.context,placement.type==='inside_entity');
    if(ref.status!=='resolved') return ref;
    const frame=spatialFrame(options.context.baseDocument), geometry=entityPoints(ref.entity,ref.document.vertices);
    const direction=placement.type==='inside_entity'?placement.anchor:placement.direction;
    const gap=placement.type==='relative_to_entity'?placement.gapMeters:undefined;
    const layout=spatialRectangle(geometry,intent.width,intent.height,direction,frame,placement.type==='inside_entity',gap,placement.type==='inside_entity'&&ref.entity.type==='polygon'?labelAnchor(ref.document,ref.entity):undefined);
    if(layout.status!=='ready') return layout;
    origin=layout.origin;
    assumptions.push({type:'spatial',message:`Объект: «${ref.entity.name}». Направление: ${direction}. Направления: ${frame.name}. ${frame.stale?'Геопривязка устарела; используем MODEL. ':''}${layout.inset??`Gap: ${layout.gap.toFixed(3)} м (${gap==null?'Auto, эскизный':'явный'}). Центрирование по перпендикулярной оси.`}${direction.includes('_')?' Диагональ: одинаковый gap по двум осям.':''} Прямоугольник сохраняет оси MODEL.`});
  }
  else {
    const output = outputs.get(placement.polygonActionIndex);
    if (!output) return { status: 'blocked', dependencyIndex: placement.polygonActionIndex, message: `Сначала исправьте Action ${placement.polygonActionIndex + 1}: положение зависит от polygon output.` };
    const polygon = document.entities.find(entity => entity.id === output.entityId);
    if (!polygon || polygon.type !== 'polygon') return { status: 'invalid', message: 'Предыдущий polygon output не найден' };
    parentGeometry = output.references.map(ref => ref.position);
    const anchor = placement.type === 'centered_in_action_result' ? 'center' : placement.anchor;
    const parentBounds = bounds(parentGeometry);
    if (!parentBounds) return { status: 'invalid', message: 'Контур участка пуст' };
    const frame = spatialFrame(document);
    if (frame.name === 'SURVEY' || frame.stale) {
      const layout = spatialRectangle(parentGeometry, intent.width, intent.height, anchor, frame, true, undefined, labelAnchor(document, polygon));
      if (layout.status !== 'ready') return layout;
      origin = layout.origin;
      assumptions.push({type:'spatial',message:`Объект: «${polygon.name}». Направление: ${anchor}. Направления: ${frame.name}. ${frame.stale?'Геопривязка устарела; используем MODEL. ':''}${layout.inset} Эскизное размещение.`});
    } else {
      const layout = resolvePlacement(parentBounds, intent, anchor, { center: labelAnchor(document, polygon) });
      if (layout.status !== 'ready') return layout;
      origin = layout.origin;
      assumptions.push({ type: 'relative_placement', objectName: intent.name, parentName: polygon.name, anchor });
      if (anchor !== 'center') assumptions.push({ type: 'auto_layout_inset', objectName: intent.name, anchor, nominal: layout.nominalInset, x: layout.insetX, y: layout.insetY }, { type: 'sketch_layout' });
    }
  }
  if(placement.type==='relative_to_entity'&&intent.constraints?.some(c=>c.type==='containment'&&c.value==='inside'))return {status:'invalid',message:'Внешнее относительное размещение противоречит условию внутри объекта.'};
  const constrained=additionalPlacement(origin,parentGeometry,intent.width,intent.height,'anchor'in placement?placement.anchor:undefined,intent.constraints??[]);
  if('message'in constrained)return {status:'invalid',message:constrained.message};origin=constrained.origin;
  if(placement.type==='inside_boundary'&&parentGeometry){const check=insetPlacement({...placement,anchor:'south_west',offsetAlongSide:null},parentGeometry,intent.width,intent.height);if('message'in check)return {status:'invalid',message:check.message};const b=bounds(parentGeometry)!;if(origin.x<b.minX+Math.max(placement.inset.west,placement.minimumClearance)-1e-8||origin.x+intent.width>b.maxX-Math.max(placement.inset.east,placement.minimumClearance)+1e-8||origin.y<b.minY+Math.max(placement.inset.south,placement.minimumClearance)-1e-8||origin.y+intent.height>b.maxY-Math.max(placement.inset.north,placement.minimumClearance)+1e-8)return {status:'invalid',message:'Фиксированные расстояния противоречат минимальным отступам от границы.'};}
  const geometry = [origin, { x: origin.x + intent.width, y: origin.y }, { x: origin.x + intent.width, y: origin.y + intent.height }, { x: origin.x, y: origin.y + intent.height }];
  if (parentGeometry && !rectangleInsidePolygon(geometry, parentGeometry)) return { status: 'invalid', message: 'Эскизное размещение не помещается внутри контура участка. Измените размеры или положение.' };
  if (!geometry.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)) || geometry[1]!.x === origin.x || geometry[3]!.y === origin.y) return { status: 'invalid', message: 'Размеры прямоугольника вне точности/диапазона координат' };
  const target = targetLayer(document, options.targetLayerId ?? (/дом|house/i.test(intent.name) ? 'buildings' : 'boundary'), /дом|house/i.test(intent.name) ? 'Здания' : 'Граница участка');
  if ('status' in target) return target;
  const vertices = geometry.map((point, index) => worldVertex(`${actionId}-corner-${index + 1}`, point));
  const entity = { id: `geometry-${actionId}`, type: 'polygon' as const, name: intent.name, layerId: target.layer.id, vertexIds: vertices.map(vertex => vertex.id) as [string, string, string, ...string[]] };
  const references = vertices.map((vertex, index) => ({ name: `${intent.name} · ${index + 1}`, entityId: entity.id, vertexId: vertex.id, position: getVertex(Object.fromEntries(vertices.map(v => [v.id, v])), vertex.id), layer: target.layer.name }));
  const area = polygonArea(geometry), perimeter = pathLength(geometry, true);
  if (!Number.isFinite(area) || !Number.isFinite(perimeter) || area <= 0) return { status: 'invalid', message: 'Неконечные метрики прямоугольника' };
  return { status: 'ready', kind: 'rectangle', width: intent.width, height: intent.height, area, perimeter, geometry, references, warnings: [], assumptions,
    explanation:assumptions.filter(a=>a.type==='spatial').map(a=>a.message).join(' ') + (intent.constraints?.length?` Дополнительные условия: ${intent.constraints.map(c=>c.type==='fixed_side_distance'?`${c.side}: ровно ${c.distance} м`:c.type==='alignment'?c.relation:c.value).join('; ')}.`:''),
    targetLayer: target.layer.id, output: { kind: 'created_polygon', entityId: entity.id, vertexIds: entity.vertexIds, references },
    command: { type: 'add-entity', entity, vertices, ...(target.addition ? { layer: target.addition } : {}) } };
}
