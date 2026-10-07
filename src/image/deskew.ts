import type { GeometryCandidate, ImageCalibration, PixelImage, PixelPoint } from './types';
export function rotatedSize(width:number,height:number,degrees:number){const a=degrees*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));return {width:Math.max(2,Math.ceil(width*c+height*s-1e-8)),height:Math.max(2,Math.ceil(width*s+height*c-1e-8))};}
export function analysisToPerspective(p:PixelPoint,calibration:ImageCalibration):PixelPoint {
  const w=calibration.perspectiveWidth??calibration.rectifiedWidth,h=calibration.perspectiveHeight??calibration.rectifiedHeight,a=-(calibration.analysisRotationDeg??0)*Math.PI/180,x=p.x-calibration.rectifiedWidth/2,y=p.y-calibration.rectifiedHeight/2;
  return {x:w/2+x*Math.cos(a)-y*Math.sin(a),y:h/2+x*Math.sin(a)+y*Math.cos(a)};
}
/** Expanded, bounded analysis canvas; source image and MODEL placement never change. */
export function rotateAnalysis(source:PixelImage,degrees:number,logical:{width:number;height:number}):PixelImage {
  if(!degrees)return source;
  const size=rotatedSize(logical.width,logical.height,degrees),ratio=Math.min(1,1200/Math.max(size.width,size.height)),width=Math.max(2,Math.round(size.width*ratio)),height=Math.max(2,Math.round(size.height*ratio));
  const calibration={perspectiveWidth:logical.width,perspectiveHeight:logical.height,rectifiedWidth:size.width,rectifiedHeight:size.height,analysisRotationDeg:degrees} as ImageCalibration,data=new Uint8ClampedArray(width*height*4).fill(255);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=analysisToPerspective({x:(x+.5)*size.width/width,y:(y+.5)*size.height/height},calibration),sx=p.x*source.width/logical.width-.5,sy=p.y*source.height/logical.height-.5;
    if(sx<0||sy<0||sx>source.width-1||sy>source.height-1)continue;
    const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(source.width-1,x0+1),y1=Math.min(source.height-1,y0+1),fx=sx-x0,fy=sy-y0;
    for(let c=0;c<4;c++)data[(y*width+x)*4+c]=source.data[(y0*source.width+x0)*4+c]!*(1-fx)*(1-fy)+source.data[(y0*source.width+x1)*4+c]!*fx*(1-fy)+source.data[(y1*source.width+x0)*4+c]!*(1-fx)*fy+source.data[(y1*source.width+x1)*4+c]!*fx*fy;
  }return {width,height,data};
}
/** Dominant axial directions modulo 90°, weighted by length; never silently applied. */
export function suggestDeskew(candidates:GeometryCandidate[]):{skewDeg:number;correctionDeg:number;support:number}|null {
  const lines=candidates.filter((c):c is GeometryCandidate&{type:'line'}=>c.type==='line').map(c=>{const a=c.points[0]!,b=c.points[1]!,length=Math.hypot(b.x-a.x,b.y-a.y);let deg=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;deg=((deg+45)%90+90)%90-45;return {deg,length};}).filter(l=>l.length>=25&&Math.abs(l.deg)<=15);
  if(!lines.length)return null;let best:typeof lines=[];
  for(const l of lines){const group=lines.filter(q=>Math.abs(q.deg-l.deg)<1.2);if(group.reduce((s,q)=>s+q.length,0)>best.reduce((s,q)=>s+q.length,0))best=group;}
  const length=best.reduce((s,l)=>s+l.length,0),support=length/lines.reduce((s,l)=>s+l.length,0);if(length<80||support<.65)return null;
  const skewDeg=best.reduce((s,l)=>s+l.deg*l.length,0)/length;if(Math.abs(skewDeg)<.15)return null;
  return {skewDeg,correctionDeg:-skewDeg,support};
}
