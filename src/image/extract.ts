import { CANDIDATE_LIMIT, type Candidate, type ExtractionOptions, type ExtractionResult, type PixelImage, type PixelPoint } from './types';
import { distancePx } from './transform';
const offsets = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const;
function lineDistance(p: PixelPoint, a: PixelPoint, b: PixelPoint) {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
/** Iterative Ramer–Douglas–Peucker, including two independent halves of a loop. */
export function simplify(points: PixelPoint[], tolerance: number, closed = false): PixelPoint[] {
  if (points.length <= 2) return points;
  if (closed) {
    let split = 1; for (let i = 2; i < points.length; i++) if (distancePx(points[0]!, points[i]!) > distancePx(points[0]!, points[split]!)) split = i;
    return [...simplify(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplify([...points.slice(split), points[0]!], tolerance).slice(0, -1)];
  }
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) { const [start, end] = stack.pop()!; let index = -1, maximum = tolerance;
    for (let i = start + 1; i < end; i++) { const d = lineDistance(points[i]!, points[start]!, points[end]!); if (d > maximum) { index = i; maximum = d; } }
    if (index >= 0) { keep[index] = 1; stack.push([start, index], [index, end]); }
  }
  return points.filter((_, i) => keep[i]);
}
/** Least-squares circle fit; radial residual plus complete angular coverage reject arcs/noisy loops. */
export function fitCircle(points: PixelPoint[]): { center: PixelPoint; radius: number; confidence: number } | null {
  if (points.length < 20) return null;
  const mean = points.reduce((p, q) => ({ x: p.x + q.x / points.length, y: p.y + q.y / points.length }), { x: 0, y: 0 });
  let xx = 0, xy = 0, yy = 0, bx = 0, by = 0;
  for (const p of points) { const x = p.x - mean.x, y = p.y - mean.y, r = x * x + y * y; xx += x * x; xy += x * y; yy += y * y; bx += x * r / 2; by += y * r / 2; }
  const determinant = xx * yy - xy * xy; if (Math.abs(determinant) < 1e-8) return null;
  const center = { x: mean.x + (bx * yy - by * xy) / determinant, y: mean.y + (by * xx - bx * xy) / determinant };
  const radii = points.map(p => distancePx(p, center)), radius = radii.reduce((a, b) => a + b, 0) / radii.length;
  const residual = Math.sqrt(radii.reduce((a, b) => a + (b - radius) ** 2, 0) / radii.length), bins = new Set(points.map(p => Math.floor((Math.atan2(p.y - center.y, p.x - center.x) + Math.PI) / (Math.PI * 2) * 16) % 16));
  if (radius < 6 || residual > Math.max(.65, radius * .025) || bins.size < 15) return null;
  return { center, radius, confidence: Math.max(0, Math.min(1, 1 - residual / radius)) };
}
export function cleanupPaths(raw: PixelPoint[][], options: ExtractionOptions): { points: PixelPoint[]; closed: boolean }[] {
  const epsilon = { low: 2.5, medium: 1.3, high: .65 }[options.detail], minimum = { low: 4, medium: 8, high: 14 }[options.noise];
  const paths = raw.filter(p => p.length > 1 && p.slice(1).reduce((n, q, i) => n + distancePx(q, p[i]!), 0) >= minimum).map(points => {
    const closed = points.length >= 8 && distancePx(points[0]!, points.at(-1)!) <= (options.join ? 2.8 : 1.5);
    return { points: simplify(closed ? points.slice(0, -1) : points, epsilon, closed), closed };
  }).filter(p => p.points.length >= (p.closed ? 3 : 2));
  // Endpoint joining uses stable pair order and never joins through a junction.
  if (options.join) {
    let changed = true;
    while (changed) { changed = false;
      outer: for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
        const a = paths[i]!, b = paths[j]!; if (a.closed || b.closed) continue;
        for (const reverseA of [false, true]) for (const reverseB of [false, true]) {
          const ap = reverseA ? [...a.points].reverse() : a.points, bp = reverseB ? [...b.points].reverse() : b.points, end = ap.at(-1)!, start = bp[0]!;
          if (distancePx(end, start) > 2.8) continue;
          const ambiguous = paths.some((p, k) => k !== i && k !== j && !p.closed && [p.points[0]!, p.points.at(-1)!].some(q => distancePx(q, end) <= 2.8));
          if (ambiguous) continue;
          const middle = { x: (end.x + start.x) / 2, y: (end.y + start.y) / 2 };
          const joined = [...ap.slice(0, -1), middle, ...bp.slice(1)];
          const closed = joined.length >= 3 && distancePx(joined[0]!, joined.at(-1)!) <= 2.8;
          paths[i] = { points: simplify(closed ? joined.slice(0, -1) : joined, epsilon, closed), closed };
          paths.splice(j, 1); changed = true; break outer;
        }
      }
    }
  }
  const seen = new Set<string>();
  return paths.filter(p => {
    const keys = p.points.map(q => `${Math.round(q.x)},${Math.round(q.y)}`), forward = keys.join(';'), backward = [...keys].reverse().join(';'), key = forward < backward ? forward : backward;
    if (seen.has(key)) return false; seen.add(key); return true;
  });
}
interface Component { pixels: number[]; x: number; y: number; width: number; height: number }
function components(mask: Uint8Array, width: number, height: number, options: ExtractionOptions): Component[] {
  const seen = new Uint8Array(mask.length), stack = new Int32Array(mask.length), result: Component[] = [];
  const minimum = { low: 3, medium: 10, high: 25 }[options.noise];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 1; stack[0] = start; seen[start] = 1;
    let x0 = width, y0 = height, x1 = 0, y1 = 0; const pixels: number[] = [];
    while (top) { const index = stack[--top]!, x = index % width, y = Math.floor(index / width); pixels.push(index); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      for (const [dx, dy] of offsets) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue; const n = ny * width + nx; if (mask[n] && !seen[n]) { seen[n] = 1; stack[top++] = n; } }
    }
    if (pixels.length < minimum || Math.max(x1 - x0, y1 - y0) < 3) pixels.forEach(i => { mask[i] = 0; });
    else result.push({ pixels, x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
    if (result.length > 20000) throw new Error('Слишком много шума. Увеличьте удаление шума или выберите меньшую область.');
  }
  return result;
}
function textRegions(items: Component[], mask: Uint8Array): Candidate[] {
  const compact = items.filter(c => c.height >= 6 && c.height <= 36 && c.width >= 2 && c.width <= c.height * 1.4 && c.pixels.length / (c.width * c.height) > .24).sort((a, b) => a.y - b.y || a.x - b.x), used = new Set<Component>(), result: Candidate[] = [];
  for (const a of compact) { if (used.has(a)) continue;
    const row = compact.filter(b => !used.has(b) && Math.abs(b.y + b.height / 2 - a.y - a.height / 2) < a.height * .35 && b.height / a.height > .6 && b.height / a.height < 1.7).sort((a, b) => a.x - b.x);
    const groups: Component[][] = []; for (const b of row) { const group = groups.at(-1), previous = group?.at(-1); if (previous && b.x - previous.x - previous.width < a.height * 1.8) group!.push(b); else groups.push([b]); }
    for (const group of groups) if (group.length >= 3) { group.forEach(c => { used.add(c); c.pixels.forEach(i => { mask[i] = 0; }); }); const x = Math.min(...group.map(c => c.x)), y = Math.min(...group.map(c => c.y)); result.push({ id: '', type: 'text', bounds: { x, y, width: Math.max(...group.map(c => c.x + c.width)) - x, height: Math.max(...group.map(c => c.y + c.height)) - y } }); }
  }
  return result;
}
/** Zhang–Suen thinning preserves topology; bounded iterations handle ordinary drawing strokes. */
function thin(mask: Uint8Array, width: number, height: number) {
  const remove: number[] = [];
  for (let iteration = 0; iteration < 40; iteration++) { let changed = false;
    for (let phase = 0; phase < 2; phase++) { remove.length = 0;
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) { const i = y * width + x; if (!mask[i]) continue;
        const n = offsets.map(([dx, dy]) => mask[i + dy * width + dx]!), count = n.reduce((a, b) => a + b, 0); if (count < 2 || count > 6) continue;
        let transitions = 0; for (let k = 0; k < 8; k++) if (!n[k] && n[(k + 1) % 8]) transitions++;
        if (transitions !== 1) continue;
        if (phase === 0 ? n[0]! * n[2]! * n[4]! || n[2]! * n[4]! * n[6]! : n[0]! * n[2]! * n[6]! || n[0]! * n[4]! * n[6]!) continue;
        remove.push(i);
      }
      if (remove.length) changed = true; remove.forEach(i => { mask[i] = 0; });
    }
    if (!changed) break;
  }
}
function trace(mask: Uint8Array, width: number, height: number): PixelPoint[][] {
  const edges = new Uint8Array(mask.length), visited = new Uint8Array(mask.length), paths: PixelPoint[][] = [];
  const neighbours = (i: number) => { const x = i % width, y = Math.floor(i / width), result: { index: number; direction: number }[] = [];
    offsets.forEach(([dx, dy], direction) => { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= width || ny >= height) return; const index = ny * width + nx; if (!mask[index]) return;
      // Suppress triangle shortcuts around an orthogonal corner; retain true diagonal strokes.
      if (dx && dy && (mask[y * width + nx] || mask[ny * width + x])) return;
      result.push({ index, direction }); }); return result;
  };
  for (let i = 0; i < mask.length; i++) if (mask[i]) neighbours(i).forEach(n => { edges[i] = edges[i]! | (1 << n.direction); });
  const degree = (i: number) => { let value = edges[i]!, n = 0; while (value) { n += value & 1; value >>= 1; } return n; };
  const walk = (start: number, first: { index: number; direction: number }) => { const path: PixelPoint[] = [{ x: start % width + .5, y: Math.floor(start / width) + .5 }]; let current = start, next = first;
    for (let count = 0; count <= mask.length; count++) { visited[current] = visited[current]! | (1 << next.direction); visited[next.index] = visited[next.index]! | (1 << ((next.direction + 4) % 8)); current = next.index; path.push({ x: current % width + .5, y: Math.floor(current / width) + .5 });
      if (current === start || degree(current) !== 2) break;
      const following = neighbours(current).find(n => !(visited[current]! & (1 << n.direction))); if (!following) break; next = following;
    }
    paths.push(path); if (paths.length > CANDIDATE_LIMIT * 4) throw new Error('Слишком много фрагментов. Увеличьте удаление шума.');
  };
  for (let i = 0; i < mask.length; i++) if (mask[i] && degree(i) !== 2) for (const n of neighbours(i)) if (!(visited[i]! & (1 << n.direction))) walk(i, n);
  for (let i = 0; i < mask.length; i++) if (mask[i]) for (const n of neighbours(i)) if (!(visited[i]! & (1 << n.direction))) walk(i, n);
  return paths;
}
/** Otsu threshold after alpha-on-white compositing; no OCR/network/provider imports. */
export function extractGeometry(image: PixelImage, options: ExtractionOptions, stage: (value: string) => void = () => {}): ExtractionResult {
  if (image.width < 2 || image.height < 2 || image.width * image.height > 1_440_000 || image.data.length !== image.width * image.height * 4) throw new Error('Недопустимый размер рабочего изображения.');
  const started = performance.now(), gray = new Uint8Array(image.width * image.height), histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) { const a = image.data[i * 4 + 3]! / 255, g = Math.round((image.data[i * 4]! * .299 + image.data[i * 4 + 1]! * .587 + image.data[i * 4 + 2]! * .114) * a + 255 * (1 - a)); gray[i] = g; histogram[g] = histogram[g]! + 1; }
  let total = 0; for (let i = 0; i < 256; i++) total += i * histogram[i]!;
  let count = 0, sum = 0, maximum = -1, threshold = 128;
  for (let t = 0; t < 255; t++) { count += histogram[t]!; sum += t * histogram[t]!; if (!count || count === gray.length) continue; const between = count * (gray.length - count) * (sum / count - (total - sum) / (gray.length - count)) ** 2; if (between > maximum) { maximum = between; threshold = t; } }
  const mask = gray.map(g => g <= Math.max(60, Math.min(200, threshold)) ? 1 : 0);
  if (mask.reduce((n, value) => n + value, 0) > mask.length * .5) throw new Error('Слишком большая тёмная область. V1 рассчитан на штриховой чертёж на светлом фоне; выберите область чертежа.');
  stage('Выделение линий'); const items = components(mask, image.width, image.height, options), regions = textRegions(items, mask); items.forEach(c => { c.pixels.length = 0; }); items.length = 0; thin(mask, image.width, image.height);
  stage('Трассировка контуров'); const raw = trace(mask, image.width, image.height), detection = performance.now() - started, cleanStarted = performance.now();
  stage('Очистка геометрии'); const candidates: Candidate[] = [...regions];
  // Fit on original traced pixels; simplification must not erase circle evidence.
  const circles: { points: PixelPoint[]; circle: NonNullable<ReturnType<typeof fitCircle>> }[] = [];
  const remaining = raw.filter(points => { if (points.length < 20 || distancePx(points[0]!, points.at(-1)!) > 1.5) return true; const circle = fitCircle(points.slice(0, -1)); if (!circle) return true; circles.push({ points, circle }); return false; });
  circles.forEach(({ circle }) => candidates.push({ id: '', type: 'circle', ...circle }));
  for (const path of cleanupPaths(remaining, options)) {
    if (path.closed) { const area = Math.abs(path.points.reduce((sum, p, i) => { const q = path.points[(i + 1) % path.points.length]!; return sum + p.x * q.y - p.y * q.x; }, 0)) / 2; if (area < 16) continue; }
    candidates.push({ id: '', type: path.closed ? 'contour' : path.points.length === 2 ? 'line' : 'polyline', points: path.points });
  }
  if (candidates.length > CANDIDATE_LIMIT) throw new Error('Более 5000 кандидатов. Увеличьте удаление шума или уменьшите область.');
  candidates.forEach((c, i) => { c.id = `candidate-${i + 1}`; });
  return { candidates, timings: { detection, cleanup: performance.now() - cleanStarted }, analysisWidth: image.width, analysisHeight: image.height };
}
export function scaleCandidates(candidates: Candidate[], sx: number, sy: number): Candidate[] {
  const point = (p: PixelPoint) => ({ x: p.x * sx, y: p.y * sy });
  return candidates.map(c => c.type === 'circle' ? { ...c, center: point(c.center), radius: c.radius * (sx + sy) / 2 } : 'points' in c ? { ...c, points: c.points.map(point) } : { ...c, bounds: { x: c.bounds.x * sx, y: c.bounds.y * sy, width: c.bounds.width * sx, height: c.bounds.height * sy } });
}
