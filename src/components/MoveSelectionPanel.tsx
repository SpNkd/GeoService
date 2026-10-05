import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { resolveSelectionMove } from '../domain/selectionMove';
import type { EditorAction, EditorState } from '../store/editor';

export function MoveSelectionPanel({ state, dispatch }: { state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const [x, setX] = useState('0'), [y, setY] = useState('0'), firstInput = useRef<HTMLInputElement>(null);
  const resolution = useMemo(() => {
    try { return { plan: resolveSelectionMove(state.document, state.selectedEntityIds), error: null }; }
    catch (error) { return { plan: null, error: error instanceof Error ? error.message : 'Нельзя переместить выбор' }; }
  }, [state.document, state.selectedEntityIds]);
  useEffect(() => { if (state.moveInputOpen) { firstInput.current?.focus(); firstInput.current?.select(); } }, [state.moveInputOpen]);
  if (!state.selectedEntityIds.length && !state.moveInputOpen) return null;
  if (!state.moveInputOpen) return <div className="property-section move-selection"><button className="secondary-action" onClick={() => dispatch({ type: 'open-move-input' })}>Переместить… · M</button></div>;
  const delta = { x: Number(x), y: Number(y) }, valid = x.trim() !== '' && y.trim() !== '' && Number.isFinite(delta.x) && Number.isFinite(delta.y) && (delta.x !== 0 || delta.y !== 0);
  return <form className="property-section move-selection" aria-label="Перемещение выбора" onSubmit={event => {
    event.preventDefault();
    if (!resolution.plan || !valid || state.transactionBefore) return;
    dispatch({ type: 'execute', expectedDocument: state.document, command: { type: 'move-entities', entityIds: resolution.plan.entityIds, delta } });
    setX('0'); setY('0');
  }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dispatch({ type: 'close-move-input' }); } }}>
    <h3>Переместить выбор · {state.selectedEntityIds.length}</h3>
    <label>ΔX (м)<input ref={firstInput} aria-label="Перемещение ΔX" type="number" step="any" value={x} onChange={event => setX(event.target.value)} /></label>
    <label>ΔY (м)<input aria-label="Перемещение ΔY" type="number" step="any" value={y} onChange={event => setY(event.target.value)} /></label>
    {resolution.error && <p className="read-only-banner">{resolution.error}</p>}
    {Boolean(resolution.plan?.affectedEntityIds.length) && <p className="property-note">Перемещение затронет {resolution.plan!.affectedEntityIds.length} связанных объектов.</p>}
    <p className="property-note">MODEL · метры. Размеры следуют за своими опорами. Drag за тело — свободный перенос; Shift — по X или Y.</p>
    <button type="submit" className="secondary-action" disabled={!resolution.plan || !valid || Boolean(state.transactionBefore)}>Применить перемещение</button>
    <button type="button" className="tool-button compact" onClick={() => dispatch({ type: 'close-move-input' })}>Закрыть перемещение</button>
  </form>;
}
