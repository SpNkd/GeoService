/** Canonical coordinates are metres; X east, Y north, Z up. No SVG types here. */
export interface WorldPoint { x: number; y: number; z?: number }
export interface Viewport { center: WorldPoint; pixelsPerUnit: number }
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  order: number;
  styleId: string;
}
export interface EntityStyle {
  id: string;
  stroke: string;
  fill: string;
  lineWeight: number; // presentation weight in CSS pixels, not world geometry
  dash?: string;
}
interface EntityBase { id: string; name: string; layerId: string; styleId?: string }
export interface PointEntity extends EntityBase { type: 'point'; position: WorldPoint }
export interface LineEntity extends EntityBase {
  type: 'line'; start: WorldPoint; end: WorldPoint;
}
export interface PolylineEntity extends EntityBase {
  type: 'polyline'; vertices: [WorldPoint, WorldPoint, ...WorldPoint[]];
}
export interface PolygonEntity extends EntityBase {
  type: 'polygon'; vertices: [WorldPoint, WorldPoint, WorldPoint, ...WorldPoint[]];
}
export interface TextEntity extends EntityBase {
  type: 'text'; position: WorldPoint; content: string; fontSize: number;
}
export type Entity = PointEntity | LineEntity | PolylineEntity | PolygonEntity | TextEntity;
export interface GeoDocument {
  schemaVersion: 1;
  metadata: { id: string; title: string; description: string };
  coordinateSystem: {
    kind: 'local-cartesian'; name: string; xAxis: 'east'; yAxis: 'north'; zAxis: 'up';
  };
  units: { length: 'm'; area: 'm2' };
  layers: Layer[];
  entities: Entity[];
  styles: EntityStyle[];
  viewport: Viewport; // saved initial camera; live navigation belongs to editor state
}

export function entityPoints(entity: Entity): WorldPoint[] {
  switch (entity.type) {
    case 'point': case 'text': return [entity.position];
    case 'line': return [entity.start, entity.end];
    case 'polyline': case 'polygon': return entity.vertices;
  }
}
