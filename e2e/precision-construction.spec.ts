import { editorCommand, openRightTab } from './helpers/editorCommands';
import { test, expect, type Page } from '@playwright/test';
import { readAutosaveDocument } from './helpers/autosave';
import type { GeoDocument, DimensionEntity, PolygonEntity } from '../src/domain/model';
import { aiRequestSchema } from '../src/ai/intent';
import { developmentMockProvider } from '../server/ai';
const doc = (page: Page): Promise<GeoDocument> => readAutosaveDocument(page);
async function at(page: Page, x: number, y: number) {
  const canvas = page.getByTestId('drawing-canvas'), box = (await canvas.boundingBox())!;
  const zoom = Number(await canvas.getAttribute('data-zoom')), cx = Number(await canvas.getAttribute('data-center-x')), cy = Number(await canvas.getAttribute('data-center-y'));
  return { x: box.x + box.width/2 + (x-cx)*zoom, y: box.y + box.height/2 - (y-cy)*zoom };
}
async function clickWorld(page: Page, x: number, y: number) { const p = await at(page,x,y); await page.mouse.click(p.x,p.y); }
async function tool(page: Page, name: string) { await editorCommand(page,`Инструмент: ${name}`); }
async function setup(page: Page) {
  await page.route('**/api/ai/config', route => route.fulfill({json:{mode:'mock'}}));
  const provider = developmentMockProvider();
  await page.route('**/api/ai/intent', async route => { const request = aiRequestSchema.parse(route.request().postDataJSON()); expect(Object.keys(request).sort()).toEqual(request.clarificationAnswers?['clarificationAnswers','text']:['text']); await route.fulfill({json:await provider.parseIntent({...request,signal:new AbortController().signal})}); });
  await page.goto('/'); await editorCommand(page, 'Новый документ');
}
async function generate(page: Page, text: string) { await openRightTab(page,'ai');await page.getByRole('textbox',{name:'Запрос',exact:true}).fill(text); await page.getByRole('button',{name:'Generate plan',exact:true}).click(); }
async function roundTrip(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download'),editorCommand(page,'Сохранить JSON')]);
  await editorCommand(page, 'Новый документ'); await page.getByLabel('Файл GeoDocument',{exact:true}).setInputFiles((await download.path())!);
}
test.beforeEach(async ({page}) => { await setup(page); });

test('layer creation, rename layout, reorder, double-click selection and safe delete', async ({page}) => {
  await page.getByRole('button',{name:'Создать слой',exact:true}).click();
  const id = (await doc(page)).layers.at(-1)!.id;
  const name = page.getByRole('textbox',{name:'Название слоя',exact:true}); await name.fill('Разбивка'); await name.blur();
  const inputBox = (await name.boundingBox())!, labelBox = (await page.locator('.layer-property-name > span').boundingBox())!;
  expect(inputBox.x).toBeGreaterThan(labelBox.x + labelBox.width);
  await page.getByRole('button',{name:'Поднять слой Разбивка',exact:true}).click();
  expect([...((await doc(page)).layers)].sort((a,b)=>a.order-b.order).at(-2)!.id).toBe(id);
  await tool(page,'Линия'); await clickWorld(page,0,0); await clickWorld(page,10,0);
  expect((await doc(page)).entities[0]!.layerId).toBe(id);
  await page.getByRole('button',{name:'Выбрать слой Разбивка',exact:true}).dblclick();
  await expect(page.locator('[data-entity-type="line"]')).toHaveAttribute('data-selected','true');
  await page.getByRole('button',{name:'Выбрать слой Разбивка',exact:true}).click();
  await page.getByRole('button',{name:'Удалить слой',exact:true}).click();
  await expect(page.getByTestId('editor-error')).toContainText('Слой содержит 1 объектов');
  await page.getByRole('button',{name:'Создать слой',exact:true}).click();
  const emptyId = (await doc(page)).layers.at(-1)!.id;
  await page.getByRole('button',{name:'Удалить слой',exact:true}).click(); expect((await doc(page)).layers.some(layer=>layer.id===emptyId)).toBe(false);
  await page.getByRole('button',{name:'Отменить',exact:true}).click(); expect((await doc(page)).layers.some(layer=>layer.id===emptyId)).toBe(true);
});

