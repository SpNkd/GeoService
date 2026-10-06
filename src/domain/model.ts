import type { SourceProvenance, SourceDocument, VectorPrimitive, BlockDefinition, BlockTransform, ImportedSemanticContent } from '../vectors/types';
/** Canonical MODEL coordinates in metres. Survey XY and absolute height are derived separately. */
export interface WorldPoint { x: number; y: number; z?: number }
export interface Vertex extends WorldPoint { id: string }
export type VertexRegistry = Record<string, Vertex>;
export interface Viewport { center: WorldPoint; pixelsPerUnit: number }
export interface Layer { id: string; name: string; visible: boolean; locked: boolean; order: number; styleId: string; source?: SourceProvenance }
export interface EntityStyle { id: string; stroke: string; fill: string; lineWeight: number; dash?: string }
interface EntityBase { id: string; name: string; layerId: string; styleId?: string; visible?: boolean; source?: SourceProvenance }
export interface PointEntity extends EntityBase { type: 'point'; vertexId: string }
export interface LineEntity extends EntityBase { type: 'line'; startVertexId: string; endVertexId: string }
export interface PolylineEntity extends EntityBase { type: 'polyline'; vertexIds: [string, string, ...string[]] }
export interface PolygonEntity extends EntityBase { type: 'polygon'; vertexIds: [string, string, string, ...string[]] }
export interface TextEntity extends EntityBase { type: 'text'; vertexId: string; content: string; fontSize: number; rotationDeg?: number; height?: number }
export interface LabelEntity extends EntityBase { type: 'label'; targetId: string; template: string; dx: number; dy: number }
export interface DimensionEntity extends EntityBase { type: 'dimension'; startVertexId: string; endVertexId: string; offset: number; textPosition?: number }
export interface SymbolEntity extends EntityBase { type: 'symbol'; libraryId: string; symbolId: string; position: { x: number; y: number }; rotationDeg: number; scale: number; properties?: Record<string, string | number | boolean | null> }
export interface ArcEntity extends EntityBase { type: 'arc'; center: WorldPoint; radius: number; startAngle: number; endAngle: number }
export interface CircleEntity extends EntityBase { type: 'circle'; center: WorldPoint; radius: number }
export interface BlockInstanceEntity extends EntityBase, BlockTransform { type: 'block_instance'; blockDefinitionId: string; attributes?: Record<string, string>; attributePrimitives?: VectorPrimitive[]; /** Absent in older v2 files, whose attribute positions are insert-relative MODEL offsets. */ attributeCoordinateSpace?: 'block-local' }
export interface ImportedGraphicEntity extends EntityBase { type: 'imported_graphic'; position: WorldPoint; primitives: VectorPrimitive[]; semanticContent?: ImportedSemanticContent }
export interface ConnectorEndpoint { kind: 'symbol_port'; symbolEntityId: string; portId: string }
export interface ConnectorEntity extends EntityBase { type: 'connector'; start: ConnectorEndpoint; end: ConnectorEndpoint; routing: 'direct' | 'orthogonal'; waypoints?: {x:number;y:number}[] }
export type Entity = ConnectorEntity | PointEntity | LineEntity | PolylineEntity | PolygonEntity | TextEntity | LabelEntity | DimensionEntity | SymbolEntity | ArcEntity | CircleEntity | BlockInstanceEntity | ImportedGraphicEntity;
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
  sources?: SourceDocument[];
  blocks?: BlockDefinition[];
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
    case 'connector': case 'label': case 'symbol': case 'arc': case 'circle': case 'block_instance': case 'imported_graphic': return [];
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
