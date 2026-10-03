export type Delimiter = ',' | ';' | '\t';
export type DecimalSeparator = '.' | ',';
export interface TableRow { line: number; cells: string[] }
export interface ImportTable { rows: TableRow[]; columnCount: number; delimiter: Delimiter }
export const MAX_TABLE_BYTES = 5 * 1024 * 1024;
export const MAX_TABLE_ROWS = 50000;

/** Quoted fields, escaped quotes, CRLF, BOM and embedded quoted newlines share one parser. */
export function parseTable(raw: string, delimiter: Delimiter): ImportTable {
  if (new TextEncoder().encode(raw).length > MAX_TABLE_BYTES) throw new Error('Таблица превышает лимит 5 МБ');
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows: TableRow[] = [];
  let cells: string[] = [], cell = '', quoted = false, closed = false, line = 1, rowLine = 1;
  const endCell = () => { cells.push(cell.trim()); cell = ''; closed = false; };
  const endRow = () => {
    endCell();
    if (cells.some(value => value !== '')) rows.push({ line: rowLine, cells });
    cells = [];
    if (rows.length > MAX_TABLE_ROWS + 1) throw new Error('Таблица содержит более 50 000 строк');
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else { cell += char; if (char === '\n') line++; }
    } else if (char === delimiter) endCell();
    else if (char === '\n') { endRow(); line++; rowLine = line; }
    else if (char === '"' && !cell.trim() && !closed) { cell = ''; quoted = true; }
    else if (char === '"' || (closed && char.trim())) throw new Error(`Строка ${line}: неверные кавычки в таблице`);
    else if (!closed) cell += char;
  }
  if (quoted) throw new Error(`Строка ${rowLine}: незакрытые кавычки`);
  endRow();
  const widths = new Map<number, number>();
  for (const row of rows.slice(0, 100)) widths.set(row.cells.length, (widths.get(row.cells.length) ?? 0) + 1);
  const columnCount = [...widths].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  if (columnCount > 100 || rows.some(row => row.cells.length > 100)) throw new Error('Таблица содержит более 100 столбцов');
  return { rows, columnCount, delimiter };
}

export function detectDelimiter(raw: string): { delimiter: Delimiter; ambiguous: boolean } {
  // Respect quoted separators and consider consistency, not a global comma replacement.
  const candidates = (['\t', ';', ','] as const).map(delimiter => {
    try {
      const widths = parseTable(raw, delimiter).rows.slice(0, 20).map(row => row.cells.length);
      const useful = widths.filter(width => width >= 2);
      const score = useful.length ? useful.length / Math.max(1, widths.length) : 0;
      return { delimiter, score };
    } catch { return { delimiter, score: 0 }; }
  }).sort((a, b) => b.score - a.score);
  return { delimiter: candidates[0]!.delimiter, ambiguous: candidates[0]!.score === 0 || candidates[0]!.score === candidates[1]!.score };
}
export function detectDecimal(table: ImportTable): { decimal: DecimalSeparator; ambiguous: boolean } {
  let dot = false, comma = false;
  for (const row of table.rows.slice(0, 100)) for (const cell of row.cells) {
    if (/^[+-]?\d+\.\d+(?:[eE][+-]?\d+)?$/.test(cell)) dot = true;
    if (/^[+-]?\d+,\d+(?:[eE][+-]?\d+)?$/.test(cell)) comma = true;
  }
  return { decimal: comma && !dot ? ',' : '.', ambiguous: dot && comma };
}
export function detectHeader(table: ImportTable): boolean {
  const first = table.rows[0]?.cells ?? [];
  return first.some(cell => /^(id|name|point|point id|easting|northing|height|x|y|z|h|e|n|имя|точка|высота)$/i.test(cell.trim()));
}
