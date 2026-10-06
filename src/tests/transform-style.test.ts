import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createNewDocument } from '../domain/newDocument';
import type { Entity, GeoDocument } from '../domain/model';
import { rotationDelta, resolveSelectionTransform, projectSelectionTransform, selectionPivot } from '../domain/selectionTransform';
import { applyCommand } from '../domain/commands';
import { editorReducer, initialEditorState, isDocumentDirty } from '../store/editor';
import { resolveEntityStyle, lineTypes, capturedStyle } from '../styles/model';
import { createVectorStyleResolver } from '../renderer/vectorStyle';
import { styleOverridesSchema, layerStyleSchema } from '../styles/schema';
import { serializeDocument, deserializeDocument } from '../persistence/serialization';
import { validateDocument } from '../persistence/documentSchema';
import { toolbarLayout } from '../editor/toolbarLayout';
import { importDxf } from '../dxf/import';
import { EntityView } from '../renderer/EntityView';
import { renderItems } from '../renderer/selectors';
import { connectorDocument } from './fixtures/connectorDocument';
import { VectorView } from '../renderer/VectorView';
import { visitEntityPrimitives } from '../view/geometry';
import { SelectionStyle } from '../components/StyleEditor';
import { connectorRoute } from '../connectors/model';
function fixture() { const d = createNewDocument(); d.vertices = { a: { id: 'a', x: 0, y: 0, z: 7 }, b: { id: 'b', x: 10, y: 0, z: 9 }, c: { id: 'c', x: 10, y: 10 }, e: { id: 'e', x: 0, y: 10 } }; d.entities = [{ id: 'poly', type: 'polygon', name: 'P', layerId: 'boundary', vertexIds: ['a', 'b', 'c', 'e'] }, { id: 'line', type: 'line', name: 'L', layerId: 'boundary', startVertexId: 'a', endVertexId: 'b' }]; return d; }
function rotate(d: GeoDocument, ids: string[], angleDeg = 90, pivot = { x: 0, y: 0 }) { return applyCommand(d, { type: 'transform-selection', entityIds: ids, transform: { kind: 'rotate', angleDeg, pivot } }); }
function independent(entity: Entity) { const d = fixture(); d.entities = [entity]; return d; }
const base = { id: 'x', name: 'X', layerId: 'boundary' };
describe('shared selection transforms', () => {
    it('polygon rotates canonical vertices', () => { const d = rotate(fixture(), ['poly']); expect(d.vertices.b!.x).toBeCloseTo(0); expect(d.vertices.b!.y).toBeCloseTo(10); });
    it('polyline rotates references', () => { const d = fixture(); d.entities = [{ ...base, type: 'polyline', vertexIds: ['a', 'b', 'c'] }]; expect(rotate(d, ['x']).vertices.c!.x).toBeCloseTo(-10); });
    it('line rotates endpoints', () => expect(rotate(fixture(), ['line']).vertices.b!.y).toBeCloseTo(10));
    it('shared vertex transforms once', () => expect(rotate(fixture(), ['poly', 'line']).vertices.b!.y).toBeCloseTo(10));
    it('group point follows its shared vertex once', () => { const d = fixture(); d.entities.push({ ...base, type: 'point', vertexId: 'b' }); expect(rotate(d, ['line', 'x']).vertices.b!.y).toBeCloseTo(10); });
    it('single point has no meaningless rotation', () => expect(() => rotate(independent({ ...base, type: 'point', vertexId: 'a' }), ['x'])).toThrow('самостоятельного'));
    it('MODEL Z stays exact', () => expect(rotate(fixture(), ['poly']).vertices.b!.z).toBe(9));
    it('arc center and radian angles rotate; radius stays', () => { const d = rotate(independent({ ...base, type: 'arc', center: { x: 10, y: 0 }, radius: 4, startAngle: 0, endAngle: Math.PI / 2 }), ['x']); expect(d.entities[0]).toMatchObject({ startAngle: Math.PI / 2, endAngle: Math.PI, radius: 4 }); });
    it('circle center rotates with a group', () => { const d = fixture(); d.entities.push({ ...base, type: 'circle', center: { x: 10, y: 0 }, radius: 2 }); expect(rotate(d, ['poly', 'x']).entities[2]).toMatchObject({ center: { y: 10 }, radius: 2 }); });
    it('single circle is a no-op and has no grip', () => expect(() => rotate(independent({ ...base, type: 'circle', center: { x: 0, y: 0 }, radius: 2 }), ['x'])).toThrow());
    it('text position and intrinsic rotation', () => { const d = rotate(independent({ ...base, type: 'text', vertexId: 'b', content: 'T', fontSize: 12, rotationDeg: 20 }), ['x']); expect(d.entities[0]).toMatchObject({ rotationDeg: 110 }); expect(d.vertices.b!.y).toBeCloseTo(10); });
    it('symbol anchor and rotation update without changing definition', () => { const d = rotate(independent({ ...base, type: 'symbol', libraryId: 'gas-process-demo', symbolId: 'filter', position: { x: 10, y: 0 }, rotationDeg: 0, scale: 1 }), ['x']); expect(d.entities[0]).toMatchObject({ rotationDeg: 90, symbolId: 'filter', position: { y: 10 } }); });
    it('block stays shared and does not explode', () => { const d = fixture(); d.blocks = [{ id: 'b', sourceName: 'B', basePoint: { x: 0, y: 0 }, primitives: [] }]; d.entities = [{ ...base, type: 'block_instance', blockDefinitionId: 'b', position: { x: 10, y: 0 }, rotationDeg: 0, scaleX: 1, scaleY: 1 }]; const next = rotate(d, ['x']); expect(next.entities).toHaveLength(1); expect(next.blocks).toBe(d.blocks); expect(next.entities[0]).toMatchObject({ rotationDeg: 90 }); });
    it('raster anchor rotates and asset remains', () => { const d = rotate(independent({ ...base, type: 'raster_underlay', assetId: 'asset', position: { x: 10, y: 0 }, width: 20, height: 10, opacity: .4, locked: false, rotationDeg: 0 }), ['x']); expect(d.entities[0]).toMatchObject({ assetId: 'asset', rotationDeg: 90, width: 20, position: { y: 10 } }); });
    it('proxy primitives rotate in local coordinates', () => { const d = rotate(independent({ ...base, type: 'imported_graphic', position: { x: 0, y: 0 }, primitives: [{ kind: 'path', layerId: 'boundary', colorMode: 'bylayer', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false }] }), ['x']); expect(d.entities[0]).toMatchObject({ primitives: [{ points: [{ y: 0 }, { y: 10 }] }] }); });
    it('associative dimensions keep references and offset', () => { const d = fixture(); d.entities.push({ ...base, type: 'dimension', startVertexId: 'a', endVertexId: 'b', offset: 2 }); expect(rotate(d, ['line', 'x']).entities[2]).toEqual(d.entities[2]); });
    it('label follows target and rotated offset', () => { const d = fixture(); d.entities.push({ ...base, type: 'label', targetId: 'line', template: 'L', dx: 2, dy: 3 }); expect(rotate(d, ['line']).entities[2]).toMatchObject({ dx: -3, dy: 2 }); });
    it('selected label rotates around pivot without editing target', () => { const d = fixture(); d.entities.push({ ...base, type: 'label', targetId: 'line', template: 'L', dx: 2, dy: 3 }); const next = rotate(d, ['x']); expect(next.vertices).toEqual(d.vertices); expect(next.entities[2]).toMatchObject({ dx: -8, dy: 7 }); });
    it('connector route follows rotated symbols and is not transformed twice', () => { const d = connectorDocument(), connection = d.entities.find(e => e.type === 'connector')!; const next = rotate(d, ['valve', 'filter', connection.id], 30); expect(next.entities.find(e => e.id === connection.id)).toEqual(connection); expect(connectorRoute(next, connection)).not.toEqual(connectorRoute(d, connection)); });
    it('locked dependent connector blocks rotation atomically', () => { const d = connectorDocument(); d.layers = d.layers.map(l => l.id === 'annotations' ? { ...l, locked: true } : l); expect(() => rotate(d, ['valve'], 30)).toThrow('заблокированный'); });
    it('connector style preserves routing and endpoints', () => { const d = connectorDocument(), e = d.entities.find(e => e.type === 'connector')!, next = applyCommand(d, { type: 'set-entity-style', entityIds: [e.id], patch: { lineType: 'dash_dot', strokeColor: '#24834B' } }); expect(next.entities.find(t => t.id === e.id)).toMatchObject({ start: e.start, end: e.end, routing: e.routing }); expect(connectorRoute(next, next.entities.find(t => t.id === e.id)! as typeof e)).toEqual(connectorRoute(d, e)); });
    it('locked shared consumer blocks entire command', () => { const d = fixture(); d.layers[1] = { ...d.layers[1]!, locked: true }; d.entities[1] = { ...d.entities[1]!, layerId: d.layers[1]!.id }; expect(() => rotate(d, ['poly'])).toThrow('заблокирован'); expect(d.vertices.b!.x).toBe(10); });
    it('rotation snap uses 15 degrees including negative', () => { expect(rotationDelta(0, 23 * Math.PI / 180, true)).toBe(30); expect(rotationDelta(0, -23 * Math.PI / 180, true)).toBe(-30); });
    it('pointer wrap chooses nearest delta', () => expect(rotationDelta(179 * Math.PI / 180, -179 * Math.PI / 180)).toBeCloseTo(2));
    it('pivot defaults to combined center', () => expect(selectionPivot(fixture(), ['poly', 'line'])).toEqual({ x: 5, y: 5 }));
    it('preview starts from immutable snapshot, not previous frame', () => { const d = fixture(), r = resolveSelectionTransform(d, ['poly'], 'rotate'); projectSelectionTransform(d, r, { kind: 'rotate', pivot: { x: 0, y: 0 }, angleDeg: 20 }); expect(projectSelectionTransform(d, r, { kind: 'rotate', pivot: { x: 0, y: 0 }, angleDeg: 90 }).vertices.b!.y).toBeCloseTo(10); expect(d.vertices.b!.x).toBe(10); });
    it('drag preview does not change document, history or dirty', () => { const s = initialEditorState(fixture()), preview = editorReducer(editorReducer(s, { type: 'begin-selection-rotate', entityIds: ['poly'] }), { type: 'preview-selection-rotate', angleDeg: 37 }); expect(preview.document).toBe(s.document); expect(preview.past).toHaveLength(0); expect(isDocumentDirty(preview)).toBe(false); });
    it('commit is one history step and Undo/Redo restore exact snapshots', () => { const s = initialEditorState(fixture()), r = editorReducer(editorReducer(editorReducer(s, { type: 'begin-selection-rotate', entityIds: ['poly'] }), { type: 'preview-selection-rotate', angleDeg: 37 }), { type: 'finish-selection-rotate' }); expect(r.error).toBeNull(); expect(r.past).toHaveLength(1); expect(editorReducer(r, { type: 'undo' }).document).toEqual(s.document); expect(editorReducer(editorReducer(r, { type: 'undo' }), { type: 'redo' }).document).toEqual(r.document); });
    it('Escape cancellation retains snapshot', () => { const s = initialEditorState(fixture()), r = editorReducer(editorReducer(editorReducer(s, { type: 'begin-selection-rotate', entityIds: ['poly'] }), { type: 'preview-selection-rotate', angleDeg: 37 }), { type: 'cancel-transaction' }); expect(r.document).toBe(s.document); expect(r.selectionRotate).toBeNull(); expect(r.past).toHaveLength(0); });
    it('zero/full revolution has no history', () => { const s = initialEditorState(fixture()); expect(editorReducer(s, { type: 'execute', command: { type: 'transform-selection', entityIds: ['poly'], transform: { kind: 'rotate', pivot: { x: 0, y: 0 }, angleDeg: 360 } } }).past).toHaveLength(0); });
    it('Axon rejects free rotation', () => { const s = { ...initialEditorState(fixture()), viewMode: 'axonometric' as const }; expect(editorReducer(s, { type: 'begin-selection-rotate', entityIds: ['poly'] }).error).toContain('вокруг оси Z'); });
});
describe('CAD style and source precedence', () => {
    it('layer style resolves without copying into entity', () => { const d = fixture(); d.layers[0] = { ...d.layers[0]!, style: { strokeColor: '#24834B', lineType: 'dashed', lineWidth: 3 } }; expect(resolveEntityStyle(d, d.entities[0]!)).toMatchObject({ stroke: '#24834B', dash: '8 4', lineWeight: 3 }); expect(d.entities[0]!.style).toBeUndefined(); });
    it('entity override wins layer', () => { const d = fixture(); d.layers[0] = { ...d.layers[0]!, style: { strokeColor: '#24834B' } }; d.entities[0] = { ...d.entities[0]!, style: { strokeColor: '#246BCC' } }; expect(resolveEntityStyle(d, d.entities[0]!).stroke).toBe('#246BCC'); });
    it('explicit ByLayer returns to dynamic layer', () => { let d = fixture(); d = applyCommand(d, { type: 'set-entity-style', entityIds: ['poly'], patch: { strokeColor: null } }); d = applyCommand(d, { type: 'set-layer-style', layerId: 'boundary', patch: { strokeColor: '#D34444' } }); expect(resolveEntityStyle(d, d.entities[0]!).stroke).toBe('#D34444'); });
    it('imported explicit primitive remains original until intentional override', () => { const d = fixture(), p = { layerId: 'boundary', colorMode: 'explicit' as const, stroke: '#AA1234' }; expect(createVectorStyleResolver(d, d.entities[0]!)(p, { stroke: '#000', lineWeight: 1, dash: undefined }).stroke).toBe('#AA1234'); const next = applyCommand(d, { type: 'set-layer-style', layerId: 'boundary', patch: { strokeColor: '#24834B' } }); expect(createVectorStyleResolver(next, next.entities[0]!)(p, { stroke: '#000', lineWeight: 1, dash: undefined }).stroke).toBe('#24834B'); });
    it('primitive ByBlock inheritance remains source baseline', () => { const d = fixture(); expect(createVectorStyleResolver(d)({ layerId: 'boundary', colorMode: 'byblock' }, { stroke: '#AA1234', lineWeight: 2, dash: '5 2' }).stroke).toBe('#AA1234'); });
    it.each(lineTypes)('catalog $id resolves one SVG/Canvas dash', type => { const d = applyCommand(fixture(), { type: 'set-entity-style', entityIds: ['line'], patch: { lineType: type.id } }), e = d.entities[1]!; expect(resolveEntityStyle(d, e).dash).toBe(type.dash); expect(createVectorStyleResolver(d, e)({ layerId: 'boundary', colorMode: 'byblock' }, { stroke: '#000', lineWeight: 1, dash: undefined }).dash).toBe(type.dash); });
    it('width opacity and polygon fill resolve', () => { const d = applyCommand(fixture(), { type: 'set-entity-style', entityIds: ['poly'], patch: { lineWidth: 4, opacity: .4, fillColor: '#24834B', fillOpacity: .25 } }); expect(resolveEntityStyle(d, d.entities[0]!)).toMatchObject({ lineWeight: 4, opacity: .4, fill: '#24834B', fillOpacity: .25 }); });
    it('text and dimension visual settings resolve', () => { const d = independent({ ...base, type: 'text', vertexId: 'a', content: 'X', fontSize: 12, style: { textColor: '#246BCC', textSize: 24, opacity: .5 } }); expect(resolveEntityStyle(d, d.entities[0]!)).toMatchObject({ textColor: '#246BCC', textSize: 24, opacity: .5 }); });
    it('bulk style change is one atomic history step', () => { const s = editorReducer(initialEditorState(fixture()), { type: 'execute', command: { type: 'set-entity-style', entityIds: ['poly', 'line'], patch: { strokeColor: '#24834B' } } }); expect(s.past).toHaveLength(1); expect(s.document.entities.every(e => e.style?.strokeColor === '#24834B')).toBe(true); });
    it('locked bulk style fails atomically', () => { const d = fixture(); d.layers[0] = { ...d.layers[0]!, locked: true }; expect(() => applyCommand(d, { type: 'set-entity-style', entityIds: ['poly', 'line'], patch: { strokeColor: '#24834B' } })).toThrow('заблокирован'); expect(d.entities[0]!.style).toBeUndefined(); });
    it('unsupported raster vector styles reject explicitly', () => expect(() => applyCommand(independent({ ...base, type: 'raster_underlay', assetId: 'a', position: { x: 0, y: 0 }, width: 10, height: 10, opacity: .6, rotationDeg: 0, locked: false }), { type: 'set-entity-style', entityIds: ['x'], patch: { strokeColor: '#24834B' } })).toThrow('не поддерживает'));
    it('ByLayer is captured semantically', () => expect(capturedStyle({ ...fixture().entities[1]!, style: { strokeColor: null, lineType: 'dashed' } })).toMatchObject({ strokeColor: null, lineType: 'dashed' }));
    it('Match copies only visual fields with one Undo', () => { let s = initialEditorState(fixture()); s.document.entities[0] = { ...s.document.entities[0]!, style: { strokeColor: '#24834B', lineType: 'dashed' } }; s = editorReducer(s, { type: 'copy-style', entityId: 'poly' }); s = { ...s, selectedEntityIds: ['line'] }; const next = editorReducer(s, { type: 'paste-style' }); expect(next.error).toBeNull(); expect(next.past).toHaveLength(1); expect(next.document.entities[1]).toMatchObject({ name: 'L', layerId: 'boundary', style: { strokeColor: '#24834B', lineType: 'dashed' } }); expect(next.document.vertices).toEqual(s.document.vertices); });
    it('layer change leaves canonical entities untouched', () => { const d = fixture(); expect(applyCommand(d, { type: 'set-layer-style', layerId: 'boundary', patch: { lineType: 'dashed' } }).entities).toBe(d.entities); });
    it('source reset leaves provenance intact', () => { const d = fixture(); d.entities[1] = { ...d.entities[1]!, source: { kind: 'dxf', sourceDocumentId: 'source', originalLayer: 'SOURCE', originalType: 'LINE' }, style: { strokeColor: '#24834B' } }; const next = applyCommand(d, { type: 'reset-entity-style', entityIds: ['line'] }); expect(next.entities[1]!.style).toBeUndefined(); expect(next.entities[1]!.source).toEqual(d.entities[1]!.source); });
    it('current preset reaches normal creation and persists between tools', () => { let s = editorReducer(initialEditorState(createNewDocument()), { type: 'current-style', patch: { strokeColor: '#24834B', lineType: 'dashed' } }); s = editorReducer(s, { type: 'tool', tool: 'polygon' }); s = editorReducer(s, { type: 'execute', command: { type: 'add-entity', entity: { ...base, type: 'line', startVertexId: 'a', endVertexId: 'b' }, vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }] } }); expect(s.document.entities[0]!.style).toMatchObject({ lineType: 'dashed' }); expect(s.currentStyle.strokeColor).toBe('#24834B'); });
    it('rejects unsafe CSS, unknown line catalog and invalid budgets', () => { for (const patch of [{ strokeColor: 'url(x)' }, { lineType: 'hacked' }, { lineWidth: 0 }, { opacity: 2 }, { textSize: NaN }])
        expect(styleOverridesSchema.safeParse(patch).success).toBe(false); });
    it('normalizes hex and refuses null layer defaults', () => { expect(layerStyleSchema.parse({ strokeColor: '#aabbcc' }).strokeColor).toBe('#AABBCC'); expect(layerStyleSchema.safeParse({ strokeColor: null }).success).toBe(false); });
    it('Save/Open roundtrip includes sparse style intent and transformed geometry', () => { let d = rotate(fixture(), ['poly'], 37); d = applyCommand(d, { type: 'set-layer-style', layerId: 'boundary', patch: { lineType: 'dashed' } }); d = applyCommand(d, { type: 'set-entity-style', entityIds: ['line'], patch: { strokeColor: null } }); expect(deserializeDocument(serializeDocument(d))).toEqual(d); });
    it('legacy document remains valid without style metadata', () => { const d = fixture(); expect(validateDocument(d)).toEqual(d); });
    it('resolved style cache is stable for unrelated document metadata', () => { const d = fixture(), e = d.entities[0]!; expect(resolveEntityStyle({ ...d, metadata: { ...d.metadata, title: 'New' } }, e)).toBe(resolveEntityStyle(d, e)); });
    it('native SVG uses unified dash, width, fill and opacity', () => { const d = applyCommand(fixture(), { type: 'set-entity-style', entityIds: ['poly'], patch: { lineType: 'dashed', opacity: .4, lineWidth: 4, fillColor: '#24834B' } }), item = renderItems(d)[0]!; const html = renderToStaticMarkup(createElement(EntityView, { item, document: d, viewport: d.viewport, size: { width: 1000, height: 700 }, selected: false })); expect(html).toContain('stroke-dasharray="8 4"'); expect(html).toContain('opacity="0.4"'); expect(html).toContain('fill="#24834B"'); });
});
describe('toolbar packing and DXF navigation', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ id: String(i), width: 90, compactWidth: 34, priority: i < 7 ? 0 : 1, compactable: i >= 7 }));
    it.each([1920, 1600, 1440, 1366, 1280, 1024])('packs %s without dropping commands', width => { const result = toolbarLayout(width, items); expect(result.used).toBeLessThanOrEqual(result.budget); expect(new Set([...result.visible, ...result.overflow]).size).toBe(items.length); expect(result.visible.slice(0, 7)).toEqual(items.slice(0, 7).map(i => i.id)); });
    it('viewport focus and paper navigation preserve document/history/visibility', () => { const d = importDxf(new TextEncoder().encode(readFileSync('src/tests/fixtures/dxf/layouts.dxf', 'utf8')).buffer, 'layouts.dxf').document, s = initialEditorState(d), layout = d.dxfLayouts![0]!, v = layout.viewports[1]!, next = editorReducer(s, { type: 'fit-dxf-viewport', layoutId: layout.id, viewportId: v.id, size: { width: 1000, height: 700 } }); expect(next.dxfViewportId).toBe(v.id); expect(next.layoutViewport!.center).toEqual(v.centerPaper); expect(next.document).toBe(d); expect(next.past).toHaveLength(0); expect(isDocumentDirty(next)).toBe(false); expect(editorReducer(next, { type: 'dxf-layout', layoutId: null, size: { width: 1000, height: 700 } }).layoutId).toBeNull(); });
    it('navigation is blocked while transforming', () => { const s = editorReducer(initialEditorState(fixture()), { type: 'begin-selection-rotate', entityIds: ['poly'] }); expect(editorReducer(s, { type: 'dxf-layout', layoutId: 'invalid', size: { width: 1000, height: 700 } }).layoutId).toBeNull(); });
    it('source paper style remains and multiple viewport data survives styles', () => { const d = importDxf(new TextEncoder().encode(readFileSync('src/tests/fixtures/dxf/layouts.dxf', 'utf8')).buffer, 'layouts.dxf').document; const next = applyCommand(d, { type: 'set-layer-style', layerId: d.layers[0]!.id, patch: { strokeColor: '#24834B' } }); expect(next.dxfLayouts).toBe(d.dxfLayouts); expect(next.layers.map(l => l.visible)).toEqual(d.layers.map(l => l.visible)); });
});
describe('style parity and legacy intent', () => {
    it('Match preserves legacy explicit visual values and inherits the other properties', () => {
        const d = fixture(), layer = d.layers[0]!, baseline = d.styles.find(s => s.id === layer.styleId)!;
        d.styles.push({ ...baseline, id: 'legacy-explicit', stroke: '#24834B', dash: '8 4', lineWeight: 4 });
        const source = { ...d.entities[1]!, styleId: 'legacy-explicit' };
        expect(capturedStyle(source, d)).toMatchObject({ strokeColor: '#24834B', lineType: 'dashed', lineWidth: 4, opacity: null });
    });
    it('Axon native polygon filling follows the current resolved style including none', () => {
        const d = applyCommand(fixture(), { type: 'set-entity-style', entityIds: ['poly'], patch: { fillColor: 'none' } }), e = d.entities[0]!, style = resolveEntityStyle(d, e), filled: boolean[] = [];
        visitEntityPrimitives(d, e, { stroke: style.stroke, lineWeight: style.lineWeight, dash: style.dash, fill: style.fill }, part => { if (part.primitive.kind === 'path')
            filled.push(!!part.primitive.fill); });
        expect(filled).toEqual([false]);
        const colored = applyCommand(d, { type: 'set-entity-style', entityIds: ['poly'], patch: { fillColor: '#246BCC' } }), c = resolveEntityStyle(colored, colored.entities[0]!);
        visitEntityPrimitives(colored, colored.entities[0]!, { stroke: c.stroke, lineWeight: c.lineWeight, dash: c.dash, fill: c.fill }, part => { expect(part.primitive).toMatchObject({ fill: true }); expect(part.paint.fill).toBe('#246BCC'); });
    });
    it('SVG compound source HATCH combines owner opacity and fill opacity', () => {
        const e: Entity = { ...base, type: 'imported_graphic', position: { x: 0, y: 0 }, style: { strokeColor: '#D34444', opacity: .5 }, primitives: [{ kind: 'path', layerId: 'boundary', colorMode: 'explicit', stroke: '#24834B', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: true, fill: true, fillGroup: 'hatch', fillOpacity: .4 }] }, d = independent(e);
        const html = renderToStaticMarkup(createElement(VectorView, { entity: e, document: d, viewport: d.viewport, size: { width: 1000, height: 700 }, color: '#000000', selected: false }));
        expect(html).toContain('fill-opacity="0.2"');
        expect(html).toContain('fill-rule="evenodd"');
        expect(html).toContain('fill="#D34444"');
    });
    it('import inspector makes Source distinct from explicit ByLayer', () => {
        const d = fixture();
        d.entities[1] = { ...d.entities[1]!, source: { kind: 'dxf', sourceDocumentId: 'source', originalType: 'LINE', originalLayer: 'SOURCE' } };
        const state = { ...initialEditorState(d), selectedEntityIds: ['line'] };
        const html = renderToStaticMarkup(createElement(SelectionStyle, { state, dispatch: () => { } }));
        expect(html).toContain('value="source" disabled="" selected=""');
        expect(html).toContain('Источник DXF');
        expect(html).toContain('value="inherit"');
    });
    it('mixed style edit explicitly reports a skipped Symbol and is one Undo', () => {
        const d = fixture();
        d.entities.push({ ...base, type: 'symbol', libraryId: 'gas-process-demo', symbolId: 'filter', position: { x: 0, y: 0 }, rotationDeg: 0, scale: 1 });
        const s = { ...initialEditorState(d), selectedEntityIds: ['line', 'x'] }, next = editorReducer(s, { type: 'apply-selection-style', patch: { strokeColor: '#24834B' } });
        expect(next.error).toContain('пропущено несовместимых объектов: 1');
        expect(next.past).toHaveLength(1);
        expect(next.document.entities[2]).toBe(d.entities[2]);
        expect(editorReducer(next, { type: 'undo' }).document).toBe(d);
    });
});


