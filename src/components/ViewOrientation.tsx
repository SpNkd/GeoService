import type { Dispatch } from 'react';
import type { EditorAction, EditorState } from '../store/editor';
import { viewRotation } from '../view/projection';
export function ViewOrientation({ state, dispatch }: {
    state: EditorState;
    dispatch: Dispatch<EditorAction>;
}) { if (state.layoutId || state.viewMode !== 'plan')
    return null; return <details className="view-orientation" data-popup><summary>Вид · {viewRotation(state.viewport).toFixed(1)}°</summary><div><button onClick={() => dispatch({ type: 'view-angle', angle: 0 })}>Север вверх</button><label>Поворот вида, °<input aria-label="Поворот вида, °" type="number" value={viewRotation(state.viewport)} onChange={e => dispatch({ type: 'view-angle', angle: e.currentTarget.valueAsNumber })}/></label><button onClick={() => dispatch({ type: 'align-view', axis: 'horizontal' })}>Выровнять горизонтально по 2 точкам</button><button onClick={() => dispatch({ type: 'align-view', axis: 'vertical' })}>Выровнять вертикально по 2 точкам</button></div></details>; }
