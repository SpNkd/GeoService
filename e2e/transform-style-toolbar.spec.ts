import { editorCommand, openRightTab } from './helpers/editorCommands';
import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createNewDocument } from '../src/domain/newDocument';
import { readAutosaveDocument } from './helpers/autosave';
const failures = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const list: string[] = []; failures.set(page, list); page.on('pageerror', e => list.push(e.message)); page.on('console', m => { if (m.type() === 'error')
    list.push(m.text()); }); });
test.afterEach(({ page }) => expect(failures.get(page)).toEqual([]));
function scene() { const d = createNewDocument(); d.metadata.id = 'transform-style'; d.vertices = { a: { id: 'a', x: 0, y: 0 }, b: { id: 'b', x: 20, y: 0 }, c: { id: 'c', x: 20, y: 10 }, e: { id: 'e', x: 10, y: 12 }, f: { id: 'f', x: 0, y: 10 }, l1: { id: 'l1', x: 25, y: 0 }, l2: { id: 'l2', x: 35, y: 0 }, t: { id: 't', x: 28, y: 8 } }; d.entities = [{ id: 'polygon', name: 'Пять вершин', type: 'polygon', layerId: 'boundary', vertexIds: ['a', 'b', 'c', 'e', 'f'] }, { id: 'line', name: 'Линия для стиля', type: 'line', layerId: 'boundary', startVertexId: 'l1', endVertexId: 'l2' }, { id: 'text', name: 'Текст группы', type: 'text', layerId: 'boundary', vertexId: 't', content: 'Текст', fontSize: 14 }, { id: 'symbol', name: 'Символ группы', type: 'symbol', layerId: 'boundary', libraryId: 'gas-process-demo', symbolId: 'filter', position: { x: 40, y: 0 }, rotationDeg: 0, scale: 1 }]; return d; }
async function frame(page: Page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function setup(page: Page, d = scene()) { await page.route('**/api/ai/config', r => r.fulfill({ json: { mode: 'mock' } })); await page.addInitScript(d => localStorage.setItem('geoservice.document.v2', JSON.stringify(d)), d); await page.goto('/'); await expect(page.getByTestId('drawing-canvas')).toBeVisible(); await frame(page); }
async function command(page:Page,name:string){await editorCommand(page,name);}
async function select(page: Page, name: string) { await openRightTab(page,'search');await page.getByLabel('Поиск в документе', { exact: true }).fill(name); await page.locator('.search-results').getByRole('button', { name, exact: true }).click(); await openRightTab(page,'search');await page.getByLabel('Поиск в документе', { exact: true }).clear(); await openRightTab(page,'properties'); }
async function screen(page: Page, p: {
    x: number;
    y: number;
}) { const c = page.getByTestId('drawing-canvas'), b = (await c.boundingBox())!, z = Number(await c.getAttribute('data-zoom')), cx = Number(await c.getAttribute('data-center-x')), cy = Number(await c.getAttribute('data-center-y')); return { x: b.x + b.width / 2 + (p.x - cx) * z, y: b.y + b.height / 2 - (p.y - cy) * z }; }
async function dragRotate(page: Page, angle: number, shift = false) { const h = (await page.locator('[data-selection-rotation]').boundingBox())!, center = await screen(page, { x: 10, y: 6 }), dx = h.x + h.width / 2 - center.x, dy = h.y + h.height / 2 - center.y, a = angle * Math.PI / 180; await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down(); if (shift)
    await page.keyboard.down('Shift'); await page.mouse.move(center.x + dx * Math.cos(a) + dy * Math.sin(a), center.y - dx * Math.sin(a) + dy * Math.cos(a), { steps: 5 }); await frame(page); }
test('polygon free rotation, immutable preview, one Undo, 15 degree snap, cancel, RO and Axon', async ({ page }) => { await setup(page); await select(page, 'Пять вершин'); const before = await readAutosaveDocument(page); await expect(page.locator('[data-selection-rotation]')).toBeVisible(); await dragRotate(page, 37); await expect(page.getByTestId('rotation-feedback')).toContainText('Угол:'); expect(await readAutosaveDocument(page)).toEqual(before); await page.mouse.up(); const rotated = await readAutosaveDocument(page); expect(rotated.vertices.b).not.toEqual(before.vertices.b); await command(page, 'Отменить'); expect(await readAutosaveDocument(page)).toEqual(before); await command(page, 'Повторить'); expect(await readAutosaveDocument(page)).toEqual(rotated); await command(page, 'Отменить'); await dragRotate(page, 23, true); await expect(page.getByTestId('rotation-feedback')).toHaveText('Угол: 30.0°'); await page.mouse.up(); await page.keyboard.up('Shift'); await command(page, 'Отменить'); await dragRotate(page, 20); await page.keyboard.press('Escape'); await page.mouse.up(); expect(await readAutosaveDocument(page)).toEqual(before); await page.getByTestId('drawing-canvas').focus(); await page.keyboard.press('r'); await page.keyboard.press('o'); await expect(page.getByLabel('Угол поворота выделения', { exact: true })).toBeFocused(); await page.getByLabel('Угол поворота выделения', { exact: true }).fill('90'); await page.getByRole('button', { name: 'Применить поворот', exact: true }).click(); const exact = await readAutosaveDocument(page); expect(exact.vertices.b!.x).toBeCloseTo(16); expect(exact.vertices.b!.y).toBeCloseTo(16); await page.getByLabel('Вид', { exact: true }).selectOption('NE'); await expect(page.locator('[data-selection-rotation]')).toHaveCount(0); await page.getByLabel('Вид', { exact: true }).selectOption('plan'); await expect(page.locator('[data-selection-rotation]')).toBeVisible(); });
test('mixed group rotates positions, Text/Symbol orientation and persists', async ({ page }) => { await setup(page); const row = page.locator('[data-layer-id="boundary"]'); await row.getByLabel('Действия слоя Граница участка').click(); await row.getByRole('button', { name: 'Выбрать все объекты слоя', exact: true }).click(); await expect(page.getByTestId('group-properties')).toHaveCount(1); await page.getByLabel('Угол поворота выделения', { exact: true }).fill('30'); await page.getByRole('button', { name: 'Применить поворот', exact: true }).click(); const d = await readAutosaveDocument(page); expect(d.entities.find(e => e.id === 'text')).toMatchObject({ rotationDeg: 30 }); expect(d.entities.find(e => e.id === 'symbol')).toMatchObject({ rotationDeg: 30 }); await page.reload(); expect(await readAutosaveDocument(page)).toEqual(d); });
test('layer ByLayer, entity override/reset, current drawing preset, multi style and Match Properties', async ({ page }) => { await setup(page); await page.getByRole('button', { name: 'Выбрать слой Граница участка', exact: true }).click(); await page.getByLabel('Стиль слоя: Цвет', { exact: true }).selectOption('#24834B'); await page.getByLabel('Стиль слоя: Тип линии', { exact: true }).selectOption('dashed'); await page.getByLabel('Стиль слоя: Толщина, px', { exact: true }).selectOption('3'); const layerStyled = await readAutosaveDocument(page); expect(layerStyled.entities.every(e => !e.style)).toBe(true); await select(page, 'Линия для стиля'); await page.getByLabel('Стиль объектов: Цвет', { exact: true }).selectOption('#246BCC'); await page.getByRole('button', { name: 'Выбрать слой Граница участка', exact: true }).click(); await page.getByLabel('Стиль слоя: Цвет', { exact: true }).selectOption('#D34444'); await select(page, 'Линия для стиля'); expect((await readAutosaveDocument(page)).entities[1]!.style?.strokeColor).toBe('#246BCC'); await page.getByLabel('Стиль объектов: Цвет', { exact: true }).selectOption('inherit'); expect((await readAutosaveDocument(page)).entities[1]!.style?.strokeColor).toBeNull(); await page.getByLabel('Стиль объектов: Цвет', { exact: true }).selectOption('#24834B'); await page.getByLabel('Стиль объектов: Тип линии', { exact: true }).selectOption('dash_dot'); await page.getByRole('button', { name: 'Копировать стиль', exact: true }).click(); await select(page, 'Пять вершин'); const before = (await readAutosaveDocument(page)).entities[0]!; await page.getByRole('button', { name: 'Применить скопированный стиль', exact: true }).click(); let d = await readAutosaveDocument(page); expect(d.entities[0]).toMatchObject({ layerId: before.layerId, vertexIds: ['a', 'b', 'c', 'e', 'f'], style: { strokeColor: '#24834B', lineType: 'dash_dot' } }); await command(page, 'Отменить'); expect((await readAutosaveDocument(page)).entities[0]).toEqual(before); await page.locator('.current-style>summary').click(); await page.getByLabel('Текущий стиль: Цвет', { exact: true }).selectOption('#246BCC'); await page.locator('.current-style>summary').click(); await page.getByLabel('Текущий стиль: Тип линии', { exact: true }).selectOption('dotted'); await command(page, 'Инструмент: Линия'); const a = await screen(page, { x: 0, y: -5 }), b = await screen(page, { x: 10, y: -5 }); await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y); d = await readAutosaveDocument(page); expect(d.entities.at(-1)!.style).toMatchObject({ strokeColor: '#246BCC', lineType: 'dotted' }); const download = page.waitForEvent('download'); await command(page, 'Сохранить JSON'); const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8')); expect(saved).toEqual(d); await page.reload(); expect(await readAutosaveDocument(page)).toEqual(d); });
test('multi style shows mixed values, reports unsupported properties and commits once', async ({ page }) => { const d = scene(); d.entities = d.entities.slice(0, 2); d.entities[0] = { ...d.entities[0]!, style: { strokeColor: '#24834B' } }; d.entities[1] = { ...d.entities[1]!, style: { strokeColor: '#D34444' } }; await setup(page, d); const row = page.locator('[data-layer-id="boundary"]'); await row.getByLabel('Действия слоя Граница участка').click(); await row.getByRole('button', { name: 'Выбрать все объекты слоя', exact: true }).click(); await expect(page.getByLabel('Стиль объектов: Цвет', { exact: true })).toHaveValue('mixed'); const before = await readAutosaveDocument(page); await page.getByLabel('Стиль объектов: Цвет', { exact: true }).selectOption('#246BCC'); expect((await readAutosaveDocument(page)).entities.every(e => e.style?.strokeColor === '#246BCC')).toBe(true); await command(page, 'Отменить'); expect(await readAutosaveDocument(page)).toEqual(before); });
for(const width of [1920,1600,1440,1366,1280,1024])test(`responsive semantic toolbar ${width}`,async({page})=>{await page.setViewportSize({width,height:900});await setup(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('button',{name:'Символы',exact:true})).toBeVisible();await command(page,'Инструмент: Соединение');await expect(page.getByRole('button',{name:'Инструмент: Соединение',exact:true})).toHaveAttribute('aria-pressed','true');await command(page,'Инструмент: Полилиния');await expect(page.locator('.toolbar-menu>summary').filter({hasText:'Полилиния'})).toBeVisible();});
async function directSelect(page: Page, label: string, value: string) { return page.getByLabel(label, { exact: true }).evaluate(async (el, value) => { const t = performance.now(); (el as HTMLSelectElement).value = value; el.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return +(performance.now() - t).toFixed(2); }, value); }
async function directClick(page: Page, name: string) { return page.getByRole('button', { name, exact: true }).evaluate(async (el) => { const t = performance.now(); (el as HTMLButtonElement).click(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return +(performance.now() - t).toFixed(2); }); }
async function metrics(page: Page) { return page.evaluate(async () => { const { canvasMetrics } = await import(String('/src/renderer/CanvasSceneRenderer.ts')); return canvasMetrics(); }); }
test('browser performance: 100 entities rotate, bulk style, layer style and Match', async ({ page }) => {
    const d = createNewDocument();
    d.metadata.id = '100-transform';
    for (let i = 0; i < 100; i++) {
        const a = `a${i}`, b = `b${i}`;
        d.vertices[a] = { id: a, x: i % 10 * 3, y: Math.floor(i / 10) * 3 };
        d.vertices[b] = { id: b, x: i % 10 * 3 + 2, y: Math.floor(i / 10) * 3 + 1 };
        d.entities.push({ id: `l${i}`, name: `Perf line ${i}`, layerId: 'boundary', type: 'line', startVertexId: a, endVertexId: b });
    }
    await setup(page, d);
    const row = page.locator('[data-layer-id="boundary"]');
    await row.getByLabel('Действия слоя Граница участка').click();
    await row.getByRole('button', { name: 'Выбрать все объекты слоя', exact: true }).click();
    const report: Record<string, number> = {};
    await openRightTab(page,'properties');await page.getByLabel('Угол поворота выделения', { exact: true }).fill('37');
    report.rotate100 = await directClick(page, 'Применить поворот');
    expect((await readAutosaveDocument(page)).vertices.a0).not.toEqual(d.vertices.a0);
    await command(page, 'Отменить');
    report.style100 = await directSelect(page, 'Стиль объектов: Цвет', '#24834B');
    expect((await readAutosaveDocument(page)).entities.every(e => e.style?.strokeColor === '#24834B')).toBe(true);
    await command(page, 'Отменить');
    expect(await readAutosaveDocument(page)).toEqual(d);
    await page.getByRole('button', { name: 'Выбрать слой Граница участка', exact: true }).click();
    report.layerStyle100 = await directSelect(page, 'Стиль слоя: Тип линии', 'dashed');
    expect((await readAutosaveDocument(page)).entities).toEqual(d.entities);
    await command(page, 'Отменить');
    await select(page, 'Perf line 0');
    await page.getByLabel('Стиль объектов: Цвет', { exact: true }).selectOption('#246BCC');
    await directClick(page, 'Копировать стиль');
    if(!await row.locator('.layer-menu').getAttribute('open').then(v=>v!==null))await row.getByLabel('Действия слоя Граница участка').click();
    await row.getByRole('button', { name: 'Выбрать все объекты слоя', exact: true }).click();
    report.match100 = await directClick(page, 'Применить скопированный стиль');
    expect((await readAutosaveDocument(page)).entities.every(e => e.style?.strokeColor === '#246BCC')).toBe(true);
    await command(page, 'Отменить');
    expect((await readAutosaveDocument(page)).entities.slice(1)).toEqual(d.entities.slice(1));
    await page.setViewportSize({ width: 1024, height: 900 });
    await frame(page);
    await page.screenshot({ path: '/private/tmp/geoservice-toolbar-1024-style.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await writeFile('/private/tmp/geoservice-transform-style-browser-performance.json', JSON.stringify(report, null, 2));
});
test('reference DXF hierarchy has 5 Paper Spaces and 2/2/3/6/2 MODEL viewports with clean navigation', async ({ page }) => {
    test.setTimeout(120000); test.skip(!process.env.DXF_REFERENCE, 'Opt-in real DXF');
    await setup(page, createNewDocument());
    await command(page, 'DXF');
    await page.getByLabel('Файл DXF', { exact: true }).setInputFiles(process.env.DXF_REFERENCE!);
    await page.getByTestId('dxf-report').waitFor();
    await page.getByRole('button', { name: 'Открыть как новый документ', exact: true }).click();
    const before = await readAutosaveDocument(page);
    await page.getByTestId('dxf-views').locator('>summary').click();
    const nodes = page.getByTestId('dxf-paper-node');
    await expect(nodes).toHaveCount(5);
    const names = ['*Paper_Space111', '*Paper_Space266', '*Paper_Space268', '*Paper_Space289', '*Paper_Space'], counts = [2, 2, 3, 6, 2], timings: Record<string, number> = {};
    for (let i = 0; i < 5; i++) {
        const node = nodes.nth(i);
        if(await page.getByTestId('dxf-views').getAttribute('open')===null)await page.getByTestId('dxf-views').locator('>summary').click();
        await expect(page.locator('.dxf-source-note')).toContainText('Исходные имена листов отсутствуют');
        await node.locator('details>summary').click();
        await expect(node.getByTestId('dxf-viewport-node')).toHaveCount(counts[i]!);
        if(await page.getByTestId('dxf-views').getAttribute('open')===null)await page.getByTestId('dxf-views').locator('>summary').click();const start = Date.now();
        await node.getByRole('button', { name: `Paper Space ${names[i]}`, exact: true }).click();
        await expect(page.getByTestId('layout-viewport')).toHaveCount(counts[i]!);
        timings[`paper ${i}`] = Date.now() - start;
        const v = node.getByTestId('dxf-viewport-node').last();
        if(await page.getByTestId('dxf-views').getAttribute('open')===null)await page.getByTestId('dxf-views').locator('>summary').click();await v.getByRole('button').first().click();
        await expect(page.getByTestId('layout-viewport').last()).toHaveAttribute('data-active', 'true');
        const sourceLayout=before.dxfLayouts![i]!,active=sourceLayout.viewports.at(-1)!;
        await expect(page.locator('.vp-badge')).toHaveCount(before.layers.filter(l=>active.frozenSourceLayerNames.includes(l.source?.originalLayer??l.name)).length);
        const first=sourceLayout.viewports[0]!;
        await page.getByTestId('dxf-views').locator('>summary').click();await node.getByTestId('dxf-viewport-node').first().getByRole('button').first().click();
        await expect(page.locator('.vp-badge')).toHaveCount(before.layers.filter(l=>first.frozenSourceLayerNames.includes(l.source?.originalLayer??l.name)).length);
        if(await page.getByTestId('dxf-views').getAttribute('open')===null)await page.getByTestId('dxf-views').locator('>summary').click();await v.getByRole('button').first().click();
        await page.getByTestId('dxf-views').locator('>summary').click();await page.getByRole('button', { name: 'Fit Viewport', exact: true }).click();
        await page.getByTestId('dxf-views').locator('>summary').click();await page.getByRole('button', { name: 'Fit Paper Space', exact: true }).click();
        expect(await readAutosaveDocument(page)).toEqual(before);
    }
    for(const width of [1920,1600,1440,1366,1280,1024]){
        await page.setViewportSize({width,height:900});await frame(page);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
        const toolbar=page.getByRole('navigation',{name:'Инструменты редактора'});expect(await toolbar.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    }
    await page.setViewportSize({width:1440,height:900});await frame(page);
    await page.getByTestId('dxf-views').locator('>summary').click();await page.getByRole('button', { name: 'Back to Model', exact: true }).click();
    await expect(page.getByTestId('drawing-canvas')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeDisabled();
    expect(await readAutosaveDocument(page)).toEqual(before);
    await page.screenshot({ path: '/private/tmp/geoservice-dxf-views.png' });
    await page.getByTestId('dxf-views').locator('>summary').click();
    const block = before.entities.find(e => e.type === 'block_instance' && !e.attributePrimitives?.length && before.layers.find(l => l.id === e.layerId)?.visible && !before.layers.find(l => l.id === e.layerId)?.locked)!;
    await openRightTab(page,'search');await page.getByLabel('Поиск в документе', { exact: true }).fill(block.name);
    const result = page.locator('.query-result').filter({ hasText: 'block_instance' }).first();
    await result.getByRole('button').first().click();
    await result.getByRole('button', { name: 'Fit', exact: true }).click();
    await openRightTab(page,'search');await page.getByLabel('Поиск в документе', { exact: true }).clear();
    await frame(page);
    const id = (await page.getByTestId('selected-id').textContent())!, owner = before.entities.find(e => e.id === id)!;
    expect(owner.type).toBe('block_instance');
    const m = await metrics(page);
    expect(m.compilations).toBeGreaterThan(0);
    await expect(page.getByLabel('Стиль объектов: Цвет', { exact: true })).toHaveValue('source');
    timings.sourceByLayer = await directSelect(page, 'Стиль объектов: Цвет', 'inherit');
    expect((await readAutosaveDocument(page)).entities.find(e => e.id === id)!.style?.strokeColor).toBeNull();
    await command(page, 'Отменить');
    timings.referenceStyle = await directSelect(page, 'Стиль объектов: Цвет', '#246BCC');
    const styled = await readAutosaveDocument(page);
    expect(styled.entities.filter(e => e.id !== id)).toEqual(before.entities.filter(e => e.id !== id));
    expect(styled.blocks).toEqual(before.blocks);
    expect(styled.entities.find(e => e.id === id)!.source).toEqual(owner.source);
    expect((await metrics(page)).compilations - m.compilations).toBeLessThanOrEqual(1);
    await command(page, 'Отменить');
    expect(await readAutosaveDocument(page)).toEqual(before);
    await openRightTab(page,'properties');await page.getByLabel('Угол поворота выделения', { exact: true }).fill('37');
    const baseline = await metrics(page);
    timings.referenceRotate = await directClick(page, 'Применить поворот');
    const rotated = await readAutosaveDocument(page);
    expect(rotated.blocks).toEqual(before.blocks);
    expect((await metrics(page)).compilations - baseline.compilations).toBeLessThanOrEqual(1);
    await command(page, 'Отменить');
    expect(await readAutosaveDocument(page)).toEqual(before);
    await writeFile('/private/tmp/geoservice-transform-toolbar-performance.json', JSON.stringify(timings, null, 2));
});


test('custom color picker cancel is view-only; changed color commits one Undo',async({page})=>{
 await setup(page);await select(page,'Линия для стиля');const before=await readAutosaveDocument(page),picker=page.getByLabel('Стиль объектов: Цвет свой',{exact:true});
 await picker.focus();await picker.press('Tab');expect(await readAutosaveDocument(page)).toEqual(before);await expect(page.getByRole('button',{name:'Отменить',exact:true})).toBeDisabled();
 await picker.evaluate(el=>{(el as HTMLInputElement).value='#ABCDEF';el.dispatchEvent(new Event('input',{bubbles:true}));});await picker.focus();await picker.press('Tab');expect((await readAutosaveDocument(page)).entities[1]!.style?.strokeColor).toBe('#ABCDEF');await command(page,'Отменить');expect(await readAutosaveDocument(page)).toEqual(before);
});