describe('absolute intrinsic rotation',()=>{
 it('absolute block rotation migrates legacy ATTRIB while keeping insertion and definitions',()=>{
  const d=fixture();d.sources=[{id:'source',filename:'legacy.dxf',format:'DXF',dxfVersion:'AC1015',encoding:'utf8',originalUnits:6}];d.blocks=[{id:'def',sourceName:'DEF',basePoint:{x:0,y:0},primitives:[]}];
  const owner:Entity={...base,type:'block_instance',position:{x:10,y:20},blockDefinitionId:'def',scaleX:1,scaleY:1,rotationDeg:0,attributePrimitives:[{kind:'text',layerId:'boundary',colorMode:'byblock',content:'A',height:1,rotationDeg:0,position:{x:2,y:0},source:{kind:'dxf',sourceDocumentId:'source',originalType:'ATTRIB',originalLayer:'0'}}]};d.entities=[owner];
  const next=applyCommand(d,{type:'update-entity',entityId:'x',patch:{rotationDeg:90}});
  expect(next.blocks).toBe(d.blocks);expect(next.entities[0]).toMatchObject({position:{x:10,y:20},rotationDeg:90,attributeCoordinateSpace:'block-local',attributePrimitives:[{position:{x:2,y:0}}]});
 });
 it('absolute Text changes orientation around its own anchor',()=>{
  const d=independent({...base,type:'text',vertexId:'b',content:'T',fontSize:14});
  const next=applyCommand(d,{type:'update-entity',entityId:'x',patch:{rotationDeg:37}});expect(next.vertices).toEqual(d.vertices);expect(next.entities[0]).toMatchObject({rotationDeg:37});
 });
 it('absolute Symbol rotation rejects a locked associated connector atomically',()=>{
  const d=connectorDocument();d.layers=d.layers.map(l=>l.id==='annotations'?{...l,locked:true}:l);
  expect(()=>applyCommand(d,{type:'update-entity',entityId:'valve',patch:{rotationDeg:30}})).toThrow('заблокированный');
 });
});

