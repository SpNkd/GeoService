import { it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createNewDocument } from '../src/domain/newDocument';
import { projectSelectionTransform, resolveSelectionTransform, selectionPivot } from '../src/domain/selectionTransform';
import { applyCommand } from '../src/domain/commands';
import { resolveEntityStyle } from '../src/styles/model';
import { initialEditorState, editorReducer } from '../src/store/editor';
import { importDxf } from '../src/dxf/import';
import type { GeoDocument } from '../src/domain/model';
function lines(n: number) { const d = createNewDocument(); d.metadata.id = 'benchmark'; for (let i = 0; i < n; i++) {
    d.vertices[`a${i}`] = { id: `a${i}`, x: i % 10 * 3, y: Math.floor(i / 10) * 3 };
    d.vertices[`b${i}`] = { id: `b${i}`, x: i % 10 * 3 + 2, y: Math.floor(i / 10) * 3 + 1 };
    d.entities.push({ id: `l${i}`, name: `Line ${i}`, type: 'line', layerId: 'boundary', startVertexId: `a${i}`, endVertexId: `b${i}` });
} return d; }
function timed(fn: () => unknown, n = 30) { const values = []; for (let i = 0; i < n; i++) {
    const start = performance.now();
    fn();
    values.push(performance.now() - start);
} values.sort((a, b) => a - b); return { medianMs: +values[Math.floor(n / 2)]!.toFixed(3), p95Ms: +values[Math.floor(n * .95)]!.toFixed(3), samples: n }; }
it('measures pure rotation and style workloads without speculative optimization', () => {
    const report: Record<string, unknown> = { date: '2026-10-06', method: 'Node pure resolver/preview/command timings; 30 samples, no browser/frame overhead.' };
    const polygon = lines(1);
    polygon.vertices.c = { id: 'c', x: 2, y: 2 };
    polygon.vertices.d = { id: 'd', x: 0, y: 2 };
    polygon.entities = [{ id: 'poly', name: 'Polygon', type: 'polygon', layerId: 'boundary', vertexIds: ['a0', 'b0', 'c', 'd'] }];
    const hundred = lines(100), shared = lines(20);
    shared.entities = shared.entities.map(e => e.type === 'line' ? { ...e, startVertexId: 'a0' } : e);
    const mixed = lines(20);
    mixed.entities = mixed.entities.map((e, i) => i % 4 === 0 ? { id: e.id, name: e.name, layerId: e.layerId, type: 'text', vertexId: `a${i}`, content: 'Text', fontSize: 12 } : i % 4 === 1 ? { id: e.id, name: e.name, layerId: e.layerId, type: 'symbol', libraryId: 'gas-process-demo', symbolId: 'filter', position: { x: i, y: 4 }, rotationDeg: 0, scale: 1 } : i % 4 === 2 ? { id: e.id, name: e.name, layerId: e.layerId, type: 'circle', center: { x: i, y: 2 }, radius: 1 } : e);
    const workloads: [
        string,
        GeoDocument
    ][] = [['polygon', polygon], ['100 simple entities', hundred], ['shared topology', shared], ['20 mixed entities', mixed]];
    for (const [name, d] of workloads) {
        const ids = d.entities.map(e => e.id), resolved = resolveSelectionTransform(d, ids, 'rotate'), pivot = selectionPivot(d, ids);
        report[`preview ${name}`] = timed(() => projectSelectionTransform(d, resolved, { kind: 'rotate', pivot, angleDeg: 37 }));
        report[`commit ${name}`] = timed(() => applyCommand(d, { type: 'transform-selection', entityIds: ids, transform: { kind: 'rotate', pivot, angleDeg: 37 } }));
    }
    report['style 100 selected'] = timed(() => applyCommand(hundred, { type: 'set-entity-style', entityIds: hundred.entities.map(e => e.id), patch: { strokeColor: '#24834B', lineType: 'dashed' } }));
    report['layer style + 100 ByLayer resolutions'] = timed(() => { const next = applyCommand(hundred, { type: 'set-layer-style', layerId: 'boundary', patch: { strokeColor: '#24834B', lineType: 'dashed' } }); next.entities.forEach(e => resolveEntityStyle(next, e)); expect(next.entities).toBe(hundred.entities); });
    const source = { ...hundred.entities[0]!, style: { strokeColor: '#24834B' } }, s = editorReducer({ ...initialEditorState({ ...hundred, entities: [source, ...hundred.entities.slice(1)] }), selectedEntityIds: hundred.entities.slice(1).map(e => e.id) }, { type: 'copy-style', entityId: source.id });
    report['Match 99 targets'] = timed(() => editorReducer(s, { type: 'paste-style' }));
    if (process.env.DXF_REFERENCE) {
        const bytes = readFileSync(process.env.DXF_REFERENCE), d = importDxf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'reference.dxf').document, e = d.entities.find(e => e.type === 'block_instance')!, r = resolveSelectionTransform(d, [e.id], 'rotate'), pivot = selectionPivot(d, [e.id]);
        report['reference block preview'] = timed(() => projectSelectionTransform(d, r, { kind: 'rotate', pivot, angleDeg: 37 }));
        const next = applyCommand(d, { type: 'transform-selection', entityIds: [e.id], transform: { kind: 'rotate', pivot, angleDeg: 37 } });
        expect(next.blocks).toBe(d.blocks);
        report['reference block commit'] = timed(() => applyCommand(d, { type: 'transform-selection', entityIds: [e.id], transform: { kind: 'rotate', pivot, angleDeg: 37 } }));
        report['reference layer style'] = timed(() => applyCommand(d, { type: 'set-layer-style', layerId: e.layerId, patch: { strokeColor: '#24834B' } }));
    }
    writeFileSync('/private/tmp/geoservice-transform-style-domain-performance.json', JSON.stringify(report, null, 2));
});
