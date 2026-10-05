import { expect, test, type Page } from '@playwright/test';
import { readAutosaveDocument } from './helpers/autosave';
import type { GeoDocument } from '../src/domain/model';
import { entityPoints } from '../src/domain/model';
import { applyCommand } from '../src/domain/commands';
import { polygonArea, pathLength } from '../src/geometry';
import { alignedDimension } from '../src/geometry/survey';
import { documentSurveyXY } from '../src/geometry/georeferencing';
import { moveDocument } from '../src/tests/fixtures/moveDocument';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const list: string[] = []; errors.set(page, list);
  page.on('pageerror', error => list.push(error.message)); page.on('console', message => { if (message.type() === 'error') list.push(message.text()); });
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));
async function load(page: Page, document = moveDocument()) {
  await page.addInitScript(document => localStorage.setItem('geoservice.document.v2', JSON.stringify(document)), document);
  await page.goto('/'); await expect(page.locator('[data-entity-id="house"]')).toBeVisible();
  return document;
}
async function document(page: Page): Promise<GeoDocument> { return readAutosaveDocument(page); }
async function screen(page: Page, x: number, y: number) {
  const canvas = page.getByTestId('drawing-canvas'), box = (await canvas.boundingBox())!;
  const zoom = Number(await canvas.getAttribute('data-zoom')), cx = Number(await canvas.getAttribute('data-center-x')), cy = Number(await canvas.getAttribute('data-center-y'));
  return { x: box.x + box.width/2 + (x-cx)*zoom, y: box.y + box.height/2 - (y-cy)*zoom };
}
async function click(page: Page, x: number, y: number, shift = false) {
  const p = await screen(page,x,y); if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(p.x,p.y); if (shift) await page.keyboard.up('Shift');
}
async function beginDrag(page: Page, x: number, y: number, dx: number, dy: number, shift = false) {
  const a = await screen(page,x,y), b = await screen(page,x+dx,y+dy);
  await page.mouse.move(a.x,a.y); await page.mouse.down(); if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(b.x,b.y,{steps:12});
  await expect(page.getByTestId('editor-error')).toContainText('ΔX');
}
async function drag(page: Page, x: number, y: number, dx: number, dy: number, shift = false) {
  await beginDrag(page,x,y,dx,dy,shift); await page.mouse.up(); if (shift) await page.keyboard.up('Shift');
}
async function translated(page: Page, before: GeoDocument, ids: string[], dx: number, dy: number) {
  await expect.poll(async () => (await document(page)).vertices[ids[0]!]!.x).toBeCloseTo(before.vertices[ids[0]!]!.x+dx,5);
  const after = await document(page);
  for (const id of ids) { expect(after.vertices[id]!.x).toBeCloseTo(before.vertices[id]!.x+dx,5); expect(after.vertices[id]!.y).toBeCloseTo(before.vertices[id]!.y+dy,5); expect(after.vertices[id]!.z).toBe(before.vertices[id]!.z); }
  expect(Object.keys(after.vertices)).toEqual(Object.keys(before.vertices)); return after;
}
async function numeric(page: Page, dx: string, dy: string) {
  await page.keyboard.press('m'); await expect(page.getByLabel('Перемещение ΔX',{exact:true})).toBeFocused();
  await page.getByLabel('Перемещение ΔX',{exact:true}).fill(dx); await page.getByLabel('Перемещение ΔY',{exact:true}).fill(dy);
  await page.getByRole('button',{name:'Применить перемещение',exact:true}).click();
}

test('polygon interior and outline move all vertices; area/perimeter and unselected dimensions follow', async ({page}) => {
  const before = await load(page); await click(page,2,2); await drag(page,2,2,5,-2);
  const after = await translated(page,before,['a','b','c','d'],5,-2), house = before.entities[0]!;
  expect(polygonArea(entityPoints(house,after.vertices))).toBeCloseTo(polygonArea(entityPoints(house,before.vertices)),5);
  expect(pathLength(entityPoints(house,after.vertices),true)).toBeCloseTo(pathLength(entityPoints(house,before.vertices),true),8);
  const dim = before.entities.find(e=>e.id==='dim-0')!; if(dim.type!=='dimension') throw Error('dimension');
  expect(after.entities).toEqual(before.entities);
  const layout = alignedDimension(after.vertices.a!,after.vertices.b!,dim.offset,dim.textPosition);
  const p = await screen(page,layout.label.x,layout.label.y);
  const text = page.locator('[data-entity-id="dim-0"] .dimension-label'); await expect(text).toHaveText('6,000 м');
  const canvasBox = (await page.getByTestId('drawing-canvas').boundingBox())!;
  expect(Number(await text.getAttribute('x'))).toBeCloseTo(p.x-canvasBox.x,6);
  await page.getByRole('button',{name:'Отменить',exact:true}).click(); expect(await document(page)).toEqual(before);
  // Outline hit, away from endpoint grips and dimension annotation hit areas.
  await drag(page,3,0,2,1); await translated(page,before,['a','b','c','d'],2,1);
});

