import type { GeometryCandidate, PixelPoint } from './types';
import { distancePx } from './transform';

export interface ReconstructionMetrics {
  rawVertices: number; finalVertices: number; fittedPrimitives: number;
  maxDeviationPx: number; medianDeviationPx: number; strokeWidthPx: number;
  traceMs: number; fittingMs: number; topologyMs: number;
}
const tau = Math.PI * 2;
const angle = (p: PixelPoint, c: PixelPoint) => Math.atan2(p.y-c.y,p.x-c.x);
const positive = (v:number) => (v % tau + tau) % tau;
function segmentDistance(p:PixelPoint,a:PixelPoint,b:PixelPoint) {
  const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
/** Two-pass chamfer distance measured before thinning, in analysis pixels. */
export function strokeDistances(mask:Uint8Array,width:number,height:number) {
  const d=new Float32Array(mask.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;if(!mask[i])continue;
    d[i]=Math.min(x?d[i-1]!+1:1,y?d[i-width]!+1:1,x&&y?d[i-width-1]!+Math.SQRT2:1.414);
  }
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){const i=y*width+x;if(mask[i])d[i]=Math.min(d[i]!,x<width-1?d[i+1]!+1:1,y<height-1?d[i+width]!+1:1,x<width-1&&y<height-1?d[i+width+1]!+Math.SQRT2:1.414);}
  return d;
}
export function median(values:number[]) { const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]??0; }
/** TLS/PCA rejects pixel angle wobble; residual is checked against the finite emitted segment. */
export function fitLine(points:PixelPoint[],tolerance:number):{points:[PixelPoint,PixelPoint];deviations:number[]}|null {
  if(points.length<2)return null;
  const mean=points.reduce((s,p)=>({x:s.x+p.x/points.length,y:s.y+p.y/points.length}),{x:0,y:0});
  let xx=0,xy=0,yy=0;for(const p of points){xx+=(p.x-mean.x)**2;xy+=(p.x-mean.x)*(p.y-mean.y);yy+=(p.y-mean.y)**2;}
  const a=.5*Math.atan2(2*xy,xx-yy),nx=-Math.sin(a),ny=Math.cos(a);
  if(points.some(p=>Math.abs((p.x-mean.x)*nx+(p.y-mean.y)*ny)>tolerance))return null;
  // Retain raw endpoints exactly: branch nodes and adjacent fitted primitives must stay shared.
  const ends:[PixelPoint,PixelPoint]=[points[0]!,points.at(-1)!];
  const deviations=points.map(p=>segmentDistance(p,...ends));
  return deviations.every(d=>d<=tolerance)?{points:ends,deviations}:null;
}
/** Algebraic circle; arcs constrain the circle to pass through both branch endpoints. */
export function fitCurve(points:PixelPoint[],closed:boolean,tolerance:number):{candidate:GeometryCandidate;deviations:number[]}|null {
  if(points.length<12)return null;
  let center:PixelPoint;
  if(!closed){
    const a=points[0]!,b=points.at(-1)!,chord=distancePx(a,b);if(chord<3)return null;
    const m={x:(a.x+b.x)/2,y:(a.y+b.y)/2},n={x:-(b.y-a.y)/chord,y:(b.x-a.x)/chord};let numerator=0,denominator=0;
    for(const p of points){const k=2*((p.x-a.x)*n.x+(p.y-a.y)*n.y),v=p.x*p.x+p.y*p.y-a.x*a.x-a.y*a.y-2*((p.x-a.x)*m.x+(p.y-a.y)*m.y);numerator+=k*v;denominator+=k*k;}
    if(denominator<1e-8)return null;const t=numerator/denominator;center={x:m.x+t*n.x,y:m.y+t*n.y};
  }else{
    const m=points.reduce((s,p)=>({x:s.x+p.x/points.length,y:s.y+p.y/points.length}),{x:0,y:0});let xx=0,xy=0,yy=0,bx=0,by=0;
    for(const p of points){const x=p.x-m.x,y=p.y-m.y,r=x*x+y*y;xx+=x*x;xy+=x*y;yy+=y*y;bx+=x*r/2;by+=y*r/2;}
    const det=xx*yy-xy*xy;if(Math.abs(det)<1e-8)return null;center={x:m.x+(bx*yy-by*xy)/det,y:m.y+(by*xx-bx*xy)/det};
  }
  const radii=points.map(p=>distancePx(p,center)),radius=closed?radii.reduce((a,b)=>a+b,0)/radii.length:radii[0]!;
  const deviations=radii.map(r=>Math.abs(r-radius));if(radius<5||deviations.some(d=>d>tolerance))return null;
  let sweep=0;for(let i=1;i<points.length;i++){let d=angle(points[i]!,center)-angle(points[i-1]!,center);if(d>Math.PI)d-=tau;if(d<-Math.PI)d+=tau;sweep+=d;}
  if(closed){if(Math.abs(sweep)<tau*.9)return null;return {candidate:{id:'',type:'circle',center,radius},deviations};}
  if(Math.abs(sweep)<Math.PI/7||Math.abs(sweep)>tau*.97)return null;
  // Pixel coordinates have y down; retain a positive pixel sweep and reverse at canonical Apply.
  const startAngle=positive(angle(sweep>0?points[0]!:points.at(-1)!,center)),endAngle=startAngle+Math.abs(sweep);
  return {candidate:{id:'',type:'arc',center,radius,startAngle,endAngle},deviations};
}

