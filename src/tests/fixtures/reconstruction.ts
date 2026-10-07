import type { PixelImage,PixelPoint } from '../../image/types';
export type ReconstructionFixture='straight'|'corner'|'T'|'X'|'arc'|'circle'|'gap'|'deskew';
export function reconstructionFixture(kind:ReconstructionFixture,width=640,height=480):PixelImage {
 const sx=Math.min(width/640,height/480),sy=sx,data=new Uint8ClampedArray(width*height*4).fill(255),paths:PixelPoint[][]=[];
 const line=(a:PixelPoint,b:PixelPoint)=>Array.from({length:Math.max(width,height)},(_,i)=>({x:a.x+(b.x-a.x)*i/(Math.max(width,height)-1),y:a.y+(b.y-a.y)*i/(Math.max(width,height)-1)}));
 if(kind==='arc'||kind==='circle'){const sweep=kind==='circle'?2*Math.PI:2.5;paths.push(Array.from({length:1000},(_,i)=>({x:320+110*Math.cos(.2+sweep*i/999),y:240+110*Math.sin(.2+sweep*i/999)})));}
 else if(kind==='corner'){paths.push(line({x:60,y:120},{x:320,y:120}),line({x:320,y:120},{x:320,y:410}));}
 else if(kind==='T'||kind==='X'){paths.push(line({x:60,y:240},{x:580,y:240}),line({x:320,y:60},{x:320,y:kind==='T'?240:420}));}
 else if(kind==='gap'){paths.push(line({x:60,y:240},{x:318,y:240}),line({x:320,y:240},{x:580,y:240}));}
 else {paths.push(line({x:60,y:220},{x:580,y:220+520*Math.tan((kind==='deskew'?2.5:.5)*Math.PI/180)}));}
 const radius=Math.max(1,Math.round(2*Math.min(sx,sy)));
 for(const path of paths)for(const p of path){const x=Math.round(p.x*sx),y=Math.round(p.y*sy);for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=width||Y>=height)continue;const n=(Y*width+X)*4;data[n]=data[n+1]=data[n+2]=0;}}
 return {width,height,data};
}
