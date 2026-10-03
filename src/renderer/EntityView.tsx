import type { GeoDocument, Viewport } from '../domain/model';
import { entityPoints, entityVertexIds } from '../domain/model';
import { worldToScreen, type ViewSize } from '../geometry';
import { formatCoordinate } from '../geometry/format';
import type { RenderItem } from './selectors';

interface Props { item: RenderItem; document: GeoDocument; viewport: Viewport; size: ViewSize; selected: boolean }
const selectionColor = '#277ec1';

export function EntityView({ item: { entity, layer, style }, document, viewport, size, selected }: Props) {
  const ids = entityVertexIds(entity);
  const world = entityPoints(entity, document.vertices);
  const screen = world.map(point => worldToScreen(point, viewport, size));
  const stroke = selected ? selectionColor : style.stroke;
  const editable = selected && !layer.locked;
  const attributes = { stroke, strokeWidth: selected ? 2.2 : style.lineWeight, strokeDasharray: style.dash };
  let shape: React.ReactNode;
  switch (entity.type) {
    case 'point': {
      const p = screen[0]!;
      const placeLeft = p.x > size.width - 120, placeBelow = p.y < 50;
      const labelX = p.x + (placeLeft ? -13 : 13), labelY = p.y + (placeBelow ? 19 : -10);
      shape = <>
        <circle cx={p.x} cy={p.y} r={14} fill="transparent" pointerEvents="all" />
        {selected && <circle cx={p.x} cy={p.y} r={12} fill="#277ec115" stroke={selectionColor} strokeWidth={1} pointerEvents="none" />}
        <path d={`M ${p.x - 8} ${p.y} h 16 M ${p.x} ${p.y - 8} v 16`} stroke={stroke} strokeWidth={1} pointerEvents="none" />
        <circle cx={p.x} cy={p.y} r={3.5} fill={style.fill} {...attributes} pointerEvents="none" />
        <text className="point-label" x={labelX} y={labelY} textAnchor={placeLeft ? 'end' : 'start'} fill={stroke} pointerEvents="none">{entity.name}</text>
        {world[0]!.z !== undefined && <text className="height-label" x={labelX} y={labelY + 14} textAnchor={placeLeft ? 'end' : 'start'} fill="#7b8993" pointerEvents="none">{formatCoordinate(world[0]!.z!)}</text>}
      </>;
      break;
    }
    case 'line': {
      const a = screen[0]!, b = screen[1]!;
      shape = <>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...attributes} pointerEvents="none" />
        {editable && screen.map((p, i) => <rect key={ids[i]} data-vertex-handle="" data-vertex-id={ids[i]} x={p.x - 4} y={p.y - 4} width={8} height={8} fill="white" stroke={selectionColor} />)}
      </>;
      break;
    }
    case 'polyline': case 'polygon': {
      const points = screen.map(p => `${p.x},${p.y}`).join(' ');
      shape = <>
        {entity.type === 'polygon'
          ? <polygon points={points} fill={selected ? '#277ec110' : style.fill} {...attributes} />
          : <><polyline points={points} fill="none" stroke="transparent" strokeWidth={14} /><polyline points={points} fill="none" {...attributes} pointerEvents="none" /></>}
        {editable && screen.map((p, i) => <rect key={ids[i]} data-vertex-handle="" data-vertex-id={ids[i]} x={p.x - 4} y={p.y - 4} width={8} height={8} fill="white" stroke={selectionColor} />)}
      </>;
      break;
    }
    case 'text': {
      const p = screen[0]!;
      shape = <>
        {selected && <rect x={p.x - 4} y={p.y - entity.fontSize - 3} width={entity.content.length * entity.fontSize * 0.66 + 8} height={entity.fontSize + 10} fill="#277ec110" stroke={selectionColor} strokeDasharray="3 3" pointerEvents="none" />}
        <text x={p.x} y={p.y} fill={stroke} fontSize={entity.fontSize} className="annotation-label" pointerEvents="none">{entity.content}</text>
      </>;
      break;
    }
  }
  return <g data-entity-id={entity.id} data-entity-type={entity.type} data-selected={selected} data-vertex-id={entity.type === 'point' ? entity.vertexId : undefined}
    className={layer.locked ? 'entity locked' : 'entity'} aria-label={entity.name}>
    <title>{entity.name}{layer.locked ? ' · заблокирован, только просмотр' : ''}</title>{shape}
  </g>;
}
