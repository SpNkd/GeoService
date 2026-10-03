import type { Viewport } from '../domain/model';
import { worldToScreen, type ViewSize } from '../geometry';
import { formatCoordinate } from '../geometry/format';
import type { RenderItem } from './selectors';

interface Props { item: RenderItem; viewport: Viewport; size: ViewSize; selected: boolean }
const selectionColor = '#277ec1';

export function EntityView({ item: { entity, layer, style }, viewport, size, selected }: Props) {
  const project = (point: Parameters<typeof worldToScreen>[0]) => worldToScreen(point, viewport, size);
  const stroke = selected ? selectionColor : style.stroke;
  const attributes = { stroke, strokeWidth: selected ? 2.2 : style.lineWeight, strokeDasharray: style.dash };
  let shape: React.ReactNode;
  switch (entity.type) {
    case 'point': {
      const p = project(entity.position);
      const placeLeft = p.x > size.width - 120;
      const placeBelow = p.y < 50;
      const labelX = p.x + (placeLeft ? -13 : 13);
      const labelY = p.y + (placeBelow ? 19 : -10);
      shape = <>
        <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
        {selected && <circle cx={p.x} cy={p.y} r={12} fill="#277ec115" stroke={selectionColor} strokeWidth={1} />}
        <path d={`M ${p.x - 8} ${p.y} h 16 M ${p.x} ${p.y - 8} v 16`} stroke={stroke} strokeWidth={1} />
        <circle cx={p.x} cy={p.y} r={3.5} fill={style.fill} {...attributes} />
        <text className="point-label" x={labelX} y={labelY} textAnchor={placeLeft ? 'end' : 'start'} fill={stroke}>{entity.name}</text>
        {entity.position.z !== undefined && <text className="height-label" x={labelX} y={labelY + 14} textAnchor={placeLeft ? 'end' : 'start'} fill="#7b8993">{formatCoordinate(entity.position.z)}</text>}
      </>;
      break;
    }
    case 'line': {
      const a = project(entity.start), b = project(entity.end);
      shape = <>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...attributes} />
        {selected && [a, b].map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4} fill="white" stroke={selectionColor} />)}
      </>;
      break;
    }
    case 'polyline': case 'polygon': {
      const vertices = entity.vertices.map(project);
      const points = vertices.map(p => `${p.x},${p.y}`).join(' ');
      shape = <>
        {entity.type === 'polygon'
          ? <polygon points={points} fill={selected ? '#277ec110' : style.fill} {...attributes} />
          : <><polyline points={points} fill="none" stroke="transparent" strokeWidth={14} /><polyline points={points} fill="none" {...attributes} /></>}
        {selected && vertices.map((p, i) => <rect key={i} x={p.x - 3} y={p.y - 3} width={6} height={6} fill="white" stroke={selectionColor} />)}
      </>;
      break;
    }
    case 'text': {
      const p = project(entity.position);
      shape = <>
        {selected && <rect x={p.x - 4} y={p.y - entity.fontSize - 3} width={entity.content.length * entity.fontSize * 0.66 + 8} height={entity.fontSize + 10} fill="#277ec110" stroke={selectionColor} strokeDasharray="3 3" />}
        <text x={p.x} y={p.y} fill={stroke} fontSize={entity.fontSize} className="annotation-label">{entity.content}</text>
      </>;
      break;
    }
  }
  return <g data-entity-id={entity.id} data-entity-type={entity.type} data-selected={selected}
    className={layer.locked ? 'entity locked' : 'entity'} aria-label={entity.name}>
    <title>{entity.name}{layer.locked ? ' · слой заблокирован' : ''}</title>{shape}
  </g>;
}
