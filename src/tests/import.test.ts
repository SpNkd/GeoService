import { describe, expect, it } from 'vitest';
import { detectDecimal, detectDelimiter, detectHeader, parseTable } from '../import/parser';
import { buildImportPlan, createImportCommand, defaultMapping, parseCoordinate } from '../import/importPlan';
import { createNewDocument } from '../domain/newDocument';
import { applyCommand } from '../domain/commands';
import { editorReducer, initialEditorState } from '../store/editor';

function planFrom(text: string) {
  const table = parseTable(text, detectDelimiter(text).delimiter);
  const header = detectHeader(table);
  return buildImportPlan(table, { header, decimal: detectDecimal(table).decimal, mapping: defaultMapping(table, header) });
}
describe('coordinate import pipeline', () => {
  it.each([
    'id,x,y,z\nP1,562341.234,6189345.221,152.340',
    'P1;562341.234;6189345.221;152.340',
    'P1\t562341.234\t6189345.221\t152.340',
    '\uFEFFName\tEasting\tNorthing\tHeight\r\nP1\t562341.234\t6189345.221\t152.340\r\n',
  ])('parses CSV/TXT/TSV/Excel paste through the same pipeline: %s', text => {
    const plan = planFrom(text); expect(plan.errors).toEqual([]); expect(plan.mappingErrors).toEqual([]);
    expect(plan.points).toEqual([{ name: 'P1', position: { x: 562341.234, y: 6189345.221, z: 152.34 } }]);
  });
  it('detects headers and no-header input independently of delimiter', () => {
    expect(detectHeader(parseTable('E,N\n123,456', ','))).toBe(true);
    expect(detectHeader(parseTable('P1;123;456', ';'))).toBe(false);
    expect(planFrom('123;456').points[0]).toEqual({ name: 'P1', position: { x: 123, y: 456 } });
  });
  it('handles decimal comma only within parsed cells of an unambiguous format', () => {
    const plan = planFrom('P1;562341,234;6189345,221;152,340');
    expect(plan.points[0]!.position).toEqual({ x: 562341.234, y: 6189345.221, z: 152.34 });
    expect(planFrom('id,x,y\nP1,"562341,234","6189345,221"').points[0]!.position.x).toBe(562341.234);
    expect(parseCoordinate('123,45', '.')).toBeNull(); expect(parseCoordinate('0x12', '.')).toBeNull();
    expect(parseCoordinate('Infinity', '.')).toBeNull(); expect(parseCoordinate('1e999', '.')).toBeNull();
  });
  it('flags ambiguous delimiters and mixed decimal signs for manual choice', () => {
    expect(detectDelimiter('P1;123,45;456,78').ambiguous).toBe(true);
    expect(detectDecimal(parseTable('P1;123.45;456,78', ';')).ambiguous).toBe(true);
  });
  it('maps source X to Northing and Y to Easting explicitly', () => {
    const table = parseTable('Name;X;Y;H\nP1;6189345.221;562341.234;152.34', ';');
    const plan = buildImportPlan(table, { header: true, decimal: '.', mapping: ['id', 'northing', 'easting', 'height'] });
    expect(plan.points[0]!.position).toEqual({ x: 562341.234, y: 6189345.221, z: 152.34 });
  });
  it('permits absent or empty Z without fabricating zero height', () => {
    expect(planFrom('P1;123;456').points[0]!.position).toEqual({ x: 123, y: 456 });
    expect(planFrom('P1;123;456;').points[0]!.position).toEqual({ x: 123, y: 456 });
  });
  it('requires Easting/Northing roles exactly once', () => {
    const table = parseTable('P1;123;456', ';');
    expect(buildImportPlan(table, { header: false, decimal: '.', mapping: ['id', 'easting', 'easting'] }).mappingErrors).toHaveLength(2);
  });
  it('preserves physical source row numbers, errors and explicit partial-import policy', () => {
    const plan = planFrom('id,x,y\nP1,123,456\n\nP2,234,abc\nP3,,555\nP4,1,2,3');
    expect(plan.points).toHaveLength(1); expect(plan.errors.map(error => error.line)).toEqual([4, 5, 6]);
    expect(plan.errors[0]!.message).toContain('invalid Northing "abc"');
    expect(plan.errors[1]!.message).toContain('missing Easting');
    expect(() => createImportCommand(plan, createNewDocument(), 'survey-points')).toThrow();
    expect(createImportCommand(plan, createNewDocument(), 'survey-points', true).type).toBe('import-points');
  });
  it('warns for repeated names including existing points and preserves both with unique IDs', () => {
    const plan = planFrom('P1;123;456\nP1;234;567'); expect(plan.warnings[0]).toContain('P1');
    const imported = applyCommand(createNewDocument(), createImportCommand(plan, createNewDocument(), 'survey-points'));
    expect(imported.entities.map(entity => entity.name)).toEqual(['P1', 'P1']);
    expect(new Set(imported.entities.map(entity => entity.id)).size).toBe(2);
    const table = parseTable('P1;123;456', ';');
    expect(buildImportPlan(table, { header: false, decimal: '.', mapping: ['id', 'easting', 'northing'] }, ['P1']).warnings).toHaveLength(1);
  });
  it('handles quoted/escaped fields and newlines safely as domain labels', () => {
    const plan = planFrom('id,x,y\n"P, ""north""",123,456\n"<script>\nalert(1)</script>",234,567');
    expect(plan.points[0]!.name).toBe('P, "north"'); expect(plan.points).toHaveLength(2);
    expect(() => parseTable('"P1;123;456', ';')).toThrow('незакрытые');
  });
  it('imports 501 large-coordinate points plus a new layer atomically and restores their IDs in redo', () => {
    const document = createNewDocument(); document.layers = document.layers.filter(layer => layer.id !== 'survey-points');
    const plan = planFrom(Array.from({ length: 501 }, (_, i) => `P${i + 1};${562341.234123456 + i};${6189345.221234567 + i}`).join('\n'));
    const command = createImportCommand(plan, document, 'survey-points');
    let state = editorReducer(initialEditorState(document), { type: 'execute', command });
    const imported = state.document;
    expect(imported.entities).toHaveLength(501); expect(Object.keys(imported.vertices)).toHaveLength(501);
    expect(state.past).toHaveLength(1); expect(imported.layers.some(layer => layer.id === 'survey-points')).toBe(true);
    state = editorReducer(state, { type: 'undo' }); expect(state.document).toBe(document);
    expect(state.document.layers.some(layer => layer.id === 'survey-points')).toBe(false);
    state = editorReducer(state, { type: 'redo' }); expect(state.document).toBe(imported);
    expect(Object.values(state.document.vertices)[0]!.x).toBe(562341.234123456);
  });
  it('rejects locked targets and duplicate internal IDs without mutating source', () => {
    const document = createNewDocument(); document.layers.find(layer => layer.id === 'survey-points')!.locked = true;
    const plan = planFrom('P1;123;456');
    expect(() => createImportCommand(plan, document, 'survey-points')).toThrow('заблокирован');
    document.layers.find(layer => layer.id === 'survey-points')!.locked = false;
    const command = createImportCommand(planFrom('P1;1;2\nP2;3;4'), document, 'survey-points', false, () => 'same');
    expect(() => applyCommand(document, command)).toThrow('ID'); expect(document.entities).toEqual([]);
  });
  it('bounds row/column/file input before the editor can be changed', () => {
    expect(() => parseTable('x'.repeat(5 * 1024 * 1024 + 1), ';')).toThrow('5 МБ');
    expect(() => parseTable(Array(101).fill('a').join(';'), ';')).toThrow('100 столбцов');
    expect(() => parseTable(Array(50003).fill('P1;1;2').join('\n'), ';')).toThrow('50 000');
  });
});
