import { memo } from 'react';
import type { GeoDocument, Viewport } from '../domain/model';
import { entityPoints, entityVertexIds } from '../domain/model';
import { worldToScreen, type ViewSize } from '../geometry';
import { formatHeight, formatDistance } from '../geometry/format';
import { lockedVertexIds } from '../domain/commands';
import { distance } from '../geometry';
import type { PointLabelMode } from '../store/editor';
import { GeometryPath } from './PreviewPrimitives';
import { DimensionView } from './DimensionView';
import type { RenderItem } from './selectors';

interface Props { item: RenderItem; document: GeoDocument; viewport: Viewport; size: ViewSize; selected: boolean; order?: number; pointLabelMode?: PointLabelMode; showLineLengths?: boolean }
const selectionColor = '#277ec1';

export const EntityView = memo(function EntityView({ item: { entity, layer, style }, document, viewport, size, selected, order, pointLabelMode = 'name-z', showLineLengths = false }: Props) {
  const ids = entityVertexIds(entity);
  const world = entityPoints(entity, document.vertices);
  const screen = world.map(point => worldToScreen(point, viewport, size));
  const stroke = selected ? selectionColor : style.stroke;
  const editable = selected && !layer.locked;
  const locked = editable && (entity.type === 'line' || entity.type === 'polyline' || entity.type === 'polygon') ? lockedVertexIds(document) : null;
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
        {pointLabelMode !== 'z' && <text className="point-label" x={labelX} y={labelY} textAnchor={placeLeft ? 'end' : 'start'} fill={stroke} pointerEvents="none">{entity.name}</text>}
        {pointLabelMode !== 'name' && world[0]!.z !== undefined && <text className="height-label" x={labelX} y={labelY + (pointLabelMode === 'z' ? 0 : 14)} textAnchor={placeLeft ? 'end' : 'start'} fill="#7b8993" pointerEvents="none">△ {formatHeight(world[0]!.z!)}</text>}
        {order !== undefined && <g className="selection-order" pointerEvents="none"><circle cx={p.x - 15} cy={p.y - 18} r={9} fill={selectionColor} /><text x={p.x - 15} y={p.y - 15} textAnchor="middle" fill="white">{order}</text></g>}
      </>;
      break;
    }
    case 'line': {
      const a = screen[0]!, b = screen[1]!;
      shape = <>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...attributes} pointerEvents="none" />
        {showLineLengths && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 7} textAnchor="middle" fill={stroke} className="dimension-label" pointerEvents="none">{formatDistance(distance(world[0]!, world[1]!))}</text>}
        {editable && screen.map((p, i) => locked && !locked.has(ids[i]!) && <rect key={`${ids[i]}:${i}`} data-vertex-handle="" data-vertex-id={ids[i]} x={p.x - 4} y={p.y - 4} width={8} height={8} fill="white" stroke={selectionColor} />)}
      </>;
      break;
    }
    case 'polyline': case 'polygon': {
      shape = <>
        {entity.type === 'polygon'
          ? <GeometryPath points={screen} closed fill={selected ? '#277ec110' : style.fill} {...attributes} />
          : <><GeometryPath points={screen} closed={false} fill="none" stroke="transparent" strokeWidth={14} /><GeometryPath points={screen} closed={false} fill="none" {...attributes} pointerEvents="none" /></>}
        {editable && screen.map((p, i) => locked && !locked.has(ids[i]!) && <rect key={`${ids[i]}:${i}`} data-vertex-handle="" data-vertex-id={ids[i]} x={p.x - 4} y={p.y - 4} width={8} height={8} fill="white" stroke={selectionColor} />)}
      </>;
      break;
    }
    case 'dimension': {
      shape = <DimensionView a={world[0]!} b={world[1]!} offset={entity.offset} viewport={viewport} size={size} color={stroke} />;
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
    default: { const unsupported: never = entity; throw new Error(`Unsupported entity: ${String(unsupported)}`); }
  }
  return <g data-entity-id={entity.id} data-entity-type={entity.type} data-selected={selected} data-vertex-id={entity.type === 'point' ? entity.vertexId : undefined}
    className={layer.locked ? 'entity locked' : 'entity'} aria-label={entity.name}>
    <title>{entity.name}{layer.locked ? ' · заблокирован, только просмотр' : ''}</title>{shape}
  </g>;
}, (previous, next) => {
  if (previous.item.entity !== next.item.entity || previous.item.layer !== next.item.layer || previous.item.style !== next.item.style
    || previous.viewport !== next.viewport || previous.size !== next.size || previous.selected !== next.selected || previous.order !== next.order
    || previous.pointLabelMode !== next.pointLabelMode || previous.showLineLengths !== next.showLineLengths) return false;
  // Handle availability depends on every consumer's layer, not just this entity.
  if (previous.document.entities !== next.document.entities || previous.document.layers !== next.document.layers) return false;
  return entityVertexIds(next.item.entity).every(id => previous.document.vertices[id] === next.document.vertices[id]);
});
