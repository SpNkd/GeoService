import type { Entity, GeoDocument, WorldPoint } from '../domain/model';
import { worldToScreen, type ViewSize } from '../geometry';
import type { RenderItem } from './selectors';
import { intersects, viewportBounds } from './hybridScene';
import { primitivePresentationPoints, primitiveXYZ, presentationTextMetrics, projectedOwnerBounds, visitEntityPrimitives } from '../view/geometry';
import { projectXYZToAxonometric, type ProjectionContext, type RenderCamera } from '../view/projection';
import type { Paint } from './vectorStyle';
interface Stroke {path:Path2D;paint:Paint;fill:boolean;opacity:number}
interface Text {position:WorldPoint;content:string;height:number;rotation:number;paint:Paint}
interface List {origin:WorldPoint;strokes:Stroke[];texts:Text[]}
/** Presentation-only paths are cached separately from shared MODEL definitions and Plan Path2D. */
export class AxonCanvasRenderer {
  private contexts=new WeakMap<ProjectionContext,WeakMap<GeoDocument,WeakMap<Entity,List>>>();
  private compile(document:GeoDocument,item:RenderItem,context:ProjectionContext):List {
    let docs=this.contexts.get(context);if(!docs){docs=new WeakMap();this.contexts.set(context,docs);}let entities=docs.get(document);if(!entities){entities=new WeakMap();docs.set(document,entities);}const cached=entities.get(item.entity);if(cached)return cached;
    const box=projectedOwnerBounds(document,item.entity,context)!,origin={x:box.minX/2+box.maxX/2,y:box.minY/2+box.maxY/2},strokes:Stroke[]=[],texts:Text[]=[],fills=new Map<string,Stroke>();
    visitEntityPrimitives(document,item.entity,{stroke:item.style.stroke,lineWeight:item.style.lineWeight,dash:item.style.dash,opacity:item.style.opacity??1,fill:item.style.fill,fillOpacity:item.style.fillOpacity??1},part=>{const p=part.primitive;
      if(p.kind==='text'){texts.push({position:primitiveXYZ(part,p.position),content:p.content,height:presentationTextMetrics(part).height,rotation:presentationTextMetrics(part).rotation,paint:part.paint});return;}
      const points=primitivePresentationPoints(part,250).map(q=>projectXYZToAxonometric(q,context)),path=new Path2D();points.forEach((q,i)=>{if(i)path.lineTo(q.x-origin.x,q.y-origin.y);else path.moveTo(q.x-origin.x,q.y-origin.y);});if(p.kind==='circle'||p.kind==='path'&&p.closed)path.closePath();
      if(p.kind==='path'&&p.fill&&p.fillGroup){const key=`${part.fillScope}:${p.fillGroup}`;let fill=fills.get(key);if(!fill){fill={path:new Path2D(),paint:part.paint,fill:true,opacity:p.fillOpacity??1};fills.set(key,fill);}fill.path.addPath(path);}
      strokes.push({path,paint:part.paint,fill:p.kind==='path'&&!!p.fill&&!p.fillGroup,opacity:p.fillOpacity??1});
    });
    const list={origin,strokes:[...fills.values(),...strokes],texts};entities.set(item.entity,list);return list;
  }
  draw(ctx:CanvasRenderingContext2D,document:GeoDocument,items:RenderItem[],view:RenderCamera,size:ViewSize,dpr:number){const context=view.projection!,visible=viewportBounds(view,size),drawn:string[]=[],texts:Text[]=[];
    const flat={center:view.center,pixelsPerUnit:view.pixelsPerUnit};
    for(const item of items){const box=projectedOwnerBounds(document,item.entity,context);if(!box||!intersects(box,visible))continue;const list=this.compile(document,item,context),p=worldToScreen(list.origin,flat,size),ppu=view.pixelsPerUnit;drawn.push(item.entity.id);
      ctx.setTransform(ppu*dpr,0,0,-ppu*dpr,p.x*dpr,p.y*dpr);
      for(const s of list.strokes){ctx.strokeStyle=s.paint.stroke;ctx.fillStyle=s.paint.fill&&s.paint.fill!=='none'?s.paint.fill:s.paint.stroke;ctx.globalAlpha=s.paint.opacity??1;ctx.lineWidth=s.paint.lineWeight/ppu;ctx.setLineDash((s.paint.dash?.split(/[ ,]+/).map(Number).filter(Number.isFinite)??[]).map(n=>n/ppu));if(s.fill){ctx.globalAlpha=s.opacity*(s.paint.opacity??1)*(s.paint.fillOpacity??1);ctx.fill(s.path,'evenodd');ctx.globalAlpha=s.paint.opacity??1;}ctx.stroke(s.path);}
      texts.push(...list.texts);
    }
    // Engineering annotation glyphs face the screen, independently of the ground basis.
    for(const text of texts){const p=worldToScreen(text.position,view,size),height=text.paint.textSize??text.height*view.pixelsPerUnit;ctx.setTransform(dpr,0,0,dpr,p.x*dpr,p.y*dpr);ctx.rotate(-text.rotation*Math.PI/180);ctx.fillStyle=text.paint.textColor??text.paint.stroke;ctx.globalAlpha=text.paint.opacity??1;ctx.font=`${height}px sans-serif`;ctx.textBaseline='alphabetic';text.content.split('\n').forEach((line,i)=>ctx.fillText(line,0,i*height*1.2));}
    return drawn;
  }
}
