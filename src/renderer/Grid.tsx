import type { Viewport } from '../domain/model';
import { screenToWorld, worldToScreen, type ViewSize } from '../geometry';

import { visualGridSteps } from '../geometry/grid';

export function Grid({ viewport, size, snapStep = 1 }: { viewport: Viewport; size: ViewSize; snapStep?: number }) {
  const { minor: step, major } = visualGridSteps(snapStep, viewport.pixelsPerUnit);
  const topLeft = screenToWorld({ x: 0, y: 0 }, viewport, size);
  const bottomRight = screenToWorld({ x: size.width, y: size.height }, viewport, size);
  const lines: React.ReactNode[] = [];
  const labels: React.ReactNode[] = [];
  // Integer indices avoid accumulated floating-point drift in fractional grid steps.
  const firstX = Math.ceil(topLeft.x / step), lastX = Math.floor(bottomRight.x / step);
  const firstY = Math.ceil(bottomRight.y / step), lastY = Math.floor(topLeft.y / step);
  // i++ cannot advance beyond the safe integer range. Bound work for arbitrary loaded coordinates.
  const xCount = Number.isSafeInteger(firstX) && Number.isSafeInteger(lastX) ? Math.max(0, Math.min(200, lastX - firstX + 1)) : 0;
  const yCount = Number.isSafeInteger(firstY) && Number.isSafeInteger(lastY) ? Math.max(0, Math.min(200, lastY - firstY + 1)) : 0;
  for (let offset = 0; offset < xCount; offset++) {
    const i = firstX + offset;
    const x = worldToScreen({ x: i * step, y: 0 }, viewport, size).x;
    lines.push(<line key={`x${i}`} data-grid-kind={i % 5 === 0 ? 'major' : 'minor'} stroke={i % 5 === 0 ? '#cad6df' : '#e7edf1'} x1={x} y1={0} x2={x} y2={size.height} />);
    if (i % 5 === 0) labels.push(<text key={`x${i}`} x={x + 5} y={18}>{Number((i * step).toPrecision(12))}</text>);
  }
  for (let offset = 0; offset < yCount; offset++) {
    const i = firstY + offset;
    const y = worldToScreen({ x: 0, y: i * step }, viewport, size).y;
    lines.push(<line key={`y${i}`} data-grid-kind={i % 5 === 0 ? 'major' : 'minor'} stroke={i % 5 === 0 ? '#cad6df' : '#e7edf1'} x1={0} y1={y} x2={size.width} y2={y} />);
    if (y > 35 && i % 5 === 0) labels.push(<text key={`y${i}`} x={8} y={y - 6}>{Number((i * step).toPrecision(12))}</text>);
  }
  return <g data-minor-step={step} data-major-step={major} className="world-grid" pointerEvents="none">
    <g stroke="#dce3e8" strokeWidth={0.65}>{lines}</g>
    <g fill="#99a5af" fontSize={10} fontFamily="monospace">{labels}</g>
  </g>;
}
