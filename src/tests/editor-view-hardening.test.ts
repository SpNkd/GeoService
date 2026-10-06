import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createNewDocument } from '../domain/newDocument';
import { initialEditorState, editorReducer, isDocumentDirty, editorCamera } from '../store/editor';
import { worldToScreen, screenToWorld, zoomAt, panViewport, fitRotatedBounds } from '../geometry';
import { constrainAngle } from '../geometry/constraints';
import { viewRotation } from '../view/projection';
import { canvasTransform } from '../renderer/CanvasSceneRenderer';
import { viewportBounds } from '../renderer/hybridScene';
import { marqueeEntities } from '../editor/marquee';
import { resolveSelectionScope, viewportVisibleIds, paperDocument } from '../layouts/selection';
import { modelViewportCamera, pointerModel } from '../layouts/camera';
import { activeDxfViewport, viewportDocument } from '../layouts/context';
import { resolveDocumentPlan, isDocumentPlanStale } from '../documentOperations/plan';
import { detectGrid, documentTables } from '../tables/detect';
import { importDxf } from '../dxf/import';
import type { VectorPrimitive } from '../vectors/types';
const size = { width: 900, height: 650 }, origin = { x: 2196000, y: 464800 };
function scene() { const d = createNewDocument(); d.layers[0]!.visible = true; d.layers[0]!.locked = false; d.sources = [{ id: 'src', filename: 'fixture.dxf', format: 'DXF', dxfVersion: 'AC1027', encoding: 'utf-8', originalUnits: 6 }]; d.entities = []; d.vertices = {}; for (let i = 0; i < 4; i++) {
    const a = `a${i}`, b = `b${i}`;
    d.vertices[a] = { id: a, x: origin.x + i * 20, y: origin.y };
    d.vertices[b] = { id: b, x: origin.x + i * 20 + 10, y: origin.y + 5 };
    d.entities.push({ id: `line${i}`, name: `L${i}`, type: 'line', layerId: d.layers[0]!.id, startVertexId: a, endVertexId: b });
} d.dxfLayouts = [{ id: 'paper', sourceDocumentId: 'src', name: '*Paper_Space', nameAvailable: false, paperSpaceOwner: 'p', paperPrimitives: [{ kind: 'text', content: 'Title', position: { x: 0, y: 0 }, height: 1, rotationDeg: 0, layerId: d.layers[0]!.id, colorMode: 'bylayer' }], viewports: [{ id: 'vp1', number: 2, centerPaper: { x: 100, y: 100 }, sizePaper: { width: 80, height: 60 }, modelCenter: origin, viewHeight: 60, scale: 1, twist: 27, clip: { kind: 'rectangle' }, frozenSourceLayerNames: [] }, { id: 'vp2', number: 3, centerPaper: { x: 200, y: 100 }, sizePaper: { width: 80, height: 60 }, modelCenter: { x: origin.x + 45, y: origin.y }, viewHeight: 60, scale: 1, twist: 0, clip: { kind: 'rectangle' }, frozenSourceLayerNames: [] }] }]; return d; }
describe('working Plan camera invariants', () => {
    it.each([0, 27, 90, 180, 270, -39, 359.5])('large-coordinate round trip %s°', angle => { const v = { center: origin, pixelsPerUnit: 5, rotationDeg: angle }, p = { x: origin.x + 13.5, y: origin.y - 7.8, z: 100 }; const q = screenToWorld(worldToScreen(p, v, size), v, size); expect(q.x).toBeCloseTo(p.x, 8); expect(q.y).toBeCloseTo(p.y, 8); });
    it.each([27, 90, 180, -39])('zoom/pan/cull share the %s° camera', angle => { const v = { center: origin, pixelsPerUnit: 5, rotationDeg: angle }, anchor = { x: 123, y: 345 }, fixed = screenToWorld(anchor, v, size), zoom = zoomAt(v, size, anchor, 3); expect(screenToWorld(anchor, zoom, size).x).toBeCloseTo(fixed.x, 8); expect(screenToWorld(anchor, zoom, size).y).toBeCloseTo(fixed.y, 8); expect(viewRotation(zoom)).toBe(angle); const pan = panViewport(v, { x: 30, y: -20 }), p = worldToScreen(origin, pan, size); expect(p.x).toBeCloseTo(size.width / 2 + 30, 7); expect(p.y).toBeCloseTo(size.height / 2 - 20, 7); const box = viewportBounds(v, size); for (const q of [[0, 0], [900, 0], [0, 650], [900, 650]]) {
        const p = screenToWorld({ x: q[0]!, y: q[1]! }, v, size);
        expect(p.x).toBeGreaterThanOrEqual(box.minX);
        expect(p.y).toBeLessThanOrEqual(box.maxY);
    } });
    it('Canvas affine transform matches shared projection', () => { const v = { center: origin, pixelsPerUnit: 8, rotationDeg: 27 }, m = canvasTransform(v, size, origin), p = worldToScreen({ x: origin.x + 2, y: origin.y + 3 }, v, size); expect(m[0] * 2 + m[2] * 3 + m[4]).toBeCloseTo(p.x); expect(m[1] * 2 + m[3] * 3 + m[5]).toBeCloseTo(p.y); });
    it.each([27, 90, -37])('Fit preserves %s° and contains projected corners', angle => { const b = { minX: origin.x - 100, maxX: origin.x + 100, minY: origin.y - 30, maxY: origin.y + 30 }, v = fitRotatedBounds(b, size, angle, 40)!; expect(viewRotation(v)).toBe(angle); for (const p of [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }]) {
        const q = worldToScreen(p, v, size);
        expect(q.x).toBeGreaterThan(20);
        expect(q.x).toBeLessThan(880);
    } });
    it.each([27, 67, -123])('ORTHO and Shift follow working %s° basis', angle => { const v = { center: origin, pixelsPerUnit: 5, rotationDeg: angle }, p = screenToWorld({ x: 480, y: 200 }, v, size), q = worldToScreen(constrainAngle(origin, p, 90, angle), v, size); expect(q.x).toBeCloseTo(450, 7); const diagonal = worldToScreen(constrainAngle(origin, p, 45, angle), v, size); expect(Math.abs(diagonal.x - 450) < 1e-6 || Math.abs(Math.abs(diagonal.x - 450) - Math.abs(diagonal.y - 325)) < 1e-6).toBe(true); });
    it('angle/align/north-up/fit have no history, dirty or coordinate mutation', () => { const d = scene(); let s = initialEditorState(d); s = editorReducer(s, { type: 'view-angle', angle: 27 }); s = editorReducer(s, { type: 'fit-view', size }); expect(viewRotation(s.viewport)).toBe(27); s = editorReducer(s, { type: 'align-view', axis: 'vertical' }); s = editorReducer(s, { type: 'align-view-point', point: origin }); s = editorReducer(s, { type: 'align-view-point', point: { x: origin.x + 10, y: origin.y + 10 } }); expect(viewRotation(s.viewport)).toBeCloseTo(45); expect(s.document).toBe(d); expect(s.past).toHaveLength(0); expect(isDocumentDirty(s)).toBe(false); s = editorReducer(s, { type: 'view-angle', angle: 0 }); expect(viewRotation(s.viewport)).toBe(0); });
    it('coincident alignment rejects and Escape cancellation is view-only', () => { let s = editorReducer(initialEditorState(scene()), { type: 'align-view', axis: 'horizontal' }); s = editorReducer(s, { type: 'align-view-point', point: origin }); s = editorReducer(s, { type: 'align-view-point', point: origin }); expect(s.error).toContain('различаться'); s = editorReducer(s, { type: 'align-view', axis: null }); expect(s.viewAlign).toBeNull(); expect(s.past).toHaveLength(0); });
    it('Plan angle survives independent Axon and Paper round trip', () => { let s = editorReducer(initialEditorState(scene()), { type: 'view-angle', angle: 27 }); const plan = s.viewport; s = editorReducer(s, { type: 'view-mode', mode: 'axonometric', size }); expect(viewRotation(editorCamera(s))).toBe(0); s = editorReducer(s, { type: 'view-mode', mode: 'plan', size }); expect(s.viewport).toBe(plan); s = editorReducer(s, { type: 'dxf-layout', layoutId: 'paper', size }); s = editorReducer(s, { type: 'dxf-layout', layoutId: null, size }); expect(s.viewport).toBe(plan); });
    it('rotated marquee uses screen geometry rather than MODEL AABB', () => { const d = scene(), v = { center: origin, pixelsPerUnit: 5, rotationDeg: 27 }, a = worldToScreen(d.vertices.a0!, v, size), b = worldToScreen(d.vertices.b0!, v, size); expect(marqueeEntities(d, v, size, { x: Math.min(a.x, b.x) - 2, y: Math.min(a.y, b.y) - 2 }, { x: Math.max(a.x, b.x) + 2, y: Math.max(a.y, b.y) + 2 })).toEqual(['line0']); });
});
describe('local Model / Paper / viewport scopes', () => {
    it('Model all includes hidden; visible excludes hidden', () => { const d = scene(); d.entities[0]!.visible = false; expect(resolveSelectionScope(d, { kind: 'model-all' }, { layoutId: null, dxfViewportId: null }).modelIds).toHaveLength(4); expect(resolveSelectionScope(d, { kind: 'model-visible' }, { layoutId: null, dxfViewportId: null }).modelIds).toHaveLength(3); });
    it('viewport visibility excludes out-of-clip owners', () => { const d = scene(), vp = d.dxfLayouts![0]!.viewports[0]!; expect([...viewportVisibleIds(d, vp)]).toEqual(['line0', 'line1', 'line2']); });
    it('hidden global layer stays hidden independently from VP Freeze', () => { const d = scene(), vp = d.dxfLayouts![0]!.viewports[0]!; d.layers[0]!.visible = false; expect(viewportVisibleIds(d, vp).size).toBe(0); expect(viewportDocument(d, vp).layers[0]!.visible).toBe(false); expect(d.layers[0]!.visible).toBe(false); });
    it('Freeze denies hit candidates without mutating global visibility', () => { const d = scene(), vp = d.dxfLayouts![0]!.viewports[0]!; vp.frozenSourceLayerNames = [d.layers[0]!.name]; expect(viewportVisibleIds(d, vp).size).toBe(0); expect(d.layers[0]!.visible).toBe(true); });
    it('Paper union deduplicates canonical owners and includes readonly paper', () => { const d = scene(), r = resolveSelectionScope(d, { kind: 'paper-visible', layoutId: 'paper' }, { layoutId: 'paper', dxfViewportId: 'vp1' }); expect(new Set(r.modelIds).size).toBe(r.modelIds.length); expect(r.modelIds).toHaveLength(4); expect(r.paperIds).toHaveLength(1); expect(paperDocument(d, d.dxfLayouts![0]!)).toBe(paperDocument(d, d.dxfLayouts![0]!)); });
    it('Paper-only has no canonical MODEL owners', () => { const r = resolveSelectionScope(scene(), { kind: 'paper-entities', layoutId: 'paper' }, { layoutId: 'paper', dxfViewportId: 'vp1' }); expect(r.modelIds).toEqual([]); expect(r.paperIds).toHaveLength(1); });
    it('unsupported viewport is explicitly empty', () => { const d = scene(), vp = d.dxfLayouts![0]!.viewports[0]!; vp.unsupportedReason = 'clip'; expect(viewportVisibleIds(d, vp).size).toBe(0); });
    it('current view follows Paper vs active viewport context', () => { const d = scene(), context = { layoutId: 'paper', dxfViewportId: 'vp1' }; expect(resolveSelectionScope(d, { kind: 'current-view' }, context).modelIds).toHaveLength(4); expect(resolveSelectionScope(d, { kind: 'current-view' }, { ...context, viewportEditing: true }).modelIds).toHaveLength(3); });
    it('mixed selection atomically blocks edits including style', () => { let s = editorReducer(initialEditorState(scene()), { type: 'selection-scope', scope: { kind: 'paper-visible', layoutId: 'paper' } }); const d = s.document; s = editorReducer(s, { type: 'apply-selection-style', patch: { strokeColor: '#123456' } }); expect(s.document).toBe(d); expect(s.error).toContain('Paper Space'); expect(s.past).toHaveLength(0); });
    it('selection scopes never mutate history or dirty', () => { const s = editorReducer(initialEditorState(scene()), { type: 'selection-scope', scope: { kind: 'viewport-visible', layoutId: 'paper', viewportId: 'vp1' } }); expect(s.selectedEntityIds).toHaveLength(3); expect(s.past).toHaveLength(0); expect(isDocumentDirty(s)).toBe(false); });
    it('geometry intersection rejects a diagonal with only overlapping bounds', () => { const d = scene(), e = d.entities[0]!; d.vertices.a0!.x = origin.x + 29; d.vertices.a0!.y = origin.y + 100; d.vertices.b0!.x = origin.x + 100; d.vertices.b0!.y = origin.y + 29; const vp = { ...d.dxfLayouts![0]!.viewports[0]!, twist: 0 }; expect(viewportVisibleIds(d, vp).has(e.id)).toBe(false); });
});
describe('shared canonical editing through source viewport', () => {
    it.each([0, 7.85256216136421, 90])('pointer inverse twist %s° with large coordinates', twist => { const d = scene(), vp = { ...d.dxfLayouts![0]!.viewports[0]!, twist, scale: .5 }, paper = { center: { x: 130, y: 99 }, pixelsPerUnit: 3 }, camera = modelViewportCamera(vp, paper), p = { x: origin.x + 9, y: origin.y - 5 }, screen = worldToScreen(p, camera, size); const q = pointerModel(screen, vp, paper, size); expect(q.x).toBeCloseTo(p.x, 8); expect(q.y).toBeCloseTo(p.y, 8); });
    it('activation/exit keeps paper camera, source twist and canonical document', () => { let s = editorReducer(initialEditorState(scene()), { type: 'dxf-layout', layoutId: 'paper', size }); s = editorReducer(s, { type: 'layout-camera', viewport: { center: { x: 123, y: 89 }, pixelsPerUnit: 2 } }); const camera = s.layoutViewport, d = s.document; s = editorReducer(s, { type: 'viewport-editing', active: true, viewportId: 'vp1' }); expect(s.viewportEditing).toBe(true); s = editorReducer(s, { type: 'viewport-editing', active: false }); expect(s.layoutViewport).toBe(camera); expect(s.document).toBe(d); expect(isDocumentDirty(s)).toBe(false); });
    it('unsupported viewport cannot enter editing', () => { const d = scene(); d.dxfLayouts![0]!.viewports[0]!.unsupportedReason = 'nonrectangle'; const s = editorReducer({ ...initialEditorState(d), layoutId: 'paper', dxfViewportId: 'vp1' }, { type: 'viewport-editing', active: true }); expect(s.viewportEditing).toBe(false); expect(s.error).toBe('nonrectangle'); });
    it('rotate through viewport is canonical, preserves layout and one Undo', () => { const d = scene(); let s = editorReducer({ ...initialEditorState(d), layoutId: 'paper', dxfViewportId: 'vp1', viewportEditing: true }, { type: 'begin-selection-rotate', entityIds: ['line0'] }); expect(s.error).toBeNull(); s = editorReducer(s, { type: 'preview-selection-rotate', angleDeg: 20 }); s = editorReducer(s, { type: 'finish-selection-rotate' }); expect(s.error).toBeNull(); expect(s.document.vertices.a0).not.toEqual(d.vertices.a0); expect(s.document.dxfLayouts).toBe(d.dxfLayouts); expect(s.past).toHaveLength(1); s = editorReducer(s, { type: 'undo' }); expect(s.document).toBe(d); });
    it.each(['current_view', 'current_layout', 'active_viewport'] as const)('AI abstract %s binds locally without IDs', scope => { const d = scene(), s = { ...initialEditorState(d), layoutId: 'paper', dxfViewportId: 'vp1' }, p = resolveDocumentPlan([{ type: 'select_entities', query: { kind: 'entity_type', entityType: 'line', scope } }], d, [], 'plan', 'select', undefined, s); expect(p.error).toBeNull(); expect(p.matchedEntityIds).toHaveLength(scope === 'active_viewport' ? 3 : 4); expect(JSON.stringify(p.actions[0]!.intent)).not.toContain('vp1'); expect(isDocumentPlanStale(p, { ...s, viewportEditing: true })).toBe(true); });
});
function grid(): VectorPrimitive[] { const paint = { layerId: 'boundary', colorMode: 'bylayer' as const }; return [...[0, 10, 20].map(x => ({ ...paint, kind: 'path' as const, points: [{ x, y: 0 }, { x, y: 30 }], closed: false })), ...[0, 10, 20, 30].map(y => ({ ...paint, kind: 'path' as const, points: [{ x: 0, y }, { x: 20, y }], closed: false })), ...['Номер на плане', 'Наименование', '1', 'Дом', '2', 'Навес'].map((content, i) => ({ ...paint, kind: 'text' as const, position: { x: i % 2 ? 12 : 2, y: 25 - Math.floor(i / 2) * 10 }, content, height: 1, rotationDeg: 0 }))]; }
describe('bounded readonly exploded tables', () => {
    it('exact cell mapping with source spelling', () => { const r = detectGrid(grid())!; expect(r.rows).toEqual([['Номер на плане', 'Наименование'], ['1', 'Дом'], ['2', 'Навес']]); expect(r.confidence).toBe('STRONG'); });
    it('rotated grid retains cell mapping', () => { const angle = .37, c = Math.cos(angle), s = Math.sin(angle), p = (q: {
        x: number;
        y: number;
    }) => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c }), ps = grid().map(q => q.kind === 'path' ? { ...q, points: q.points.map(p) } : q.kind === 'text' ? { ...q, position: p(q.position) } : q); expect(detectGrid(ps)!.rows[1]).toEqual(['1', 'Дом']); });
    it('text without grid is not invented as table', () => expect(detectGrid(grid().filter(p => p.kind === 'text'))).toBeNull());
    it('geometry without cell text is not a table', () => expect(detectGrid(grid().filter(p => p.kind !== 'text'))).toBeNull());
    it('oversized detector work is explicitly bounded', () => expect(detectGrid(Array.from({ length: 12001 }, () => grid()[0]!))).toBeNull());
    it('uninstantiated definition is searchable and never becomes MODEL geometry', () => { const d = scene(); d.blocks = [{ id: 'table', sourceName: '*T35', basePoint: { x: 0, y: 0 }, primitives: grid() }]; const snapshot = JSON.stringify(d), t = documentTables(d)[0]!; expect(t.context).toBe('Block definition'); expect(t.instantiated).toBe(false); expect(t.explication).toEqual([{ number: '1', name: 'Дом' }, { number: '2', name: 'Навес' }]); expect(JSON.stringify(d)).toBe(snapshot); expect(documentTables(d)).toBe(documentTables(d)); });
});
it.skipIf(!process.env.DXF_REFERENCE)('reference hierarchy, actual scope counts, table location and exact building rows', () => { const b = readFileSync(process.env.DXF_REFERENCE!), d = importDxf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'reference.dxf').document; expect(d.entities).toHaveLength(458); expect(d.dxfLayouts!.map(l => l.viewports.length)).toEqual([2, 2, 3, 6, 2]); const t = documentTables(d).find(t => t.sourcePath.includes('*T35'))!; expect(t).toBeDefined(); expect(t.explication).toHaveLength(15); expect(t.instantiated).toBe(false); expect(t.explication[0]).toEqual({ number: '1', name: 'Блок-здание технологическое' }); });
it('active viewport Space pan and anchored zoom keep sheet/source intact and reset on exit', () => { let s = editorReducer(initialEditorState(scene()), { type: 'dxf-layout', layoutId: 'paper', size }); s = editorReducer(s, { type: 'layout-camera', viewport: { center: { x: 100, y: 100 }, pixelsPerUnit: 3 } }); s = editorReducer(s, { type: 'viewport-editing', active: true, viewportId: 'vp1' }); const sheet = s.layoutViewport!, doc = s.document, first = modelViewportCamera(activeDxfViewport(s)!, sheet, size), anchor = { x: 450, y: 325 }, fixed = screenToWorld(anchor, first, size); s = editorReducer(s, { type: 'zoom', size, anchor, factor: 2 }); const zoom = modelViewportCamera(activeDxfViewport(s)!, sheet, size); expect(screenToWorld(anchor, zoom, size)).toEqual(fixed); s = editorReducer(s, { type: 'pan', delta: { x: 30, y: 20 } }); const p = worldToScreen(fixed, modelViewportCamera(activeDxfViewport(s)!, sheet, size), size); expect(p.x).toBeCloseTo(480, 7); expect(p.y).toBeCloseTo(345, 7); expect(s.layoutViewport).toBe(sheet); expect(s.document).toBe(doc); expect(s.past).toHaveLength(0); s = editorReducer(s, { type: 'viewport-editing', active: false }); expect(s.viewportNavigation).toBeNull(); expect(s.layoutViewport).toBe(sheet); });
it('mixed readonly selection permits global layer visibility, preserves Freeze and drops hidden Paper selection', () => {
  const d = scene(), layerId = d.layers[0]!.id;
  let s = editorReducer({ ...initialEditorState(d), layoutId: 'paper', dxfViewportId: 'vp1' }, { type: 'selection-scope', scope: { kind: 'paper-visible', layoutId: 'paper' } });
  expect(s.selectedPaperIds).toHaveLength(1);
  s = editorReducer(s, { type: 'execute', command: { type: 'set-layer-visibility', layerId, visible: false } });
  expect(s.error).toBeNull(); expect(s.document.layers[0]!.visible).toBe(false); expect(s.selectedPaperIds).toEqual([]); expect(s.selectedEntityIds).toEqual([]);
  expect(s.document.dxfLayouts).toBe(d.dxfLayouts); expect(s.past).toHaveLength(1);
  s = editorReducer(s, { type: 'undo' }); expect(s.document).toBe(d);
});
it('a mixed entity/layer batch is blocked atomically; explicit MODEL selection clears readonly scope', () => {
  const d = scene(), layerId = d.layers[0]!.id;
  let s = editorReducer({ ...initialEditorState(d), layoutId: 'paper' }, { type: 'selection-scope', scope: { kind: 'paper-visible', layoutId: 'paper' } });
  s = editorReducer(s, { type: 'execute-batch', commands: [{ type: 'set-layer-visibility', layerId, visible: false }, { type: 'update-entity', entityId: 'line0', patch: { name: 'changed' } }] });
  expect(s.error).toContain('только для чтения'); expect(s.document).toBe(d); expect(s.past).toHaveLength(0);
  for (const action of [{ type: 'select-layer', layerId }, { type: 'select-layer-objects', layerId }, { type: 'deep-select', candidate: { ownerEntityId: 'line0', selection: null }, index: 0, count: 1 }] as const) {
    const selected = editorReducer(s, action); expect(selected.selectedPaperIds).toEqual([]); expect(selected.selectionScopeLabel).toBeNull();
    expect(editorReducer(selected, { type: 'execute', command: { type: 'update-entity', entityId: 'line0', patch: { name: 'changed' } } }).error).toBeNull();
  }
});
it('table index reuses unchanged geometry for global layer visibility but invalidates renamed layers and changed grid geometry', () => {
  const d = scene(); d.blocks = [{ id: 'table', sourceName: '*T35', basePoint: { x: 0, y: 0 }, primitives: grid() }];
  const first = documentTables(d);
  const hidden = { ...d, layers: d.layers.map(l => ({ ...l, visible: false })) };
  expect(documentTables(hidden)).toBe(first);
  const renamed = { ...d, layers: d.layers.map(l => ({ ...l, name: 'Renamed' })) };
  expect(documentTables(renamed)).not.toBe(first);
  const changed = { ...d, blocks: [{ ...d.blocks[0]!, primitives: grid().map(p => p.kind === 'text' && p.content === 'Дом' ? { ...p, content: 'Новый дом' } : p) }] };
  expect(documentTables(changed)[0]!.explication[0]!.name).toBe('Новый дом');
  expect(documentTables({ ...d, vertices: { ...d.vertices, a0: { ...d.vertices.a0!, x: origin.x + 1 } } })).not.toBe(first);
});
