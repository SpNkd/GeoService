import type { WorldPoint } from '../domain/model';
/** MODEL sagitta <= 0.01 m, capped at 4096 segments; exceeding cap fails visibly. */
export function bulgePath(points:(WorldPoint&{bulge?:number})[],closed:boolean):WorldPoint[] {
  const out:WorldPoint[]=[];
  for(let i=0;i<points.length;i++){
    const a=points[i]!,b=points[(i+1)%points.length]!,bulge=a.bulge??0;out.push({x:a.x,y:a.y,...(a.z===undefined?{}:{z:a.z})});
    if(!bulge||!closed&&i===points.length-1)continue;
    const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(!length)continue;
    const theta=4*Math.atan(bulge),radius=length*(1+bulge*bulge)/(4*Math.abs(bulge)),offset=length*(1-bulge*bulge)/(4*bulge),cx=(a.x+b.x)/2-dy/length*offset,cy=(a.y+b.y)/2+dx/length*offset,start=Math.atan2(a.y-cy,a.x-cx);
    const step=2*Math.acos(Math.max(-1,1-Math.min(.01/radius,1))),n=Math.max(1,Math.ceil(Math.abs(theta)/step));if(n>4096)throw new Error('Bulge превышает бюджет 4096 segments');
    for(let j=1;j<n;j++){const t=j/n,r=start+theta*t;out.push({x:cx+radius*Math.cos(r),y:cy+radius*Math.sin(r),...(a.z===undefined&&b.z===undefined?{}:{z:(a.z??0)+((b.z??0)-(a.z??0))*t})});}
  }
  return out;
}
export function plainDxfText(input:string):string {
  return input.replace(/\\U\+([\da-f]{4})/gi,(_s,h:string)=>String.fromCharCode(parseInt(h,16))).replace(/%%d/gi,'°').replace(/%%p/gi,'±').replace(/%%c/gi,'Ø').replace(/\\P/g,'\n').replace(/\\~/g,' ').replace(/\\S([^;]*);/g,(_s,t:string)=>t.replace(/[\^#]/g,'/')).replace(/\\[ACcFfHhQqTtWw][^;]*;/g,'').replace(/\\[LlOoKk]/g,'').replace(/[{}]/g,'').trim();
}
