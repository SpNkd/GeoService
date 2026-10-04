import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { createNewDocument } from '../src/domain/newDocument';
import type { GeoDocument } from '../src/domain/model';
import { applyCommand } from '../src/domain/commands';
import { documentFingerprint, serializeDocument } from '../src/persistence/serialization';
import { editorReducer, initialEditorState, isDocumentDirty } from '../src/store/editor';
import { polygonSelfIntersects } from '../src/geometry/survey';
import { createSnapProvider, DEFAULT_SNAP_OPTIONS, findSnapCandidate } from '../src/snapping';

function fixture(count: number): GeoDocument {
  const d = createNewDocument(); d.metadata.id = 'profile';
  for (let i = 0; i < count; i++) {
    const id = `v${i}`;
    d.vertices[id] = { id, x: 562000 + (i % 250) * 5, y: 6189000 + Math.floor(i / 250) * 5, z: 100 };
    d.entities.push({ id: `p${i}`, name: `P${i}`, type: 'point', layerId: 'survey-points', vertexId: id });
  }
  return d;
}
function timed<T>(fn: () => T) { const start = performance.now(); const result = fn(); return { ms: performance.now() - start, result }; }
function stats(values: number[]) { const sorted = [...values].sort((a, b) => a - b); return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)] }; }

it('records explicit core audit measurements without timing pass/fail thresholds', () => {
  const history = [], snapping = [];
  for (const count of [1000, 10000, 50000]) {
    const document = fixture(count);
    writeFileSync(`/private/tmp/geoservice-profile-${count}.json`, JSON.stringify(document));
    let state = initialEditorState(document);
    global.gc?.(); const heapBefore = process.memoryUsage().heapUsed;
    const execute: number[] = [], undo: number[] = [], redo: number[] = [];
    for (let i = 0; i < 20; i++) {
      const next = timed(() => editorReducer(state, { type: 'execute', command: { type: 'move-vertex', vertexId: 'v0', delta: { x: .01, y: 0 } } }));
      execute.push(next.ms); state = next.result;
    }
    global.gc?.(); const retainedHeapMiB = (process.memoryUsage().heapUsed - heapBefore) / 1024 ** 2;
    const docs = [...state.past, state.document], registries = new Set(docs.map(d => d.vertices));
    const vertices = new Set(docs.flatMap(d => Object.values(d.vertices))), entities = new Set(docs.flatMap(d => d.entities));
    for (let i = 0; i < 20; i++) { const next = timed(() => editorReducer(state, { type: 'undo' })); undo.push(next.ms); state = next.result; }
    expect(state.document).toBe(document);
    for (let i = 0; i < 20; i++) { const next = timed(() => editorReducer(state, { type: 'redo' })); redo.push(next.ms); state = next.result; }
    const fingerprints = Array.from({ length: 10 }, () => timed(() => documentFingerprint(state.document)).ms);
    let serializeError: string | null = null;
    const serialization = Array.from({ length: 5 }, () => timed(() => { try { return serializeDocument(state.document); } catch (error) { serializeError = String(error); return null; } }).ms);
    const transient = editorReducer(state, { type: 'begin-transaction' });
    const changed = editorReducer(transient, { type: 'transient', command: { type: 'move-vertex', vertexId: 'v0', delta: { x: 1, y: 0 } } });
    const dirty = timed(() => isDocumentDirty(changed));
    history.push({ count, actions: 20, executeMs: stats(execute), undoMs: stats(undo), redoMs: stats(redo),
      retainedHeapMiB, registryObjects: registries.size, uniqueVertexObjects: vertices.size, uniqueEntityObjects: entities.size,
      fingerprintMs: stats(fingerprints), serializeMs: stats(serialization), transientDirtyMs: dirty.ms, jsonBytes: Buffer.byteLength(JSON.stringify(document)), serializeError, gcAvailable: Boolean(global.gc) });
    const provider = timed(() => createSnapProvider(document));
    const viewport = { center: { x: 562000, y: 6189000 }, pixelsPerUnit: 10 };
    for (let i = 0; i < 100; i++) findSnapCandidate(document.vertices.v0!, provider.result, viewport, DEFAULT_SNAP_OPTIONS);
    const query = Array.from({ length: 1000 }, (_, i) => timed(() => findSnapCandidate(document.vertices[`v${(i * 37) % count}`]!, provider.result, viewport, DEFAULT_SNAP_OPTIONS)).ms);
    snapping.push({ count, buildMs: provider.ms, queryMs: stats(query) });
    expect(applyCommand(document, { type: 'set-layer-lock', layerId: 'survey-points', locked: true }).layers[2]!.locked).toBe(true);
  }
  const polygons = [100, 1000, 5000].map(count => {
    const points = Array.from({ length: count }, (_, i) => ({ x: 562000 + 100 * Math.cos(i * 2 * Math.PI / count), y: 6189000 + 100 * Math.sin(i * 2 * Math.PI / count) }));
    const runs = Array.from({ length: 3 }, () => { const run = timed(() => polygonSelfIntersects(points)); expect(run.result).toBe(false); return run.ms; });
    return { count, ms: stats(runs), case: 'simple convex ring (no crossing; scans all pairs)' };
  });
  const report = { cpu: cpus()[0]?.model, node: process.version, history, snapping, polygons,
    note: 'Execute includes mutation + history bookkeeping; GC heap delta is approximate retained V8 heap, not browser/RSS. No timing assertions.' };
  writeFileSync(`/private/tmp/geoservice-audit-core-${process.env.AUDIT_LABEL ?? 'after'}.json`, JSON.stringify(report, null, 2));
});
