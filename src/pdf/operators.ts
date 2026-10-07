import type { Candidate, PixelPoint } from '../image/types';
import { fitCurve } from '../image/reconstruct';
export type PdfMatrix=[number,number,number,number,number,number];
export const multiplyPdf=(a:PdfMatrix,b:PdfMatrix):PdfMatrix=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
export const pdfPoint=(m:PdfMatrix,x:number,y:number)=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
const length=(a:PixelPoint,b:PixelPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
function flatten(a:PixelPoint,b:PixelPoint,c:PixelPoint,d:PixelPoint,output:PixelPoint[],depth=0){
 const chord=length(a,d),deviation=Math.max(Math.abs((d.x-a.x)*(b.y-a.y)-(d.y-a.y)*(b.x-a.x)),Math.abs((d.x-a.x)*(c.y-a.y)-(d.y-a.y)*(c.x-a.x)))/(chord||1);
 if(depth>=10||deviation<.25){output.push(d);return;}const mid=(p:PixelPoint,q:PixelPoint)=>({x:(p.x+q.x)/2,y:(p.y+q.y)/2}),ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),m=mid(abc,bcd);flatten(a,ab,abc,m,output,depth+1);flatten(m,bcd,cd,d,output,depth+1);
}
/** Adapter for the pinned PDF.js 5.4 DrawOPS representation, not arbitrary PDF stream parsing. */
export function pdfVectors(list:{fnArray:number[];argsArray:unknown[][]},ops:Record<string,number>,pageMatrix:PdfMatrix){
 if(list.fnArray.length>200000)throw new Error('Слишком сложная PDF-страница: более 200 000 операций.');
 let matrix:PdfMatrix=pageMatrix,whiteFill=false,clipped=false,imageCount=0,vertices=0;
 const stack:{matrix:PdfMatrix;whiteFill:boolean;clipped:boolean}[]=[],candidates:Candidate[]=[],warnings=new Set<string>();
 const save=()=>stack.push({matrix:[...matrix],whiteFill,clipped}),restore=()=>{const state=stack.pop();if(state)({matrix,whiteFill,clipped}=state);};
 for(let i=0;i<list.fnArray.length;i++){
  const fn=list.fnArray[i]!,args=list.argsArray[i]??[];
  if(fn===ops.save){save();continue;}if(fn===ops.restore){restore();continue;}
  if(fn===ops.transform){matrix=multiplyPdf(matrix,args as PdfMatrix);continue;}
  if(fn===ops.paintFormXObjectBegin){save();if(Array.isArray(args[0]))matrix=multiplyPdf(matrix,args[0] as PdfMatrix);continue;}
  if(fn===ops.paintFormXObjectEnd){restore();continue;}
  if(fn===ops.setFillRGBColor){whiteFill=args[0]==='#ffffff';continue;}
  if(fn===ops.clip||fn===ops.eoClip){clipped=true;warnings.add('Сложные clip-path не извлекаются; смотрите локальный preview.');continue;}
  if(['paintImageXObject','paintInlineImageXObject','paintImageMaskXObject','paintImageXObjectRepeat','paintImageMaskXObjectRepeat','paintImageMaskXObjectGroup','paintInlineImageXObjectGroup'].some(name=>fn===ops[name])){imageCount++;continue;}
  if(fn!==ops.constructPath)continue;
  const paint=Number(args[0]),data=(args[1] as ArrayLike<ArrayLike<number>>|undefined)?.[0];
  if(!data||clipped)continue;
  const stroke=[ops.stroke,ops.closeStroke,ops.fillStroke,ops.eoFillStroke,ops.closeFillStroke,ops.closeEOFillStroke].includes(paint),fill=[ops.fill,ops.eoFill,ops.fillStroke,ops.eoFillStroke,ops.closeFillStroke,ops.closeEOFillStroke].includes(paint);
  if(!stroke&&(!fill||whiteFill))continue;
  const paths:{points:PixelPoint[];closed:boolean;curved:boolean}[]=[];let path:typeof paths[number]|undefined;
  for(let k=0;k<data.length;){const draw=data[k++]!;
   if(draw===0){path={points:[pdfPoint(matrix,data[k++]!,data[k++]!)],closed:false,curved:false};paths.push(path);}
   else if(draw===1){const p=pdfPoint(matrix,data[k++]!,data[k++]!);path?.points.push(p);}
   else if(draw===2){const b=pdfPoint(matrix,data[k++]!,data[k++]!),c=pdfPoint(matrix,data[k++]!,data[k++]!),d=pdfPoint(matrix,data[k++]!,data[k++]!);if(path?.points.length){flatten(path.points.at(-1)!,b,c,d,path.points);path.curved=true;}}
   else if(draw===3){const b=pdfPoint(matrix,data[k++]!,data[k++]!),d=pdfPoint(matrix,data[k++]!,data[k++]!);if(path?.points.length){const a=path.points.at(-1)!;flatten(a,{x:a.x+(b.x-a.x)*2/3,y:a.y+(b.y-a.y)*2/3},{x:d.x+(b.x-d.x)*2/3,y:d.y+(b.y-d.y)*2/3},d,path.points);path.curved=true;}}
   else if(draw===4){if(path)path.closed=true;}else {warnings.add('Неподдерживаемая операция пути пропущена.');break;}
  }
  if(fill&&paths.length>1&&!stroke){warnings.add('Составные заливки с отверстиями оставлены только в preview.');continue;}
  for(const p of paths){if(p.points.length<2||p.points.some(q=>!Number.isFinite(q.x)||!Number.isFinite(q.y)))continue;vertices+=p.points.length;if(vertices>100000||candidates.length>=5000)throw new Error('PDF превышает лимит геометрии: 5000 кандидатов / 100 000 вершин.');
   if(p.closed&&length(p.points[0]!,p.points.at(-1)!)<.001)p.points.pop();
   const fitted=p.curved?fitCurve(p.points,p.closed,.5):null;
   candidates.push(fitted?fitted.candidate:{id:'',type:p.closed?(p.points.length>=3?'contour':'polyline'):p.points.length===2?'line':'polyline',points:p.points});
  }
 }
 return {candidates,imageCount,warnings:[...warnings]};
}