test('explicit polygon grip edits only that vertex, with existing snapping and no whole move', async ({page}) => {
  const before = await load(page); await click(page,2,2); await click(page,9.2,7.1,true);
  const a = await screen(page,6,5), b = await screen(page,8,6); await page.mouse.move(a.x,a.y); await page.keyboard.down('Shift'); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:8}); await page.mouse.up(); await page.keyboard.up('Shift');
  await translated(page,before,['c'],2,1); const after = await document(page);
  for(const id of ['a','b','d','t']) expect(after.vertices[id]).toEqual(before.vertices[id]);
});

test('selected Dimension endpoint retarget wins over group move even when Text was selected last', async ({page}) => {
  const before = await load(page); await click(page,3,-0.7); await click(page,9.2,7.1,true);
  await expect(page.getByTestId('editor-error')).toContainText('Выбрано: 2');
  const a=await screen(page,6,0), b=await screen(page,12,10); await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:10});
  await expect(page.getByTestId('dimension-retarget-target')).toBeVisible(); expect(await document(page)).toEqual(before); await page.mouse.up();
  await expect.poll(async()=> (await document(page)).entities.find(e=>e.id==='dim-0')).toMatchObject({startVertexId:'a',endVertexId:'cb',offset:-1,textPosition:0.4});
  expect((await document(page)).vertices).toEqual(before.vertices); await page.getByRole('button',{name:'Отменить',exact:true}).click(); expect(await document(page)).toEqual(before);
});

test('house + text + shared line group from text body, bounds, one Undo and Redo', async ({page}) => {
  const before = await load(page); await click(page,2,2); await click(page,9.2,7.1,true); await click(page,-3.5,-2.1,true);
  await expect(page.getByTestId('editor-error')).toContainText('Выбрано: 3'); await expect(page.getByTestId('selection-bounds')).toBeVisible();
  await drag(page,9.2,7.1,3,2); const after = await translated(page,before,['a','b','c','d','e','t'],3,2);
  await page.getByRole('button',{name:'Отменить',exact:true}).click(); expect(await document(page)).toEqual(before); await expect(page.getByRole('button',{name:'Отменить',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Повторить',exact:true}).click(); expect(await document(page)).toEqual(after);
});

test('Line and Polyline stroke hit areas translate complete paths', async ({page}) => {
  const before = await load(page); await click(page,-3.5,-2.1); await drag(page,-3.5,-2.1,2,1);
  await translated(page,before,['a','e'],2,1); await page.getByRole('button',{name:'Отменить',exact:true}).click();
  await click(page,10.5,1); await drag(page,10.5,1,2,1); await translated(page,before,['u','v','w'],2,1);
});

test('shared unselected endpoint follows once and nonblocking dependency indicator appears', async ({page}) => {
  const before = await load(page); await click(page,2,2); await beginDrag(page,2,2,2,1);
  await expect(page.getByTestId('editor-error')).toContainText('связанных'); expect(await document(page)).toEqual(before);
  await page.mouse.up(); const after = await translated(page,before,['a','b','c','d'],2,1);
  expect(after.vertices.e).toEqual(before.vertices.e); expect(after.entities.find(e=>e.id==='line')).toEqual(before.entities.find(e=>e.id==='line'));
});

for (const layerId of ['boundary','annotations','dimensions']) test(`locked indirect ${layerId} consumer blocks whole drag and numeric move`, async ({page}) => {
  const fixture = moveDocument(); fixture.layers.find(l=>l.id===layerId)!.locked = true; const before = await load(page,fixture);
  await click(page,2,2); const a=await screen(page,2,2), b=await screen(page,5,4); await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:8}); await page.mouse.up();
  await expect(page.getByTestId('editor-error')).toContainText('заблокирован'); expect(await document(page)).toEqual(before);
  await page.keyboard.press('m'); await expect(page.getByRole('button',{name:'Применить перемещение',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Отменить',exact:true})).toBeDisabled();
});

test('selected locked member blocks an otherwise unlocked group', async ({page}) => {
  const fixture = moveDocument(); fixture.layers.find(l=>l.id==='annotations')!.locked = true; fixture.entities = fixture.entities.filter(e=>e.type!=='label');
  const before = await load(page,fixture); await click(page,2,2); await click(page,9.2,7.1,true);
  const a=await screen(page,2,2), b=await screen(page,5,4); await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y); await page.mouse.up();
  await expect(page.getByTestId('editor-error')).toContainText('Выбор содержит'); expect(await document(page)).toEqual(before);
});

for (const kind of ['Escape','pointercancel','lostcapture']) test(`${kind} discards visible preview without autosave/dirty/history`, async ({page}) => {
  const before = await load(page); await click(page,2,2); const path = page.locator('[data-entity-id="house"] [data-move-body]'), initialPath = await path.getAttribute('d');
  await beginDrag(page,2,2,3,2); await expect(path).not.toHaveAttribute('d',initialPath!);
  expect(await document(page)).toEqual(before); await expect(page.getByLabel('Есть несохранённые изменения')).toHaveCount(0); await expect(page.getByRole('button',{name:'Отменить',exact:true})).toBeDisabled();
  if(kind==='Escape') await page.keyboard.press('Escape');
  else await page.getByTestId('drawing-canvas').evaluate((svg,kind)=> { if(kind==='pointercancel') svg.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true})); else (svg as SVGSVGElement).releasePointerCapture(1); },kind);
  await page.mouse.up(); await expect(path).toHaveAttribute('d',initialPath!); expect(await document(page)).toEqual(before);
  await expect(page.getByRole('button',{name:'Отменить',exact:true})).toBeDisabled();
});

