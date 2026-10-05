import type { GeoDocument, HorizontalControl, HorizontalReference, RigidTransform2D, SurveyXY, VerticalReference, WorldPoint } from '../domain/model';

/** UX guardrails, not a geodetic accuracy standard. All lengths are metres. */
export const GEOREFERENCE_POLICY = Object.freeze({ minimumBaseline: 0.1, okDifference: 0.01, invalidAbsoluteDifference: 0.5, invalidRelativeDifference: 0.05 });
export interface CalibrationResult {
  status: 'OK' | 'WARNING' | 'INVALID'; message: string; transform?: RigidTransform2D;
  modelBaseline: number; surveyBaseline: number; difference: number;
  residual?: { e: number; n: number; distance: number };
}
type XY = Pick<WorldPoint, 'x' | 'y'>;
const finiteXY = (p: XY) => Number.isFinite(p.x) && Number.isFinite(p.y);

export function computeRigidTransform2D(modelA: XY, modelB: XY, surveyA: SurveyXY, surveyB: SurveyXY): CalibrationResult {
  const modelBaseline = Math.hypot(modelB.x - modelA.x, modelB.y - modelA.y);
  const surveyBaseline = Math.hypot(surveyB.e - surveyA.e, surveyB.n - surveyA.n);
  const difference = surveyBaseline - modelBaseline;
  const invalid = (message: string): CalibrationResult => ({ status: 'INVALID', message, modelBaseline, surveyBaseline, difference });
  if (![modelA, modelB, { x: surveyA.e, y: surveyA.n }, { x: surveyB.e, y: surveyB.n }].every(finiteXY) || !Number.isFinite(difference)) return invalid('Координаты и длины должны быть конечными числами.');
  if (Math.min(modelBaseline, surveyBaseline) < GEOREFERENCE_POLICY.minimumBaseline) return invalid('Выберите разные точки: обе базы должны быть не короче 0.100 м.');
  const angle = Math.atan2(surveyB.n - surveyA.n, surveyB.e - surveyA.e) - Math.atan2(modelB.y - modelA.y, modelB.x - modelA.x);
  const rotation = Math.atan2(Math.sin(angle), Math.cos(angle));
  const c = Math.cos(rotation), s = Math.sin(rotation);
  const transform: RigidTransform2D = { rotation, translation: { e: surveyA.e - c * modelA.x + s * modelA.y, n: surveyA.n - s * modelA.x - c * modelA.y }, scale: 1 };
  const b = modelToSurveyXY(modelB, transform);
  const residual = { e: surveyB.e - b.e, n: surveyB.n - b.n, distance: Math.hypot(surveyB.e - b.e, surveyB.n - b.n) };
  if (![transform.translation.e, transform.translation.n, residual.distance].every(Number.isFinite)) return invalid('Преобразование выходит за числовой диапазон.');
  const limit = Math.max(GEOREFERENCE_POLICY.invalidAbsoluteDifference, modelBaseline * GEOREFERENCE_POLICY.invalidRelativeDifference);
  const status = Math.abs(difference) > limit ? 'INVALID' : Math.abs(difference) > GEOREFERENCE_POLICY.okDifference ? 'WARNING' : 'OK';
  return { status, message: status === 'INVALID' ? 'Большое расхождение баз: проверьте точки и survey координаты. Apply заблокирован.' : status === 'WARNING' ? 'Базы различаются. Масштаб останется 1; остаток в B не компенсируется.' : 'Базы согласованы; масштаб 1.', transform, modelBaseline, surveyBaseline, difference, residual };
}

export function modelToSurveyXY(point: XY, transform: RigidTransform2D): SurveyXY {
  const c = Math.cos(transform.rotation), s = Math.sin(transform.rotation);
  return { e: c * point.x - s * point.y + transform.translation.e, n: s * point.x + c * point.y + transform.translation.n };
}
export function surveyToModelXY(point: SurveyXY, transform: RigidTransform2D): XY {
  const e = point.e - transform.translation.e, n = point.n - transform.translation.n;
  const c = Math.cos(transform.rotation), s = Math.sin(transform.rotation);
  return { x: c * e + s * n, y: -s * e + c * n };
}
export function modelToAbsoluteZ(z: number | undefined, reference: VerticalReference | undefined): number | undefined {
  return z === undefined || !reference ? undefined : z - reference.modelZero + reference.absoluteAtModelZero;
}
export function absoluteToModelZ(h: number | undefined, reference: VerticalReference | undefined): number | undefined {
  return h === undefined || !reference ? undefined : h - reference.absoluteAtModelZero + reference.modelZero;
}
/** Missing field in legacy v2 means direct coordinates; never infer from numeric magnitude. */
export const documentModelFrame = (document: GeoDocument) => document.modelFrame ?? 'projected';
export function documentSurveyXY(document: GeoDocument, point: XY): SurveyXY | undefined {
  return documentModelFrame(document) === 'projected' ? { e: point.x, n: point.y } : document.horizontalReference ? modelToSurveyXY(point, document.horizontalReference.transform) : undefined;
}
/** +Northing in MODEL; screen Y is inverted exactly once here. */
export function surveyNorthDirection(transform?: RigidTransform2D) {
  const rotation = transform?.rotation ?? 0;
  return { model: { x: Math.sin(rotation), y: Math.cos(rotation) }, screen: { x: Math.sin(rotation), y: -Math.cos(rotation) }, rotationDegrees: rotation * 180 / Math.PI };
}
export function staleControls(document: GeoDocument): HorizontalControl[] {
  return document.horizontalReference?.controls.filter(control => {
    const vertex = Object.hasOwn(document.vertices, control.vertexId) ? document.vertices[control.vertexId] : undefined;
    return !vertex || vertex.x !== control.modelSnapshot.x || vertex.y !== control.modelSnapshot.y;
  }) ?? [];
}
export function createHorizontalReference(document: GeoDocument, pairs: readonly [{ pointEntityId: string; survey: SurveyXY }, { pointEntityId: string; survey: SurveyXY }]): HorizontalReference {
  if (documentModelFrame(document) !== 'local') throw new Error('Проектные координаты уже используются напрямую. Привязка доступна для локальной модели.');
  if (pairs[0].pointEntityId === pairs[1].pointEntityId) throw new Error('Контрольные точки A и B должны быть разными.');
  const controls = pairs.map(pair => {
    const point = document.entities.find(entity => entity.id === pair.pointEntityId);
    if (!point || point.type !== 'point') throw new Error('Контрольная точка должна быть существующим PointEntity.');
    const vertex = document.vertices[point.vertexId]!;
    return { pointEntityId: point.id, vertexId: point.vertexId, modelSnapshot: { x: vertex.x, y: vertex.y }, survey: { ...pair.survey } };
  }) as [HorizontalControl, HorizontalControl];
  const result = computeRigidTransform2D(controls[0].modelSnapshot, controls[1].modelSnapshot, controls[0].survey, controls[1].survey);
  if (result.status === 'INVALID' || !result.transform) throw new Error(result.message);
  return { controls, transform: result.transform };
}
