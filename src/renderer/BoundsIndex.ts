import type { Bounds } from '../geometry';
import { intersects } from './hybridScene';
interface Entry<T> { box: Bounds; value: T }
interface Node<T> { box: Bounds; entries?: Entry<T>[]; left?: Node<T>; right?: Node<T> }
/** Immutable BVH. World-space bounds never depend on camera or renderer mode. */
export class BoundsIndex<T> {
  private root: Node<T> | undefined;
  constructor(entries: Entry<T>[]) {
    const build = (entries: Entry<T>[], depth: number): Node<T> | undefined => {
      if (!entries.length) return;
      const box = entries.reduce((b, e) => ({ minX: Math.min(b.minX, e.box.minX), minY: Math.min(b.minY, e.box.minY), maxX: Math.max(b.maxX, e.box.maxX), maxY: Math.max(b.maxY, e.box.maxY) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      if (entries.length <= 12) return { box, entries };
      const axis = depth % 2 ? 'minY' : 'minX'; entries.sort((a, b) => a.box[axis] - b.box[axis]);
      const mid = entries.length >> 1;
      return { box, left: build(entries.slice(0, mid), depth + 1)!, right: build(entries.slice(mid), depth + 1)! };
    };
    this.root = build([...entries], 0);
  }
  query(box: Bounds): T[] {
    const result: T[] = [];
    const visit = (n: Node<T> | undefined) => { if (!n || !intersects(n.box, box)) return; if (n.entries) for (const e of n.entries) { if (intersects(e.box, box)) result.push(e.value); } else { visit(n.left); visit(n.right); } };
    visit(this.root); return result;
  }
}
