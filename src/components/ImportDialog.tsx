import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeoDocument } from '../domain/model';
import type { DocumentCommand } from '../domain/commands';
import { detectDecimal, detectDelimiter, detectHeader, MAX_TABLE_BYTES, parseTable, type DecimalSeparator, type Delimiter } from '../import/parser';
import { buildImportPlan, createImportCommand, defaultMapping, type ColumnRole } from '../import/importPlan';

interface Props { document: GeoDocument; onClose: () => void; onImport: (command: DocumentCommand) => void }
const roles: [ColumnRole, string][] = [['ignore', 'Ignore'], ['id', 'Point ID'], ['easting', 'Easting → X'], ['northing', 'Northing → Y'], ['height', 'Height → Z']];
export function ImportDialog({ document, onClose, onImport }: Props) {
  const [raw, setRaw] = useState('');
  const [delimiter, setDelimiter] = useState<Delimiter>('\t');
  const [decimal, setDecimal] = useState<DecimalSeparator>('.');
  const [header, setHeader] = useState(false);
  const [mapping, setMapping] = useState<ColumnRole[]>([]);
  const [layerId, setLayerId] = useState('survey-points');
  const [validOnly, setValidOnly] = useState(false);
  const [source, setSource] = useState('Вставка из таблицы');
  const [notice, setNotice] = useState('');
  const [fileError, setFileError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = window.document.activeElement;
    dialog.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  const parsed = useMemo(() => {
    try { return { table: parseTable(raw, delimiter), error: '' }; }
    catch (error) { return { table: null, error: error instanceof Error ? error.message : 'Ошибка чтения таблицы' }; }
  }, [raw, delimiter]);
  const plan = useMemo(() => parsed.table ? buildImportPlan(parsed.table, { header, decimal, mapping },
    document.entities.filter(entity => entity.type === 'point').map(entity => entity.name)) : null, [parsed.table, header, decimal, mapping, document.entities]);
  const initialize = (text: string, name = 'Вставка из таблицы') => {
    setRaw(text); setSource(name); setFileError(''); setValidOnly(false);
    const detection = detectDelimiter(text);
    setDelimiter(detection.delimiter);
    try {
      const table = parseTable(text, detection.delimiter), hasHeader = detectHeader(table), decimals = detectDecimal(table);
      setHeader(hasHeader); setDecimal(decimals.decimal); setMapping(defaultMapping(table, hasHeader));
      setNotice([detection.ambiguous ? 'Разделитель неоднозначен: проверьте выбранный вариант.' : '', decimals.ambiguous ? 'Встречаются оба десятичных знака: выберите один явно.' : ''].filter(Boolean).join(' '));
    } catch { setMapping([]); setNotice('Выберите разделитель и проверьте структуру таблицы.'); }
  };
  const changeFormat = (next: Delimiter, nextHeader = header) => {
    setDelimiter(next); setHeader(nextHeader);
    try { setMapping(defaultMapping(parseTable(raw, next), nextHeader)); } catch { setMapping([]); }
  };
  const target = document.layers.find(layer => layer.id === layerId);
  const canImport = plan && plan.points.length > 0 && !plan.mappingErrors.length && (!plan.errors.length || validOnly) && !target?.locked && !fileError;
  const headers = header ? parsed.table?.rows[0]?.cells : undefined;
  const preview = parsed.table?.rows.slice(header ? 1 : 0, (header ? 1 : 0) + 15) ?? [];
  const importNow = () => {
    if (!plan || !canImport) return;
    try { onImport(createImportCommand(plan, document, layerId, validOnly)); }
    catch (error) { setFileError(error instanceof Error ? error.message : 'Не удалось подготовить импорт'); }
  };
  return <div className="modal-backdrop"><div className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" ref={dialog}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const elements = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea')];
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <div className="import-heading"><div><h2 id="import-title">Импорт координат</h2><p>CSV / TXT / TSV или вставка из Excel · координаты в метрах</p></div><button className="icon-button" aria-label="Закрыть импорт" onClick={onClose}>×</button></div>
    <div className="import-body">
      <div className="import-source"><label className="file-picker">Файл координат<input aria-label="Файл координат" type="file" accept=".csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values" onChange={async event => {
        const file = event.target.files?.[0]; if (!file) return;
        if (file.size > MAX_TABLE_BYTES) { setFileError('Таблица превышает лимит 5 МБ'); return; }
        try { initialize(await file.text(), file.name); } catch { setFileError('Не удалось прочитать файл'); }
      }} /></label><span>{source}</span></div>
      <label className="paste-field">Вставьте координаты<textarea aria-label="Вставьте координаты" value={raw} maxLength={MAX_TABLE_BYTES} onChange={event => initialize(event.target.value)} placeholder={'Name\tEasting\tNorthing\tHeight\nP1\t562341.234\t6189345.221\t152.340'} /></label>
      <div className="import-options">
        <label>Разделитель<select aria-label="Разделитель" value={delimiter} onChange={event => changeFormat(event.target.value as Delimiter)}><option value={'\t'}>TAB</option><option value=";">Точка с запятой (;)</option><option value=",">Запятая (,)</option></select></label>
        <label>Десятичный знак<select aria-label="Десятичный знак" value={decimal} onChange={event => setDecimal(event.target.value as DecimalSeparator)}><option value=".">Точка · 152.340</option><option value=",">Запятая · 152,340</option></select></label>
        <label>Целевой слой<select aria-label="Целевой слой" value={layerId} onChange={event => setLayerId(event.target.value)}>{!document.layers.some(layer => layer.id === 'survey-points') && <option value="survey-points">Геодезические точки (создать)</option>}{document.layers.map(layer => <option key={layer.id} value={layer.id} disabled={layer.locked}>{layer.name}{layer.locked ? ' · заблокирован' : !layer.visible ? ' · скрыт' : ''}</option>)}</select></label>
        <label className="check-label"><input aria-label="Первая строка — заголовок" type="checkbox" checked={header} onChange={event => changeFormat(delimiter, event.target.checked)} />Первая строка — заголовок</label>
      </div>
      <p className="mapping-note">Проверьте mapping: Easting → X, Northing → Y, Height → Z. Исходные X/Y могут требовать перестановки.</p>
      {notice && <p className="import-warning">{notice}</p>}
      {target && !target.visible && <p className="import-warning">Целевой слой скрыт. Для просмотра точек включите его видимость после импорта.</p>}
      {(fileError || parsed.error) && <p className="import-error" role="alert">{fileError || parsed.error}</p>}
      {parsed.table && parsed.table.columnCount > 0 && <div className="import-preview"><table><thead><tr><th>Строка</th>{Array.from({ length: parsed.table.columnCount }, (_, i) => <th key={i}><span>{headers?.[i] || `Столбец ${i + 1}`}</span><select aria-label={`Столбец ${headers?.[i] || i + 1}`} value={mapping[i] ?? 'ignore'} onChange={event => setMapping(Array.from({ length: parsed.table!.columnCount }, (_, index) => index === i ? event.target.value as ColumnRole : mapping[index] ?? 'ignore'))}>{roles.map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></th>)}</tr></thead><tbody>{preview.map(row => <tr key={row.line} className={plan?.errors.some(error => error.line === row.line) ? 'invalid-row' : ''}><td>{row.line}</td>{Array.from({ length: parsed.table!.columnCount }, (_, i) => <td key={i}>{row.cells[i] ?? '—'}</td>)}</tr>)}</tbody></table></div>}
      {plan && raw && <>
        <div className="import-counts" data-testid="import-counts"><span>Строк: <b>{plan.rowCount}</b></span><span>Валидных: <b>{plan.points.length}</b></span><span>Ошибочных: <b>{plan.errors.length}</b></span><small>Preview: первые 15 строк</small></div>
        {plan.mappingErrors.map(message => <p className="import-error" key={message}>{message}</p>)}
        {plan.errors.length > 0 && <div className="import-errors" role="alert">{plan.errors.slice(0, 5).map(error => <p key={error.line}>Row {error.line}: {error.message}</p>)}{plan.errors.length > 5 && <p>Ещё ошибок: {plan.errors.length - 5}</p>}<label className="check-label"><input type="checkbox" checked={validOnly} onChange={event => setValidOnly(event.target.checked)} />Импортировать только валидные строки</label></div>}
        {plan.warnings.map(message => <p className="import-warning" key={message}>{message}</p>)}
      </>}
    </div><div className="import-footer"><span>Один импорт = один шаг Undo · лимит 5 МБ / 50 000 точек</span><button className="tool-button" onClick={onClose}>Отмена</button><button className="primary-button" disabled={!canImport} onClick={importNow}>Импортировать{plan?.points.length ? ` (${plan.points.length})` : ''}</button></div>
  </div></div>;
}
