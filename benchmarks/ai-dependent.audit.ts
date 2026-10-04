import { test, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createNewDocument } from '../src/domain/newDocument';
import { resolveAiTaskPlan, taskCommands, taskPreviews } from '../src/ai/task';
import { applyCommandsAtomically } from '../src/domain/commands';
import { initialEditorState, editorReducer } from '../src/store/editor';
import { serializeDocument } from '../src/persistence/serialization';
import { AiPreviewView } from '../src/renderer/AiPreviewView';
import type { AiTaskIntent } from '../src/ai/intent';
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
function fixture(points: number, edges: number) {
  const document = createNewDocument();
  for (let i = 0; i < points; i++) {
    const id = `v-${i}`, angle = i * Math.PI * 2 / edges;
    document.vertices[id] = { id, x: i < edges ? 562000 + 100 * Math.cos(angle) : 560000 + i,
      y: i < edges ? 6180000 + 100 * Math.sin(angle) : 6100000 + i };
    document.entities.push({ type: 'point', id: `p-${i}`, name: `P${i + 1}`, layerId: 'survey-points', vertexId: id });
  }
  const task: AiTaskIntent = { actions: [
    { type: 'create_boundary_from_named_points', pointNames: Array.from({ length: edges }, (_, i) => `P${i + 1}`) },
    { type: 'create_dimensions_for_boundary_edges', boundaryActionIndex: 0 },
  ] };
  return { document, task };
}
test('dependent bulk resolution/render/atomic Apply and retained snapshot memory (diagnostic medians)', () => {
  const rows = [];
  for (const points of [2000, 10000]) for (const edges of [4, 20, 50, 100]) {
    const { document, task } = fixture(points, edges), resolution = [], preview = [], apply = [];
    for (let iteration = 0; iteration < 8; iteration++) {
      const start = performance.now(), plan = resolveAiTaskPlan(task, document), resolved = performance.now();
      const markup = taskPreviews(plan).map(({ result }) => renderToStaticMarkup(createElement(AiPreviewView,
        { result, viewport: { center: { x: 562000, y: 6180000 }, pixelsPerUnit: 2 }, size: { width: 1200, height: 800 } }))).join('');
      const rendered = performance.now(), applied = applyCommandsAtomically(document, taskCommands(plan)), end = performance.now();
      expect(plan.resolution.status).toBe('ready'); expect(applied.entities).toHaveLength(points + edges + 1);
      expect(markup.match(/data-testid="ai-ghost"/g)).toHaveLength(edges + 1);
      if (iteration >= 3) { resolution.push(resolved - start); preview.push(rendered - resolved); apply.push(end - rendered); }
    }
    const plan = resolveAiTaskPlan(task, document), initial = initialEditorState(document);
    global.gc?.(); const heapBefore = process.memoryUsage().heapUsed;
    const state = editorReducer(initial, { type: 'execute-batch', commands: taskCommands(plan), expectedDocument: document });
    global.gc?.(); const retainedHeapDelta = process.memoryUsage().heapUsed - heapBefore;
    expect(state.past).toHaveLength(1); expect(state.past[0]).toBe(document); expect(state.document.vertices).toBe(document.vertices);
    rows.push({ points, edges, generatedCommands: edges + 1, resolveMedianMs: median(resolution), previewSsrMedianMs: median(preview), atomicApplyMedianMs: median(apply),
      snapshot: { historyEntries: state.past.length, sharedVertexRegistry: true, sharedOriginalEntities: document.entities.every((entity, i) => state.document.entities[i] === entity),
        serializedGrowthBytes: Buffer.byteLength(serializeDocument(state.document)) - Buffer.byteLength(serializeDocument(document)), retainedHeapDeltaBytes: retainedHeapDelta } });
  }
  const result = { node: process.version, architecture: process.arch, date: new Date().toISOString(), warmups: 3, samples: 5,
    previewMethod: 'SSR of existing AiPreviewView/DimensionView; excludes browser layout/paint', memoryMethod: 'post-GC heap delta, noisy; exact serialized growth and shared identities also reported', rows };
  writeFileSync('docs/audit-results/ai-dependent.json', JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
});
