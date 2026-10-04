import type { WorldPoint, Viewport } from '../domain/model';
import { alignedDimension } from '../geometry/survey';
import { formatDistance } from '../geometry/format';
import { worldToScreen, type ViewSize } from '../geometry';

export function DimensionView({ a, b, offset, viewport, size, color = '#637f8e', preview = false }: {
  a: WorldPoint; b: WorldPoint; offset: number; viewport: Viewport; size: ViewSize; color?: string; preview?: boolean;
}) {
  const geometry = alignedDimension(a, b, offset);
  const originalA = worldToScreen(a, viewport, size), originalB = worldToScreen(b, viewport, size);
  const start = worldToScreen(geometry.start, viewport, size), end = worldToScreen(geometry.end, viewport, size);
  const label = worldToScreen(geometry.label, viewport, size);
  return <g className="dimension-shape" stroke={color} fill="none" strokeWidth={1.2} strokeDasharray={preview ? '4 3' : undefined} pointerEvents={preview ? 'none' : undefined}>
    <line x1={originalA.x} y1={originalA.y} x2={start.x} y2={start.y} className="extension-line" pointerEvents="none" />
    <line x1={originalB.x} y1={originalB.y} x2={end.x} y2={end.y} className="extension-line" pointerEvents="none" />
    {!preview && <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="transparent" strokeWidth={14} />}
    <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
    <path d={`M${start.x - 4},${start.y + 5}l8,-10 M${end.x - 4},${end.y + 5}l8,-10`} />
    <text data-testid={preview ? 'dimension-preview-value' : 'dimension-value'} x={label.x} y={label.y - 7} textAnchor="middle" fill={color} stroke="none" className="dimension-label">{formatDistance(geometry.length)}</text>
  </g>;
}
