import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createNewDocument } from '../src/domain/newDocument';
import type { GeoDocument } from '../src/domain/model';
import { readAutosaveDocument } from './helpers/autosave';
const X=6190000,Y=2196000;
function scene():GeoDocument {
  const d=createNewDocument(),layerId=d.layers[0]!.id,s={layerId,colorMode:'byblock' as const};
  d.blocks=[{id:'child',sourceName:'Child',basePoint:{x:X,y:Y},primitives:[{...s,kind:'text',position:{x:X,y:Y},content:'NESTED TEXT',height:8,rotationDeg:0}]},
    {id:'parent',sourceName:'Parent',basePoint:{x:0,y:0},primitives:[{...s,kind:'path',points:[{x:X-1000,y:Y-1000},{x:X+1000,y:Y-1000},{x:X+1000,y:Y+1000},{x:X-1000,y:Y+1000}],closed:true},
      ...Array.from({length:100},(_,i)=>({...s,kind:'path' as const,closed:false,points:[{x:X-1000,y:Y-1000+i*20},{x:X+1000,y:Y-1000+i*20}]})),
      {...s,kind:'block',blockDefinitionId:'child',position:{x:X+40,y:Y+40},rotationDeg:0,scaleX:1,scaleY:1}]}];
  d.vertices={a:{id:'a',x:X-30,y:Y-30},b:{id:'b',x:X+30,y:Y-30},t:{id:'t',x:X-20,y:Y+60}};
  d.entities=[{id:'block',name:'Large block',layerId,type:'block_instance',blockDefinitionId:'parent',position:{x:0,y:0},rotationDeg:0,scaleX:1,scaleY:1},
    {id:'arc',name:'Arc',layerId,type:'arc',center:{x:X,y:Y},radius:20,startAngle:0,endAngle:Math.PI},
    {id:'circle',name:'Circle',layerId,type:'circle',center:{x:X,y:Y},radius:30},
    {id:'polyline',name:'Polyline',layerId,type:'polyline',vertexIds:['a','b']},
    {id:'text',name:'Text',layerId,type:'text',vertexId:'t',content:'TEXT',height:8,fontSize:12},
    {id:'proxy',name:'HATCH proxy',layerId,type:'imported_graphic',position:{x:0,y:0},primitives:[{...s,kind:'path',points:[{x:X-15,y:Y-15},{x:X+15,y:Y-15},{x:X+15,y:Y+15},{x:X-15,y:Y+15}],closed:true,fill:true,fillOpacity:.2}]}];return d;
}
async function open(page:Page,d:GeoDocument){await page.getByLabel('Файл GeoDocument',{exact:true}).setInputFiles({name:'scene.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(d))});await expect(page.locator('[data-entity-id]')).toHaveCount(d.entities.filter(e=>e.visible!==false&&d.layers.find(l=>l.id===e.layerId)?.visible).length);}
const frame=(page:Page)=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function wheel(page:Page,factor:number,anchor?:{x:number;y:number}){
  const b=(await page.getByTestId('drawing-canvas').boundingBox())!;await page.mouse.move(anchor?.x??b.x+b.width/2,anchor?.y??b.y+b.height/2);
  // Wheel handler deliberately clamps each delta to 250. Split to achieve the requested factor.
  const delta=-Math.log(factor)/.002,n=Math.ceil(Math.abs(delta)/200);for(let i=0;i<n;i++){await page.mouse.wheel(0,delta/n);await frame(page);}
}
async function diagnostics(page:Page,d:GeoDocument){return page.evaluate(async d=>{
  const {entityBoundsPoints}=await import(String('/src/geometry/entityBounds.ts')) as typeof import('../src/geometry/entityBounds');
  const {renderItems}=await import(String('/src/renderer/selectors.ts')) as typeof import('../src/renderer/selectors');
  const svg=document.querySelector('.drawing-canvas')!,r=svg.getBoundingClientRect(),z=Number(svg.getAttribute('data-zoom')),cx=Number(svg.getAttribute('data-center-x')),cy=Number(svg.getAttribute('data-center-y'));
  const owners=renderItems(d).map(({entity:e})=>{const ps=entityBoundsPoints(d,e),xs=ps.map(p=>r.x+r.width/2+(p.x-cx)*z),ys=ps.map(p=>r.y+r.height/2-(p.y-cy)*z),bounds={x:Math.min(...xs),right:Math.max(...xs),y:Math.min(...ys),bottom:Math.max(...ys)},dom=document.querySelector(`[data-entity-id="${e.id}"]`),actual=dom?.getBoundingClientRect();
    return {id:e.id,kind:e.type,expected:bounds,candidate:bounds.x<=r.right&&bounds.right>=r.x&&bounds.y<=r.bottom&&bounds.bottom>=r.y,present:!!dom,intersects:!!actual&&actual.x<=r.right&&actual.right>=r.x&&actual.y<=r.bottom&&actual.bottom>=r.y,actual:actual?{x:actual.x,y:actual.y,right:actual.right,bottom:actual.bottom}:null};});
  return {zoom:z,center:{x:cx,y:cy},owners};
},d);}
const errors=new WeakMap<Page,string[]>();
// These regressions explicitly retain the SVG fallback and its SVG bounding-box assertions.
test.beforeEach(async({page})=>{const list:string[]=[];errors.set(page,list);page.on('pageerror',e=>list.push(e.message));page.on('console',m=>{if(m.type()==='error')list.push(m.text());});await page.goto('/?dxfRenderer=svg');});
test.afterEach(({page})=>expect(errors.get(page)).toEqual([]));
test('projected SVG owners survive exact wheel factors, pan, zoom out and Fit',async({page})=>{
  const d=scene();await open(page,d);await page.getByRole('button',{name:'Вписать',exact:true}).click();const start=await diagnostics(page,d);
  async function check(){const state=await diagnostics(page,d);expect(state.owners.map(o=>o.id)).toEqual(start.owners.map(o=>o.id));for(const o of state.owners.filter(o=>o.candidate)){expect(o.present,o.id).toBe(true);expect(o.intersects,o.id).toBe(true);if(['block_instance','imported_graphic','arc','circle'].includes(o.kind)){expect(Math.abs(o.actual!.x-o.expected.x),o.id).toBeLessThan(4);expect(Math.abs(o.actual!.y-o.expected.y),o.id).toBeLessThan(4);}}}
  for(const factor of [1.1,1.25,1.5,2,4]){const before=(await diagnostics(page,d)).zoom;await wheel(page,factor);expect((await diagnostics(page,d)).zoom/before).toBeCloseTo(factor,5);await check();}
  const b=(await page.getByTestId('drawing-canvas').boundingBox())!;await page.keyboard.down('Space');await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+90,b.y+b.height/2+40);await page.mouse.up();await page.keyboard.up('Space');await check();await wheel(page,.25);await check();await page.getByRole('button',{name:'Вписать',exact:true}).click();await check();expect((await diagnostics(page,d)).center).toEqual(start.center);expect(await readAutosaveDocument(page)).toEqual(d);
});
test('nested TEXT Alt path and highlight survive wheel zoom',async({page})=>{
  const d=scene();await open(page,d);
  const click=async()=>{const b=(await page.getByTestId('drawing-canvas').boundingBox())!,v=await diagnostics(page,d);const p={x:b.x+b.width/2+(X+48-v.center.x)*v.zoom,y:b.y+b.height/2-(Y+44-v.center.y)*v.zoom};for(let i=0;i<5;i++){await page.keyboard.down('Alt');await page.mouse.click(p.x,p.y);await page.keyboard.up('Alt');if((await page.getByTestId('deep-properties').count())&&(await page.getByTestId('deep-properties').textContent())?.includes('NESTED TEXT'))break;}await expect(page.getByTestId('deep-properties')).toContainText('Parent → Child → TEXT');await expect(page.getByTestId('deep-selection-highlight')).toBeVisible();};
  await wheel(page,4);await click();await wheel(page,4);await click();
});
test('WINDOW/CROSSING at .5/2/4 and Fit Layer retain world ownership',async({page})=>{
  const d=scene();await open(page,d);const initial=await diagnostics(page,d);
  for(const factor of [.5,2,4]){
    await page.getByRole('button',{name:'Вписать',exact:true}).click();await wheel(page,factor);
    const b=(await page.getByTestId('drawing-canvas').boundingBox())!,state=await diagnostics(page,d);
    const expected=state.owners.filter(o=>o.expected.x>=b.x+3&&o.expected.right<=b.x+b.width-3&&o.expected.y>=b.y+3&&o.expected.bottom<=b.y+b.height-3).map(o=>o.id).sort();
    await page.mouse.move(b.x+3,b.y+3);await page.mouse.down();await page.mouse.move(b.x+b.width-3,b.y+b.height-3,{steps:4});await page.mouse.up();
    expect((await page.locator('[data-selected="true"]').evaluateAll(es=>es.map(e=>e.getAttribute('data-entity-id')))).sort()).toEqual(expected);
    await page.keyboard.press('Escape');await page.mouse.move(b.x+b.width-3,b.y+3);await page.mouse.down();await page.mouse.move(b.x+3,b.y+b.height-3,{steps:4});await page.mouse.up();
    expect(await page.locator('[data-selected="true"]').count()).toBe(6);
    await page.getByRole('button',{name:`Выбрать слой ${d.layers[0]!.name}`,exact:true}).click();await page.getByRole('button',{name:'Вписать слой',exact:true}).click();const fit=await diagnostics(page,d);expect(fit.center).toEqual(initial.center);expect(fit.zoom).toBeCloseTo(initial.zoom,5);
  }
});
test('oversize JSON is rejected before File.text with actual/max bytes',async({page})=>{
  await page.evaluate(()=>{Object.defineProperty(File.prototype,'size',{get:()=>104857601});File.prototype.text=()=>{throw Error('File.text must not run');};});
  await page.getByLabel('Файл GeoDocument',{exact:true}).setInputFiles({name:'oversize.json',mimeType:'application/json',buffer:Buffer.from('{}')});await expect(page.getByRole('alert')).toContainText('100 MiB');await expect(page.getByRole('alert')).toContainText(/104\s857\s601/);
});
test('15 MB portable Save -> New -> Open preserves canonical document',async({page})=>{
  test.setTimeout(60000);const d=scene(),s={layerId:d.layers[0]!.id,colorMode:'byblock' as const};d.blocks!.push({id:'size',sourceName:'Large bytes',basePoint:{x:0,y:0},primitives:Array.from({length:1500},(_,i)=>({...s,kind:'text' as const,content:'я'.repeat(5000),position:{x:i,y:0},height:1,rotationDeg:0}))});expect(Buffer.byteLength(JSON.stringify(d))).toBeGreaterThan(15_000_000);await open(page,d);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Сохранить JSON',exact:true}).click();const file=(await (await download).path())!,saved=JSON.parse(await readFile(file,'utf8'));expect(saved).toEqual(d);await page.getByRole('button',{name:'Новый документ',exact:true}).click();await expect(page.locator('[data-entity-id]')).toHaveCount(0);await page.getByLabel('Файл GeoDocument',{exact:true}).setInputFiles(file);expect(await readAutosaveDocument(page)).toEqual(d);
});
test('real DXF zoom saturation regression and edited Save/Open (opt-in)',async({page})=>{
  test.skip(!process.env.DXF_REFERENCE,'Local reference only');test.setTimeout(120000);
  await page.getByRole('button',{name:'DXF',exact:true}).click();await page.getByLabel('Файл DXF',{exact:true}).setInputFiles(process.env.DXF_REFERENCE!);await page.getByTestId('dxf-report').waitFor();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Открыть как новый документ',exact:true}).click();await page.getByRole('dialog',{name:'Открыть DXF',exact:true}).waitFor({state:'hidden'});
  const d=await readAutosaveDocument(page);await page.getByRole('button',{name:'Вписать',exact:true}).click();const b=(await page.getByTestId('drawing-canvas').boundingBox())!,anchor={x:b.x+b.width*.15,y:b.y+b.height*.54},states=[];
  for(const factor of [1,1.1,1.25,1.5,2,2,2,2,2,2,2,.5,.5]){if(factor!==1)await wheel(page,factor,anchor);const state=await diagnostics(page,d);const large=state.owners.filter(o=>o.kind==='block_instance'&&['dxf-entity-0','dxf-entity-67'].includes(o.id));expect(large).toHaveLength(2);for(const o of large.filter(o=>o.candidate)){expect(o.present).toBe(true);expect(o.intersects,o.id).toBe(true);expect(Math.abs(o.actual!.x-o.expected.x),o.id).toBeLessThan(8);}states.push({zoom:state.zoom,center:state.center,considered:state.owners.length,candidates:state.owners.filter(o=>o.candidate).length,largeOwners:large});}
  await page.screenshot({path:'/private/tmp/geoservice-hardening-zoom.png'});await page.getByRole('button',{name:'Вписать',exact:true}).click();
  await page.getByRole('button',{name:'Скрыть слой _ГП_ЗИС',exact:true}).click();await expect(page.locator('[data-entity-id]')).not.toHaveCount(446);await page.getByRole('button',{name:'Показать слой _ГП_ЗИС',exact:true}).click();await expect(page.locator('[data-entity-id]')).toHaveCount(446);
  const hit=await page.evaluate(()=>{const s=document.querySelector('.drawing-canvas')!,r=s.getBoundingClientRect();for(let y=r.y+85;y<r.bottom-85;y+=24)for(let x=r.x+85;x<r.right-85;x+=24){const e=document.elementFromPoint(x,y)?.closest('[data-entity-type="block_instance"]');if(e)return {x,y,id:e.getAttribute('data-entity-id')};}return null;});expect(hit).not.toBeNull();await page.mouse.click(hit!.x,hit!.y);await expect(page.getByTestId('selected-id')).toHaveText(hit!.id!);
  for(let i=0;i<8;i++){await page.keyboard.down('Alt');await page.mouse.click(hit!.x,hit!.y);await page.keyboard.up('Alt');if(await page.getByTestId('deep-properties').count())break;}await expect(page.getByTestId('deep-selection-highlight')).toBeVisible();await wheel(page,1.1,hit!);await page.keyboard.down('Alt');await page.mouse.click(hit!.x,hit!.y);await page.mouse.click(hit!.x,hit!.y);await page.keyboard.up('Alt');await expect(page.getByTestId('deep-properties')).toBeVisible();
  await page.getByRole('button',{name:'Вписать',exact:true}).click();await page.keyboard.press('Escape');const fitBox=(await page.getByTestId('drawing-canvas').boundingBox())!;await page.mouse.move(fitBox.x+3,fitBox.y+3);await page.mouse.down();await page.mouse.move(fitBox.x+fitBox.width-3,fitBox.y+fitBox.height-3,{steps:4});await page.mouse.up();expect(await page.locator('[data-selected="true"]').count()).toBeGreaterThan(10);
  await page.getByRole('button',{name:'Выбрать слой _ГП_ЗИС',exact:true}).click();await page.getByRole('button',{name:'Вписать слой',exact:true}).click();await page.getByRole('button',{name:'Вписать',exact:true}).click();expect(await readAutosaveDocument(page)).toEqual(d);
  const native=d.entities.find(e=>e.type==='text')!;if(native.type!=='text')throw Error();for(const e of d.entities.filter(e=>e.type==='text').slice(0,8)){if(e.type==='text')e.content+='я'.repeat(9000);}expect(Buffer.byteLength(JSON.stringify(d))).toBeGreaterThan(10*1024**2);await open(page,d);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Сохранить JSON',exact:true}).click();const file=(await (await download).path())!,text=await readFile(file,'utf8');expect(JSON.parse(text)).toEqual(d);await page.getByRole('button',{name:'Новый документ',exact:true}).click();await page.getByLabel('Файл GeoDocument',{exact:true}).setInputFiles(file);expect(await readAutosaveDocument(page)).toEqual(d);
  await writeFile('docs/audit-results/dxf-render-hardening-reference.json',JSON.stringify({entities:d.entities.length,layers:d.layers.length,definitions:d.blocks?.length,states,editedCompactBytes:Buffer.byteLength(JSON.stringify(d)),savedBytes:Buffer.byteLength(text),saveOpenEqual:true,acceptance:['Fit','exact wheel sequence','zoom out/Fit','dense layer hide/show','block owner selection','Alt primitive before/after zoom','WINDOW marquee','Fit Layer','edited Save/New/Open'],consoleErrors:errors.get(page)},null,2)+'\n');
});
