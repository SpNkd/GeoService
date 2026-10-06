import type { GeoDocument } from '../domain/model';
import { worldToScreen, type ViewSize } from '../geometry';
import {viewRotation, type RenderCamera} from '../view/projection';
import { primitivePresentationPoints, primitiveXYZ, presentationTextMetrics, visitEntityPrimitives } from '../view/geometry';
import type { RenderItem } from './selectors';
const initialMetrics={draws:0,drawMs:0,primitives:0};
const diagnostics=globalThis as typeof globalThis&{__geoSelectionCounters?:typeof initialMetrics};
export const selectionOverlayMetrics=import.meta.env.DEV?(diagnostics.__geoSelectionCounters??=initialMetrics):initialMetrics;
/** Independent transparent overlay: no base renderer invalidation, hatch fill or owner rectangles. */
export function drawSelectionContours(ctx:CanvasRenderingContext2D,document:GeoDocument,items:readonly RenderItem[],viewport:RenderCamera,size:ViewSize){const started=performance.now();let count=0;ctx.clearRect(0,0,size.width,size.height);ctx.lineJoin='round';ctx.lineCap='round';
 for(const item of items)visitEntityPrimitives(document,item.entity,{stroke:item.style.stroke,lineWeight:item.style.lineWeight,dash:item.style.dash},part=>{count++;const p=part.primitive;ctx.save();
 if(p.kind==='text'){const at=worldToScreen(primitiveXYZ(part,p.position),viewport,size),metrics=presentationTextMetrics(part);ctx.translate(at.x,at.y);ctx.rotate(-(metrics.rotation+viewRotation(viewport))*Math.PI/180);const height=metrics.height*viewport.pixelsPerUnit;ctx.font=`${height}px sans-serif`;ctx.textBaseline='alphabetic';p.content.split('\n').forEach((line,i)=>{ctx.strokeStyle='#ffffffcc';ctx.lineWidth=4;ctx.strokeText(line,0,i*height*1.2);ctx.strokeStyle='#277ec1';ctx.lineWidth=1.5;ctx.strokeText(line,0,i*height*1.2);});}
 else {const points=primitivePresentationPoints(part,viewport.pixelsPerUnit).map(q=>worldToScreen(q,viewport,size));ctx.beginPath();points.forEach((q,i)=>i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y));if(p.kind==='circle'||p.kind==='path'&&p.closed)ctx.closePath();ctx.strokeStyle='#ffffffcc';ctx.lineWidth=5;ctx.stroke();ctx.strokeStyle='#277ec1';ctx.lineWidth=2;ctx.stroke();}ctx.restore();});
 selectionOverlayMetrics.draws++;selectionOverlayMetrics.drawMs=performance.now()-started;selectionOverlayMetrics.primitives=count;
}
