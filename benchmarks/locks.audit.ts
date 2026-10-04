import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createNewDocument } from '../src/domain/newDocument';
import { lockedVertexIds } from '../src/domain/commands';

it('profiles shared-lock checks for 5000 selected path handles without a timing threshold', () => {
  const document = createNewDocument();
  for (let i = 0; i < 49999; i++) {
    const id = `v${i}`; document.vertices[id] = { id, x: i, y: 6189000 };
    document.entities.push({ type: 'point', id: `p${i}`, name: `P${i}`, layerId: 'survey-points', vertexId: id });
  }
  const ids: [string, string, ...string[]] = ['v0', 'v1', ...Array.from({ length: 4998 }, (_, i) => `v${i + 2}`)];
  document.entities.push({ type: 'polyline', id: 'path', name: 'Path', layerId: 'boundary', vertexIds: ids });
  const start = performance.now();
  const locked = lockedVertexIds(document);
  const editable = ids.filter(id => !locked.has(id)).length;
  const ms = performance.now() - start; expect(editable).toBe(5000);
  writeFileSync(`/private/tmp/geoservice-audit-locks-${process.env.AUDIT_LABEL ?? 'after'}.json`, JSON.stringify({ entities: 50000, handles: ids.length, editable, ms }, null, 2));
});