it('non-themeable Symbol layer color intent is conservative; supported opacity still applies',()=>{
 const d=independent({...base,type:'symbol',libraryId:'gas-process-demo',symbolId:'filter',position:{x:0,y:0},rotationDeg:0,scale:1}),baseline=resolveEntityStyle(d,d.entities[0]!);
 const next=applyCommand(d,{type:'set-layer-style',layerId:'boundary',patch:{strokeColor:'#D34444',lineType:'dotted',opacity:.4,lineWidth:4}}),resolved=resolveEntityStyle(next,next.entities[0]!);
 expect(resolved.stroke).toBe(baseline.stroke);expect(resolved.dash).toBe(baseline.dash);expect(resolved).toMatchObject({opacity:.4,lineWeight:4});
});

it('explicit ByLayer retains an arbitrary imported layer dash in native and primitive paths',()=>{
 const d=fixture(),layer=d.layers[0]!,baseStyle=d.styles.find(s=>s.id===layer.styleId)!;d.styles=d.styles.map(s=>s===baseStyle?{...s,dash:'13 7'}:s);d.styles.push({...baseStyle,id:'explicit-dash',dash:'3 1'});d.entities[1]={...d.entities[1]!,styleId:'explicit-dash'};
 const next=applyCommand(d,{type:'set-entity-style',entityIds:['line'],patch:{lineType:null}}),owner=next.entities[1]!;
 expect(resolveEntityStyle(next,owner).dash).toBe('13 7');expect(createVectorStyleResolver(next,owner)({layerId:'boundary',colorMode:'explicit',dash:'3 1'},{stroke:'#000',lineWeight:1,dash:undefined}).dash).toBe('13 7');
 const changed=applyCommand(next,{type:'set-layer-style',layerId:'boundary',patch:{lineType:'dashed'}});expect(resolveEntityStyle(changed,changed.entities[1]!).dash).toBe('8 4');
});
