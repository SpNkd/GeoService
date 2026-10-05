import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeoDocument, HorizontalReference } from '../domain/model';
import type { DocumentCommand } from '../domain/commands';
import { computeRigidTransform2D } from '../geometry/georeferencing';
import { formatCoordinate } from '../geometry/format';

type Slot = 0 | 1;
interface Props {
  document: GeoDocument; picking: Slot | null; picked: { slot: Slot; id: string } | null;
  onPick: (slot: Slot | null) => void; onClose: () => void; onApply: (command: DocumentCommand) => void;
  onPreview: (reference: HorizontalReference | null) => void;
}
const number = (text: string) => text.trim() ? Number(text.replace(',', '.')) : NaN;
export function GeoreferenceDialog({ document, picking, picked, onPick, onClose, onApply, onPreview }: Props) {
  const points = useMemo(() => document.entities.filter(entity => entity.type === 'point'), [document.entities]);
  const existing = document.horizontalReference;
  const [draft, setDraft] = useState(() => ([0, 1] as const).map(i => ({ id: existing?.controls[i].pointEntityId ?? points[i]?.id ?? '', e: existing ? String(existing.controls[i].survey.e) : '', n: existing ? String(existing.controls[i].survey.n) : '' })));
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { if (picked) setDraft(previous => previous.map((value, i) => i === picked.slot ? { ...value, id: picked.id } : value)); }, [picked]);
  useEffect(() => {
    if (picking !== null) return;
    const previous = window.document.activeElement;
    dialog.current?.querySelector<HTMLSelectElement>('select')?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, [picking]);
  const preview = useMemo(() => {
    const selected = draft.map(value => points.find(point => point.id === value.id));
    if (!selected[0] || !selected[1]) return null;
    const controls = selected.map((point, i) => { const vertex = document.vertices[point!.vertexId]!; return { pointEntityId: point!.id, vertexId: point!.vertexId, modelSnapshot: { x: vertex.x, y: vertex.y }, survey: { e: number(draft[i]!.e), n: number(draft[i]!.n) } }; }) as HorizontalReference['controls'];
    const [a, b] = controls;
    const result = computeRigidTransform2D(a.modelSnapshot, b.modelSnapshot, a.survey, b.survey);
    if (a.pointEntityId === b.pointEntityId) return { controls, result: { ...result, status: 'INVALID' as const, message: 'Контрольные точки A и B должны быть разными.' } };
    return { controls, result };
  }, [draft, points, document.vertices]);
  const reference = useMemo(() => preview?.result.transform && preview.result.status !== 'INVALID' ? { controls: preview.controls, transform: preview.result.transform } : null, [preview]);
  useEffect(() => { onPreview(reference); return () => onPreview(null); }, [onPreview, reference]);
  const update = (slot: Slot, field: 'id' | 'e' | 'n', value: string) => setDraft(previous => previous.map((item, i) => i === slot ? { ...item, [field]: value } : item));
  if (picking !== null) return <div className="reference-pick-banner" role="status" data-shortcut-suppressed>Выберите существующую точку {picking === 0 ? 'A' : 'B'} на схеме.<button className="secondary-action" onClick={() => onPick(null)}>Вернуться к привязке · Esc</button></div>;
  const result = preview?.result;
  const value = (n: number | undefined) => n !== undefined && Number.isFinite(n) ? formatCoordinate(n) : '—';
  return <div className="modal-backdrop reference-backdrop"><div className="georeference-dialog" role="dialog" aria-modal="true" aria-labelledby="georeference-title" data-shortcut-suppressed ref={dialog}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const elements = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <div className="import-heading"><div><h2 id="georeference-title">Горизонтальная привязка</h2><p>Две существующие точки · rotation + translation · scale = 1</p></div><button aria-label="Закрыть привязку" className="icon-button" onClick={onClose}>×</button></div>
    <div className="import-body">
      {points.length < 2 && <p className="import-warning">Нужны две PointEntity. Создайте их инструментом «Точка»; привязка к вершине полигона позволяет использовать его угол.</p>}
      <div className="reference-controls">{([0, 1] as const).map(i => {
        const point = points.find(point => point.id === draft[i]!.id), vertex = point && document.vertices[point.vertexId]; const letter = i === 0 ? 'A' : 'B';
        return <fieldset key={i}><legend>Контрольная точка {letter}</legend>
          <label>Точка<select aria-label={`Контрольная точка ${letter}`} value={draft[i]!.id} onChange={event => update(i, 'id', event.target.value)}><option value="">Выберите точку</option>{points.map(point => <option key={point.id} value={point.id}>{point.name} · {point.id}</option>)}</select></label>
          <button className="secondary-action" onClick={() => onPick(i)}>Выбрать {letter} на схеме</button>
          <p className="mono">MODEL X {value(vertex?.x)} · Y {value(vertex?.y)}</p>
          <label>Easting<input aria-label={`Easting ${letter}`} inputMode="decimal" value={draft[i]!.e} onChange={event => update(i, 'e', event.target.value)} /></label>
          <label>Northing<input aria-label={`Northing ${letter}`} inputMode="decimal" value={draft[i]!.n} onChange={event => update(i, 'n', event.target.value)} /></label>
        </fieldset>;
      })}</div>
      <section className="calibration-preview" data-testid="calibration-preview" data-status={result?.status ?? 'INVALID'}>
        <h3>Preview · {result?.status ?? 'INVALID'}</h3><dl>
          <dt>Rotation</dt><dd data-testid="calibration-rotation">{value(result?.transform ? result.transform.rotation * 180 / Math.PI : undefined)}°</dd>
          <dt>Translation E / N</dt><dd>{value(result?.transform?.translation.e)} / {value(result?.transform?.translation.n)} м</dd>
          <dt>Model baseline</dt><dd>{value(result?.modelBaseline)} м</dd><dt>Survey baseline</dt><dd>{value(result?.surveyBaseline)} м</dd>
          <dt>Difference (Survey − Model)</dt><dd>{result && result.difference > 0 ? '+' : ''}{value(result?.difference)} м</dd>
          <dt>Residual ΔE / ΔN</dt><dd>{value(result?.residual?.e)} / {value(result?.residual?.n)} м</dd>
          <dt>Residual magnitude</dt><dd>{value(result?.residual?.distance)} м</dd>
        </dl><p role="status">{result?.message ?? 'Выберите две точки и введите конечные E/N.'}</p>
        <small>A совмещается точно. Residual B = введённые координаты − преобразованные. Геометрия и масштаб остаются прежними.</small>
      </section>
    </div><div className="import-footer"><span>Apply сохраняет только привязку · один Undo</span><button className="secondary-action" onClick={onClose}>Отмена</button><button className="primary-button" disabled={!reference} onClick={() => reference && onApply({ type: 'set-horizontal-reference', pairs: reference.controls.map(control => ({ pointEntityId: control.pointEntityId, survey: control.survey })) as NonNullable<Extract<DocumentCommand, { type: 'set-horizontal-reference' }>['pairs']> })}>Применить привязку</button></div>
  </div></div>;
}
