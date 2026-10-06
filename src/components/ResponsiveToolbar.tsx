import { Children, cloneElement, isValidElement, useEffect, useRef, useState, type ReactNode, type ReactElement } from 'react';
import { toolbarLayout, type ToolbarItem } from '../editor/toolbarLayout';
type NodeProps = {
    children?: ReactNode;
    className?: string;
    'aria-label'?: string;
    'aria-pressed'?: boolean;
    title?: string;
};
function textOf(node: ReactNode): string { return typeof node === 'string' ? node : typeof node === 'number' ? String(node) : isValidElement<NodeProps>(node) ? textOf(node.props.children) : Array.isArray(node) ? node.map(textOf).join('') : ''; }
function commands(children: ReactNode): ReactElement<NodeProps>[] { return Children.toArray(children).flatMap(node => { if (!isValidElement<NodeProps>(node))
    return []; const c = node.props.className ?? ''; if (c.includes('tool-group'))
    return commands(node.props.children); if (c.includes('divider') || c === 'toolbar-context')
    return []; return [node]; }); }
export function ResponsiveToolbar({ children, inert = false }: {
    children: ReactNode;
    inert?: boolean;
}) {
    const ref = useRef<HTMLElement>(null), menu = useRef<HTMLDetailsElement>(null), [width, setWidth] = useState(() => window.innerWidth), nodes = commands(children);
    useEffect(() => { if (!ref.current)
        return; const observer = new ResizeObserver(([entry]) => { if (entry)
        setWidth(w => Math.abs(w - entry.contentRect.width) > .5 ? entry.contentRect.width : w); }); observer.observe(ref.current); return () => observer.disconnect(); }, []);
    const metadata: ToolbarItem[] = nodes.map((node, i) => { const label = node.props['aria-label'] ?? textOf(node), primary = /Инструмент: (Выбор|Точка|Линия|Полилиния|Полигон|Текст|Размер)$/.test(label), common = /Новый документ|Открыть JSON|Сохранить JSON|Отменить|Повторить|Переместить|Повернуть/.test(label), compactable = node.type === 'button' && !primary && Children.toArray(node.props.children).some(c => isValidElement(c)); return { id: String(i), priority: primary ? 0 : common ? 1 : 2, width: Math.max(34, Math.ceil(textOf(node).length * 6.7) + (Children.toArray(node.props.children).some(c => isValidElement(c)) ? 36 : 22)), compactWidth: 34, compactable }; });
    const layout = toolbarLayout(width, metadata), overflowActive = layout.overflow.some(id => nodes[Number(id)]?.props['aria-pressed']);
    const render = (id: string, inMenu = false) => { const node = nodes[Number(id)]!, item = metadata[Number(id)]!, label = node.props['aria-label'] ?? textOf(node), compact = layout.compact && item.compactable && !inMenu; const icons = Children.toArray(node.props.children).filter(c => isValidElement(c)); return <span className="toolbar-item" key={id} style={inMenu ? undefined : { width: compact ? item.compactWidth : item.width }}>{compact ? cloneElement(node, { 'aria-label': label, title: node.props.title ?? label, children: icons }) : cloneElement(node, { 'aria-label': label, title: node.props.title ?? label })}</span>; };
    return <nav ref={ref} inert={inert} className="toolbar responsive-toolbar" aria-label="Инструменты редактора">{layout.visible.map(id => render(id))}{layout.overflow.length > 0 && <details ref={menu} className="toolbar-overflow" onKeyDown={e => { if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        menu.current!.open = false;
        menu.current!.querySelector('summary')?.focus();
    } }}><summary aria-label="Ещё инструменты" className={overflowActive ? 'active' : ''}>Ещё ▾{overflowActive && <span aria-hidden="true"> ●</span>}</summary><div aria-label="Дополнительные инструменты" onClick={e => { if (e.target instanceof Element && e.target.closest('button'))
        menu.current!.open = false; }}>{layout.overflow.map(id => render(id, true))}</div></details>}</nav>;
}
