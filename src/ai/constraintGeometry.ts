import {anchorLabels} from './assumptions';
import { bounds } from '../geometry';
import type { WorldPoint } from '../domain/model';
import type { BoundaryPlacement } from './constraintSchema';
export function insetPlacement(p:BoundaryPlacement,polygon:WorldPoint[],width:number,height:number):{origin:WorldPoint;explanation:string}|{message:string;unsupported?:true} {
  const b=bounds(polygon);
  if(!b||polygon.length!==4||polygon.some(v=>![b.minX,b.maxX].includes(v.x)||![b.minY,b.maxY].includes(v.y)))return {unsupported:true,message:'Отступы по сторонам пока поддерживаются для прямоугольной границы в осях MODEL.'};
  const i=p.inset, c=p.minimumClearance;
  const west=Math.max(i.west,c),east=Math.max(i.east,c),south=Math.max(i.south,c),north=Math.max(i.north,c);
  const minX=b.minX+west,maxX=b.maxX-east-width,minY=b.minY+south,maxY=b.maxY-north-height;
  if(minX>maxX||minY>maxY)return {message:`Объект ${width}×${height} м не помещается в границе ${b.maxX-b.minX}×${b.maxY-b.minY} м с отступами: запад ${west}, восток ${east}, север ${north}, юг ${south} м. Уменьшите размеры или отступы в запросе.`};
  const anchor=p.anchor;
  let x=anchor.includes('west')?minX:anchor.includes('east')?maxX:(minX+maxX)/2;
  let y=anchor.includes('south')?minY:anchor.includes('north')?maxY:(minY+maxY)/2;
  // Positive side offset runs east on N/S sides, north on E/W sides, from the inset corner.
  if(p.offsetAlongSide!==null){if(anchor==='north'||anchor==='south')x=minX+p.offsetAlongSide;else if(anchor==='east'||anchor==='west')y=minY+p.offsetAlongSide;else return {message:'Смещение вдоль стороны требует одной стороны, а не угла или центра.'};}
  if(x<minX||x>maxX||y<minY||y>maxY)return {message:'Смещение вдоль стороны нарушает отступы или выходит за доступную границу.'};
  return {origin:{x,y},explanation:`В ${anchorLabels[anchor]} части: отступы от внешнего контура — север ${north}, юг ${south}, восток ${east}, запад ${west} м. Минимальное расстояние ${c} м; размеры объекта учтены.`};
}
export const distance=(a:WorldPoint,b:WorldPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
export function nearestOnContour(point:WorldPoint,polygon:WorldPoint[],closed=true) {
  let best={point:polygon[0]!,edge:0,t:0,distance:Infinity};
  for(let i=0;i<(closed?polygon.length:polygon.length-1);i++){
    const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
    const t=l?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/l)):0,q={x:a.x+t*dx,y:a.y+t*dy},d=distance(point,q);
    if(d<best.distance-1e-9)best={point:q,edge:i,t,distance:d};
  }return best;
}
export function inside(p:WorldPoint,poly:WorldPoint[]):boolean {
  if(nearestOnContour(p,poly).distance<1e-8)return true;
  let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i]!,b=poly[j]!;if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;
}
const cross=(a:WorldPoint,b:WorldPoint,c:WorldPoint)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
export function segmentInside(a:WorldPoint,b:WorldPoint,poly:WorldPoint[]):boolean {
  if(!inside(a,poly)||!inside(b,poly)||!inside({x:(a.x+b.x)/2,y:(a.y+b.y)/2},poly))return false;
  for(let i=0;i<poly.length;i++){const c=poly[i]!,d=poly[(i+1)%poly.length]!;if(cross(a,b,c)*cross(a,b,d)<-1e-10&&cross(c,d,a)*cross(c,d,b)<-1e-10)return false;}return true;
}
export function boundaryRoute(source:WorldPoint,target:WorldPoint,poly:WorldPoint[]):WorldPoint[] {
  const a=nearestOnContour(source,poly),b=nearestOnContour(target,poly),paths:WorldPoint[][]=[];
  for(const direction of [1,-1]){
    const path=[source,a.point];
    if(a.edge===b.edge&&(direction===1?a.t<=b.t:a.t>=b.t))path.push(b.point);
    else {let vertex=(a.edge+(direction===1?1:0))%poly.length;const stop=(b.edge+(direction===1?0:1))%poly.length;
      for(let n=0;n<=poly.length;n++){path.push(poly[vertex]!);if(vertex===stop)break;vertex=(vertex+direction+poly.length)%poly.length;}path.push(b.point);}
    path.push(target);paths.push(path);
  }
  const length=(p:WorldPoint[])=>p.slice(1).reduce((sum,v,i)=>sum+distance(p[i]!,v),0);
  return length(paths[0]!)<=length(paths[1]!)+1e-9?paths[0]!:paths[1]!;
}
/** Visibility graph on a simple polygon; deterministic shortest path without obstacles. */
export function shortestInside(source:WorldPoint,target:WorldPoint,poly:WorldPoint[]):WorldPoint[]|null {
  if(!inside(source,poly)||!inside(target,poly))return null;
  const points=[source,target,...poly],cost=points.map(()=>Infinity),prev=points.map(()=>-1),visited=new Set<number>();cost[0]=0;
  for(let n=0;n<points.length;n++){let u=-1;for(let i=0;i<points.length;i++)if(!visited.has(i)&&(u<0||cost[i]!<cost[u]!))u=i;
    if(u<0||!Number.isFinite(cost[u]))break;if(u===1)break;visited.add(u);
    for(let v=0;v<points.length;v++)if(!visited.has(v)&&v!==u&&segmentInside(points[u]!,points[v]!,poly)){const c=cost[u]!+distance(points[u]!,points[v]!);if(c<cost[v]!-1e-9){cost[v]=c;prev[v]=u;}}
  }
  if(!Number.isFinite(cost[1]))return null;const path:WorldPoint[]=[];for(let u=1;u>=0;u=prev[u]!)path.unshift(points[u]!);return path;
}
/** Additional exact constraints cannot be silently discarded or relaxed to minimum clearances. */
export function additionalPlacement(origin:WorldPoint,polygon:WorldPoint[]|null,width:number,height:number,placementAnchor:string|undefined,constraints:import('./constraintSchema').ExtraConstraint[]):{origin:WorldPoint}|{message:string} {
 const anchors=[...(placementAnchor?[placementAnchor]:[]),...constraints.flatMap(c=>c.type==='anchor'?[c.value]:[])];
 if(anchors.some(a=>a.includes('north'))&&anchors.some(a=>a.includes('south'))||anchors.some(a=>a.includes('east'))&&anchors.some(a=>a.includes('west')))return {message:'Противоречивые направления: объект не может одновременно находиться на противоположных сторонах границы. Уточните сторону.'};
 if(anchors.includes('center')&&anchors.some(a=>a!=='center'))return {message:'Противоречивые условия: одновременно центр и сторона границы.'};
 const contains=constraints.flatMap(c=>c.type==='containment'?[c.value]:[]);
 if(contains.includes('inside')&&contains.includes('outside')||polygon&&contains.includes('outside'))return {message:'Противоречивые условия: объект запрошен одновременно внутри и снаружи границы.'};
 const fixed=constraints.filter(c=>c.type==='fixed_side_distance');
 if(!fixed.length)return {origin};const b=polygon?bounds(polygon):null;
 if(!b)return {message:'Точные расстояния от сторон требуют размещения внутри прямоугольной границы.'};
 const xs:number[]=[],ys:number[]=[];
 for(const c of fixed){if(c.side==='west')xs.push(b.minX+c.distance);if(c.side==='east')xs.push(b.maxX-c.distance-width);if(c.side==='south')ys.push(b.minY+c.distance);if(c.side==='north')ys.push(b.maxY-c.distance-height);}
 if(xs.some(x=>Math.abs(x-xs[0]!)>1e-8)||ys.some(y=>Math.abs(y-ys[0]!)>1e-8))return {message:'Несовместимые фиксированные расстояния от сторон: при заданном размере они требуют разных положений объекта.'};
 return {origin:{x:xs[0]??origin.x,y:ys[0]??origin.y}};
}
