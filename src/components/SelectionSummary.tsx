import { paperDocument } from '../layouts/selection';
import { useMemo, type Dispatch } from 'react';
import type { EditorState, EditorAction } from '../store/editor';
import type { ViewSize } from '../geometry';
import { selectedLayerCounts } from '../layouts/layers';
export function SelectionSummary({ state, dispatch, size }: {
    state: EditorState;
    dispatch: Dispatch<EditorAction>;
    size: ViewSize;
}) { const summary = useMemo(() => { const all = [...state.document.entities, ...(state.document.dxfLayouts ?? []).flatMap(l => paperDocument(state.document, l).entities)], ids = new Set([...state.selectedEntityIds, ...state.selectedPaperIds]), types = new Map<string, number>(), sources = new Map<string, number>(), layers = selectedLayerCounts(state.document, state.selectedEntityIds); for (const e of all)
    if (ids.has(e.id)) {
        const type = e.source?.originalType ?? e.type;
        types.set(type, (types.get(type) ?? 0) + 1);
        if (e.source)
            sources.set(e.source.originalLayer, (sources.get(e.source.originalLayer) ?? 0) + 1);
    } for (const e of all)
    if (state.selectedPaperIds.includes(e.id))
        layers.set(e.layerId, (layers.get(e.layerId) ?? 0) + 1); const readonly = state.selectedPaperIds.length + state.document.entities.filter(e => state.selectedEntityIds.includes(e.id) && (state.document.layers.find(l => l.id === e.layerId)?.locked || e.type === 'raster_underlay' && e.locked)).length; return { types, sources, layers, readonly }; }, [state.document, state.selectedEntityIds, state.selectedPaperIds]); return <div className="selection-summary" data-testid="group-properties"><strong>Выбрано: {state.selectedEntityIds.length + state.selectedPaperIds.length} объектов</strong><small>Контекст: {state.selectionScopeLabel ?? 'выбор'} · {state.document.dxfLayouts?.find(l => l.id === state.layoutId)?.name ?? 'Model'}{state.viewportEditing ? ` · Viewport ${(state.document.dxfLayouts?.find(l => l.id === state.layoutId)?.viewports.findIndex(v => v.id === state.dxfViewportId) ?? -1) + 1}` : ''}</small><p>Редактируемые MODEL: {state.selectedEntityIds.length + state.selectedPaperIds.length - summary.readonly} · Только чтение: {summary.readonly}</p><h3>Типы</h3>{[...summary.types].map(([name, count]) => <div key={name}>{name} — {count}</div>)}<h3>Слои</h3>{[...summary.layers].map(([id, count]) => <div key={id}>{state.document.layers.find(l => l.id === id)?.name} — {count}</div>)}{summary.sources.size > 0 && <details><summary>Исходные слои DXF</summary>{[...summary.sources].map(([name, count]) => <div key={name}>{name} — {count}</div>)}</details>}<div className="summary-actions"><button onClick={() => dispatch({ type: 'layer-panel-filter', filter: 'selected' })}>Показать слои</button><button onClick={() => dispatch({ type: 'isolate-layers', layerIds: [...summary.layers.keys()], label: 'слои выбранных объектов' })}>Только слои выбранного</button><button onClick={() => dispatch({ type: 'fit-entities', entityIds: [...state.selectedEntityIds, ...state.selectedPaperIds], size })}>Fit</button><button onClick={() => dispatch({ type: 'select', entityId: null })}>Снять выделение</button></div></div>; }
