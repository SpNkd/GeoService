import { projectionOf, presentationZ } from '../view/projection';
import { dimensionPresentationPoints } from '../view/geometry';
import type { WorldPoint, Viewport } from '../domain/model';
import { alignedDimension } from '../geometry/survey';
import { formatDistance } from '../geometry/format';
import { worldToScreen, type ViewSize } from '../geometry';

export function DimensionView({ a, b, offset, viewport, size, textPosition = 0.5, color = '#637f8e', preview = false, grips = false }: {
  a: WorldPoint; b: WorldPoint; offset: number; viewport: Viewport; size: ViewSize; textPosition?: number; color?: string; preview?: boolean; grips?: boolean;
}) {
  const geometry = projectionOf(viewport)?dimensionPresentationPoints(a,b,offset,textPosition):alignedDimension(a,b,offset,textPosition);
  const originalA = worldToScreen(a, viewport, size), originalB = worldToScreen(b, viewport, size);
  const start = worldToScreen(geometry.start, viewport, size), end = worldToScreen(geometry.end, viewport, size);
  const label = worldToScreen(geometry.label, viewport, size);
  // Leave the point marker's center reachable through the extension hit area.
  const extensionHit = (original: { x: number; y: number }, end: { x: number; y: number }) => {
    const length = Math.hypot(end.x - original.x, end.y - original.y);
    const t = length > 0 ? Math.min(1, 14 / length) : 1;
    return `M${original.x + (end.x - original.x) * t},${original.y + (end.y - original.y) * t}L${end.x},${end.y}`;
  };
  return <g className="dimension-shape" stroke={color} fill="none" strokeWidth={1.2} strokeDasharray={preview ? '4 3' : undefined} pointerEvents={preview ? 'none' : undefined}>
    <line x1={originalA.x} y1={originalA.y} x2={start.x} y2={start.y} className="extension-line" pointerEvents="none" />
    <line x1={originalB.x} y1={originalB.y} x2={end.x} y2={end.y} className="extension-line" pointerEvents="none" />
    {!preview && <path d={`${extensionHit(originalA, start)} ${extensionHit(originalB, end)}`} stroke="transparent" strokeWidth={14} />}
    {!preview && <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="transparent" strokeWidth={14} />}
    <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
    <path d={`M${start.x - 4},${start.y + 5}l8,-10 M${end.x - 4},${end.y + 5}l8,-10`} />
    {!preview && <rect data-dimension-text-handle="" x={label.x - Math.max(28, formatDistance(geometry.length).length * 3.7)} y={label.y - 24} width={Math.max(56, formatDistance(geometry.length).length * 7.4)} height={22} fill="transparent" stroke="none" pointerEvents="all" />}
    <text pointerEvents="none" data-testid={preview ? 'dimension-preview-value' : 'dimension-value'} x={label.x} y={label.y - 7} textAnchor="middle" fill={color} stroke="none" className="dimension-label">{formatDistance(geometry.length)}{projectionOf(viewport)&&presentationZ(a)!==presentationZ(b)?' · плановый размер':''}</text>
    {grips && !preview && ([['start', originalA], ['end', originalB]] as const).map(([endpoint, point]) => <g key={endpoint} data-dimension-reference-grip={endpoint} data-testid={`dimension-${endpoint}-grip`} aria-label={`Изменить привязку ${endpoint === 'start' ? 'начала' : 'конца'} размера`} className="dimension-reference-grip">
      <circle cx={point.x} cy={point.y} r={7} fill="transparent" stroke="none" pointerEvents="all" />
      <circle cx={point.x} cy={point.y} r={5} fill="white" stroke={color} strokeWidth={2} pointerEvents="none" />
    </g>)}
  </g>;
}
