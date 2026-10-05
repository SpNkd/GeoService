// Opt-in local reference benchmark, descriptive timings only; no FPS CI threshold.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const label=process.env.DXF_PROFILE_LABEL??'before',reference=process.env.DXF_REFERENCE??'/path/to/local-reference.dxf';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.addInitScript(()=>{
  window.__profile={commits:0,components:{},json:[],longTasks:[]};
  const stringify=JSON.stringify;JSON.stringify=function(...args){const start=performance.now(),result=stringify.apply(this,args);if(args[0]?.schemaVersion===2||args[0]?.document?.schemaVersion===2)window.__profile.json.push({ms:performance.now()-start,bytes:result.length});return result;};
  new PerformanceObserver(list=>window.__profile.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true});
  const rendered=new Map();window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),inject(renderer){this.renderers.set(1,renderer);return 1;},onCommitFiberRoot(_id,root){window.__profile.commits++;const visit=(f,path='r')=>{if(!f)return;const key=path+'/'+(f.key??f.index??0),name=f.elementType?.displayName??f.elementType?.name??f.type?.name;if(f.actualStartTime>=0&&f.actualStartTime!==rendered.get(key)){rendered.set(key,f.actualStartTime);if(name)window.__profile.components[name]=(window.__profile.components[name]??0)+1;}visit(f.child,key);visit(f.sibling,path);};visit(root.current);},onCommitFiberUnmount(){}};
});
const session=await page.context().newCDPSession(page);await session.send('Performance.enable');
await session.send('Tracing.start',{categories:'devtools.timeline',transferMode:'ReturnAsStream'});
const stageWindows={};
const metrics=async()=>Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
const frame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const results={label,reference,stages:{}};
async function stage(name,run){await frame();const a=await metrics(),snapshot=await page.evaluate(()=>({commits:window.__profile.commits,json:window.__profile.json.length,longTasks:window.__profile.longTasks.length,components:{...window.__profile.components}})),start=Date.now();const samples=await run();await frame();const b=await metrics(),after=await page.evaluate(s=>({commits:window.__profile.commits-s.commits,json:window.__profile.json.slice(s.json),longTasks:window.__profile.longTasks.slice(s.longTasks),components:Object.fromEntries(Object.entries(window.__profile.components).map(([k,v])=>[k,v-(s.components[k]??0)]).filter(([,v])=>v))}),snapshot);const timings=[...(samples??[])].sort((a,b)=>a-b);stageWindows[name]=[a.Timestamp*1e6,b.Timestamp*1e6];results.stages[name]={elapsedMs:Date.now()-start,scriptMs:(b.ScriptDuration-a.ScriptDuration)*1000,taskMs:(b.TaskDuration-a.TaskDuration)*1000,layoutMs:(b.LayoutDuration-a.LayoutDuration)*1000,styleMs:(b.RecalcStyleDuration-a.RecalcStyleDuration)*1000,layoutCount:b.LayoutCount-a.LayoutCount,...after,...(timings.length?{samples:timings.length,medianMs:timings[Math.floor(timings.length*.5)],p95Ms:timings[Math.min(timings.length-1,Math.floor(timings.length*.95))]}:{})};console.log(name,JSON.stringify(results.stages[name]));}
await page.goto(process.env.DXF_PROFILE_URL??'http://127.0.0.1:5173/');await page.getByTestId('drawing-canvas').waitFor();
await page.getByRole('button',{name:'DXF',exact:true}).click();await page.getByLabel('Файл DXF',{exact:true}).setInputFiles(reference);await page.getByTestId('dxf-report').waitFor();
await stage('initialRenderAndAutosave',async()=>{const renderStart=await page.evaluate(()=>performance.now());page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Открыть как новый документ',exact:true}).click();await page.getByRole('dialog',{name:'Открыть DXF',exact:true}).waitFor({state:'hidden'});await frame();results.firstRenderMs=await page.evaluate(t=>performance.now()-t,renderStart);await page.getByTestId('persistence-status').filter({hasText:'Сохранено локально'}).waitFor({timeout:30000});});
const document=await page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('geoservice.autosave');open.onsuccess=()=>{const db=open.result,r=db.transaction('documents').objectStore('documents').get('current');r.onsuccess=()=>{resolve(r.result.document);db.close();};r.onerror=reject;};}));
await writeFile('/private/tmp/geoservice-dxf-profile.json',JSON.stringify(document));
results.document={entities:document.entities.length,blocks:document.blocks.length,layers:document.layers.length,sharedPrimitives:document.blocks.reduce((n,b)=>n+b.primitives.length,0)+document.entities.reduce((n,e)=>n+(e.attributePrimitives?.length??0)+(e.primitives?.length??0),0),jsonBytes:Buffer.byteLength(JSON.stringify(document))};
const canvas=page.getByTestId('drawing-canvas');
await stage('fit',async()=>{await page.getByRole('button',{name:'Вписать',exact:true}).click();});
const box=await canvas.boundingBox(),point={x:box.x+box.width*.5,y:box.y+box.height*.5};
async function path(count,action){const times=[];for(let i=0;i<count;i++){const start=Date.now();await action(i);await frame();times.push(Date.now()-start);}return times;}
await stage('pointermoveHover',()=>path(60,i=>page.mouse.move(box.x+20+(i*43)%(box.width-40),box.y+20+(i*17)%(box.height-40))));
await stage('pan5seconds',async()=>{await page.keyboard.down('Space');await page.mouse.move(point.x,point.y);await page.mouse.down();const times=[],start=Date.now();let i=0;while(Date.now()-start<5000){const t=Date.now();await page.mouse.move(point.x+70*Math.sin(i*.15),point.y+40*Math.cos(i*.15));await frame();times.push(Date.now()-t);i++;}await page.mouse.up();await page.keyboard.up('Space');return times;});
// Reset camera so different pan sample throughput cannot change subsequent hit coordinates.
await page.getByRole('button',{name:'Вписать',exact:true}).click();await frame();
await stage('zoom20',()=>path(20,async i=>{await page.mouse.move(point.x,point.y);await page.mouse.wheel(0,i<10?-40:40);}));
const hits=await page.evaluate(()=>{const s=document.querySelector('.drawing-canvas'),r=s.getBoundingClientRect(),result=[];for(let y=r.y+25;y<r.bottom-25;y+=24)for(let x=r.x+25;x<r.right-25;x+=24){const e=document.elementFromPoint(x,y)?.closest('[data-entity-id]');if(e&&!result.some(p=>p.id===e.getAttribute('data-entity-id')))result.push({x,y,id:e.getAttribute('data-entity-id'),type:e.getAttribute('data-entity-type')});}return result;});
results.hitSamples=hits.length;
await stage('ordinarySelection20',()=>path(20,i=>page.mouse.click((hits[i%hits.length]??point).x,(hits[i%hits.length]??point).y)));
await stage('altSelection10',async()=>{await page.keyboard.down('Alt');const t=await path(10,i=>page.mouse.click((hits[i%hits.length]??point).x,(hits[i%hits.length]??point).y));await page.keyboard.up('Alt');return t;});
await stage('marquee',async()=>{await page.mouse.move(box.x+3,box.y+3);await page.mouse.down();await path(12,i=>page.mouse.move(box.x+3+(box.width-6)*(i+1)/12,box.y+3+(box.height-6)*(i+1)/12));await page.mouse.up();});
async function movePreview(single){const p=hits.find(p=>p.type==='block_instance')??hits[0];if(!p)return;await page.mouse.move(p.x,p.y);if(single){await page.mouse.click(p.x,p.y);await page.keyboard.press('Escape');}await page.mouse.down();const times=await path(12,i=>page.mouse.move(p.x+20*(i+1)/12,p.y+15*(i+1)/12));await page.keyboard.press('Escape');await page.mouse.up();return times;}
await stage('moveMultiPreview',()=>movePreview(false));
await stage('moveBlockPreview',()=>movePreview(true));
await stage('layerHideShow',async()=>{const l=document.layers.find(l=>l.name==='_ГП_ЗИС');await page.getByRole('button',{name:`Скрыть слой ${l.name}`,exact:true}).click();await page.getByRole('button',{name:`Показать слой ${l.name}`,exact:true}).click();});
await stage('propertiesCommitAutosave',async()=>{await page.getByRole('button',{name:'Создать слой',exact:true}).click();await page.getByTestId('persistence-status').filter({hasText:'Сохранено локально'}).waitFor({timeout:30000});await page.waitForTimeout(800);});
results.bounds=await page.evaluate(async d=>{const {visibleBounds}=await import('/src/renderer/selectors.ts'),times=[];for(let i=0;i<20;i++){const t=performance.now();visibleBounds(i===0?d:{...d});times.push(performance.now()-t);}return {firstMs:times[0],medianMs:times.sort((a,b)=>a-b)[10],p95Ms:times[19]};},document);
const traceComplete=new Promise(resolve=>session.once('Tracing.tracingComplete',resolve));await session.send('Tracing.end');const {stream}=await traceComplete;let traceJson='';for(;;){const chunk=await session.send('IO.read',{handle:stream});traceJson+=chunk.data;if(chunk.eof)break;}await session.send('IO.close',{handle:stream});
const trace=JSON.parse(traceJson).traceEvents;for(const [name,[start,end]] of Object.entries(stageWindows)){const events=trace.filter(e=>e.ph==='X'&&e.ts>=start&&e.ts<end);results.stages[name].paintMs=events.filter(e=>e.name==='Paint').reduce((n,e)=>n+(e.dur??0)/1000,0);results.stages[name].prePaintMs=events.filter(e=>e.name==='PrePaint').reduce((n,e)=>n+(e.dur??0)/1000,0);results.stages[name].eventDispatchMs=events.filter(e=>e.name==='EventDispatch').reduce((n,e)=>n+(e.dur??0)/1000,0);}
results.instrumentation='Chrome CDP script/layout/style/paint + Long Tasks + React fiber work counters. Samples include Playwright delivery and two rAFs; descriptive, not FPS. Fiber counters include memo wrapper work, not necessarily function execution.';
results.errors=errors;results.domPrimitives=await page.locator('svg.drawing-canvas path,svg.drawing-canvas circle').count();
await writeFile(`docs/audit-results/dxf-interaction-${label}.json`,JSON.stringify(results,null,2)+'\n');await browser.close();
