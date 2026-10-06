import type { Dispatch } from 'react';
import type { EditorState, EditorAction } from '../store/editor';
import type { ViewSize } from '../geometry';
export function DxfViews({ state, dispatch, size }: {
    state: EditorState;
    dispatch: Dispatch<EditorAction>;
    size: ViewSize;
}) {
    const layouts = state.document.dxfLayouts;
    if (!layouts?.length)
        return null;
    const disabled = !!state.transactionBefore;
    return <details className="dxf-views" data-testid="dxf-views"><summary>DXF Views · {state.layoutId ? layouts.find(l => l.id === state.layoutId)?.name : 'Model'}</summary><div className="dxf-views-menu"><button disabled={disabled} aria-pressed={!state.layoutId} onClick={() => dispatch({ type: 'dxf-layout', layoutId: null, size })}>Model · Model Space</button>{layouts.map(l => <section data-testid="dxf-paper-node" key={l.id}><button disabled={disabled} aria-label={`Paper Space ${l.name}`} aria-pressed={state.layoutId === l.id} onClick={() => dispatch({ type: 'dxf-layout', layoutId: l.id, size })}>{l.name} · Paper Space</button>{!l.nameAvailable && <small>Имя исходного листа отсутствует в DXF</small>}<details><summary>{l.viewports.length} MODEL viewport внутри Paper Space</summary>{l.viewports.map((v, index) => <div key={v.id} data-testid="dxf-viewport-node"><button disabled={disabled} aria-label={`${l.name}: Viewport ${index + 1}`} aria-pressed={state.layoutId === l.id && state.dxfViewportId === v.id} onClick={() => dispatch({ type: 'fit-dxf-viewport', layoutId: l.id, viewportId: v.id, size })}>Viewport {index + 1} · MODEL viewport · ID {v.number}</button><small>Масштаб {v.scale.toFixed(3)} · центр MODEL {v.modelCenter.x.toFixed(2)}, {v.modelCenter.y.toFixed(2)} · VP Freeze: {v.frozenSourceLayerNames.length}</small>{v.unsupportedReason && <small>{v.unsupportedReason}</small>}</div>)}</details></section>)}<div className="summary-actions"><button disabled={disabled || !state.layoutId} onClick={() => dispatch({ type: 'fit-view', size })}>Fit Paper Space</button><button disabled={disabled || !state.layoutId || !state.dxfViewportId} onClick={() => { if (state.layoutId && state.dxfViewportId)
        dispatch({ type: 'fit-dxf-viewport', layoutId: state.layoutId, viewportId: state.dxfViewportId, size }); }}>Fit Viewport</button><button disabled={disabled || !state.layoutId} onClick={() => dispatch({ type: 'dxf-layout', layoutId: null, size })}>Back to Model</button></div></div></details>;
}
