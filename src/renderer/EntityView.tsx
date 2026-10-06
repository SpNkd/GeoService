import { viewRotation, projectionOf } from '../view/projection';
import { ConnectorView } from './ConnectorView';
import { VectorView } from './VectorView';
import { SymbolView } from './SymbolView';
import { memo } from 'react';
import type { GeoDocument, Viewport } from '../domain/model';
import { entityPoints, entityVertexIds } from '../domain/model';
import { worldToScreen, type ViewSize } from '../geometry';
import { formatHeight, formatDistance } from '../geometry/format';
import { lockedVertexIds } from '../domain/commands';
import { distance } from '../geometry';
import { resolvedLabelPosition, resolveLabelTemplate } from '../geometry/labels';
import type { PointLabelMode } from '../store/editor';
import { GeometryPath } from './PreviewPrimitives';
import { DimensionView } from './DimensionView';
import type { RenderItem } from './selectors';

interface Props { item: RenderItem; document: GeoDocument; viewport: Viewport; size: ViewSize; selected: boolean; order?: number; pointLabelMode?: PointLabelMode; showLineLengths?: boolean; dimensionRetarget?: { endpoint: 'start' | 'end'; vertexId: string | null } | null }
const selectionColor = '#277ec1';

export const EntityView = memo(function EntityView({ item: { entity, layer, style }, document, viewport, size, selected, order, pointLabelMode = 'name-z', showLineLengths = false, dimensionRetarget = null }: Props) {
  const ids = entityVertexIds(entity);
  const world = entityPoints(entity, document.vertices);
  const screen = world.map(point => worldToScreen(point, viewport, size));
  const stroke = selected ? selectionColor : style.stroke;
  const textColor=selected?selectionColor:style.textColor??stroke;
  const editable = selected && !layer.locked && !projectionOf(viewport);
  const locked = editable && (entity.type === 'line' || entity.type === 'polyline' || entity.type === 'polygon') ? lockedVertexIds(document) : null;
  const attributes = { stroke, strokeWidth: selected ? 2.2 : style.lineWeight, strokeDasharray: style.dash };
  let shape: React.ReactNode;
  switch (entity.type) {
    case 'raster_underlay': {shape=null;break;}
    case 'arc': case 'circle': case 'block_instance': case 'imported_graphic': { shape=<VectorView entity={entity} document={document} viewport={viewport} size={size} color={style.stroke} selected={selected} lineWeight={style.lineWeight} />; break; }
    case 'connector': {shape=<ConnectorView entity={entity} document={document} viewport={viewport} size={size} stroke={stroke} lineWeight={selected?2.2:style.lineWeight} dash={style.dash} editable={editable}/>;break;}
    case 'symbol': { shape = <SymbolView entity={entity} viewport={viewport} size={size} color={stroke} lineWeight={style.lineWeight} selected={selected} />; break; }
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
          ? <><path d={`M${screen.map(p => `${p.x},${p.y}`).join('L')}Z`} fill="transparent" stroke="transparent" strokeWidth={14} pointerEvents="all" data-move-body="" /><GeometryPath points={screen} closed fill={style.fill} fillOpacity={style.fillOpacity??1} {...attributes} pointerEvents="none" /></>
          : <><GeometryPath points={screen} closed={false} fill="none" stroke="transparent" strokeWidth={14} /><GeometryPath points={screen} closed={false} fill="none" {...attributes} pointerEvents="none" /></>}
        {editable && screen.map((p, i) => locked && !locked.has(ids[i]!) && <rect key={`${ids[i]}:${i}`} data-vertex-handle="" data-vertex-id={ids[i]} x={p.x - 4} y={p.y - 4} width={8} height={8} fill="white" stroke={selectionColor} />)}
      </>;
      break;
    }
    case 'dimension': {
      const candidate = dimensionRetarget?.vertexId ? document.vertices[dimensionRetarget.vertexId] : undefined;
      const isOpposite = candidate?.id === (dimensionRetarget?.endpoint === 'start' ? entity.endVertexId : entity.startVertexId);
      const a = dimensionRetarget?.endpoint === 'start' && candidate && !isOpposite ? candidate : world[0]!;
      const b = dimensionRetarget?.endpoint === 'end' && candidate && !isOpposite ? candidate : world[1]!;
      const target = candidate && worldToScreen(candidate, viewport, size);
      shape = <>
        <g opacity={dimensionRetarget ? 0.28 : 1}><DimensionView a={world[0]!} b={world[1]!} offset={entity.offset} textPosition={entity.textPosition ?? 0.5} viewport={viewport} size={size} color={stroke} textColor={textColor} lineWeight={style.lineWeight} dash={style.dash} textSize={style.textSize} grips={editable} /></g>
        {dimensionRetarget && candidate && !isOpposite && <DimensionView a={a} b={b} offset={entity.offset} textPosition={entity.textPosition ?? 0.5} viewport={viewport} size={size} color="#18865b" preview />}
        {dimensionRetarget && target && <circle data-testid="dimension-retarget-target" cx={target.x} cy={target.y} r={7} fill={isOpposite ? '#fff' : '#e6fff1'} stroke={isOpposite ? '#c94242' : '#18865b'} strokeWidth={2} pointerEvents="none" />}
      </>;
      break;
    }
    case 'text': {
      const p = screen[0]!,fontSize=style.textSize??(entity.height?entity.height*viewport.pixelsPerUnit:entity.fontSize);
      shape = <g transform={`translate(${p.x} ${p.y}) rotate(${-((entity.rotationDeg??0)+viewRotation(viewport))})`}>
        <rect x={-7} y={-fontSize-7} width={Math.max(28, Math.max(...entity.content.split('\n').map(line=>line.length)) * fontSize * 0.7 + 14)} height={fontSize * (1 + (entity.content.split('\n').length-1)*1.2) + 14} fill={selected ? '#277ec110' : 'transparent'} stroke={selected ? selectionColor : 'transparent'} strokeDasharray="3 3" pointerEvents="all" />
        <text x={0} y={0} fill={textColor} fontSize={fontSize} className="annotation-label" pointerEvents="none">{entity.content.split('\n').map((line,i)=><tspan key={i} x={0} dy={i?1.2*fontSize:0}>{line}</tspan>)}</text>
      </g>;
      break;
    }
    case 'label': {
      const position = resolvedLabelPosition(document, entity);
      const p = position && worldToScreen(position, viewport, size), content = resolveLabelTemplate(document, entity);
      if (!p) { shape = null; break; }
      const width = Math.max(32, content.length * 7.4 + 16);
      shape = <>
        <rect x={p.x - 6} y={p.y - 17} width={width} height={24} rx={3} fill={selected ? '#277ec120' : 'transparent'} stroke={selected ? selectionColor : 'transparent'} strokeDasharray="3 3" pointerEvents="all" />
        <text x={p.x} y={p.y} fill={textColor} style={{fontSize:style.textSize}} className="annotation-label" pointerEvents="none">{content}</text>
      </>;
      break;
    }
    default: { const unsupported: never = entity; throw new Error(`Unsupported entity: ${String(unsupported)}`); }
  }
  return <g data-entity-id={entity.id} data-entity-type={entity.type} data-selected={selected} data-vertex-id={entity.type === 'point' ? entity.vertexId : undefined}
    opacity={selected||['arc','circle','block_instance','imported_graphic'].includes(entity.type)?1:style.opacity??1} className={layer.locked ? 'entity locked' : 'entity'} aria-label={entity.name}>
    <title>{`${entity.name}${layer.locked ? ' · заблокирован, только просмотр' : ''}`}</title>{shape}
  </g>;
}, (previous, next) => {
  if (previous.item.entity !== next.item.entity || previous.item.layer !== next.item.layer || previous.item.style !== next.item.style
    || previous.viewport !== next.viewport || previous.size !== next.size || previous.selected !== next.selected || previous.order !== next.order
    || previous.pointLabelMode !== next.pointLabelMode || previous.showLineLengths !== next.showLineLengths || previous.dimensionRetarget !== next.dimensionRetarget) return false;
  // Handle availability depends on every consumer's layer, not just this entity.
  if (previous.document.layers !== next.document.layers) return false;
  if (next.selected && ['line','polyline','polygon'].includes(next.item.entity.type) && previous.document.entities !== next.document.entities) return false;
  if (['block_instance','imported_graphic'].includes(next.item.entity.type) && previous.document.blocks !== next.document.blocks) return false;
  if (!entityVertexIds(next.item.entity).every(id => previous.document.vertices[id] === next.document.vertices[id])) return false;
  if(next.item.entity.type==='connector'){const e=next.item.entity;return [e.start.symbolEntityId,e.end.symbolEntityId].every(id=>previous.document.entities.find(e=>e.id===id)===next.document.entities.find(e=>e.id===id));}
  if (next.item.entity.type === 'label') {
    if (previous.document.verticalReference !== next.document.verticalReference) return false;
    const targetId = next.item.entity.targetId;
    const beforeTarget = previous.document.entities.find(entity => entity.id === targetId);
    const afterTarget = next.document.entities.find(entity => entity.id === targetId);
    return beforeTarget === afterTarget && (!afterTarget || entityVertexIds(afterTarget).every(id => previous.document.vertices[id] === next.document.vertices[id]));
  }
  return true;
});
