import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSampleDocument } from '../src/sample/document';
import type { GeoDocument } from '../src/domain/model';
import type { SourceProvenance } from '../src/vectors/types';
import { readAutosaveDocument } from './helpers/autosave';
const provenance=(originalType:string,handle:string):SourceProvenance=>({kind:'dxf',sourceDocumentId:'source',originalType,originalLayer:'0',handle});
function synthetic():GeoDocument {
  const d=createSampleDocument(),style={layerId:'l',colorMode:'byblock' as const};
  return {...d,metadata:{...d.metadata,title:'Deep selection'},vertices:{},layers:[{id:'l',name:'0',styleId:'s',visible:true,locked:false,order:0}],styles:[{id:'s',stroke:'#333333',fill:'none',lineWeight:1}],
    blocks:[{id:'child',sourceName:'Child',basePoint:{x:0,y:0},primitives:[{...style,kind:'path',points:[{x:2,y:2.5},{x:7,y:2.5}],closed:false,source:provenance('LINE','L')},{...style,kind:'text',content:'Газ ГРС',height:1,rotationDeg:0,position:{x:2,y:2},source:provenance('TEXT','T')}]},
    {id:'parent',sourceName:'Parent',basePoint:{x:0,y:0},primitives:[{...style,kind:'block',blockDefinitionId:'child',position:{x:20,y:10},rotationDeg:0,scaleX:1,scaleY:1,source:provenance('INSERT','I')}]}],
    entities:[{id:'owner',name:'generic',type:'block_instance',layerId:'l',blockDefinitionId:'child',position:{x:0,y:0},rotationDeg:0,scaleX:1,scaleY:1,attributes:{Марка:'ГРС'},source:provenance('INSERT','O')},{id:'parentOwner',name:'generic parent',type:'block_instance',layerId:'l',blockDefinitionId:'parent',position:{x:0,y:0},rotationDeg:0,scaleX:1,scaleY:1,source:provenance('INSERT','P')}],
    sources:[{id:'source',filename:'synthetic.dxf',format:'DXF',dxfVersion:'AC1024',encoding:'utf-8',originalUnits:6}]};
}
async function open(page:Page,d:GeoDocument){await page.getByLabel('Файл GeoDocument',{exact:true}).setInputFiles({name:'drawing.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(d))});await expect(page.locator('[data-entity-id]')).toHaveCount(d.entities.length);}
async function screen(page:Page,x:number,y:number){const canvas=page.getByTestId('drawing-canvas'),b=(await canvas.boundingBox())!,z=Number(await canvas.getAttribute('data-zoom')),cx=Number(await canvas.getAttribute('data-center-x')),cy=Number(await canvas.getAttribute('data-center-y'));return {x:b.x+b.width/2+(x-cx)*z,y:b.y+b.height/2-(y-cy)*z};}
async function alt(page:Page,p:{x:number;y:number}){await page.keyboard.down('Alt');await page.mouse.click(p.x,p.y);await page.keyboard.up('Alt');}
const errors=new WeakMap<Page,string[]>();
// Keep the SVG fallback's DOM/paint contracts covered; hybrid-renderer.spec exercises the same interactions without bulk SVG.
test.beforeEach(async({page})=>{const list:string[]=[];errors.set(page,list);page.on('pageerror',e=>list.push(e.message));page.on('console',m=>{if(m.type()==='error')list.push(m.text());});await page.goto('/?dxfRenderer=svg');await expect(page.getByTestId('drawing-canvas')).toBeVisible();});
test.afterEach(({page})=>expect(errors.get(page)).toEqual([]));
test('normal owner, Alt cycle TEXT/LINE, isolated highlight and read-only Move/Delete',async({page})=>{
  const d=synthetic();await open(page,d);const p=await screen(page,3,2.5);await page.mouse.click(p.x,p.y);await expect(page.getByTestId('selected-id')).toHaveText('owner');await expect(page.locator('.entity-heading h3')).toHaveText('Child');await expect(page.getByRole('heading',{name:'Блок',exact:true})).toBeVisible();
  await alt(page,p);await expect(page.getByTestId('hit-stack-status')).toContainText('Выбор 1/3');await alt(page,p);await expect(page.getByTestId('deep-properties')).toContainText('Газ ГРС');await expect(page.getByTestId('deep-selection-highlight')).toBeVisible();await expect(page.getByLabel('Слой объекта',{exact:true})).toHaveCount(0);await page.keyboard.press('m');await expect(page.getByTestId('editor-error')).toContainText('Элемент является частью блока');await page.keyboard.press('Delete');expect(await readAutosaveDocument(page)).toEqual(d);
  await alt(page,p);await expect(page.getByTestId('deep-properties')).toContainText('LINE');await alt(page,p);await expect(page.getByTestId('deep-properties')).toHaveCount(0);await expect(page.getByTestId('hit-stack-status')).toContainText('Выбор 1/3');
  await alt(page,p);await page.mouse.click(p.x,p.y);await expect(page.getByTestId('deep-properties')).toHaveCount(0);await expect(page.getByTestId('selected-id')).toHaveText('owner');
});
test('Parent → nested INSERT → Child TEXT inspector reports path and source handle',async({page})=>{
  await open(page,synthetic());const p=await screen(page,23,12.5);await alt(page,p);await alt(page,p);await expect(page.getByTestId('deep-properties')).toContainText('INSERT');await alt(page,p);await expect(page.getByTestId('deep-properties')).toContainText('Parent → Child → TEXT');await expect(page.getByTestId('deep-properties')).toContainText('Газ ГРС');await expect(page.getByTestId('selected-id')).toHaveText('parentOwner');
});
test('ordinary foreground line outranks a large HATCH, Alt retains overlap owners',async({page})=>{
  const d=synthetic();d.blocks=[];d.vertices={a:{id:'a',x:0,y:0},b:{id:'b',x:20,y:0}};d.entities=[{id:'line',name:'Foreground',type:'line',layerId:'l',startVertexId:'a',endVertexId:'b'},{id:'hatch',name:'HATCH',type:'imported_graphic',layerId:'l',position:{x:0,y:0},source:provenance('HATCH','H'),primitives:[{kind:'path',layerId:'l',colorMode:'byblock',points:[{x:-10,y:-10},{x:30,y:-10},{x:30,y:10},{x:-10,y:10}],closed:true,fill:true}]}];await open(page,d);const p=await screen(page,10,0);await page.mouse.click(p.x,p.y);await expect(page.getByTestId('selected-id')).toHaveText('line');await alt(page,p);await expect(page.getByTestId('selected-id')).toHaveText('line');await alt(page,p);await expect(page.getByTestId('selected-id')).toHaveText('hatch');
});
test('MULTILEADER inspector shows primary text; dimension displayed text stays composite',async({page})=>{
  await page.getByRole('button',{name:'DXF',exact:true}).click();await page.getByLabel('Файл DXF',{exact:true}).setInputFiles(resolve('src/tests/fixtures/dxf/mixed_proxy.dxf'));await page.getByTestId('dxf-report').waitFor();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Открыть как новый документ',exact:true}).click();await page.getByRole('dialog',{name:'Открыть DXF',exact:true}).waitFor({state:'hidden'});
  const d=await readAutosaveDocument(page);await open(page,{...d,entities:d.entities.filter(e=>e.source?.originalType==='MULTILEADER')});const p=await screen(page,4.5,6.5);await page.mouse.click(p.x,p.y);await expect(page.locator('.entity-heading h3')).toHaveText('Выноска');await expect(page.getByTestId('imported-semantic-content')).toContainText('Мультивыноска');
  await open(page,{...d,entities:d.entities.filter(e=>e.source?.originalType==='DIMENSION')});const q=await screen(page,5.5,-1.5);await page.mouse.click(q.x,q.y);await expect(page.getByTestId('imported-semantic-content')).toContainText('10');await expect(page.locator('.entity-heading span').last()).toHaveText('DXF размер');
});
test('native TEXT and MTEXT inspector edit, double click, Move, layer and Save/Open',async({page})=>{
  const d=synthetic();d.blocks=[];d.vertices={a:{id:'a',x:0,y:0},b:{id:'b',x:15,y:0}};d.layers.push({id:'new',name:'Другой',styleId:'s',visible:true,locked:false,order:1});d.entities=[{id:'t',name:'TEXT',type:'text',layerId:'l',vertexId:'a',content:'Газ',height:1,rotationDeg:0,fontSize:12,source:provenance('TEXT','TX')},{id:'mt',name:'MTEXT',type:'text',layerId:'l',vertexId:'b',content:'Дом\nвход',height:1,rotationDeg:0,fontSize:12,source:provenance('MTEXT','MT')}];await open(page,d);
  for(const [id,x] of [['t',0],['mt',15]] as const){let p=await screen(page,x+.5,.5);await page.mouse.click(p.x,p.y);await expect(page.getByTestId('selected-id')).toHaveText(id);await page.getByLabel('Текст',{exact:true}).fill(`Новый ${id}`);await page.getByLabel('Текст',{exact:true}).blur();await page.mouse.dblclick(p.x,p.y);await expect(page.getByLabel('Редактировать текст',{exact:true})).toBeVisible();await page.getByLabel('Редактировать текст',{exact:true}).fill(`Газ ${id}`);await page.getByRole('button',{name:'Готово',exact:true}).click();p=await screen(page,x+.5,.5);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+10,p.y-5,{steps:4});await page.mouse.up();await page.getByLabel('Слой объекта',{exact:true}).selectOption('new');}
  const changed=await readAutosaveDocument(page),download=page.waitForEvent('download');await page.getByRole('button',{name:'Сохранить JSON',exact:true}).click();const file=(await (await download).path())!;expect(JSON.parse(await readFile(file,'utf8'))).toEqual(changed);await open(page,d);await page.getByLabel('Файл GeoDocument',{exact:true}).setInputFiles(file);expect(await readAutosaveDocument(page)).toEqual(changed);
});
test('reference real DXF semantic and deep inspection acceptance (opt-in)',async({page})=>{
  test.skip(!process.env.DXF_REFERENCE,'Local DXF is not a CI fixture');test.setTimeout(90000);
  await page.getByRole('button',{name:'DXF',exact:true}).click();await page.getByLabel('Файл DXF',{exact:true}).setInputFiles(process.env.DXF_REFERENCE!);await page.getByTestId('dxf-report').waitFor();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Открыть как новый документ',exact:true}).click();await page.getByRole('dialog',{name:'Открыть DXF',exact:true}).waitFor({state:'hidden'});const d=await readAutosaveDocument(page);
  expect(d.entities.filter(e=>e.source?.originalType==='TEXT'&&e.type==='text')).toHaveLength(24);expect(d.entities.filter(e=>e.source?.originalType==='MTEXT'&&e.type==='text')).toHaveLength(19);
  const result=await page.evaluate(async document=>{const {createProvenanceIndex}=await import(String('/src/dxf/provenance.ts'));const index=createProvenanceIndex(document);return {soil:index.searchText('Плодородный'),gas:index.searchText('газ'),volume:index.getBlockInstancesBySourceName('VOLUME').length};},d);expect(result.soil.length).toBeGreaterThan(0);expect(result.volume).toBe(62);
  const leader=d.entities.find(e=>e.source?.handle==='58829')!;expect(leader).toMatchObject({type:'imported_graphic',semanticContent:{primaryText:'Плодородный грунт, h=0.20 м'}});await open(page,{...d,entities:[leader]});if(leader.type!=='imported_graphic')throw Error();const text=leader.primitives.find(p=>p.kind==='text')!;if(text.kind!=='text')throw Error();const p=await screen(page,text.position.x+text.height*.5,text.position.y+text.height*.4);await page.mouse.click(p.x,p.y);await expect(page.locator('.entity-heading h3')).toContainText('Плодородный грунт');
  const block=d.entities.find(e=>e.type==='block_instance'&&d.layers.find(l=>l.id===e.layerId)?.visible&&d.blocks?.find(b=>b.id===e.blockDefinitionId)?.primitives.some(p=>p.kind==='text'&&p.visible!==false))!;
  await open(page,{...d,entities:[block]});
  const probe=await page.evaluate(async ({document,ownerId})=>{
    const [{createProvenanceIndex},{resolveDeepSelection},{blockMatrix,multiply,transformPoint}]=await Promise.all([import(String('/src/dxf/provenance.ts')),import(String('/src/editor/deepSelection.ts')),import(String('/src/vectors/geometry.ts'))]);
    const texts=createProvenanceIndex(document).getEntitySemanticSummary(ownerId).texts;
    const svg=window.document.querySelector('.drawing-canvas')!,r=svg.getBoundingClientRect(),z=Number(svg.getAttribute('data-zoom')),cx=Number(svg.getAttribute('data-center-x')),cy=Number(svg.getAttribute('data-center-y'));
    for(const text of texts){if(!text.primitivePath.length)continue;const selection={ownerEntityId:ownerId,blockPath:[],primitivePath:text.primitivePath,sourceType:'TEXT'},resolved=resolveDeepSelection(document,selection);if(!resolved||resolved.primitive.kind!=='text'||resolved.primitive.visible===false)continue;
      const p=resolved.primitive,m= multiply(resolved.matrix,blockMatrix({position:p.position,rotationDeg:p.rotationDeg,scaleX:1,scaleY:1},{x:0,y:0})),world=transformPoint({x:p.height*.5,y:p.height*.4},m),point={x:r.x+r.width/2+(world.x-cx)*z,y:r.y+r.height/2-(world.y-cy)*z};
      if(window.document.elementFromPoint(point.x,point.y)?.closest('[data-entity-id]'))return {...point,text:p.content};
    }return null;
  },{document:d,ownerId:block.id});expect(probe).not.toBeNull();await page.mouse.click(probe!.x,probe!.y);await expect(page.locator('.entity-heading')).toContainText('DXF блок');
  await alt(page,probe!);for(let i=0;i<12;i++){await alt(page,probe!);if((await page.getByTestId('deep-properties').textContent())?.includes(probe!.text))break;}
  await expect(page.getByTestId('deep-properties')).toContainText(probe!.text);await expect(page.getByTestId('deep-selection-highlight')).toBeVisible();
  const nativeEdited=[];
  for(const sourceType of ['TEXT','MTEXT']){
    const native=d.entities.find(e=>e.type==='text'&&e.source?.originalType===sourceType&&d.layers.find(l=>l.id===e.layerId)?.visible&&!d.layers.find(l=>l.id===e.layerId)?.locked)!;
    expect(native.type).toBe('text');await open(page,{...d,entities:[native]});const body=page.locator(`[data-entity-id="${native.id}"] rect`);await body.click();await page.getByLabel('Текст',{exact:true}).fill('Газ acceptance');await page.getByLabel('Текст',{exact:true}).blur();await body.dblclick();await page.getByLabel('Редактировать текст',{exact:true}).fill('Газ reference');await page.getByRole('button',{name:'Готово',exact:true}).click();
    const p=(await body.boundingBox())!;await page.mouse.move(p.x+p.width/2,p.y+p.height/2);await page.mouse.down();await page.mouse.move(p.x+p.width/2+8,p.y+p.height/2-4,{steps:3});await page.mouse.up();
    const changed=await readAutosaveDocument(page);expect(changed.entities[0]).toMatchObject({type:'text',content:'Газ reference',source:{originalType:sourceType}});nativeEdited.push(sourceType);
    await page.getByRole('button',{name:'Сохранить JSON',exact:true}).click(); // reset dirty before the next isolated reference document
  }
  await writeFile('docs/audit-results/dxf-ux-reference.json',JSON.stringify({nativeText:24,nativeMtext:19,soilHits:result.soil.length,gasHits:result.gas.length,volume:result.volume,soilHandle:leader.source?.handle,deepOwner:block.id,deepText:probe!.text,nativeEdited,consoleErrors:errors.get(page)},null,2)+'\n');
});
