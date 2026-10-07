import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { multiplyPdf, pdfVectors, type PdfMatrix } from './operators';
import type { Candidate } from '../image/types';
pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
export async function openLocalPdf(file:File,signal:AbortSignal){
 if(file.size<=0||file.size>40*1024*1024)throw new Error('Размер PDF должен быть не более 40 MiB.');
 if(import.meta.env.PROD&&'serviceWorker'in navigator){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([navigator.serviceWorker.register(new URL(import.meta.env.BASE_URL+'ocr-offline.js?mode=pdf',location.href),{scope:import.meta.env.BASE_URL}).then(()=>navigator.serviceWorker.ready),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Offline warm-up timeout')),5000);})]);}catch{/* Optional cache: local PDF parsing remains available. */}finally{clearTimeout(timer);}}
 const bytes=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(bytes.subarray(0,8)).indexOf('%PDF-')!==0)throw new Error('Файл не является PDF.');if(signal.aborted)throw new DOMException('Отменено','AbortError');
 const base=new URL(import.meta.env.BASE_URL+'pdf/',location.href).href,task=pdfjs.getDocument({data:bytes,isEvalSupported:false,enableXfa:false,cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',wasmUrl:base+'wasm/',maxImageSize:70_000_000,canvasMaxAreaInBytes:32*1024*1024});
 const abort=()=>void task.destroy();signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,60000);
 try{const pdf=await task.promise;if(signal.aborted)throw new DOMException('Отменено','AbortError');if(pdf.numPages>500)throw new Error('PDF содержит более 500 страниц. Выберите меньший файл.');return pdf;}catch(e){await task.destroy();throw e;}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
export interface PdfPageResult {width:number;height:number;route:'vector'|'raster'|'mixed';candidates:Candidate[];imageCount:number;warnings:string[];preview:Blob;timings:{inspection:number;rendering:number}}
export async function readPdfPage(pdf:PDFDocumentProxy,pageNumber:number,signal:AbortSignal):Promise<PdfPageResult>{
 const start=performance.now(),page=await pdf.getPage(pageNumber),view=page.getViewport({scale:1});
 if(signal.aborted)throw new DOMException('Отменено','AbortError');
 const operators=await page.getOperatorList(),vectors=pdfVectors(operators as {fnArray:number[];argsArray:unknown[][]},pdfjs.OPS,view.transform as PdfMatrix),text=await page.getTextContent();
 const candidates:Candidate[]=[...vectors.candidates];
 for(const item of text.items){if(!('str'in item)||!item.str.trim())continue;if(candidates.length>=5000)throw new Error('Более 5000 PDF-кандидатов.');const m=multiplyPdf(view.transform as PdfMatrix,item.transform as PdfMatrix),height=Math.max(.01,Math.hypot(m[2],m[3])),length=Math.hypot(m[0],m[1])||1,rotation=Math.atan2(m[1],m[0]),x=m[4],y=m[5],w=item.width;
  const points=[{x,y},{x:x+w*Math.cos(rotation),y:y+w*Math.sin(rotation)},{x:x+w*Math.cos(rotation)+height*Math.sin(rotation),y:y+w*Math.sin(rotation)-height*Math.cos(rotation)},{x:x+height*Math.sin(rotation),y:y-height*Math.cos(rotation)}],xs=points.map(p=>p.x),ys=points.map(p=>p.y);void length;
  candidates.push({id:'',type:'text',recognizedText:item.str,originalText:item.str,anchor:{x,y},textHeight:height,rotationDeg:rotation*180/Math.PI,confirmed:false,bounds:{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}});
 }
 candidates.forEach((c,i)=>c.id=`pdf-${pageNumber}-${i+1}`);
 const route=candidates.length?(vectors.imageCount?'mixed':'vector'):'raster',inspection=performance.now()-start,renderStart=performance.now();
 const scale=Math.min(2,2400/Math.max(view.width,view.height)),viewport=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.max(2,Math.ceil(viewport.width));canvas.height=Math.max(2,Math.ceil(viewport.height));
 const rendering=page.render({canvas,viewport,annotationMode:pdfjs.AnnotationMode.DISABLE}),abort=()=>rendering.cancel();signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,60000);
 try{await rendering.promise;if(signal.aborted)throw new DOMException('Отменено','AbortError');const preview=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Не удалось создать PDF preview.')),'image/png'));return {width:view.width,height:view.height,route,candidates,imageCount:vectors.imageCount,warnings:vectors.warnings,preview,timings:{inspection,rendering:performance.now()-renderStart}};}
 finally{clearTimeout(timer);signal.removeEventListener('abort',abort);canvas.width=canvas.height=0;page.cleanup();}
}
