import { type GeoDocument, type WorldPoint } from '../domain/model';
import { bounds, polygonOrientation, type Bounds } from './index';
import { staleControls } from './georeferencing';
import { AUTO_LAYOUT_INSET, resolvePlacement, rectangleInsidePolygon, pathInsidePolygon, type LayoutAnchor } from './autoPlacement';
export type Direction = Exclude<LayoutAnchor, 'center'>;
export function spatialFrame(document: GeoDocument) {
  const stale = staleControls(document).length > 0;
  const rotation = document.horizontalReference && !stale ? document.horizontalReference.transform.rotation : 0;
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return { name: document.horizontalReference && !stale ? 'SURVEY' as const : 'MODEL' as const, stale,
    to: (p: WorldPoint): WorldPoint => ({ x: c*p.x-s*p.y, y:s*p.x+c*p.y }),
    from: (p: WorldPoint): WorldPoint => ({ x:c*p.x+s*p.y, y:-s*p.x+c*p.y }),
    footprint: (w:number,h:number) => ({width:Math.abs(c)*w+Math.abs(s)*h,height:Math.abs(s)*w+Math.abs(c)*h}) };
}
export type SpatialFrame = ReturnType<typeof spatialFrame>;
export const autoLayoutGap = (b: Bounds) => Math.min(AUTO_LAYOUT_INSET.maximum,Math.max(AUTO_LAYOUT_INSET.minimum,Math.min(b.maxX-b.minX,b.maxY-b.minY)*AUTO_LAYOUT_INSET.fraction));
export const rectangleCorners = (origin:WorldPoint,w:number,h:number) => [origin,{x:origin.x+w,y:origin.y},{x:origin.x+w,y:origin.y+h},{x:origin.x,y:origin.y+h}];
export function relativeCenter(b:Bounds,size:{width:number;height:number},direction:Direction,gap:number):WorldPoint {
  return {x:direction.includes('east')?b.maxX+gap+size.width/2:direction.includes('west')?b.minX-gap-size.width/2:(b.minX+b.maxX)/2,
    y:direction.includes('north')?b.maxY+gap+size.height/2:direction.includes('south')?b.minY-gap-size.height/2:(b.minY+b.maxY)/2};
}
export function spatialRectangle(polygon:WorldPoint[],w:number,h:number,anchor:LayoutAnchor,frame:SpatialFrame,inside:boolean,gap?:number|null,centerOverride?:WorldPoint) {
  const b=bounds(polygon.map(frame.to));
  if(!b) return {status:'invalid' as const,message:'Объект не содержит геометрию'};
  const size=frame.footprint(w,h), actualGap=gap??autoLayoutGap(b);
  let center:WorldPoint;
  let inset:string|undefined;
  if(inside) {
    const layout=resolvePlacement(b,size,anchor,centerOverride?{center:frame.to(centerOverride)}:{});
    if(layout.status!=='ready') return layout;
    center={x:layout.origin.x+size.width/2,y:layout.origin.y+size.height/2};
    inset=`Автоотступ внутри: X ${layout.insetX.toFixed(3)}, Y ${layout.insetY.toFixed(3)} м.`;
  } else {
    if(anchor==='center') return {status:'invalid' as const,message:'Для внешнего размещения требуется направление'};
    center=relativeCenter(b,size,anchor,actualGap);
  }
  const world=frame.from(center),origin={x:world.x-w/2,y:world.y-h/2};
  if(inside&&!rectangleInsidePolygon(rectangleCorners(origin,w,h),polygon)) return {status:'invalid' as const,message:'Прямоугольник не помещается внутри реального контура.'};
  return {status:'ready' as const,origin,gap:actualGap,inset};
}
/** Select a unique outward-facing straight side; contiguous collinear segments form one chain. */
export function offsetPolygonSide(points:WorldPoint[],side:'north'|'south'|'east'|'west',offset:number,outside:boolean,frame:SpatialFrame) {
  const p=points.map(frame.to), orientation=polygonOrientation(p);
  if(orientation==='degenerate') return {status:'invalid' as const,message:'Вырожденный контур'};
  const direction={north:{x:0,y:1},south:{x:0,y:-1},east:{x:1,y:0},west:{x:-1,y:0}}[side];
  const edges=p.map((a,i)=>{ const b=p[(i+1)%p.length]!,dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),sign=orientation==='ccw'?1:-1;
    const normal={x:sign*dy/len,y:-sign*dx/len};return {a,b,normal,score:normal.x*direction.x+normal.y*direction.y,len}; });
  const score=Math.max(...edges.map(e=>e.score));
  if(!Number.isFinite(score)||score<=0) return {status:'invalid' as const,message:'Сторона контура не определена'};
  const candidates=edges.map((e,i)=>({e,i})).filter(({e})=>Math.abs(e.score-score)<1e-9);
  let first=candidates.find(({i})=>!candidates.some(c=>c.i===(i+p.length-1)%p.length));
  if(!first) first=candidates[0];
  const chain: typeof edges=[]; let i=first!.i;
  while(candidates.some(c=>c.i===i)&&chain.length<candidates.length) {chain.push(edges[i]!);i=(i+1)%p.length;}
  if(chain.length!==candidates.length||chain.some(e=>Math.abs(e.normal.x-chain[0]!.normal.x)>1e-9||Math.abs(e.normal.y-chain[0]!.normal.y)>1e-9))
    return {status:'invalid' as const,message:'Сторона неоднозначна: выберите простой контур с единственной прямой стороной.'};
  const n=chain[0]!.normal,k=outside?offset:-offset;
  const geometry=[chain[0]!.a,...chain.map(e=>e.b)].map(a=>frame.from({x:a.x+n.x*k,y:a.y+n.y*k}));
  if(!geometry.every(a=>Number.isFinite(a.x)&&Number.isFinite(a.y))) return {status:'invalid' as const,message:'Неконечная геометрия отступа'};
  if(!outside&&!pathInsidePolygon(geometry,points)) return {status:'invalid' as const,message:'Внутренний отступ выводит линию за пределы контура.'};
  return {status:'ready' as const,geometry};
}
