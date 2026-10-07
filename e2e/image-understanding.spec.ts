import {expect,test,type Page} from '@playwright/test';
import {createNewDocument} from '../src/domain/newDocument';
import {editorCommand, openRightTab } from './helpers/editorCommands';
import {readAutosaveDocument} from './helpers/autosave';
async function setup(page:Page,kind='ocr',width=960,height=640){
 await page.addInitScript(d=>{if(!sessionStorage.getItem('v2-seeded')){localStorage.setItem('geoservice.document.v2',JSON.stringify(d));sessionStorage.setItem('v2-seeded','1');}},createNewDocument());
 await page.goto('/');
 const png=await page.evaluate(async({kind,width,height})=>{const {understandingFixture}=await import(String('/src/tests/fixtures/imageUnderstanding.ts'));return understandingFixture(kind,width,height).toDataURL().split(',')[1];},{kind,width,height});
 await page.getByLabel('Импорт подложки',{exact:true}).setInputFiles({name:kind+'.png',mimeType:'image/png',buffer:Buffer.from(png!,'base64')});
 await expect(page.getByTestId('underlay-properties')).toBeVisible();await editorCommand(page,'Векторизация изображения');
 await page.getByRole('button',{name:'4. Извлечение',exact:true}).click();
 if(kind==='photo')await page.getByLabel('Освещение изображения',{exact:true}).selectOption('adaptive');
 await page.getByRole('button',{name:'Извлечь геометрию',exact:true}).click();
 await expect(page.getByTestId('image-progress')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Распознать текст и символы',exact:true})).toBeVisible();
}
async function recognize(page:Page){await page.getByRole('button',{name:'Распознать текст и символы',exact:true}).click();await expect(page.getByRole('button',{name:'Распознать текст и символы',exact:true})).toBeEnabled({timeout:120000});}
const inputs=(page:Page)=>page.locator('.recognition-row input:not([type=checkbox])');
const textValues=(page:Page)=>inputs(page).evaluateAll(es=>es.map(e=>(e as HTMLInputElement).value));
const pageErrors=new WeakMap<Page,string[]>();
test.beforeEach(({page})=>{const errors:string[]=[];pageErrors.set(page,errors);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});});
test.afterEach(({page})=>expect(pageErrors.get(page)).toEqual([]));
test('real local OCR RU/EN correction, editable Text Search/Undo/Redo/reload; strict local network',async({page})=>{
 test.setTimeout(150000);const external:string[]=[],requests:string[]=[];
 page.context().on('request',r=>{requests.push(r.url());if(/^https?:/.test(r.url())&&new URL(r.url()).hostname!=='127.0.0.1')external.push(r.url());});
 await setup(page);await recognize(page);const values=await textValues(page);
 await test.info().attach('ocr-examples',{body:JSON.stringify(values),contentType:'application/json'});
 expect(values).toContain('ГАЗ');expect(values).toContain('ВОДА');expect(values).toContain('V-101');
 await inputs(page).first().fill('ГАЗ проверено');await page.getByLabel('Подтвердить текст candidate-1',{exact:true}).check();
 await page.getByRole('button',{name:/Применить результат/}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect.poll(async()=>(await readAutosaveDocument(page)).entities.some(e=>e.type==='text'&&e.content==='ГАЗ проверено')).toBe(true);
 const applied=await readAutosaveDocument(page),text=applied.entities.find(e=>e.type==='text')!;expect(text.imageSource?.source).toBe('image-ocr');
 await openRightTab(page,'search');await page.getByLabel('Поиск в документе',{exact:true}).fill('ГАЗ проверено');await expect(page.locator('.search-results')).toContainText('ГАЗ проверено');
 await page.locator('.search-results .query-result').getByRole('button',{name:'ГАЗ проверено',exact:true}).click();
 await openRightTab(page,'properties');await page.getByLabel('Текст',{exact:true}).fill('ГАЗ исправлен');await page.getByTestId('drawing-canvas').focus();
 await expect.poll(async()=>(await readAutosaveDocument(page)).entities.some(e=>e.type==='text'&&e.content==='ГАЗ исправлен')).toBe(true);
 await editorCommand(page,'Отменить');await expect.poll(async()=>(await readAutosaveDocument(page)).entities.some(e=>e.type==='text'&&e.content==='ГАЗ проверено')).toBe(true);
 await editorCommand(page,'Отменить');await expect.poll(async()=>(await readAutosaveDocument(page)).entities.length).toBe(1);
 await editorCommand(page,'Повторить');await expect.poll(async()=>(await readAutosaveDocument(page)).entities.some(e=>e.id===text.id)).toBe(true);
 await page.reload();await expect.poll(async()=>(await readAutosaveDocument(page)).entities.some(e=>e.id===text.id)).toBe(true);
 expect(external).toEqual([]);expect(requests.some(u=>u.includes('/api/ai/intent'))).toBe(false);expect(requests.some(u=>u.includes('/ocr/runtime/'))).toBe(true);expect(requests.some(u=>u.includes('/ocr/lang/'))).toBe(true);
});
test('known repeated group across rotation/scale; individual exception, native Symbol movement/rotation/Search/reload',async({page})=>{
 test.setTimeout(120000);await setup(page,'symbols');await recognize(page);const group=page.locator('.recognition-group');await expect(group).toHaveCount(1);await expect(group).toContainText('Похоже на: Клапан · 4');
 await group.getByRole('button',{name:/Подтвердить группу/}).click();await group.getByText('Проверить экземпляры',{exact:true}).click();await group.getByRole('checkbox').last().uncheck();
 await page.getByRole('button',{name:/Применить результат/}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect.poll(async()=>(await readAutosaveDocument(page)).entities.filter(e=>e.type==='symbol').length).toBe(3);
 const doc=await readAutosaveDocument(page),symbols=doc.entities.filter(e=>e.type==='symbol');expect(symbols.every(e=>e.symbolId==='valve')).toBe(true);expect(new Set(symbols.map(e=>e.rotationDeg)).size).toBe(2);expect(doc.entities.some(e=>e.type==='line'||e.type==='polygon'||e.type==='polyline')).toBe(true);
 await openRightTab(page,'search');await page.getByLabel('Поиск в документе',{exact:true}).fill('Клапан');await expect(page.locator('.search-results .query-result')).toHaveCount(3);await page.locator('.search-results .query-result').first().getByRole('button',{name:'Клапан',exact:true}).click();
 await openRightTab(page,'properties');await page.getByLabel('MODEL X',{exact:true}).fill('20');await page.getByLabel('MODEL X',{exact:true}).press('Enter');await page.getByLabel('Поворот (°)',{exact:true}).fill('180');await page.getByLabel('Поворот (°)',{exact:true}).press('Enter');
 await expect.poll(async()=>(await readAutosaveDocument(page)).entities.some(e=>e.type==='symbol'&&e.position.x===20&&e.rotationDeg===180)).toBe(true);
 await editorCommand(page,'Отменить');await editorCommand(page,'Отменить');await expect.poll(async()=>JSON.stringify((await readAutosaveDocument(page)).entities)).toBe(JSON.stringify(doc.entities));
 await page.reload();await expect.poll(async()=>(await readAutosaveDocument(page)).entities.filter(e=>e.type==='symbol').length).toBe(3);
 await editorCommand(page,'Векторизация изображения');await page.getByRole('button',{name:'Отмена',exact:true}).click();
});
test('unknown repeats stay geometry; manual assignment still requires confirmation',async({page})=>{
 await setup(page,'unknown');await recognize(page);const group=page.locator('.recognition-group').first();await expect(group).toContainText('Неизвестный повторяющийся символ · 4');
 await page.getByLabel('Символ группы symbol-group-1',{exact:true}).selectOption('gas-process-demo/valve');await expect(page.getByRole('button',{name:/Применить геометрию/})).toBeVisible();
 await group.getByRole('button',{name:/Подтвердить группу/}).click();await group.getByRole('button',{name:'Оставить геометрией',exact:true}).click();await expect(page.getByRole('button',{name:/Применить геометрию/})).toBeEnabled();
 await page.getByRole('button',{name:/Применить геометрию/}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect((await readAutosaveDocument(page)).entities.some(e=>e.type==='symbol')).toBe(false);
});
for(const kind of ['photo','rotated'])test(`real local OCR ${kind}: orientation/illumination and explicit review`,async({page})=>{
 test.setTimeout(150000);await setup(page,kind);await recognize(page);const values=await textValues(page);await test.info().attach(kind+'-ocr',{body:JSON.stringify(values),contentType:'application/json'});expect(values.filter(Boolean).length).toBeGreaterThanOrEqual(4);expect(values).toContain('ГАЗ');await expect(page.getByRole('button',{name:/Применить геометрию/})).toBeVisible();await page.getByRole('button',{name:'Отмена',exact:true}).click();expect((await readAutosaveDocument(page)).entities).toHaveLength(1);
});
test('OCR failure/cancel preserves V1 geometry; cached review does not rerun OCR',async({page})=>{
 test.setTimeout(150000);await setup(page);const before=await readAutosaveDocument(page);
 await page.context().route('**/ocr/runtime/worker.min.js',r=>r.fulfill({status:503,body:'OCR unavailable'}));await recognize(page);await expect(page.getByRole('dialog')).toContainText('Локальный OCR/runtime');await expect(page.getByRole('button',{name:/Применить геометрию/})).toBeEnabled();expect(await readAutosaveDocument(page)).toEqual(before);
 await page.context().unroute('**/ocr/runtime/worker.min.js');await page.getByRole('button',{name:'4. Извлечение',exact:true}).click();await page.getByRole('button',{name:'Извлечь геометрию',exact:true}).click();await expect(page.getByTestId('image-progress')).toHaveCount(0);
 await page.context().route('**/ocr/runtime/worker.min.js',async r=>{await new Promise(resolve=>setTimeout(resolve,1500));await r.continue();});await page.getByRole('button',{name:'Распознать текст и символы',exact:true}).click();await expect(page.getByRole('button',{name:'Отменить распознавание',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByTestId('image-progress')).toHaveCount(0);expect(await readAutosaveDocument(page)).toEqual(before);
 await page.context().unroute('**/ocr/runtime/worker.min.js');await recognize(page);expect(await textValues(page)).toContain('ГАЗ');let runtime=0;page.context().on('request',r=>{if(r.url().includes('/ocr/'))runtime++;});await recognize(page);expect(runtime).toBe(0);await page.context().route('**/ocr/runtime/worker.min.js',r=>r.fulfill({status:503,body:'OCR unavailable'}));await page.getByLabel('Качество OCR',{exact:true}).selectOption('accurate');await recognize(page);expect((await textValues(page)).filter(Boolean)).toHaveLength(0);await expect(page.getByRole('dialog')).toContainText('Локальный OCR/runtime');expect(await readAutosaveDocument(page)).toEqual(before);
});
test('image Symbol semantics reuse Teach/Search/local AI resolver; request sends text only',async({page})=>{
 let sent:unknown;await page.route('**/api/ai/config',r=>r.fulfill({json:{mode:'mock'}}));await page.route('**/api/ai/intent',r=>{sent=r.request().postDataJSON();return r.fulfill({json:{intent:{actions:[{type:'select_entities',query:{kind:'learned_concept',name:'Арматура скана',scope:'document'}}]},unsupported:false}});});
 await setup(page,'symbols');await recognize(page);await page.getByRole('button',{name:/Подтвердить группу/}).click();await page.getByRole('checkbox',{name:/Добавить категорию/}).first().check();await page.getByRole('button',{name:/Применить результат/}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 const applied=await readAutosaveDocument(page);expect(applied.semantics!.annotations).toHaveLength(1);await openRightTab(page,'search');await page.getByLabel('Поиск в документе',{exact:true}).fill('Клапан');await page.locator('.search-results .query-result').first().getByRole('button',{name:'Клапан',exact:true}).click();await editorCommand(page,'Научить GeoService');await page.getByLabel('Название смысловой категории',{exact:true}).fill('Арматура скана');await page.getByRole('button',{name:'Предложить правило',exact:true}).click();await page.getByRole('button',{name:'Запомнить',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await openRightTab(page,'search');await page.getByLabel('Поиск в документе',{exact:true}).fill('Арматура скана');await expect(page.locator('.search-results .query-result')).toHaveCount(4);
 await openRightTab(page,'ai');await page.getByLabel('Запрос',{exact:true}).fill('выдели Арматура скана');await page.getByRole('button',{name:'Generate plan',exact:true}).click();await expect(page.getByTestId('document-operations-preview')).toBeVisible();expect(sent).toEqual({text:'выдели Арматура скана'});
});

test('private reference scan local opt-in: review geometry and real OCR without committing source',async({page})=>{
 test.skip(!process.env.IMAGE_REFERENCE,'Private reference scan requires explicit local path');test.setTimeout(150000);
 await page.goto('/');await page.getByLabel('Импорт подложки',{exact:true}).setInputFiles(process.env.IMAGE_REFERENCE!);await expect(page.getByTestId('underlay-properties')).toBeVisible();const before=await readAutosaveDocument(page);await editorCommand(page,'Векторизация изображения');await page.getByRole('button',{name:'4. Извлечение',exact:true}).click();await page.getByRole('button',{name:'Извлечь геометрию',exact:true}).click();await expect(page.getByTestId('image-progress')).toHaveCount(0);await page.getByLabel('Качество OCR',{exact:true}).selectOption('accurate');await recognize(page);
 const values=await textValues(page),counts={textRegions:values.length,recognized:values.filter(Boolean).length,geometry:Number(await page.getByTestId('image-count-line').innerText())+Number(await page.getByTestId('image-count-polyline').innerText())+Number(await page.getByTestId('image-count-contour').innerText())};expect(counts.recognized).toBeGreaterThan(0);expect(counts.geometry).toBeGreaterThan(0);await test.info().attach('private-reference-counts',{body:JSON.stringify(counts),contentType:'application/json'});await page.screenshot({path:'/private/tmp/geoservice-image-v2-reference.png',fullPage:true});await page.getByRole('button',{name:'Отмена',exact:true}).click();expect(await readAutosaveDocument(page)).toEqual(before);
});

test('portrait and fitted candidate preview preserve raster/overlay coordinates',async({page})=>{
 await setup(page,'ocr',640,960);
 const assertAlignment=async()=>{const geometry=await page.getByTestId('image-review-preview').evaluate(e=>{const canvas=e.querySelector('canvas')!.getBoundingClientRect(),svg=e.querySelector('svg')!,box=svg.getBoundingClientRect(),v=svg.viewBox.baseVal,m=svg.getScreenCTM()!;return {rasterRatio:canvas.width/canvas.height,logicalRatio:v.width/v.height,overlayRatio:box.width/box.height,height:canvas.height,limit:innerHeight*.65,scaleX:m.a,scaleY:m.d,rasterX:canvas.x,rasterY:canvas.y,overlayX:m.e+v.x*m.a,overlayY:m.f+v.y*m.d};});expect(geometry.rasterRatio).toBeCloseTo(geometry.logicalRatio,2);expect(geometry.overlayRatio).toBeCloseTo(geometry.logicalRatio,2);expect(geometry.scaleX).toBeCloseTo(geometry.scaleY,3);expect(geometry.overlayX).toBeCloseTo(geometry.rasterX,1);expect(geometry.overlayY).toBeCloseTo(geometry.rasterY,1);expect(geometry.height).toBeLessThanOrEqual(geometry.limit+1);};
 await assertAlignment();await page.locator('.image-candidate').first().click();await page.getByRole('button',{name:/^Fit candidate-/}).first().click();await assertAlignment();
});

test('rerun recognition clears confirmation and restores geometry replaced by symbols',async({page})=>{
 await setup(page,'symbols');await recognize(page);const before=await page.getByRole('button',{name:/Применить геометрию/}).innerText();await page.getByRole('button',{name:/Подтвердить группу/}).click();await expect(page.getByRole('button',{name:/Применить результат/})).toBeVisible();await recognize(page);await expect(page.getByRole('button',{name:/Применить геометрию/})).toHaveText(before);await page.getByRole('button',{name:'Отмена',exact:true}).click();expect((await readAutosaveDocument(page)).entities).toHaveLength(1);
});
