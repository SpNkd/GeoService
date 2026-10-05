import type { WorldPoint } from '../domain/model';
import type { VectorPrimitive, PrimitiveStyle } from '../vectors/types';
import { number, value, type RawRecord, type Group } from './raw';
import { bulgePath, plainDxfText } from './curves';
const coordinate=(value:string|undefined,factor:number)=>{const n=Number(value)*factor;if(!Number.isFinite(n))throw new Error('Invalid supplemental DXF coordinate');return n===0?0:n;};
const point=(groups:Group[],i:number,factor:number):WorldPoint=>({x:coordinate(groups[i]?.value,factor),y:coordinate(groups[i+1]?.value,factor),...(groups[i+2]?.code===groups[i]!.code+20?{z:coordinate(groups[i+2]!.value,factor)}:{})});
export function hatchPrimitives(r:RawRecord,style:PrimitiveStyle,factor:number):VectorPrimitive[] {
  const g=r.groups,primitives:VectorPrimitive[]=[];
  for(let i=0;i<g.length;i++)if(g[i]!.code===92){
    const flags=Number(g[i]!.value);let end=i+1;while(end<g.length&&![92,97,75].includes(g[end]!.code))end++;
    const segment=g.slice(i+1,end);
    if(flags&2){const points:(WorldPoint&{bulge?:number})[]=[];for(let j=0;j<segment.length;j++)if(segment[j]!.code===10){const p=point(segment,j,factor);let k=j+2;let bulge=0;while(k<segment.length&&segment[k]!.code!==10){if(segment[k]!.code===42)bulge=Number(segment[k]!.value);k++;}points.push({...p,bulge});}if(points.length>=3)primitives.push({...style,kind:'path',points:bulgePath(points,true),closed:true,fill:true});}
    else {
      const points:WorldPoint[]=[];
      for(let j=0;j<segment.length;j++)if(segment[j]!.code===72){let k=j+1;while(k<segment.length&&segment[k]!.code!==72)k++;const edge={...r,groups:segment.slice(j+1,k)};
        if(segment[j]!.value==='1'){const a=edge.groups.findIndex(x=>x.code===10),b=edge.groups.findIndex(x=>x.code===11);if(a>=0&&b>=0)points.push(point(edge.groups,a,factor),point(edge.groups,b,factor));}
        else if(segment[j]!.value==='2'){const idx=edge.groups.findIndex(x=>x.code===10),center=point(edge.groups,idx,factor),radius=number(edge,40)*factor,start=number(edge,50)*Math.PI/180,endAngle=number(edge,51)*Math.PI/180,ccw=number(edge,73,1)!==0;let sweep=endAngle-start;if(ccw&&sweep<0)sweep+=2*Math.PI;if(!ccw&&sweep>0)sweep-=2*Math.PI;const n=Math.max(2,Math.ceil(Math.abs(sweep)/(2*Math.acos(Math.max(-1,1-Math.min(.01/radius,1))))));if(n>4096)throw new Error('HATCH arc budget exceeded');for(let t=0;t<=n;t++)points.push({x:center.x+radius*Math.cos(start+sweep*t/n),y:center.y+radius*Math.sin(start+sweep*t/n)});}
        else throw new Error('HATCH ellipse/spline boundary not supported');
      }
      if(points.length>=3)primitives.push({...style,kind:'path',points,closed:true,fill:true});
    }
    i=end-1;
  }
  if(!primitives.length)throw new Error('HATCH has no supported boundary');return primitives;
}
export function leaderPrimitives(r:RawRecord,style:PrimitiveStyle,factor:number):VectorPrimitive[] {
  const g=r.groups,ps:VectorPrimitive[]=[];const posIndex=g.findIndex(x=>x.code===12),text=plainDxfText(value(r,304)??'');
  if(posIndex>=0&&text&&!text.includes('LEADER_LINE'))ps.push({...style,kind:'text',position:point(g,posIndex,factor),content:text,height:Math.max(number(r,41,1)*factor,.00001),rotationDeg:number(r,42)*180/Math.PI});
  let base:WorldPoint|undefined;
  for(let i=0;i<g.length;i++){
    if(g[i]!.value==='LEADER{'){const j=g.slice(i+1).findIndex(x=>x.code===10);if(j>=0)base=point(g,i+1+j,factor);}
    if(g[i]!.value==='LEADER_LINE{'){let end=i+1;while(end<g.length&&g[end]!.code!==305)end++;const points:WorldPoint[]=[];for(let j=i+1;j<end;j++)if(g[j]!.code===10)points.push(point(g,j,factor));if(base)points.push(base);if(points.length>=2){ps.push({...style,kind:'path',points,closed:false});const a=points[0]!,b=points[1]!,angle=Math.atan2(b.y-a.y,b.x-a.x),length=Math.min(Math.hypot(b.x-a.x,b.y-a.y)/3,number(r,140,1)*factor);ps.push({...style,kind:'path',points:[a,{x:a.x+length*Math.cos(angle+.2),y:a.y+length*Math.sin(angle+.2)},{x:a.x+length*Math.cos(angle-.2),y:a.y+length*Math.sin(angle-.2)}],closed:true,fill:true});}i=end;}
  }
  if(!ps.length)throw new Error('MULTILEADER content not supported');return ps;
}
