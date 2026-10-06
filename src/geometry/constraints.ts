import type { WorldPoint } from '../domain/model';
/** Working camera basis; Shift overrides persistent Ortho. Zero rotation uses MODEL axes. */
export function constrainAngle(origin: WorldPoint, cursor: WorldPoint, incrementDeg: 45 | 90, rotationDeg=0): WorldPoint {
  const dx = cursor.x - origin.x, dy = cursor.y - origin.y, length = Math.hypot(dx, dy);
  const basis=rotationDeg*Math.PI/180;
  const step = incrementDeg * Math.PI / 180, angle = Math.round((Math.atan2(dy, dx)+basis) / step) * step;
  // Exact axis/diagonal directions avoid trigonometric residuals.
  const index = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  const directions = [[1, 0], [Math.SQRT1_2, Math.SQRT1_2], [0, 1], [-Math.SQRT1_2, Math.SQRT1_2], [-1, 0], [-Math.SQRT1_2, -Math.SQRT1_2], [0, -1], [Math.SQRT1_2, -Math.SQRT1_2]];
  const direction = directions[index]!;
  return { x: origin.x + length * (direction[0]!*Math.cos(basis)+direction[1]!*Math.sin(basis)), y: origin.y + length * (-direction[0]!*Math.sin(basis)+direction[1]!*Math.cos(basis)) };
}
