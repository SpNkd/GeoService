import { viewRotation, projectionOf, projectXYZToAxonometric, type RenderCamera } from '../view/projection';
import type { Viewport, WorldPoint } from '../domain/model';

/** Screen Y grows down. World Y grows north. */
export interface ScreenPoint { x: number; y: number }
export interface ViewSize { width: number; height: number }
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export const MIN_ZOOM = 0.00001;
export const MAX_ZOOM = 100000;

export function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y); // planar distance; Z is intentionally excluded
}
export function midpoint(a: WorldPoint, b: WorldPoint): WorldPoint {
  const result: WorldPoint = { x: a.x + (b.x - a.x) / 2, y: a.y + (b.y - a.y) / 2 };
  if (a.z !== undefined && b.z !== undefined) result.z = a.z + (b.z - a.z) / 2;
  return result;
}
export function bounds(points: readonly WorldPoint[]): Bounds | null {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}
export function signedPolygonArea(vertices: readonly WorldPoint[]): number {
  const origin = vertices[0];
  if (!origin || vertices.length < 3) return 0;
  // Translate before the shoelace sum to avoid subtracting huge products.
  let sum = 0;
  vertices.forEach((a, index) => {
    const b = vertices[(index + 1) % vertices.length]!;
    sum += (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y);
  });
  return sum / 2;
}
export const polygonArea = (vertices: readonly WorldPoint[]) => Math.abs(signedPolygonArea(vertices));
/** In world XY, positive shoelace area is counterclockwise. */
export const polygonOrientation = (vertices: readonly WorldPoint[]): 'cw' | 'ccw' | 'degenerate' => {
  const area = signedPolygonArea(vertices);
  return area > 0 ? 'ccw' : area < 0 ? 'cw' : 'degenerate';
};
export function pathLength(vertices: readonly WorldPoint[], closed = false): number {
  let length = 0;
  for (let i = 1; i < vertices.length; i++) length += distance(vertices[i - 1]!, vertices[i]!);
  if (closed && vertices.length > 1) length += distance(vertices[vertices.length - 1]!, vertices[0]!);
  return length;
}
export function worldToScreen(point: WorldPoint, view: RenderCamera, size: ViewSize): ScreenPoint {
  const projection=projectionOf(view);if(projection)point=projectXYZToAxonometric(point,projection);
  const a=viewRotation(view)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),x=point.x-view.center.x,y=point.y-view.center.y;
  return {x:size.width/2+(x*c-y*s)*view.pixelsPerUnit,y:size.height/2-(x*s+y*c)*view.pixelsPerUnit};
}
export function screenToWorld(point: ScreenPoint, view: Viewport, size: ViewSize): WorldPoint {
  const a=viewRotation(view)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),x=(point.x-size.width/2)/view.pixelsPerUnit,y=(size.height/2-point.y)/view.pixelsPerUnit;
  return {x:view.center.x+x*c+y*s,y:view.center.y-x*s+y*c};
}
/** Fit projected corners around a stable local midpoint; preserves the working angle. */
export function fitRotatedBounds(box:Bounds|null,size:ViewSize,angle=0,padding=64):RenderCamera|null {
  if(!box)return null;const center={x:box.minX/2+box.maxX/2,y:box.minY/2+box.maxY/2},camera={center,pixelsPerUnit:1,rotationDeg:angle};
  const points=[{x:box.minX,y:box.minY},{x:box.minX,y:box.maxY},{x:box.maxX,y:box.minY},{x:box.maxX,y:box.maxY}].map(p=>worldToScreen(p,camera,{width:0,height:0}));
  const fit=fitToBounds(bounds(points),size,padding);return fit?{center,pixelsPerUnit:fit.pixelsPerUnit,...(angle?{rotationDeg:angle}:{})}:null;
}
export function fitToBounds(box: Bounds | null, size: ViewSize, padding = 64): Viewport | null {
  if (!box || size.width <= 0 || size.height <= 0) return null;
  const availableWidth = Math.max(size.width - 2 * padding, size.width * 0.25);
  const availableHeight = Math.max(size.height - 2 * padding, size.height * 0.25);
  return {
    center: { x: box.minX / 2 + box.maxX / 2, y: box.minY / 2 + box.maxY / 2 },
    pixelsPerUnit: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM,
      availableWidth / Math.max(box.maxX - box.minX, 1), availableHeight / Math.max(box.maxY - box.minY, 1))),
  };
}
export function panViewport(view: Viewport, delta: ScreenPoint): Viewport {
  const center=screenToWorld({x:-delta.x,y:-delta.y},view,{width:0,height:0});return {...view,center};
}
export function zoomAt(view: Viewport, size: ViewSize, anchor: ScreenPoint, factor: number): Viewport {
  const fixed=screenToWorld(anchor,view,size),pixelsPerUnit=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,view.pixelsPerUnit*factor)),next={...view,pixelsPerUnit},q=screenToWorld(anchor,next,size);
  return {...next,center:{x:view.center.x+fixed.x-q.x,y:view.center.y+fixed.y-q.y}};
}
/** 1 / 2 / 5 steps in world metres. Bounded line count even at extreme zoom. */
export function gridStep(pixelsPerUnit: number): number {
  const target = 64 / pixelsPerUnit;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
}
