import type { RasterUnderlayEntity } from '../domain/model';
import type { ImageCalibration, ImageQuad, PixelImage, PixelPoint } from './types';
export type Homography = [number, number, number, number, number, number, number, number, number];
export const distancePx = (a: PixelPoint, b: PixelPoint) => Math.hypot(b.x - a.x, b.y - a.y);
export function fullQuad(width: number, height: number): ImageQuad { return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]; }
export function quadError(q: ImageQuad, width: number, height: number): string | null {
  if (q.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x > width || p.y > height)) return 'Углы должны находиться внутри изображения.';
  for (let i = 0; i < 4; i++) {
    const a = q[i]!, b = q[(i + 1) % 4]!, c = q[(i + 2) % 4]!;
    if (distancePx(a, b) < 2 || (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 1e-6) return 'Углы пересекаются или вырождаются. Порядок: верхний левый → верхний правый → нижний правый → нижний левый.';
  }
  const area = q.reduce((n, p, i) => { const next = q[(i + 1) % 4]!; return n + p.x * next.y - p.y * next.x; }, 0) / 2;
  return area < Math.max(4, width * height * 1e-6) ? 'Область слишком мала для коррекции.' : null;
}
export function rectifiedSize(q: ImageQuad) { return { width: Math.max(2, Math.round((distancePx(q[0], q[1]) + distancePx(q[3], q[2])) / 2)), height: Math.max(2, Math.round((distancePx(q[0], q[3]) + distancePx(q[1], q[2])) / 2)) }; }
/** Pivoted Gaussian elimination of the eight point-correspondence equations. */
export function homography(from: ImageQuad, to: ImageQuad): Homography {
  const a: number[][] = [];
  from.forEach((p, i) => { const t = to[i]!; a.push([p.x, p.y, 1, 0, 0, 0, -t.x * p.x, -t.x * p.y, t.x], [0, 0, 0, p.x, p.y, 1, -t.y * p.x, -t.y * p.y, t.y]); });
  for (let col = 0; col < 8; col++) {
    let pivot = col; for (let row = col + 1; row < 8; row++) if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    [a[pivot], a[col]] = [a[col]!, a[pivot]!];
    const divisor = a[col]![col]!; if (Math.abs(divisor) < 1e-10) throw new Error('Вырожденная перспектива.');
    for (let j = col; j <= 8; j++) a[col]![j] = a[col]![j]! / divisor;
    for (let row = 0; row < 8; row++) if (row !== col) { const factor = a[row]![col]!; for (let j = col; j <= 8; j++) a[row]![j] = a[row]![j]! - factor * a[col]![j]!; }
  }
  return [...a.map(row => row[8]!), 1] as Homography;
}
export function projectPixel(h: Homography, p: PixelPoint): PixelPoint {
  const denominator = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(denominator) < 1e-10) throw new Error('Точка вне допустимой перспективы.');
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / denominator, y: (h[3] * p.x + h[4] * p.y + h[5]) / denominator };
}
/** Bilinear inverse sampling at pixel centres; bounded output, source never changed. */
export function rectifyImage(source: PixelImage, q: ImageQuad, width: number, height: number): PixelImage {
  const error = quadError(q, source.width, source.height); if (error) throw new Error(error);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width * height > 4_000_000) throw new Error('Превышен размер рабочего изображения.');
  const h = homography(fullQuad(width, height), q), data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = projectPixel(h, { x: x + .5, y: y + .5 });
    const sx = Math.max(0, Math.min(source.width - 1, p.x - .5)), sy = Math.max(0, Math.min(source.height - 1, p.y - .5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(source.width - 1, x0 + 1), y1 = Math.min(source.height - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
    const ids = [(y0 * source.width + x0) * 4, (y0 * source.width + x1) * 4, (y1 * source.width + x0) * 4, (y1 * source.width + x1) * 4];
    for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = source.data[ids[0]! + c]! * (1 - fx) * (1 - fy) + source.data[ids[1]! + c]! * fx * (1 - fy) + source.data[ids[2]! + c]! * (1 - fx) * fy + source.data[ids[3]! + c]! * fx * fy;
  }
  return { width, height, data };
}
export function metresPerPixel(a: PixelPoint, b: PixelPoint, metres: number) {
  const px = distancePx(a, b); if (!Number.isFinite(metres) || metres <= 0 || px < 1e-6) throw new Error('Две разные точки и положительная реальная длина обязательны.');
  return metres / px;
}
export function pixelToModel(p: PixelPoint, image: Pick<RasterUnderlayEntity, 'position' | 'rotationDeg' | 'width' | 'height'>, calibration: Pick<ImageCalibration, 'rectifiedWidth' | 'rectifiedHeight'>): PixelPoint {
  const x = (p.x / calibration.rectifiedWidth - .5) * image.width, y = (.5 - p.y / calibration.rectifiedHeight) * image.height, angle = image.rotationDeg * Math.PI / 180;
  return { x: image.position.x + x * Math.cos(angle) - y * Math.sin(angle), y: image.position.y + x * Math.sin(angle) + y * Math.cos(angle) };
}
