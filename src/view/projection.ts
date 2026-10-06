import type { Viewport, WorldPoint } from '../domain/model';
/** Parallel MODEL projection; heights are never derived from the vertical datum. */
export const PRESENTATION_DEFAULT_Z=0;
export const AXON_ORIENTATIONS=['NE','NW','SE','SW'] as const;
export type AxonOrientation=typeof AXON_ORIENTATIONS[number];
export interface ProjectionContext {orientation:AxonOrientation;origin:WorldPoint}
export type RenderCamera=Viewport & {rotationDeg?:number; screenClip?:{x:number;y:number;width:number;height:number}; projection?:ProjectionContext};
export const projectionOf=(view:Viewport)=>(view as RenderCamera).projection;
export function projectAxonometricBasis(orientation:AxonOrientation='NE') {
  const c=Math.sqrt(3)/2,s=.5;
  const bases={NE:[{x:c,y:s},{x:-c,y:s}],NW:[{x:-c,y:s},{x:-c,y:-s}],SE:[{x:c,y:-s},{x:c,y:s}],SW:[{x:-c,y:-s},{x:c,y:-s}]} as const;
  const [x,y]=bases[orientation];return {x,y,z:{x:0,y:1}};
}
export function presentationZ(point:WorldPoint){return point.z??PRESENTATION_DEFAULT_Z;}
export function projectXYZToAxonometric(point:WorldPoint,context:ProjectionContext):{x:number;y:number} {
  const basis=projectAxonometricBasis(context.orientation),dx=point.x-context.origin.x,dy=point.y-context.origin.y,dz=presentationZ(point)-presentationZ(context.origin);
  return {x:basis.x.x*dx+basis.y.x*dy,y:basis.x.y*dx+basis.y.y*dy+dz};
}
/** Approximate painter depth along the nullspace of the parallel projection. */
export function axonometricDepth(point:WorldPoint,context:ProjectionContext){const b=projectAxonometricBasis(context.orientation);return b.y.x*(point.x-context.origin.x)-b.x.x*(point.y-context.origin.y)+(b.x.x*b.y.y-b.y.x*b.x.y)*(presentationZ(point)-presentationZ(context.origin));}
export interface Bounds3D {minX:number;minY:number;minZ:number;maxX:number;maxY:number;maxZ:number}
export function modelXYZBounds(points:readonly WorldPoint[]):Bounds3D|null {
  if(!points.length)return null;const b={minX:Infinity,minY:Infinity,minZ:Infinity,maxX:-Infinity,maxY:-Infinity,maxZ:-Infinity};
  for(const p of points){b.minX=Math.min(b.minX,p.x);b.minY=Math.min(b.minY,p.y);b.minZ=Math.min(b.minZ,presentationZ(p));b.maxX=Math.max(b.maxX,p.x);b.maxY=Math.max(b.maxY,p.y);b.maxZ=Math.max(b.maxZ,presentationZ(p));}return b;
}
export function boxXYZCorners(b:Bounds3D):WorldPoint[]{return [b.minX,b.maxX].flatMap(x=>[b.minY,b.maxY].flatMap(y=>[b.minZ,b.maxZ].map(z=>({x,y,z}))));}
export function getAxonometricBounds(points:readonly WorldPoint[],context:ProjectionContext) {
  if(!points.length)return null;let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const point of points){const p=projectXYZToAxonometric(point,context);minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}return {minX,minY,maxX,maxY};
}
/** Only the explicitly chosen ground plane has an inverse. Never used for XYZ editing. */
export function groundPointFromProjection(p:{x:number;y:number},context:ProjectionContext,z=PRESENTATION_DEFAULT_Z):WorldPoint {
  const b=projectAxonometricBasis(context.orientation),y=p.y-(z-presentationZ(context.origin)),det=b.x.x*b.y.y-b.y.x*b.x.y;
  return {x:context.origin.x+(p.x*b.y.y-y*b.y.x)/det,y:context.origin.y+(y*b.x.x-p.x*b.x.y)/det,z};
}
/** Bounded presentation tessellation, sagitta <= 0.35 pixels except the 512-segment cap. */
export function presentationArc(center:WorldPoint,radius:number,start:number,sweep:number,pixelsPerUnit=100):WorldPoint[] {
  const error=.35/Math.max(pixelsPerUnit,1e-9),angle=2*Math.acos(Math.max(-1,Math.min(1,1-error/radius))),count=Math.max(8,Math.min(512,Math.ceil(sweep/Math.max(angle,1e-4))));
  return Array.from({length:count+1},(_,i)=>{const a=start+sweep*i/count;return {...center,x:center.x+radius*Math.cos(a),y:center.y+radius*Math.sin(a)};});
}

/** Temporary working angle belongs to the camera, never GeoDocument. */
export const viewRotation=(view:Viewport)=>(view as RenderCamera).rotationDeg??0;
