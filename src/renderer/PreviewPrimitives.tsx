import type { ScreenPoint } from '../geometry';

/** The same path primitive serves canonical entities, manual drafts and AI transient views. */
export function GeometryPath({ points, closed, ...attributes }: { points: readonly ScreenPoint[]; closed: boolean } & Omit<React.SVGProps<SVGPolygonElement>, 'points'>) {
  const coordinates = points.map(p => `${p.x},${p.y}`).join(' ');
  return closed ? <polygon points={coordinates} {...attributes} /> : <polyline points={coordinates} {...attributes} />;
}
export function MeasurementLine({ a, b }: { a: ScreenPoint; b: ScreenPoint }) {
  return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
}
