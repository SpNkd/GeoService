import { useEffect, useState, Children, cloneElement, isValidElement, type ReactNode, type ReactElement } from 'react';
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
    return commands(node.props.children); return c.includes('divider') || c === 'toolbar-context' ? [] : [node]; }); }
export function ResponsiveToolbar({ children, inert = false }: {
    children: ReactNode;
    inert?: boolean;
}) {
    const [width, setWidth] = useState(() => window.innerWidth);
    useEffect(() => { const resize = () => setWidth(window.innerWidth); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
    const nodes = commands(children), label = (n: ReactElement<NodeProps>) => n.props['aria-label'] ?? textOf(n), take = (re: RegExp) => nodes.filter(n => re.test(label(n))), render = (n: ReactElement<NodeProps>) => cloneElement(n, { 'aria-label': label(n), title: n.props.title ?? label(n) });
    const group = (name: string, entries: ReactElement<NodeProps>[], active = false) => <details className={`toolbar-menu ${name === 'Ещё' ? 'toolbar-overflow' : ''}`} data-popup key={name}><summary aria-label={name === 'Ещё' ? 'Ещё инструменты' : undefined} className={active ? 'active' : ''}>{name} ▾</summary><div>{entries.map((n, i) => <span key={i}>{render(n)}</span>)}</div></details>;
    const lines = take(/^Инструмент: (Линия|Полилиния)$/), polyline = lines.find(n => label(n).endsWith('Полилиния'))?.props['aria-pressed'];
    return <nav inert={inert} className="toolbar semantic-toolbar" aria-label="Инструменты редактора">
 {group('Файл / данные', take(/Новый документ|Открыть JSON|Сохранить JSON|^DXF$|[Пп]одложк|Импорт координат|Векторизация изображения/))}
 {group('Правка', take(/Повернуть выделенное|Переместить выбор|Научить GeoService|Смысл \/ категории/))}
 <div className="semantic-draw" role="group" aria-label="Рисование">{take(/^Инструмент: (Выбор|Точка)$/).map(render)}{group(polyline ? 'Полилиния' : 'Линия', lines, lines.some(n => n.props['aria-pressed']))}{take(/^Инструмент: (Полигон|Текст|Соединение)$/).map(render)}{take(/^Символы$/).map(render)}</div>
 {group('Инженерия', take(/^Инструмент: (Размер|Измерение|Панорама)$/))}
 <div className="semantic-history" role="group" aria-label="История">{take(/^(Отменить|Повторить)$/).map(n => cloneElement(render(n), { children: Children.toArray(n.props.children).filter(isValidElement) }))}</div>
 {width < 1100 ? group('Ещё', take(/Горячие клавиши/)) : take(/Горячие клавиши/).map(render)}
 </nav>;
}
