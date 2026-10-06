import { presentationZ } from '../view/projection';
import { modelToAbsoluteZ } from './georeferencing';
import type { Entity, GeoDocument, LabelEntity, WorldPoint } from '../domain/model';
import { entityVertexIds, getVertex, vertexPoint } from '../domain/model';
import { DISPLAY_PRECISION, formatCoordinate, formatHeight, formatMeasure } from './format';
import { bounds, distance, pathLength, polygonArea } from './index';

export function labelAnchor(document: GeoDocument, target: Entity): WorldPoint {
  if (!['point','line','polyline','polygon','symbol'].includes(target.type)) throw new Error('Целевой объект не поддерживает подпись');
  if (target.type === 'symbol') return { ...target.position };
  const points = entityVertexIds(target).map(id => vertexPoint(getVertex(document.vertices, id)));
  if (target.type === 'point') return points[0]!;
  if (target.type === 'line') return { ...(points.some(p=>p.z!==undefined)?{z:(presentationZ(points[0]!)+presentationZ(points[1]!))/2}:{}), x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 };
  if (target.type === 'polyline') {
    const total = pathLength(points);
    if (!total) return points[0]!;
    const middle = total / 2;
    let passed = 0;
    for (let i = 1; i < points.length; i++) {
      const length = distance(points[i - 1]!, points[i]!);
      if (passed + length >= middle) {
        const t = length ? (middle - passed) / length : 0;
        return { ...(points.some(p=>p.z!==undefined)?{z:presentationZ(points[i-1]!)+(presentationZ(points[i]!)-presentationZ(points[i-1]!))*t}:{}), x: points[i - 1]!.x + (points[i]!.x - points[i - 1]!.x) * t, y: points[i - 1]!.y + (points[i]!.y - points[i - 1]!.y) * t };
      }
      passed += length;
    }
    return points.at(-1)!;
  }
  const origin = points[0]!;
  let crossSum = 0, xSum = 0, ySum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    const cross = (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y);
    crossSum += cross; xSum += (a.x + b.x - 2 * origin.x) * cross; ySum += (a.y + b.y - 2 * origin.y) * cross;
  }
  if (Math.abs(crossSum) > 1e-12) return { ...(points.some(p=>p.z!==undefined)?{z:points.reduce((n,p)=>n+presentationZ(p),0)/points.length}:{}), x: origin.x + xSum / (3 * crossSum), y: origin.y + ySum / (3 * crossSum) };
  const box = bounds(points)!;
  return { ...(points.some(p=>p.z!==undefined)?{z:points.reduce((n,p)=>n+presentationZ(p),0)/points.length}:{}), x: box.minX / 2 + box.maxX / 2, y: box.minY / 2 + box.maxY / 2 };
}

export function defaultLabelTemplate(target: Entity): string {
  switch (target.type) {
    case 'point': case 'symbol': return '{name}';
    case 'line': case 'polyline': return 'L={length} м';
    case 'polygon': return 'S={area} м² · P={perimeter} м';
    default: throw new Error('Подписи доступны для точек, линий, полилиний и полигонов');
  }
}

/** Replaces only known fields. Unknown braces remain literal user text; no code is evaluated. */
export function resolveLabelTemplate(document: GeoDocument, label: LabelEntity): string {
  const target = document.entities.find(entity => entity.id === label.targetId);
  if (!target || target.type === 'label' || target.type === 'dimension' || target.type === 'text') return label.template;
  const ids = entityVertexIds(target), points = ids.map(id => vertexPoint(getVertex(document.vertices, id)));
  const allowed: Record<string, string> = { name: target.name, h_absolute: '—' };
  if (target.type === 'point') {
    const p = points[0]!;
    allowed.name = target.name; allowed.x = formatCoordinate(p.x); allowed.y = formatCoordinate(p.y);
    const absolute = modelToAbsoluteZ(p.z, document.verticalReference);
    if (absolute !== undefined) allowed.h_absolute = formatHeight(absolute);
    if (p.z !== undefined) allowed.z = formatHeight(p.z);
  } else if (target.type === 'line') allowed.length = formatMeasure(distance(points[0]!, points[1]!), DISPLAY_PRECISION.distance);
  else if (target.type === 'polyline') allowed.length = formatMeasure(pathLength(points), DISPLAY_PRECISION.distance);
  else if (target.type === 'polygon') { allowed.area = formatMeasure(polygonArea(points), DISPLAY_PRECISION.distance); allowed.perimeter = formatMeasure(pathLength(points, true), DISPLAY_PRECISION.distance); }
  return label.template.replace(/\{([a-z_]+)\}/gi, (token, key: string) => allowed[key] ?? token);
}

export function resolvedLabelPosition(document: GeoDocument, label: LabelEntity): WorldPoint | null {
  const target = document.entities.find(entity => entity.id === label.targetId);
  if (!target) return null;
  const anchor = labelAnchor(document, target);
  return { ...anchor, x: anchor.x + label.dx, y: anchor.y + label.dy };
}
