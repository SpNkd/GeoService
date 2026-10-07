import {chromium} from '@playwright/test';
import {writeFile,unlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const baseline='src/image/.baseline-extract.ts';
await writeFile(baseline,execFileSync('git',['show','d547e16e91c272a264786f722bcab46c621b4ed8:src/image/extract.ts']));
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage(),errors=[],external=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).hostname!=='127.0.0.1')external.push(r.url());});
try{
 await page.goto('http://127.0.0.1:5173/');const measurements=[];
 for(const kind of ['straight','corner','T','X','arc','circle','gap'])for(const [width,height]of [[1920,1080],[3840,2160],[7680,4320]]){
 const result=await page.evaluate(async({kind,width,height})=>{
 const {reconstructionFixture}=await import('/src/tests/fixtures/reconstruction.ts'),{prepareImage,processImage}=await import('/src/image/client.ts'),{DEFAULT_EXTRACTION}=await import('/src/image/types.ts'),{fullQuad}=await import('/src/image/transform.ts'),{extractGeometry}=await import('/src/image/.baseline-extract.ts'),{createNewDocument}=await import('/src/domain/newDocument.ts'),{candidateCommands}=await import('/src/image/apply.ts'),{applyCommandsAtomically}=await import('/src/domain/commands.ts');
 const fixture=reconstructionFixture(kind,width,height),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').putImageData(new ImageData(fixture.data,width,height),0,0);const blob=await new Promise(r=>canvas.toBlob(r));canvas.width=canvas.height=0;
 const tasks=[],observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({duration:e.duration,start:e.startTime}))));observer.observe({type:'longtask'});
 const start=performance.now(),bitmap=await createImageBitmap(blob),decode=performance.now()-start,t=performance.now(),source=prepareImage(bitmap),preparation=performance.now()-t;bitmap.close();
 const calibration={quad:fullQuad(width,height),rectifiedWidth:width,rectifiedHeight:height},w=performance.now(),output=await processImage(source,{width,height},calibration,DEFAULT_EXTRACTION,new AbortController().signal),workerWall=performance.now()-w;
 const p=performance.now(),preview=document.createElement('canvas');preview.width=output.image.width;preview.height=output.image.height;preview.getContext('2d').putImageData(new ImageData(output.image.data,output.image.width,output.image.height),0,0);document.body.append(preview);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const previewMs=performance.now()-p;preview.remove();
 const doc=createNewDocument(),raster={id:'transform',type:'raster_underlay',name:'synthetic',assetId:'local',layerId:doc.layers[0].id,position:{x:0,y:0},width:width*.01,height:height*.01,rotationDeg:0,opacity:.6,locked:false};
 const convert=candidates=>applyCommandsAtomically(doc,candidateCommands(doc,raster,raster,calibration,candidates,new Set(candidates.map(c=>c.id)),raster.layerId,'benchmark'));
 const a=performance.now(),applied=convert(output.result.candidates),apply=performance.now()-a;await new Promise(r=>setTimeout(r,60));observer.disconnect();
 const oldStart=performance.now(),before=extractGeometry(output.image,DEFAULT_EXTRACTION),beforeMs=performance.now()-oldStart,beforeCandidates=before.candidates.map(c=>'points'in c?{...c,points:c.points.map(p=>({x:p.x*width/output.image.width,y:p.y*height/output.image.height}))}:c.type==='circle'?{...c,center:{x:c.center.x*width/output.image.width,y:c.center.y*height/output.image.height},radius:c.radius*width/output.image.width}:c),oldDoc=convert(beforeCandidates);
 const counts=candidates=>({entities:candidates.length,types:candidates.reduce((o,c)=>({...o,[c.type]:(o[c.type]??0)+1}),{}),vertices:candidates.reduce((n,c)=>n+('points'in c?c.points.length:c.type==='arc'?2:0),0)});
 return {kind,width,height,decode,preparation,workerWall,previewMs,apply,analysis:{width:source.width,height:source.height},...output.result.timings,metrics:output.result.reconstruction,before:{...counts(before.candidates),milliseconds:beforeMs,jsonBytes:JSON.stringify(oldDoc).length},after:{...counts(output.result.candidates),jsonBytes:JSON.stringify(applied).length},mainLongTasks:tasks.filter(t=>t.start>=start),memory:{sourceNativeBitmapEstimate:width*height*4,boundedRgbaBytes:source.data.byteLength,note:'Native decode/WASM peak RSS is not measured by JS heap.'}};
 },{kind,width,height});measurements.push(result);
 }
 const report={date:new Date().toISOString(),baselineCommit:'d547e16',method:'Sequential Chrome. Original deterministic fixtures; fixture generation excluded. Baseline extraction uses the same bounded rectified bitmap and settings. Baseline CPU comparison excluded from main long-task interval. Candidate JSON uses identical canonical conversion.',measurements,errors,external};await writeFile('docs/audit-results/geometry-reconstruction-performance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({jobs:measurements.length,errors,external,longTasks:measurements.flatMap(r=>r.mainLongTasks).length}));if(errors.length||external.length)throw new Error('Browser/privacy check failed');
}finally{await browser.close();await unlink(baseline);}