test('world grid, Shift/Ortho precision, discoverable label and endpoint priority', async ({page}) => {
  await page.getByRole('spinbutton',{name:'Шаг привязки сетки',exact:true}).fill('0.5');
  await page.locator('.survey-settings summary').click(); await page.getByRole('checkbox',{name:'Grid',exact:true}).check(); await page.locator('.survey-settings summary').click();
  await tool(page,'Линия'); await clickWorld(page,0.1,0.1); await clickWorld(page,10.1,0.1);
  let drawing = await doc(page); let line = drawing.entities[0]!; expect(line.type).toBe('line'); if(line.type!=='line')throw new Error();
  expect(drawing.vertices[line.startVertexId]).toMatchObject({x:0,y:0}); expect(drawing.vertices[line.endVertexId]).toMatchObject({x:10,y:0});
  await expect(page.locator('.property-section>summary').filter({hasText:/^Подписи$/})).toBeVisible(); await page.getByRole('button',{name:'Добавить подпись',exact:true}).click();
  const label = page.locator('[data-entity-type="label"] text'); await expect(label).toContainText('10,000');
  // Disable snaps so Shift/Ortho exercise their exact world-angle branch.
  await page.getByRole('button',{name:'Привязки',exact:true}).click();
  await tool(page,'Линия'); await clickWorld(page,-10,-10); await page.keyboard.down('Shift'); await clickWorld(page,-4,-5); await page.keyboard.up('Shift');
  drawing=await doc(page); line=drawing.entities.filter(e=>e.type==='line').at(-1)!; if(line.type!=='line')throw new Error();
  const a=drawing.vertices[line.startVertexId]!,b=drawing.vertices[line.endVertexId]!; expect(b.x-a.x).toBeCloseTo(b.y-a.y,10);
  await page.getByTestId('drawing-canvas').focus(); await page.keyboard.press('F8'); await expect(page.getByRole('button',{name:'Ортогональный режим',exact:true})).toHaveAttribute('aria-pressed','true');
  await tool(page,'Линия'); await clickWorld(page,-10,10); await clickWorld(page,-3,12);
  drawing=await doc(page); line=drawing.entities.filter(e=>e.type==='line').at(-1)!; if(line.type!=='line')throw new Error(); expect(drawing.vertices[line.startVertexId]!.y).toBe(drawing.vertices[line.endVertexId]!.y);
  // Explicit endpoint wins over an angle constraint.
  await page.getByRole('button',{name:'Привязки',exact:true}).click(); await tool(page,'Линия'); await clickWorld(page,0,-10); await page.keyboard.down('Shift'); await clickWorld(page,10,0); await page.keyboard.up('Shift');
  const last=(await doc(page)).entities.filter(e=>e.type==='line').at(-1)!; if(last.type!=='line')throw new Error();
  expect((await doc(page)).vertices[last.endVertexId]).toMatchObject({x:10,y:0});
});

