/** Canonical MODEL coordinates in metres. Survey XY and absolute height are derived separately. */
export interface WorldPoint { x: number; y: number; z?: number }
export interface Vertex extends WorldPoint { id: string }
export type VertexRegistry = Record<string, Vertex>;
export interface Viewport { center: WorldPoint; pixelsPerUnit: number }
export interface Layer { id: string; name: string; visible: boolean; locked: boolean; order: number; styleId: string }
export interface EntityStyle { id: string; stroke: string; fill: string; lineWeight: number; dash?: string }
interface EntityBase { id: string; name: string; layerId: string; styleId?: string }
export interface PointEntity extends EntityBase { type: 'point'; vertexId: string }
export interface LineEntity extends EntityBase { type: 'line'; startVertexId: string; endVertexId: string }
export interface PolylineEntity extends EntityBase { type: 'polyline'; vertexIds: [string, string, ...string[]] }
export interface PolygonEntity extends EntityBase { type: 'polygon'; vertexIds: [string, string, string, ...string[]] }
export interface TextEntity extends EntityBase { type: 'text'; vertexId: string; content: string; fontSize: number }
export interface LabelEntity extends EntityBase { type: 'label'; targetId: string; template: string; dx: number; dy: number }
export interface DimensionEntity extends EntityBase { type: 'dimension'; startVertexId: string; endVertexId: string; offset: number; textPosition?: number }
export type Entity = PointEntity | LineEntity | PolylineEntity | PolygonEntity | TextEntity | LabelEntity | DimensionEntity;
export interface SurveyXY { e: number; n: number }
export interface RigidTransform2D { rotation: number; translation: SurveyXY; scale: 1 }
export interface HorizontalControl { pointEntityId: string; vertexId: string; modelSnapshot: { x: number; y: number }; survey: SurveyXY }
export interface HorizontalReference { controls: [HorizontalControl, HorizontalControl]; transform: RigidTransform2D }
export interface VerticalReference { modelZero: 0; absoluteAtModelZero: number }
export interface GeoDocument {
  /** Absent only in legacy v2: projected/direct. */
  modelFrame?: 'local' | 'projected';
  horizontalReference?: HorizontalReference;
  verticalReference?: VerticalReference;
  schemaVersion: 2;
  metadata: { id: string; title: string; description: string };
  coordinateSystem: { kind: 'local' | 'projected' | 'unknown'; name?: string; epsg?: number; xAxis: 'east'; yAxis: 'north'; zAxis: 'up' };
  units: { length: 'm'; area: 'm2' };
  vertices: VertexRegistry;
  layers: Layer[];
  entities: Entity[];
  styles: EntityStyle[];
  viewport: Viewport;
}

export function entityVertexIds(entity: Entity): string[] {
  switch (entity.type) {
    case 'point': case 'text': return [entity.vertexId];
    case 'label': return [];
    case 'line': case 'dimension': return [entity.startVertexId, entity.endVertexId];
    case 'polyline': case 'polygon': return entity.vertexIds;
  }
}
export function vertexPoint(vertex: Vertex): WorldPoint {
  return vertex.z === undefined ? { x: vertex.x, y: vertex.y } : { x: vertex.x, y: vertex.y, z: vertex.z };
}
export function worldVertex(id: string, point: WorldPoint): Vertex {
  return point.z === undefined ? { id, x: point.x, y: point.y } : { id, x: point.x, y: point.y, z: point.z };
}
export function getVertex(vertices: VertexRegistry, id: string): Vertex {
  const vertex = Object.hasOwn(vertices, id) ? vertices[id] : undefined;
  if (!vertex) throw new Error(`Ссылка на отсутствующую вершину ${id}`);
  return vertex;
}
export function entityPoints(entity: Entity, vertices: VertexRegistry): WorldPoint[] {
  return entityVertexIds(entity).map(id => vertexPoint(getVertex(vertices, id)));
}
