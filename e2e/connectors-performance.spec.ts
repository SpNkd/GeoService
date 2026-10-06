import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { connectorBenchmarkDocument } from '../src/tests/fixtures/connectorDocument';
import { readAutosaveDocument } from './helpers/autosave';
import type { GeoDocument, SymbolEntity } from '../src/domain/model';
const stats=(samples:number[])=>{const sorted=[...samples].sort((a,b)=>a-b);return {medianMs:sorted[Math.floor(sorted.length/2)]!,p95Ms:sorted[Math.ceil(sorted.length*.95)-1]!,samples};};
test('100 symbols / 150 connectors browser observation',async({page,browser})=>{
  test.skip(!process.env.CONNECTOR_BENCHMARK,'Opt-in measured browser benchmark');test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const d=connectorBenchmarkDocument();await page.addInitScript(d=>localStorage.setItem('geoservice.document.v2',JSON.stringify(d)),d);
  const begin=performance.now();await page.goto('/');await expect(page.locator('[data-entity-type="connector"]')).toHaveCount(150);await expect(page.locator('[data-entity-type="symbol"]')).toHaveCount(100);const mountMs=performance.now()-begin;
  const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const c=page.getByTestId('drawing-canvas');for(let i=0;i<5&&Number(await c.getAttribute('data-zoom'))<20;i++)await page.getByRole('button',{name:'Увеличить',exact:true}).click();const box=(await c.boundingBox())!,pan:number[]=[],selection:number[]=[],moveOne:number[]=[],moveGroup:number[]=[];
  const symbolPoint=async(id:string)=>{const e=d.entities.find(e=>e.id===id)! as SymbolEntity,b=(await c.boundingBox())!,z=Number(await c.getAttribute('data-zoom')),cx=Number(await c.getAttribute('data-center-x')),cy=Number(await c.getAttribute('data-center-y'));return {x:b.x+b.width/2+(e.position.x+.85-cx)*z,y:b.y+b.height/2-(e.position.y+.75-cy)*z};};
  const clickSymbol=async(id:string,shift=false)=>{const p=await symbolPoint(id);if(shift)await page.keyboard.down('Shift');await page.mouse.click(p.x,p.y);if(shift)await page.keyboard.up('Shift');await expect(page.locator(`[data-entity-id="${id}"]`)).toHaveAttribute('data-selected','true');};
  for(let i=0;i<8;i++){
    await page.keyboard.press('Escape');
    const t=performance.now();await page.mouse.move(box.x+200,box.y+200);await page.keyboard.down('Space');await page.mouse.down();await page.mouse.move(box.x+204,box.y+202);await page.mouse.up();await page.keyboard.up('Space');await frame();pan.push(performance.now()-t);
    const s=performance.now();await clickSymbol('s55');await frame();selection.push(performance.now()-s);
    const before=await page.getByTestId('connector-route').first().getAttribute('d');const hit=await symbolPoint('s55'),m=performance.now();await page.mouse.move(hit.x,hit.y);await page.mouse.down();await page.mouse.move(hit.x+4,hit.y-3);await page.mouse.up();await frame();moveOne.push(performance.now()-m);expect(await page.getByTestId('connector-route').first().getAttribute('d')).toBe(before);
    await page.getByRole('button',{name:'Отменить',exact:true}).click();await clickSymbol('s55');await clickSymbol('s56',true);await clickSymbol('s65',true);await expect(page.getByTestId('group-properties')).toContainText('3 объектов');
    const h=await symbolPoint('s55'),g=performance.now();await page.mouse.move(h.x,h.y);await page.mouse.down();await page.mouse.move(h.x+4,h.y-3);await page.mouse.up();await frame();moveGroup.push(performance.now()-g);await page.getByRole('button',{name:'Отменить',exact:true}).click();
  }
  const canonical=await readAutosaveDocument(page);expect(canonical).toEqual(d);
  const pure=await page.evaluate(async(d:GeoDocument)=>{
    const [{connectorRoute,connectivityIndex},{applyCommand}]=await Promise.all([import(String('/src/connectors/model.ts')),import(String('/src/domain/commands.ts'))]);const reroute:number[]=[],index:number[]=[];
    for(let i=0;i<100;i++){const moved=applyCommand(d,{type:'move-entities',entityIds:['s55'],delta:{x:i+.1,y:.2}}),t=performance.now();connectivityIndex(moved);index.push(performance.now()-t);const start=performance.now();for(const e of moved.entities)if(e.type==='connector')connectorRoute(moved,e);reroute.push(performance.now()-start);}
    return {reroute,index};
  },d);
  expect(errors).toEqual([]);const report={symbols:100,connectors:150,engine:browser.version(),mountMs,measurement:'Headless Chrome; UI samples include automation and two requestAnimationFrame waits; pure reroute excludes automation.',pan:stats(pan),selection:stats(selection),moveOne:stats(moveOne),moveGroup:stats(moveGroup),reroute150:stats(pure.reroute),index:stats(pure.index),consoleErrors:errors};
  await writeFile(process.env.CONNECTOR_BENCHMARK!,JSON.stringify(report,null,2));
});
