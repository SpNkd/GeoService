import type { Bounds } from '../geometry';
import type { Point } from './types';
const overlaps=(a:Bounds,b:Bounds)=>a.minX<=b.maxX&&a.maxX>=b.minX&&a.minY<=b.maxY&&a.maxY>=b.minY;
export const box=(a:Point,b:Point=a,r=0):Bounds=>({minX:Math.min(a.x,b.x)-r,maxX:Math.max(a.x,b.x)+r,minY:Math.min(a.y,b.y)-r,maxY:Math.max(a.y,b.y)+r});
export const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
/** Worker-safe BVH; candidate pairs are queried by segment bounds, never all pairs. */
export class SpatialIndex<T> {
 private root: {bounds:Bounds;items?:{bounds:Bounds;value:T}[];children?:SpatialIndex<T>[]} | undefined;
 constructor(items:{bounds:Bounds;value:T}[],depth=0){if(!items.length)return;const bounds=items.reduce((b,e)=>({minX:Math.min(b.minX,e.bounds.minX),minY:Math.min(b.minY,e.bounds.minY),maxX:Math.max(b.maxX,e.bounds.maxX),maxY:Math.max(b.maxY,e.bounds.maxY)}),{minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity});
 if(items.length<=12){this.root={bounds,items};return;}const axis=depth%2?'minY':'minX',sorted=[...items].sort((a,b)=>a.bounds[axis]-b.bounds[axis]),mid=sorted.length>>1;this.root={bounds,children:[new SpatialIndex(sorted.slice(0,mid),depth+1),new SpatialIndex(sorted.slice(mid),depth+1)]};}
 query(bounds:Bounds):T[]{const result:T[]=[];const visit=(tree:SpatialIndex<T>)=>{const node=tree.root;if(!node||!overlaps(bounds,node.bounds))return;if(node.items)for(const item of node.items){if(overlaps(bounds,item.bounds))result.push(item.value);}else node.children?.forEach(visit);};visit(this);return result;}
}