test('Shift constrains Move horizontally and vertically, with selected Shift-click retaining toggle', async ({page}) => {
  const before = await load(page); await click(page,2,2); await drag(page,2,2,3,1,true); await translated(page,before,['a','b','c','d'],3,0);
  await page.getByRole('button',{name:'Отменить',exact:true}).click(); await drag(page,2,2,1,3,true); await translated(page,before,['a','b','c','d'],0,3);
  await click(page,2,5,true); await expect(page.locator('[data-entity-id="house"]')).toHaveAttribute('data-selected','false');
});

test('M numeric exact 5/-2 and invalid empty/zero inputs; Label offset policies', async ({page}) => {
  const before = await load(page); await click(page,2,2); await click(page,3.1,3.6,true);
  await numeric(page,'5','-2'); const after = await translated(page,before,['a','b','c','d'],5,-2);
  expect(after.vertices.a).toEqual({id:'a',x:5,y:-2,z:2}); expect(after.vertices.c).toEqual({id:'c',x:11,y:3});
  expect(after.entities.find(e=>e.id==='label')).toEqual(before.entities.find(e=>e.id==='label'));
  await expect(page.getByRole('button',{name:'Применить перемещение',exact:true})).toBeDisabled();
  await page.getByLabel('Перемещение ΔX',{exact:true}).fill(''); await expect(page.getByRole('button',{name:'Применить перемещение',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Закрыть перемещение',exact:true}).click(); await page.getByRole('button',{name:'Отменить',exact:true}).click();
  await click(page,9.2,7.1); await click(page,3.1,3.6,true); await drag(page,9.2,7.1,2,1);
  const independent=await translated(page,before,['t'],2,1); expect(independent.vertices.a).toEqual(before.vertices.a);
  const label=independent.entities.find(e=>e.id==='label')!; if(label.type!=='label') throw Error('label');
  expect(label.dx).toBeCloseTo(2,5); expect(label.dy).toBeCloseTo(2,5);
});

test('rotated georeference numeric MODEL +2X derives SURVEY +2N; control Move becomes STALE', async ({page}) => {
  const fixture=applyCommand(moveDocument(),{type:'set-horizontal-reference',pairs:[{pointEntityId:'control-a',survey:{e:500000,n:6000000}},{pointEntityId:'control-b',survey:{e:500000,n:6000020}}]});
  const before=await load(page,fixture); await click(page,2,2); await numeric(page,'2','0'); const after=await translated(page,before,['a','b','c','d'],2,0);
  await expect(page.getByTestId('reference-state')).not.toContainText('STALE'); expect(after.horizontalReference).toEqual(before.horizontalReference);
  const a=documentSurveyXY(before,before.vertices.a!)!, b=documentSurveyXY(after,after.vertices.a!)!; expect(b.e).toBeCloseTo(a.e); expect(b.n-a.n).toBeCloseTo(2);
  await page.getByRole('button',{name:'Закрыть перемещение',exact:true}).click(); await click(page,-8,10); await numeric(page,'1','0');
  await expect(page.getByTestId('reference-state')).toContainText('STALE'); expect((await document(page)).horizontalReference).toEqual(before.horizontalReference);
});
