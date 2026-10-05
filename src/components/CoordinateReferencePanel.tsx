import { useEffect, useState, type Dispatch } from 'react';
import { documentModelFrame, staleControls } from '../geometry/georeferencing';
import type { EditorAction, EditorState } from '../store/editor';

export function CoordinateReferencePanel({ state, dispatch, onCalibrate }: { state: EditorState; dispatch: Dispatch<EditorAction>; onCalibrate: () => void }) {
  const doc = state.document, local = documentModelFrame(doc) === 'local', reference = doc.horizontalReference;
  const stale = staleControls(doc);
  const [height, setHeight] = useState(doc.verticalReference ? String(doc.verticalReference.absoluteAtModelZero) : '');
  useEffect(() => setHeight(doc.verticalReference ? String(doc.verticalReference.absoluteAtModelZero) : ''), [doc.verticalReference]);
  const numeric = height.trim() ? Number(height.replace(',', '.')) : NaN;
  return <section className="coordinate-reference-panel" aria-label="Система координат документа">
    <h3>Координаты документа</h3>
    <label>Frame геометрии <select aria-label="Frame геометрии" value={documentModelFrame(doc)} disabled={Boolean(state.transactionBefore) || Boolean(reference)} onChange={event => dispatch({ type: 'execute', command: { type: 'set-model-frame', frame: event.target.value as 'local' | 'projected' } })}><option value="local">Local · MODEL</option><option value="projected">Projected · direct E/N</option></select></label>
    <p className="field-help">Смена frame сохраняет исходные X/Y; преобразование координат не выполняется.{reference ? ' Для смены удалите привязку.' : ''}</p>
    <p data-testid="model-frame">{local ? 'Локальная система · MODEL' : 'Проектные координаты · прямые E/N'}</p>
    <p data-testid="reference-state">{local ? reference ? stale.length ? 'STALE · требуется проверка' : 'Привязана · scale = 1' : 'Не привязана' : 'Identity / direct'}</p>
    {local && <div><button className="secondary-action" disabled={Boolean(state.transactionBefore)} onClick={onCalibrate}>{reference ? 'Изменить привязку' : 'Привязать координаты'}</button>
      {reference && <button className="secondary-action" disabled={Boolean(state.transactionBefore)} onClick={() => dispatch({ type: 'execute', command: { type: 'set-horizontal-reference', pairs: null } })}>Удалить привязку</button>}</div>}
    {stale.length > 0 && <div className="reference-warning" role="status">{stale.map(control => <p key={control.pointEntityId}>Контрольная точка {doc.entities.find(entity => entity.id === control.pointEntityId)?.name ?? control.pointEntityId} изменилась после привязки.</p>)}<button className="secondary-action" disabled={Boolean(state.transactionBefore)} onClick={onCalibrate}>Пересчитать привязку</button><p>Принятое преобразование сохранено.</p></div>}
    <form onSubmit={event => { event.preventDefault(); if (Number.isFinite(numeric)) dispatch({ type: 'execute', command: { type: 'set-vertical-reference', reference: { modelZero: 0, absoluteAtModelZero: numeric } } }); }}>
      <h3>Высотная привязка</h3><label>±0.000 = <input aria-label="Абсолютная отметка нуля" type="text" inputMode="decimal" value={height} onChange={event => setHeight(event.target.value)} /> м</label>
      <div><button className="secondary-action" type="submit" disabled={!Number.isFinite(numeric) || Boolean(state.transactionBefore)}>Применить высотную привязку</button>
        {doc.verticalReference && <button className="secondary-action" type="button" disabled={Boolean(state.transactionBefore)} onClick={() => dispatch({ type: 'execute', command: { type: 'set-vertical-reference', reference: null } })}>Удалить высотную привязку</button>}</div>
    </form>
  </section>;
}