export function reconstructPaths(raw:PixelPoint[][],settings:{detail:'low'|'medium'|'high';join:boolean;minimum:number;distances?:Float32Array;width?:number;modelTolerancePx?:number}) {
  const started=performance.now(),deviations:number[]=[],candidates:GeometryCandidate[]=[],allWidths:number[]=[],samples=new Map<GeometryCandidate,PixelPoint[]>(),tolerances=new Map<GeometryCandidate,number>();
  const add=(candidate:GeometryCandidate,path:PixelPoint[],tolerance:number)=>{candidates.push(candidate);samples.set(candidate,path);tolerances.set(candidate,tolerance);};
  const endpointCounts=new Map<string,number>(),key=(p:PixelPoint)=>`${p.x}:${p.y}`;
  for(const path of raw)for(const p of [path[0],path.at(-1)])if(p)endpointCounts.set(key(p),(endpointCounts.get(key(p))??0)+1);
  const protectedNode=(p:PixelPoint)=>(endpointCounts.get(key(p))??0)>1;
  const emit=(path:PixelPoint[],tolerance:number,depth=0)=>{
    const line=fitLine(path,tolerance);if(line){add({id:'',type:'line',points:line.points},path,tolerance);line.deviations.forEach(d=>deviations.push(d));return;}
    const curve=fitCurve(path,false,tolerance);if(curve){add(curve.candidate,path,tolerance);curve.deviations.forEach(d=>deviations.push(d));return;}
    // Residual against the endpoint chord finds real corners instead of every local pixel angle.
    let index=1,maximum=0;for(let i=1;i<path.length-1;i++){const d=segmentDistance(path[i]!,path[0]!,path.at(-1)!);if(d>maximum){maximum=d;index=i;}}
    if(depth<16&&index>=3&&path.length-index>=4){emit(path.slice(0,index+1),tolerance,depth+1);emit(path.slice(index),tolerance,depth+1);}
    else {add({id:'',type:'polyline',points:path},path,tolerance);deviations.push(0);}
  };
  for(const path of raw){
    if(path.length<2||path.slice(1).reduce((s,p,i)=>s+distancePx(p,path[i]!),0)<settings.minimum)continue;
    const widths=settings.distances&&settings.width?path.filter((_,i)=>i%4===0).map(p=>2*settings.distances![Math.min(settings.distances!.length-1,Math.floor(p.y)*settings.width!+Math.floor(p.x))]!).filter(Number.isFinite):[1];
    const width=Math.max(1,median(widths));allWidths.push(width);
    // Model tolerance is an optional upper bound, coherently converted before the worker fit.
    const noise=Math.max(.9,Math.min(4,width*.45))*({low:1.5,medium:1,high:.65}[settings.detail]);
    const tolerance=Math.max(1e-6,Math.min(noise,settings.modelTolerancePx??Infinity));
    const closed=path.length>=8&&distancePx(path[0]!,path.at(-1)!)<1.6;
    if(closed){const curve=fitCurve(path.slice(0,-1),true,tolerance);if(curve){add(curve.candidate,path,tolerance);curve.deviations.forEach(d=>deviations.push(d));}else {
      // Preserve loop corners and closure; simplify separately through the existing RDP boundary.
      add({id:'',type:'contour',points:path.slice(0,-1)},path,tolerance);
    }}else emit(path,tolerance);
  }
  const fittingMs=performance.now()-started,topologyStart=performance.now();
  // Only bridge actual scan gaps. Shared branch endpoints are never merged through.
  if(settings.join)for(let i=0;i<candidates.length;i++){const a=candidates[i]!;if(a.type!=='line')continue;
    for(let j=i+1;j<candidates.length;j++){const b=candidates[j]!;if(b.type!=='line')continue;
      merge: for(const reverseA of [false,true])for(const reverseB of [false,true]){
        const ap=reverseA?[...a.points].reverse():a.points,bp=reverseB?[...b.points].reverse():b.points,end=ap[1]!,start=bp[0]!;
        if(protectedNode(end)||protectedNode(start)||distancePx(end,start)>2.8)continue;
        const u={x:end.x-ap[0]!.x,y:end.y-ap[0]!.y},v={x:bp[1]!.x-start.x,y:bp[1]!.y-start.y},dot=(u.x*v.x+u.y*v.y)/(Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y)||1);
        if(dot<.999||segmentDistance(start,ap[0]!,bp[1]!)>1||segmentDistance(end,ap[0]!,bp[1]!)>1)continue;
        const merged={...a,points:[ap[0]!,bp[1]!]},rawSamples=[...(samples.get(a)??[]),...(samples.get(b)??[])],limit=Math.min(tolerances.get(a)??1,tolerances.get(b)??1);if(rawSamples.some(p=>candidateDeviation(merged,p)>limit))continue;
        a.points=merged.points;samples.set(a,rawSamples);samples.delete(b);tolerances.set(a,limit);candidates.splice(j,1);j--;break merge;
      }
    }
  }
  const topologyMs=performance.now()-topologyStart;
  return {candidates,samples,tolerances,metrics:{rawVertices:raw.reduce((s,p)=>s+p.length,0),finalVertices:candidates.reduce((s,c)=>s+('points'in c?c.points.length:c.type==='arc'?2:0),0),fittedPrimitives:candidates.length,maxDeviationPx:deviations.reduce((m,d)=>Math.max(m,d),0),medianDeviationPx:median(deviations),strokeWidthPx:median(allWidths),traceMs:0,fittingMs,topologyMs} satisfies ReconstructionMetrics};
}

/** Residual against the final emitted CAD primitive (including finite arc endpoints). */
export function candidateDeviation(c:GeometryCandidate,p:PixelPoint):number{
 if('points'in c){let d=Infinity;for(let i=1;i<c.points.length;i++)d=Math.min(d,segmentDistance(p,c.points[i-1]!,c.points[i]!));if(c.type==='contour')d=Math.min(d,segmentDistance(p,c.points.at(-1)!,c.points[0]!));return d;}
 const radial=Math.abs(distancePx(p,c.center)-c.radius);if(c.type==='circle')return radial;
 const a=positive(angle(p,c.center)-c.startAngle);if(a<=c.endAngle-c.startAngle+1e-9)return radial;
 return Math.min(...[c.startAngle,c.endAngle].map(a=>distancePx(p,{x:c.center.x+c.radius*Math.cos(a),y:c.center.y+c.radius*Math.sin(a)})));
}
