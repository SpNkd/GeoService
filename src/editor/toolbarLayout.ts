export interface ToolbarItem {
    id: string;
    width: number;
    compactWidth: number;
    priority: number;
    compactable: boolean;
}
/** Deterministic packing: every command is either visible or in the explicit overflow. */
export function toolbarLayout(width: number, items: ToolbarItem[]) {
    const compact = width < 1600, budget = Math.max(0, width - 36 - 78), ranked = items.map((item, index) => ({ item, index })).sort((a, b) => a.item.priority - b.item.priority || a.index - b.index), visible = new Set<string>();
    let used = 0;
    for (const { item } of ranked) {
        const w = compact && item.compactable ? item.compactWidth : item.width;
        if (used + w + 4 <= budget) {
            visible.add(item.id);
            used += w + 4;
        }
    }
    return { compact, visible: items.filter(i => visible.has(i.id)).map(i => i.id), overflow: items.filter(i => !visible.has(i.id)).map(i => i.id), used, budget };
}
