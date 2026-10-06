import { useState, type Dispatch } from 'react';
import { lineTypes, lineWidths, styleKeysFor, type StyleValues, type StyleOverrides, type LayerStyle } from '../styles/model';
import type { EditorAction, EditorState } from '../store/editor';
const labels: Record<keyof StyleValues, string> = { strokeColor: 'Цвет', lineType: 'Тип линии', lineWidth: 'Толщина, px', opacity: 'Непрозрачность', fillColor: 'Заливка', fillOpacity: 'Непрозрачность заливки', textColor: 'Цвет текста', textSize: 'Размер текста, px' };
const presets = ['#24834B', '#D34444', '#246BCC', '#314652', '#E2A530', '#7C4BAD'];
function StyleFields({ keys, values, label, disabled, onChange, layer = false, supported, sources }: {
    keys: (keyof StyleValues)[];
    values: (StyleOverrides | LayerStyle)[];
    label: string;
    disabled: boolean;
    onChange: (patch: StyleOverrides) => void;
    layer?: boolean;
    supported?: (key: keyof StyleValues, index: number) => boolean;
    sources?: boolean[];
}) {
    const [recent, setRecent] = useState<string[]>([]);
    return <div className="style-fields">{keys.map(key => {
            const relevant = values.flatMap((v, index) => !supported || supported(key, index) ? [{ value: v[key], source: sources?.[index] ?? false }] : []), raw = relevant[0]?.value, mode = (v: typeof relevant[number]) => v.value === undefined && v.source ? 'source' : v.value === null || v.value === undefined ? 'inherit' : String(v.value), mixed = relevant.some(v => mode(v) !== mode(relevant[0]!)), current = mixed ? 'mixed' : mode(relevant[0]!), color = key.includes('Color');
            const pickerColor=typeof raw === 'string' && /^#[\da-f]{6}$/i.test(raw)?raw.toUpperCase():'#314652';
            const commit = (value: string) => { if (value === 'mixed' || value === 'source')
                return; const next = value === 'inherit' ? null : color || key === 'lineType' ? value : Number(value); if (layer && next === null)
                return; onChange({ [key]: next }); if (color && typeof next === 'string' && next !== 'none')
                setRecent(r => [next, ...r.filter(c => c !== next)].slice(0, 4)); };
            return <label key={key}>{labels[key]}<select aria-label={`${label}: ${labels[key]}`} value={current} disabled={disabled} onChange={e => commit(e.target.value)}><option value="source" disabled hidden={current !== 'source'}>Источник DXF</option><option value="inherit">{layer ? 'Исходный / по умолчанию' : 'По слою'}</option>{mixed && <option value="mixed">Смешанный</option>}{color ? <>{key === 'fillColor' && <option value="none">Нет заливки</option>}{[...new Set([...presets, ...recent, ...(!['mixed', 'inherit', 'source', 'none'].includes(current) ? [current] : [])])].map(c => <option key={c} value={c}>{c}</option>)}</> : key === 'lineType' ? lineTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>) : [...new Set([...(key === 'lineWidth' ? lineWidths : key === 'textSize' ? [10, 12, 14, 18, 24, 36] : [0, .25, .4, .5, .75, 1]), ...(!['mixed', 'inherit', 'source'].includes(current) ? [Number(current)] : [])])].map(v => <option key={v} value={v}>{key.includes('pacity') ? `${v * 100}%` : v}</option>)}</select>{color && <input aria-label={`${label}: ${labels[key]} свой`} type="color" key={`${key}-${raw}`} defaultValue={pickerColor} disabled={disabled} onBlur={e => { if (e.target.value.toUpperCase() !== pickerColor)
                commit(e.target.value.toUpperCase()); }}/>}</label>;
        })}</div>;
}
export function CurrentStyle({ state, dispatch }: {
    state: EditorState;
    dispatch: Dispatch<EditorAction>;
}) { return <details className="current-style"><summary>Стиль рисования</summary><StyleFields label="Текущий стиль" keys={['strokeColor', 'lineType', 'lineWidth']} values={[state.currentStyle]} disabled={!!state.transactionBefore} onChange={patch => dispatch({ type: 'current-style', patch })}/></details>; }
export function SelectionStyle({ state, dispatch }: {
    state: EditorState;
    dispatch: Dispatch<EditorAction>;
}) {
    const selected = state.document.entities.filter(e => state.selectedEntityIds.includes(e.id));
    if (state.deepSelection || !selected.length)
        return null;
    const compatible = selected.filter(e => styleKeysFor(e).length), skipped = selected.length - compatible.length;
    const keys = [...new Set(compatible.flatMap(styleKeysFor))];
    const disabled = !!state.transactionBefore || state.selectedPaperIds.length>0 || selected.some(e => state.document.layers.find(l => l.id === e.layerId)?.locked || e.type === 'raster_underlay' && e.locked);
    return <details className="property-section" data-testid="selection-style" open><summary>Стиль</summary>{keys.length ? <StyleFields label="Стиль объектов" keys={keys} values={compatible.map(e => e.style ?? {})} sources={compatible.map(e => !!e.source)} supported={(key, index) => styleKeysFor(compatible[index]!).includes(key)} disabled={disabled} onChange={patch => dispatch({ type: 'apply-selection-style', patch })}/> : <small>Нет общих векторных свойств стиля.</small>}{skipped > 0 && <small>Растровые подложки используют свою непрозрачность; пропущено: {skipped}.</small>}<div className="summary-actions"><button disabled={disabled || compatible.length !== 1} onClick={() => dispatch({ type: 'copy-style', entityId: compatible[0]!.id })}>Копировать стиль</button><button disabled={disabled || !state.styleClipboard} onClick={() => dispatch({ type: 'paste-style' })}>Применить скопированный стиль</button>{compatible.some(e => e.source) && <button disabled={disabled} onClick={() => dispatch({ type: 'execute', command: { type: 'reset-entity-style', entityIds: compatible.map(e => e.id) } })}>Вернуть стиль источника</button>}</div></details>;
}
export function LayerStyleEditor({ state, dispatch, layerId }: {
    state: EditorState;
    dispatch: Dispatch<EditorAction>;
    layerId: string;
}) { const layer = state.document.layers.find(l => l.id === layerId)!; return <section className="property-section" data-testid="layer-style"><h3>Стиль слоя</h3><StyleFields label="Стиль слоя" layer keys={['strokeColor', 'lineType', 'lineWidth', 'opacity', 'fillColor', 'fillOpacity', 'textColor', 'textSize']} values={[layer.style ?? {}]} disabled={!!state.transactionBefore} onChange={patch => dispatch({ type: 'execute', command: { type: 'set-layer-style', layerId, patch: patch as LayerStyle } })}/><button className="secondary-action" disabled={!!state.transactionBefore || !layer.style} onClick={() => dispatch({ type: 'execute', command: { type: 'reset-layer-style', layerId } })}>Вернуть исходный стиль слоя</button></section>; }
