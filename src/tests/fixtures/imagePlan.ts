import { fullQuad, homography, projectPixel } from '../../image/transform';
import type { ImageQuad, PixelImage, PixelPoint } from '../../image/types';
export const skewedCorners: ImageQuad = [{ x: 35, y: 28 }, { x: 445, y: 55 }, { x: 404, y: 292 }, { x: 73, y: 271 }];
export type ImageFixture = 'clean' | 'rotated' | 'skewed' | 'noisy' | 'circle' | 'text';
export function imagePlan(kind: ImageFixture = 'clean', width = 480, height = 320): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x: number, y: number) => { if (x < 0 || y < 0 || x >= width || y >= height) return; const i = (Math.floor(y) * width + Math.floor(x)) * 4; data[i] = data[i + 1] = data[i + 2] = 20; };
  const rotate = (p: PixelPoint) => kind === 'rotated' ? { x: 240 + ((p.x - 240) * Math.cos(.3) - (p.y - 160) * Math.sin(.3)) * .8, y: 160 + ((p.x - 240) * Math.sin(.3) + (p.y - 160) * Math.cos(.3)) * .8 } : p;
  const line = (a: PixelPoint, b: PixelPoint, thickness = 3) => { a = rotate(a); b = rotate(b); const length = Math.hypot(b.x - a.x, b.y - a.y); for (let i = 0; i <= length * 2; i++) { const t = i / (length * 2); const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t; for (let dy = -thickness / 2; dy <= thickness / 2; dy++) for (let dx = -thickness / 2; dx <= thickness / 2; dx++) ink(x + dx, y + dy); } };
  const rectangle = (x: number, y: number, w: number, h: number) => { const p = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]; p.forEach((a, i) => line(a, p[(i + 1) % 4]!)); };
  if (kind !== 'text') {
    rectangle(45, 45, 180, 135); line({ x: 280, y: 55 }, { x: 410, y: 55 }); line({ x: 280, y: 100 }, { x: 390, y: 150 }); line({ x: 55, y: 245 }, { x: 175, y: 245 }); line({ x: 175, y: 245 }, { x: 175, y: 285 });
  }
  if (kind === 'circle') { for (let i = 0; i < 500; i++) { const angle = i / 500 * Math.PI * 2; for (let r = 32; r <= 35; r += .5) ink(335 + Math.cos(angle) * r, 230 + Math.sin(angle) * r); } }
  if (kind === 'text') for (let k = 0; k < 6; k++) { const x = 80 + k * 18; line({ x, y: 90 }, { x, y: 105 }, 2); line({ x: x + 7, y: 90 }, { x: x + 7, y: 105 }, 2); line({ x, y: 97 }, { x: x + 7, y: 97 }, 2); }
  if (kind === 'noisy') { let seed = 123; for (let i = 0; i < 700; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; const x = seed % width; seed = (seed * 1664525 + 1013904223) >>> 0; const y = seed % height; ink(x, y); if (i % 12 === 0) line({ x, y }, { x: x + 7, y: y + 1 }, 1); } }
  if (kind !== 'skewed') return { width, height, data };
  const inverse = homography(skewedCorners, fullQuad(width, height)), warped = new Uint8ClampedArray(data.length).fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const p = projectPixel(inverse, { x: x + .5, y: y + .5 }), sx = Math.floor(p.x), sy = Math.floor(p.y); if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue; const source = (sy * width + sx) * 4, target = (y * width + x) * 4; for (let c = 0; c < 4; c++) warped[target + c] = data[source + c]!; }
  return { width, height, data: warped };
}
