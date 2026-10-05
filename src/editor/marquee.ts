import type { GeoDocument, Viewport } from '../domain/model';
import { entityPoints } from '../domain/model';
import { worldToScreen, type ScreenPoint, type ViewSize } from '../geometry';
import { alignedDimension } from '../geometry/survey';
import { resolvedLabelPosition, resolveLabelTemplate } from '../geometry/labels';
import { renderItems } from '../renderer/selectors';

export type SelectionMode = 'replace' | 'add' | 'toggle';
export function marqueeEntities(document: GeoDocument, viewport: Viewport, size: ViewSize, start: ScreenPoint, end: ScreenPoint): string[] {
  const box = { minX: Math.min(start.x,end.x), maxX: Math.max(start.x,end.x), minY: Math.min(start.y,end.y), maxY: Math.max(start.y,end.y) };
  const inside = (p: ScreenPoint) => p.x>=box.minX && p.x<=box.maxX && p.y>=box.minY && p.y<=box.maxY;
  const intersects = (a: ScreenPoint,b: ScreenPoint) => {
    let lo=0, hi=1;
    const axes: [number,number,number,number][] = [[a.x,b.x-a.x,box.minX,box.maxX],[a.y,b.y-a.y,box.minY,box.maxY]];
    for (const [origin,d,min,max] of axes) {
      if(d===0) { if(origin<min || origin>max) return false; }
      else { const t1=(min-origin)/d, t2=(max-origin)/d; lo=Math.max(lo,Math.min(t1,t2)); hi=Math.min(hi,Math.max(t1,t2)); if(lo>hi) return false; }
    }
    return true;
  };
  const crossing=end.x<start.x;
  return renderItems(document).filter(({entity})=> {
    let points=entityPoints(entity,document.vertices).map(p=>worldToScreen(p,viewport,size));
    if(entity.type==='text' || entity.type==='label') {
      const world=entity.type==='label' ? resolvedLabelPosition(document,entity) : entityPoints(entity,document.vertices)[0];
      if(!world) return false;
      const p=worldToScreen(world,viewport,size), font=entity.type==='text'?entity.fontSize:12;
      const content=entity.type==='text'?entity.content:resolveLabelTemplate(document,entity);
      const width=Math.max(28,content.length*font*0.66+14), height=font+14;
      points=[{x:p.x-7,y:p.y-font-7},{x:p.x-7+width,y:p.y-font-7},{x:p.x-7+width,y:p.y-font-7+height},{x:p.x-7,y:p.y-font-7+height}];
    }
    if(entity.type==='dimension') {
      const a=document.vertices[entity.startVertexId]!,b=document.vertices[entity.endVertexId]!,d=alignedDimension(a,b,entity.offset,entity.textPosition);
      const ends=[worldToScreen(d.start,viewport,size),worldToScreen(d.end,viewport,size)],label=worldToScreen(d.label,viewport,size);
      const all=[...points,...ends,{x:label.x-40,y:label.y-24},{x:label.x+40,y:label.y}];
      const xs=all.map(p=>p.x),ys=all.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),X=Math.max(...xs),Y=Math.max(...ys);
      points=[{x,y},{x:X,y},{x:X,y:Y},{x,y:Y}];
    }
    if(!crossing) return points.length>0 && points.every(inside);
    if(points.some(inside)) return true;
    const closed=['polygon','text','label','dimension'].includes(entity.type);
    for(let i=0;i<points.length-(closed?0:1);i++) if(intersects(points[i]!,points[(i+1)%points.length]!)) return true;
    if(closed) {
      let contains=false;
      for(let i=0,j=points.length-1;i<points.length;j=i++) { const a=points[i]!,b=points[j]!; if((a.y>start.y)!==(b.y>start.y) && start.x<(b.x-a.x)*(start.y-a.y)/(b.y-a.y)+a.x) contains=!contains; }
      return contains;
    }
    return false;
  }).map(({entity})=>entity.id);
}
