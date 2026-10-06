import { useEffect, useRef, useState, type Dispatch } from 'react';
import type { EditorAction, EditorState } from '../store/editor';
import { resolveSelectionTransform, selectionPivot, AXON_ROTATE_MESSAGE } from '../domain/selectionTransform';
export function RotateSelectionPanel({ state, dispatch }: {
    state: EditorState;
    dispatch: Dispatch<EditorAction>;
}) {
    const [angle, setAngle] = useState('0'), input = useRef<HTMLInputElement>(null);
    useEffect(() => { if (state.rotateInputOpen)
        input.current?.focus(); }, [state.rotateInputOpen, state.rotateInputFocusEpoch]);
    const entities = state.document.entities.filter(e => state.selectedEntityIds.includes(e.id));
    let reason = '';
    try {
        resolveSelectionTransform(state.document, state.selectedEntityIds, 'rotate');
    }
    catch (error) {
        reason = error instanceof Error ? error.message : String(error);
    }
    const intrinsic = entities.length === 1 && ['text', 'symbol', 'block_instance', 'raster_underlay'].includes(entities[0]!.type);
    if (state.layoutId&&!state.viewportEditing || state.deepSelection || !entities.length && !state.rotateInputOpen)
        return null;
    const disabled = !!reason || !!state.transactionBefore || state.viewMode === 'axonometric' && !intrinsic;
    const rotate = (angleDeg: number) => { try {
        dispatch({ type: 'execute', command: { type: 'transform-selection', entityIds: state.selectedEntityIds, transform: { kind: 'rotate', pivot: selectionPivot(state.document, state.selectedEntityIds), angleDeg } } });
    }
    catch (error) {
        dispatch({ type: 'report-error', message: String(error) });
    } };
    const single = entities[0], absolute = intrinsic && single && 'rotationDeg' in single ? single.rotationDeg ?? 0 : 0;
    return <section className="property-section rotate-selection" data-testid="rotate-selection"><h3>Поворот выделения</h3><label>Повернуть выделенное на, °<input ref={input} aria-label="Угол поворота выделения" type="number" step="any" value={angle} disabled={disabled} onChange={e => setAngle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && angle.trim() && Number.isFinite(Number(angle)))
        rotate(Number(angle)); }}/></label><button className="secondary-action" disabled={disabled || !angle.trim() || !Number.isFinite(Number(angle))} onClick={() => rotate(Number(angle))}>Применить поворот</button><div className="summary-actions"><button disabled={disabled} onClick={() => rotate(-90)}>90° вправо</button><button disabled={disabled} onClick={() => rotate(90)}>90° влево</button><button disabled={disabled} onClick={() => rotate(180)}>180°</button></div>
 {intrinsic && single && single.type !== 'symbol' && single.type !== 'raster_underlay' && <label>Абсолютный поворот вокруг MODEL Z, °<input aria-label="Абсолютный поворот MODEL Z" key={`${single.id}-${absolute}`} type="number" step="any" defaultValue={absolute} disabled={!!reason || !!state.transactionBefore} onBlur={e => { if (Number.isFinite(e.target.valueAsNumber))
        dispatch({ type: 'execute', command: { type: 'update-entity', entityId: single.id, patch: { rotationDeg: e.target.valueAsNumber } } }); }}/></label>}
 <small>{reason || (!entities.length ? 'Выберите объекты на схеме.' : state.viewMode === 'axonometric' ? AXON_ROTATE_MESSAGE : 'Delta вокруг центра выделения · Shift: шаг 15° · Esc: отмена')}</small></section>;
}
