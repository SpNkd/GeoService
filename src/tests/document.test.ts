import { describe, expect, it } from 'vitest';
import { applyCommand } from '../domain/commands';
import { createSampleDocument } from '../sample/document';
import { editorReducer, initialEditorState } from '../store/editor';
import { renderItems, visibleBounds } from '../renderer/selectors';
import { polygonArea } from '../geometry';

describe('canonical document and command boundary', () => {
  it('has unique stable IDs, valid references and canonical sample geometry', () => {
    const document = createSampleDocument();
    expect(new Set(document.entities.map(e => e.id)).size).toBe(document.entities.length);
    expect(new Set(document.layers.map(l => l.id)).size).toBe(document.layers.length);
    for (const entity of document.entities) {
      expect(document.layers.some(layer => layer.id === entity.layerId)).toBe(true);
      if (entity.styleId) expect(document.styles.some(style => style.id === entity.styleId)).toBe(true);
    }
    for (const layer of document.layers) expect(document.styles.some(style => style.id === layer.styleId)).toBe(true);
    expect(new Set(document.entities.map(entity => entity.type))).toEqual(new Set(['point', 'line', 'polyline', 'polygon', 'text']));
    const building = document.entities.find(e => e.id === 'building-01')!;
    expect(building.type === 'polygon' && polygonArea(building.vertices)).toBe(216);
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });
  it('updates precise point coordinates immutably', () => {
    const document = createSampleDocument();
    const next = applyCommand(document, { type: 'set-point-position', entityId: 'sp1', position: { x: 562341.234123456, y: 6189345.2212345, z: 152.3400123 } });
    const entity = next.entities.find(e => e.id === 'sp1')!;
    expect(entity.type === 'point' && entity.position.x).toBe(562341.234123456);
    expect(document.entities.find(e => e.id === 'sp1')).not.toEqual(entity);
    expect(next.layers).toBe(document.layers);
    expect(next.entities[0]).toBe(document.entities[0]);
  });
  it('rejects missing entities, invalid coordinates and wrong entity types', () => {
    const document = createSampleDocument();
    expect(() => applyCommand(document, { type: 'set-point-position', entityId: 'missing', position: { x: 0, y: 0 } })).toThrow();
    for (const position of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: 0, y: 0, z: -Infinity }]) {
      expect(() => applyCommand(document, { type: 'set-point-position', entityId: 'p1', position })).toThrow();
    }
    expect(() => applyCommand(document, { type: 'set-point-position', entityId: 'building-01', position: { x: 0, y: 0 } })).toThrow();
  });
  it('enforces layer locks on source and destination and validates references', () => {
    const document = createSampleDocument();
    const locked = applyCommand(document, { type: 'set-layer-lock', layerId: 'survey-points', locked: true });
    expect(() => applyCommand(locked, { type: 'set-point-position', entityId: 'p1', position: { x: 1, y: 2 } })).toThrow();
    expect(() => applyCommand(locked, { type: 'set-entity-layer', entityId: 'p1', layerId: 'boundary' })).toThrow();
    expect(() => applyCommand(locked, { type: 'set-entity-layer', entityId: 'building-01', layerId: 'survey-points' })).toThrow();
    expect(() => applyCommand(document, { type: 'set-entity-layer', entityId: 'p1', layerId: 'unknown' })).toThrow();
    expect(() => applyCommand(document, { type: 'set-layer-visibility', layerId: 'unknown', visible: false })).toThrow();
    expect(applyCommand(document, { type: 'set-entity-layer', entityId: 'p1', layerId: 'boundary' }).entities.find(e => e.id === 'p1')?.layerId).toBe('boundary');
  });
  it('filters invisible layers and orders render output by layer', () => {
    const document = createSampleDocument();
    const hidden = applyCommand(document, { type: 'set-layer-visibility', layerId: 'buildings', visible: false });
    expect(renderItems(hidden).some(item => item.entity.id === 'building-01')).toBe(false);
    expect(renderItems(document).map(item => item.layer.order)).toEqual(renderItems(document).map(item => item.layer.order).sort((a, b) => a - b));
    const empty = { ...document, layers: document.layers.map(layer => ({ ...layer, visible: false })) };
    expect(visibleBounds(empty)).toBeNull();
  });
});

describe('editor state ownership', () => {
  it('pan / zoom / selection / grid never alter world geometry or document identity', () => {
    const state = initialEditorState(createSampleDocument());
    let next = editorReducer(state, { type: 'pan', delta: { x: 200, y: -80 } });
    next = editorReducer(next, { type: 'zoom', size: { width: 1000, height: 700 }, anchor: { x: 345, y: 200 }, factor: 2 });
    next = editorReducer(next, { type: 'select', entityId: 'p1' });
    next = editorReducer(next, { type: 'toggle-grid' });
    expect(next.document).toBe(state.document); expect(next.viewport).not.toEqual(state.viewport); expect(next.selectionId).toBe('p1');
  });
  it('clears hidden / locked selection and refuses selecting locked entities', () => {
    const state = editorReducer(initialEditorState(createSampleDocument()), { type: 'select', entityId: 'p1' });
    for (const command of [{ type: 'set-layer-lock', layerId: 'survey-points', locked: true } as const, { type: 'set-layer-visibility', layerId: 'survey-points', visible: false } as const]) {
      const next = editorReducer(state, { type: 'command', command });
      expect(next.selectionId).toBeNull();
      expect(editorReducer(next, { type: 'select', entityId: 'p1' }).selectionId).toBeNull();
    }
    expect(editorReducer(state, { type: 'select', entityId: 'missing' })).toBe(state);
  });
});
