import type { WorldPoint } from '../domain/model';
/** World axes, independent of viewport; Shift overrides persistent Ortho. */
export function constrainAngle(origin: WorldPoint, cursor: WorldPoint, incrementDeg: 45 | 90): WorldPoint {
  const dx = cursor.x - origin.x, dy = cursor.y - origin.y, length = Math.hypot(dx, dy);
  const step = incrementDeg * Math.PI / 180, angle = Math.round(Math.atan2(dy, dx) / step) * step;
  // Exact axis/diagonal directions avoid trigonometric residuals.
  const index = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  const directions = [[1, 0], [Math.SQRT1_2, Math.SQRT1_2], [0, 1], [-Math.SQRT1_2, Math.SQRT1_2], [-1, 0], [-Math.SQRT1_2, -Math.SQRT1_2], [0, -1], [Math.SQRT1_2, -Math.SQRT1_2]];
  const direction = directions[index]!;
  return { x: origin.x + length * direction[0]!, y: origin.y + length * direction[1]! };
}