test('dimension line/extension hit targets and text drag change separate persistent values', async ({page}) => {
  await tool(page,'Размер'); await clickWorld(page,0,0); await clickWorld(page,10,0); await clickWorld(page,5,3);
  const dimension=page.locator('[data-entity-type="dimension"]'); const before=(await doc(page)).entities[0] as DimensionEntity;
  const extension=await at(page,0,1.5); await page.mouse.move(extension.x+3,extension.y); await page.mouse.down(); await page.mouse.move(extension.x+3,extension.y-20,{steps:4}); await page.mouse.up();
  const moved=(await doc(page)).entities[0] as DimensionEntity; expect(moved.offset).not.toBe(before.offset);
  const text=dimension.locator('[data-dimension-text-handle]'), box=(await text.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down(); await page.mouse.move(box.x+box.width/2+25,box.y+box.height/2,{steps:4}); await page.mouse.up();
  const shifted=(await doc(page)).entities[0] as DimensionEntity; expect(shifted.textPosition).toBeGreaterThan(0.5); expect(shifted.offset).toBe(moved.offset);
  await page.getByRole('button',{name:'Отменить',exact:true}).click(); expect(((await doc(page)).entities[0] as DimensionEntity).textPosition??0.5).toBe(0.5);
  await page.getByRole('button',{name:'Повторить',exact:true}).click(); await roundTrip(page); expect((await doc(page)).entities[0]).toEqual(shifted);
});

test('AI creates new points and a shared boundary, atomically, with persistent Undo/Redo', async ({page}) => {
  const before=await doc(page); await generate(page,'Создай P1 (0,0), P2 (20,0), P3 (20,10), P4 (0,10) и построй границу');
  await expect(page.getByTestId('ai-ghost')).toHaveCount(2); expect(await doc(page)).toEqual(before);
  await page.getByRole('button',{name:'Apply 2 changes',exact:true}).click(); await expect(page.locator('[data-entity-type="point"]')).toHaveCount(4); await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(1);
  const applied=await doc(page); expect(Object.keys(applied.vertices)).toHaveLength(4);
  await page.getByRole('button',{name:'Отменить',exact:true}).click(); await expect(page.locator('[data-entity-id]')).toHaveCount(0);
  await page.getByRole('button',{name:'Повторить',exact:true}).click(); await roundTrip(page); expect(await doc(page)).toEqual(applied);
});

test('AI site/house/dimensions preview equals execution; editable shared house corner and Save/Open', async ({page}) => {
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await generate(page,'Нарисуй участок 20×30 м, в центре дом 6×4 м и проставь размеры дома');
  await expect(page.getByTestId('ai-ghost')).toHaveCount(6); await expect(page.getByTestId('ai-plan')).toContainText('Предположения');
  await expect(page.getByTestId('dimension-preview-value')).toHaveText(['6,000 м','4,000 м','6,000 м','4,000 м']);
  await page.getByRole('button',{name:'Apply 6 changes',exact:true}).click(); await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(2);
  await expect(page.getByTestId('dimension-value')).toHaveText(['6,000 м','4,000 м','6,000 м','4,000 м']);
  const house=page.locator('[data-entity-type="polygon"][aria-label="Дом"]'); await house.locator('polygon').click({force:true});
  const handle=house.locator('[data-vertex-handle]').first(), box=(await handle.boundingBox())!;
  await page.mouse.move(box.x+4,box.y+4); await page.mouse.down(); await page.mouse.move(box.x+14,box.y-6,{steps:5}); await page.mouse.up();
  await expect(page.getByTestId('dimension-value').first()).not.toHaveText('6,000 м');
  const saved=await doc(page), polygon=saved.entities.find(e=>e.name==='Дом') as PolygonEntity; expect(polygon.vertexIds).toHaveLength(4);
  await roundTrip(page); expect(await doc(page)).toEqual(saved); expect(errors).toEqual([]);
});

test('AI clarification sends original text and structured user answers, and vague engineering request has no side effects', async ({page}) => {
  const before=await doc(page); await generate(page,'Создай точки P1 и P2'); await expect(page.getByTestId('ai-clarification')).toBeVisible(); expect(await doc(page)).toEqual(before);
  await page.getByRole('textbox',{name:'Ответ на уточнение',exact:true}).fill('P1 (0,0), P2 (30,0)'); await page.getByRole('button',{name:'Generate plan',exact:true}).click();
  await expect(page.getByTestId('ai-ghost')).toHaveCount(1); await page.getByRole('button',{name:'Apply',exact:true}).click(); await expect(page.locator('[data-entity-type="point"]')).toHaveCount(2);
  await page.getByRole('button',{name:'Cancel',exact:true}).click(); const current=await doc(page);
  await generate(page,'Нарисуй участок, на нем дом 6×4, грядки и газовую трубу с запада'); await expect(page.getByTestId('ai-clarification')).toBeVisible(); await expect(page.getByTestId('ai-ghost')).toHaveCount(0); expect(await doc(page)).toEqual(current);
});
