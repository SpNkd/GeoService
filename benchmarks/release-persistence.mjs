import {chromium,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const saved=()=>expect(page.getByTestId('persistence-status')).toHaveText('Сохранено локально',{timeout:15000});
async function command(name){const button=page.getByRole('button',{name,exact:true,includeHidden:true});const parents=await button.evaluate(e=>{const a=[];for(let p=e.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement&&!p.open)a.unshift(p.querySelector(':scope>summary').textContent);return a;});for(const s of parents)await page.getByText(s,{exact:true}).first().click();await button.click();}
try{await page.goto('http://127.0.0.1:5173/');await saved();
 const preparation=await page.evaluate(async()=>{
  const {createNewDocument}=await import('/src/domain/newDocument.ts'),{prepareAutosaveDocument}=await import('/src/persistence/autosavePreparation.ts'),{createAutosaveStore}=await import('/src/persistence/autosave.ts');
  const d=createNewDocument();d.metadata.title='Synthetic 50k persistence';for(let i=0;i<50000;i++){const id='v'+i;d.vertices[id]={id,x:i%500,y:Math.floor(i/500)};d.entities.push({id:'p'+i,type:'point',name:'P'+i,layerId:'survey-points',vertexId:id});}
  const tasks=[];new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'});window.__persistenceTasks=tasks;
  const start=performance.now(),prepared=await prepareAutosaveDocument(d),workerPrepareMs=performance.now()-start;
  const api=createAutosaveStore({prepare:async()=>prepared}),t=performance.now();await api.saveAutosave(d,true);const writeMs=performance.now()-t;
  const file=new File([JSON.stringify(d)],'synthetic-50k.json',{type:'application/json'}),dt=new DataTransfer();dt.items.add(file);const input=document.querySelector('input[aria-label="Файл GeoDocument"]');input.files=dt.files;window.__openStart=performance.now();input.dispatchEvent(new Event('change',{bubbles:true}));
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(prepared.document))),canonicalHash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
  return {owners:d.entities.length,bytes:prepared.approximateSerializedBytes,workerPrepareMs,indexedDBWriteMs:writeMs,canonicalHash};
 });await expect(page.locator('.document-facts')).toContainText('50000 в модели',{timeout:15000});await saved();
 const openMs=await page.evaluate(()=>performance.now()-window.__openStart);const saveStart=performance.now(),download=page.waitForEvent('download');await command('Сохранить JSON');const file=await(await download).path(),text=await readFile(file,'utf8'),saveMs=performance.now()-saveStart;const doc=JSON.parse(text);expect(doc.entities).toHaveLength(50000);expect(createHash('sha256').update(JSON.stringify(doc)).digest('hex')).toBe(preparation.canonicalHash);
 await page.waitForTimeout(80);const mainLongTasks=await page.evaluate(()=>window.__persistenceTasks);
 const reloadStart=performance.now();await page.reload();await saved();const hydrationMs=performance.now()-reloadStart;
 const check=await page.evaluate(()=>new Promise(r=>{const q=indexedDB.open('geoservice.autosave');q.onsuccess=()=>{const db=q.result,g=db.transaction('documents').objectStore('documents').get('current');g.onsuccess=async()=>{const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(g.result.document)));r({owners:g.result.document.entities.length,title:g.result.document.metadata.title,canonicalHash:Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('')});db.close();};};}));expect(check.owners).toBe(50000);expect(check.title).toBe('Synthetic 50k persistence');expect(check.canonicalHash).toBe(preparation.canonicalHash);
 const {canonicalHash,...timings}=preparation;void canonicalHash;
 const report={method:'Isolated Chrome DEV, generated 50k points, safe local coordinates. Fixture generation excluded; cold large preparation Worker measured separately from IndexedDB put. Open/Save/reload are actual UI. Save wall includes Playwright and local download. No native process RSS estimate.',...timings,roundTripSha256Matches:true,openMs,saveMs,hydrationToSavedMs:hydrationMs,mainLongTasks,errors};await writeFile('docs/audit-results/release-persistence.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));expect(errors).toEqual([]);
}finally{await browser.close();}
