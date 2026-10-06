import type { Entity, EntityStyle, GeoDocument, Layer } from '../domain/model';
export const lineTypes = [
    { id: 'continuous', label: 'Сплошная', dash: undefined }, { id: 'dashed', label: 'Штриховая', dash: '8 4' },
    { id: 'dash_dot', label: 'Штрихпунктирная', dash: '8 3 2 3' }, { id: 'dotted', label: 'Точечная', dash: '1 3' },
    { id: 'center', label: 'Осевая', dash: '16 4 3 4' }
] as const;
export type LineTypeId = typeof lineTypes[number]['id'];
export const lineWidths = [.25, .5, 1, 1.5, 2, 3, 4] as const;
export interface StyleValues {
    strokeColor: string;
    lineType: LineTypeId;
    lineWidth: number;
    opacity: number;
    fillColor: string;
    fillOpacity: number;
    textColor: string;
    textSize: number;
}
export type LayerStyle = Partial<StyleValues>;
/** null is an intentional ByLayer choice; absent retains the imported source baseline. */
export type StyleOverrides = {
    [K in keyof StyleValues]?: StyleValues[K] | null;
};
export interface ResolvedStyle extends EntityStyle {
    opacity: number;
    fillOpacity: number;
    textColor: string;
    textSize: number | undefined;
}
const fallback: EntityStyle = { id: 'fallback', stroke: '#546675', fill: 'none', lineWeight: 1.5 };
const cache = new WeakMap<Entity, WeakMap<Layer, WeakMap<GeoDocument['styles'], ResolvedStyle>>>();
export function styleIntent<K extends keyof StyleValues>(key: K, override: StyleOverrides | undefined, layer: LayerStyle | undefined, sourceLayer: LayerStyle | undefined, byLayer: () => StyleValues[K] | undefined): StyleValues[K] | undefined {
    return override?.[key] === null ? layer?.[key] ?? byLayer() : override?.[key] ?? layer?.[key] ?? sourceLayer?.[key];
}
export function resolveEntityStyle(document: GeoDocument, e: Entity, layer = document.layers.find(l => l.id === e.layerId)!): ResolvedStyle {
    let layers = cache.get(e);
    if (!layers) {
        layers = new WeakMap();
        cache.set(e, layers);
    }
    let styles = layers.get(layer);
    if (!styles) {
        styles = new WeakMap();
        layers.set(layer, styles);
    }
    const cached = styles.get(document.styles);
    if (cached)
        return cached;
    const original = document.styles.find(s => s.id === (e.styleId ?? layer.styleId)) ?? fallback, byLayer = document.styles.find(s => s.id === layer.styleId) ?? fallback;
    const legacy = (s: EntityStyle, key: keyof StyleValues): string | number | undefined => ({ strokeColor: s.stroke, lineWidth: s.lineWeight, opacity: s.opacity ?? 1, fillColor: s.fill, fillOpacity: s.fillOpacity ?? 1, textColor: s.textColor ?? s.stroke, textSize: s.textSize, lineType: lineTypes.find(t => t.dash === s.dash)?.id ?? 'continuous' })[key];
    const value = (key: keyof StyleValues) => e.type==='symbol'&&!styleKeysFor(e).includes(key)?legacy(original,key):styleIntent(key, e.style, layer.style, undefined, () => legacy(byLayer, key) as never) ?? legacy(original, key);
    const lineType = value('lineType') as LineTypeId;
    const result: ResolvedStyle = { ...original, stroke: value('strokeColor') as string, fill: value('fillColor') as string, lineWeight: value('lineWidth') as number, opacity: value('opacity') as number, fillOpacity: value('fillOpacity') as number, textColor: (styleIntent('textColor', e.style, layer.style, undefined, () => legacy(byLayer, 'textColor') as string) ?? value('strokeColor')) as string, textSize: value('textSize') as number | undefined, dash: e.type==='symbol'?original.dash:e.style?.lineType===null&&layer.style?.lineType===undefined?byLayer.dash:e.style?.lineType === undefined && layer.style?.lineType === undefined ? original.dash : lineTypes.find(t => t.id === lineType)?.dash };
    styles.set(document.styles, result);
    return result;
}
export function styleKeysFor(e: Entity): (keyof StyleValues)[] { if (e.type === 'raster_underlay')
    return []; if (e.type === 'symbol')
    return ['lineWidth', 'opacity']; if (e.type === 'text' || e.type === 'label')
    return ['strokeColor', 'opacity', 'textColor', 'textSize']; if (e.type === 'dimension')
    return ['strokeColor', 'lineType', 'lineWidth', 'opacity', 'textColor', 'textSize']; return ['strokeColor', 'lineType', 'lineWidth', 'opacity', ...(e.type === 'polygon' ? ['fillColor', 'fillOpacity'] as const : [])]; }
export function capturedStyle(e: Entity, document?: GeoDocument): StyleOverrides {
    const layer = document?.layers.find(l => l.id === e.layerId), original = document?.styles.find(s => s.id === e.styleId), baseline = document?.styles.find(s => s.id === layer?.styleId);
    const legacy = (s: EntityStyle | undefined): {
        [K in keyof StyleValues]?: StyleValues[K] | undefined;
    } => s ? { strokeColor: s.stroke, lineWidth: s.lineWeight, lineType: lineTypes.find(t => t.dash === s.dash)?.id, fillColor: s.fill, opacity: s.opacity, textColor: s.textColor, textSize: s.textSize, fillOpacity: s.fillOpacity } : {};
    const source = legacy(original), byLayer = legacy(baseline);
    return Object.fromEntries(styleKeysFor(e).map(k => [k, e.style?.[k] !== undefined ? e.style[k] : source[k] !== undefined && source[k] !== byLayer[k] ? source[k] : null]));
}
