import type { GeoDocument, Layer, PointEntity, Vertex, WorldPoint } from '../domain/model';
import type { DocumentCommand } from '../domain/commands';
import { MAX_TABLE_ROWS, type DecimalSeparator, type ImportTable } from './parser';

export type ColumnRole = 'id' | 'easting' | 'northing' | 'height' | 'ignore';
export interface ImportOptions { header: boolean; decimal: DecimalSeparator; mapping: ColumnRole[] }
export interface ImportPoint { name: string; position: WorldPoint }
export interface RowError { line: number; message: string }
export interface ImportPlan { points: ImportPoint[]; errors: RowError[]; warnings: string[]; rowCount: number; mappingErrors: string[] }
export function defaultMapping(table: ImportTable, header: boolean): ColumnRole[] {
  if (header) return Array.from({ length: table.columnCount }, (_, i) => {
    const name = table.rows[0]?.cells[i]?.toLowerCase() ?? '';
    if (['id', 'name', 'point', 'point id', 'имя', 'точка'].includes(name)) return 'id';
    if (['easting', 'e', 'x'].includes(name)) return 'easting';
    if (['northing', 'n', 'y'].includes(name)) return 'northing';
    if (['height', 'z', 'h', 'высота'].includes(name)) return 'height';
    return 'ignore';
  });
  const first = table.rows[0]?.cells[0] ?? '';
  const numericFirst = /^[+-]?\d+(?:[.,]\d+)?$/.test(first);
  const roles: ColumnRole[] = numericFirst ? ['easting', 'northing', 'height'] : ['id', 'easting', 'northing', 'height'];
  return Array.from({ length: table.columnCount }, (_, i) => roles[i] ?? 'ignore');
}
export function parseCoordinate(value: string, decimal: DecimalSeparator): number | null {
  const pattern = decimal === '.' ? /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/ : /^[+-]?(?:\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?$/;
  if (!pattern.test(value)) return null;
  const number = Number(decimal === ',' ? value.replace(',', '.') : value);
  return Number.isFinite(number) ? number : null;
}
export function buildImportPlan(table: ImportTable, options: ImportOptions, existingNames: string[] = []): ImportPlan {
  const mappingErrors: string[] = [];
  for (const role of ['easting', 'northing', 'height', 'id'] as const) {
    const count = options.mapping.filter(value => value === role).length;
    if (count > 1) mappingErrors.push(`Роль ${role} назначена нескольким столбцам`);
    if ((role === 'easting' || role === 'northing') && count === 0) mappingErrors.push(`Назначьте столбец ${role === 'easting' ? 'Easting' : 'Northing'}`);
  }
  const rows = table.rows.slice(options.header ? 1 : 0);
  if (rows.length > MAX_TABLE_ROWS) mappingErrors.push('Лимит импорта — 50 000 точек');
  const plan: ImportPlan = { points: [], errors: [], warnings: [], rowCount: rows.length, mappingErrors };
  if (mappingErrors.length) return plan;
  const index = (role: ColumnRole) => options.mapping.indexOf(role);
  const names = new Set(existingNames), duplicates = new Set<string>();
  for (const row of rows) {
    const problems: string[] = [];
    if (row.cells.length !== table.columnCount) problems.push(`Ожидалось ${table.columnCount} столбцов, получено ${row.cells.length}`);
    const coordinate = (role: ColumnRole, label: string, optional = false) => {
      const value = row.cells[index(role)] ?? '';
      if (!value && optional) return undefined;
      const parsed = parseCoordinate(value, options.decimal);
      if (parsed === null) problems.push(value ? `invalid ${label} "${value.slice(0, 60)}"` : `missing ${label}`);
      return parsed ?? undefined;
    };
    const x = coordinate('easting', 'Easting'), y = coordinate('northing', 'Northing');
    const z = index('height') >= 0 ? coordinate('height', 'Height', true) : undefined;
    const name = index('id') < 0 ? `P${plan.points.length + 1}` : row.cells[index('id')] ?? '';
    if (!name.trim()) problems.push('missing Point ID');
    if (name.length > 1000) problems.push('Point ID длиннее 1000 символов');
    if (problems.length || x === undefined || y === undefined) { plan.errors.push({ line: row.line, message: problems.join('; ') }); continue; }
    if (names.has(name)) duplicates.add(name);
    names.add(name);
    plan.points.push({ name, position: { x, y, ...(z === undefined ? {} : { z }) } });
  }
  if (duplicates.size) plan.warnings.push(`Повторяющиеся имена: ${[...duplicates].slice(0, 10).join(', ')}. Все точки сохранятся с разными внутренними ID.`);
  return plan;
}

/** IDs are allocated once before dispatch, so redo restores precisely the same batch. */
export function createImportCommand(plan: ImportPlan, document: GeoDocument, layerId: string, validOnly = false,
  newId: () => string = () => crypto.randomUUID()): DocumentCommand {
  if (plan.mappingErrors.length || (!validOnly && plan.errors.length) || !plan.points.length) throw new Error('Импорт требует корректного mapping и явного выбора для строк с ошибками');
  const existing = document.layers.find(layer => layer.id === layerId);
  if (existing?.locked) throw new Error('Целевой слой заблокирован');
  if (!existing && layerId !== 'survey-points') throw new Error('Целевой слой отсутствует');
  const layer: Layer | undefined = existing ? undefined : { id: 'survey-points', name: 'Геодезические точки', visible: true, locked: false,
    order: Math.max(...document.layers.map(layer => layer.order)) + 1, styleId: document.styles.find(style => style.id === 'survey')?.id ?? document.styles[0]!.id };
  const points = plan.points.map(point => {
    const vertex: Vertex = { id: `v-${newId()}`, ...point.position };
    const entity: PointEntity = { id: `point-${newId()}`, type: 'point', name: point.name, layerId, vertexId: vertex.id };
    return { vertex, entity };
  });
  return { type: 'import-points', points, ...(layer ? { layer } : {}) };
}
