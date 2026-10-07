import { test, expect, type Page } from '@playwright/test';
import { createNewDocument } from '../src/domain/newDocument';
import { readAutosaveDocument, autosaveSnapshot } from './helpers/autosave';
import { editorCommand , openRightTab } from './helpers/editorCommands';
async function point(page: Page, p: {
    x: number;
    y: number;
}) { return page.getByTestId('drawing-canvas').evaluate(async (el, p) => { const { worldToScreen } = await import(String('/src/geometry/index.ts')), r = el.getBoundingClientRect(), v = { center: { x: Number((el as SVGElement).dataset.centerX), y: Number((el as SVGElement).dataset.centerY) }, pixelsPerUnit: Number((el as SVGElement).dataset.zoom), rotationDeg: Number((el as SVGElement).dataset.viewAngle) }; const q = worldToScreen(p, v, { width: r.width, height: r.height }); return { x: r.x + q.x, y: r.y + q.y }; }, p); }
async function views(page: Page) { const root = page.getByTestId('dxf-views'); if (await root.getAttribute('open') === null)
    await root.locator('>summary').click(); return root; }
async function reference(page: Page) { test.skip(!process.env.DXF_REFERENCE); await page.goto('/'); await page.getByTestId('drawing-canvas').waitFor(); await editorCommand(page, 'DXF'); await page.getByLabel('Файл DXF', { exact: true }).setInputFiles(process.env.DXF_REFERENCE!); await page.getByTestId('dxf-report').waitFor(); await page.getByRole('button', { name: 'Открыть как новый документ', exact: true }).click(); return readAutosaveDocument(page); }
test('two snapped points align vertically; ORTHO creates true rotated MODEL and Undo', async ({ page }) => { const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); const d = createNewDocument(); d.vertices = { a: { id: 'a', x: 0, y: 0 }, b: { id: 'b', x: 20 * Math.cos(27 * Math.PI / 180), y: 20 * Math.sin(27 * Math.PI / 180) } }; d.entities = [{ id: 'axis', name: 'Site axis', type: 'line', layerId: 'boundary', startVertexId: 'a', endVertexId: 'b' }]; await page.goto('/'); await page.getByTestId('drawing-canvas').waitFor(); await page.getByLabel('Файл GeoDocument', { exact: true }).setInputFiles({ name: 'axis.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(d)) }); const before = await autosaveSnapshot(page); await page.locator('.view-orientation>summary').click(); await page.getByRole('button', { name: 'Выровнять вертикально по 2 точкам', exact: true }).click(); let a = await point(page, d.vertices.a!), b = await point(page, d.vertices.b!); await page.mouse.click(a.x, a.y); await page.mouse.move(b.x, b.y); await expect(page.getByTestId('view-align-guide')).toBeVisible(); await page.mouse.click(b.x, b.y); await expect(page.getByTestId('drawing-canvas')).toHaveAttribute('data-view-angle', '63'); await editorCommand(page,'Вписать схему в вид'); a = await point(page, d.vertices.a!); b = await point(page, d.vertices.b!); expect(a.x).toBeCloseTo(b.x, 5); expect(await autosaveSnapshot(page)).toEqual(before); await page.getByRole('button', { name: 'Ортогональный режим', exact: true }).click(); await editorCommand(page, 'Инструмент: Линия'); await page.mouse.click(a.x, a.y); await page.mouse.click(a.x + 25, a.y - 70); const after = await readAutosaveDocument(page), e = after.entities.at(-1)!; expect(after.entities).toHaveLength(2); expect(e.type).toBe('line'); if (e.type === 'line') {
    const A = after.vertices[e.startVertexId]!, B = after.vertices[e.endVertexId]!;
    expect(Math.abs(Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI - 27)).toBeLessThan(.000001);
} await editorCommand(page, 'Отменить'); expect(await readAutosaveDocument(page)).toEqual(d); expect(errors).toEqual([]); });
test('reference all 15 window Fits and Paper Fits leave document/history clean', async ({ page }) => { test.setTimeout(120000); const before = await reference(page); for (const l of before.dxfLayouts!) {
    let root = await views(page);
    await root.getByRole('button', { name: `Paper Space ${l.name}`, exact: true }).click();
    await expect(page.getByTestId('layout-viewport')).toHaveCount(l.viewports.length);
    for (let i = 0; i < l.viewports.length; i++) {
        root = await views(page);
        const node = root.getByTestId('dxf-paper-node').filter({ has: page.getByRole('button', { name: `Paper Space ${l.name}`, exact: true }) });
        if (await node.locator('details').getAttribute('open') === null)
            await node.locator('details>summary').click();
        await node.getByRole('button', { name: `${l.name}: Viewport ${i + 1}`, exact: true }).click();
        await expect(page.locator(`[data-viewport-id="${l.viewports[i]!.id}"]`)).toHaveAttribute('data-active', 'true');
    }
    root = await views(page);
    await root.getByRole('button', { name: 'Fit Paper Space', exact: true }).click();
} const root = await views(page); await root.getByRole('button', { name: 'Back to Model', exact: true }).click(); await expect(page.getByTestId('drawing-canvas')).toBeVisible(); expect(await readAutosaveDocument(page)).toEqual(before); await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeDisabled(); });
test('reference active viewport canonical Move / Undo and readonly Paper atomic guard', async ({ page }) => { test.setTimeout(120000); const before = await reference(page); await page.getByLabel('DXF контекст', { exact: true }).selectOption(before.dxfLayouts![3]!.id); let root = await views(page), node = root.getByTestId('dxf-paper-node').nth(3); await node.locator('details>summary').click(); await node.getByRole('button', { name: 'Редактировать модель · Viewport 1', exact: true }).click(); const candidate = await page.evaluate(async (d) => { const { viewportVisibleIds } = await import(String('/src/layouts/selection.ts')), ids = viewportVisibleIds(d, d.dxfLayouts![3]!.viewports[0]!); return d.entities.find((e: {
    id: string;
    type: string;
    layerId: string;
}) => ids.has(e.id) && e.type === 'line' && !d.layers.find((l: {
    id: string;
    locked: boolean;
}) => l.id === e.layerId)?.locked); }, before); expect(candidate).toBeDefined(); await openRightTab(page,'search');await page.getByLabel('Область поиска', { exact: true }).selectOption('viewport'); await openRightTab(page,'search');await page.getByLabel('Поиск в документе', { exact: true }).fill(candidate!.name); await page.locator('.search-results .query-result').getByRole('button').first().click(); await openRightTab(page,'search');await page.getByLabel('Поиск в документе', { exact: true }).clear(); await editorCommand(page, 'Переместить выбор'); await page.getByLabel('Перемещение ΔX', { exact: true }).fill('2'); await page.getByLabel('Перемещение ΔY', { exact: true }).fill('3'); await page.getByRole('button', { name: 'Применить перемещение', exact: true }).click(); const moved = await readAutosaveDocument(page); if (candidate!.type === 'line') {
    expect(moved.vertices[candidate!.startVertexId]!.x).toBeCloseTo(before.vertices[candidate!.startVertexId]!.x + 2);
    expect(moved.vertices[candidate!.startVertexId]!.y).toBeCloseTo(before.vertices[candidate!.startVertexId]!.y + 3);
} expect(moved.dxfLayouts).toEqual(before.dxfLayouts); await page.getByRole('button', { name: 'Выйти в лист', exact: true }).click(); await editorCommand(page, 'Отменить'); expect(await readAutosaveDocument(page)).toEqual(before); root = await views(page); node = root.getByTestId('dxf-paper-node').nth(3); await node.getByRole('button', { name: 'Всё видимое на листе', exact: true }).click(); await expect(page.locator('.selection-summary')).toContainText('Только чтение: 116'); await editorCommand(page, 'Переместить выбор'); await page.getByLabel('Перемещение ΔX', { exact: true }).fill('1'); await page.getByRole('button', { name: 'Применить перемещение', exact: true }).click(); await expect(page.getByTestId('editor-error')).toContainText('Paper Space'); expect(await readAutosaveDocument(page)).toEqual(before); });
