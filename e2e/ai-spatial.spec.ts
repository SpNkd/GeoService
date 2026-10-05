import { test, expect, type Page } from '@playwright/test';
import type { AiTaskIntent, SpatialAnchor } from '../src/ai/intent';
import type { GeoDocument } from '../src/domain/model';
const documentOf = (page: Page): Promise<GeoDocument> => page.evaluate(()=>JSON.parse(localStorage.getItem('geoservice.document.v2')!));
const task = (anchor: SpatialAnchor, dimensions: boolean): AiTaskIntent => ({actions:[
  {type:'create_rectangle',name:'Участок',width:20,height:30,placement:{type:'local_origin'}},
  {type:'create_rectangle',name:'Дом',width:5,height:6,placement:{type:'anchored_in_action_result',anchor,polygonActionIndex:0}},
  ...(dimensions ? [{type:'create_dimensions_for_boundary_edges' as const,boundaryActionIndex:1}] : []),
]});
async function setup(page:Page, result:unknown) {
  await page.route('**/api/ai/config',route=>route.fulfill({json:{mode:'mock'}}));
  await page.route('**/api/ai/intent',route=>{expect(Object.keys(route.request().postDataJSON())).toEqual(['text']); return route.fulfill({json:result});});
  await page.goto('/'); await page.getByRole('button',{name:'Новый документ',exact:true}).click();
}
async function generate(page:Page,text:string) {await page.getByRole('textbox',{name:'Запрос',exact:true}).fill(text); await page.getByRole('button',{name:'Generate plan',exact:true}).click();}
test('north sketch preview with six ghosts, assumptions, atomic Apply and one Undo/Redo',async ({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await setup(page,{intent:task('north',true),unsupported:false}); const before=await documentOf(page);
  await generate(page,'Создай участок 20×30, на севере участка поставь дом 5×6 и проставь размеры дома');
  await expect(page.getByTestId('ai-ghost')).toHaveCount(6); expect(await documentOf(page)).toEqual(before);
  await expect(page.getByTestId('ai-assumptions')).toContainText('северной границы: 1.0 м'); await expect(page.getByTestId('ai-assumptions')).toContainText('По горизонтали объект центрирован');
  await expect(page.getByTestId('dimension-preview-value')).toHaveText(['5,000 м','6,000 м','5,000 м','6,000 м']);
  // Check the rendered preview: north is above, contained and centered horizontally in screen space.
  const polygons=page.getByTestId('ai-ghost').locator('polygon'); const site=(await polygons.nth(0).boundingBox())!,house=(await polygons.nth(1).boundingBox())!;
  expect(house.x+house.width/2).toBeCloseTo(site.x+site.width/2,1);expect(house.y).toBeGreaterThan(site.y);expect(house.y+house.height).toBeLessThan(site.y+site.height/2);
  expect(house.x).toBeGreaterThan(site.x);expect(house.x+house.width).toBeLessThan(site.x+site.width);
  await page.screenshot({path:'/tmp/geoservice-spatial-north-preview.png',fullPage:true});
  await page.getByRole('button',{name:'Apply 6 changes',exact:true}).click();await expect(page.locator('[data-entity-type="polygon"]')).toHaveCount(2);await expect(page.locator('[data-entity-type="dimension"]')).toHaveCount(4);
  const applied=await documentOf(page), houseEntity=applied.entities.find(e=>e.name==='Дом')!;if(houseEntity.type!=='polygon')throw new Error();
  expect(houseEntity.vertexIds.map(id=>({x:applied.vertices[id]!.x,y:applied.vertices[id]!.y}))).toEqual([{x:7.5,y:23},{x:12.5,y:23},{x:12.5,y:29},{x:7.5,y:29}]);
  await page.getByRole('button',{name:'Отменить',exact:true}).click();expect(await documentOf(page)).toEqual(before);
  await page.getByRole('button',{name:'Повторить',exact:true}).click();expect(await documentOf(page)).toEqual(applied);expect(errors).toEqual([]);
});
for(const [anchor,text,x,y] of [['west','на западе',1,12],['north_east','в северо-восточной части',14,23]] as const) test(`${anchor} appears on expected side`,async ({page})=>{
  await setup(page,task(anchor,false));await generate(page,`Участок 20×30, дом 5×6 ${text}`);await expect(page.getByTestId('ai-ghost')).toHaveCount(2);
  await page.getByRole('button',{name:'Apply 2 changes',exact:true}).click();const drawing=await documentOf(page),house=drawing.entities.find(e=>e.name==='Дом')!;if(house.type!=='polygon')throw new Error();
  expect(drawing.vertices[house.vertexIds[0]]).toMatchObject({x,y});
});
test('reported wrapper is ordinary clarification, not an invalid structured output error',async ({page})=>{
  await setup(page,{intent:{status:'needs_clarification',questions:['Уточните точное положение дома на севере участка: расстояние от северной границы и смещение по ширине.']},unsupported:false});
  const before=await documentOf(page);await generate(page,'Создай точку P1');await expect(page.getByTestId('ai-clarification')).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByTestId('ai-ghost')).toHaveCount(0);expect(await documentOf(page)).toEqual(before);
});
