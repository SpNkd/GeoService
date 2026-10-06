import { connectorRoute } from '../connectors/model';
import { vectorEntityBounds, blockMatrix, transformPoint, textBounds } from '../vectors/geometry';
import { entityPoints, type Entity, type GeoDocument } from '../domain/model';
import { bounds } from './index';
import { resolvedLabelPosition, resolveLabelTemplate } from './labels';
import { alignedDimension } from './survey';
import { symbolBoundsPoints } from '../symbols/transforms';
/** MODEL bounds. Annotation extent is approximate at the document's saved reference zoom. */
export function entityBoundsPoints(document:GeoDocument,entity:Entity) {
  if(entity.type==='connector')return connectorRoute(document,entity);
  if(['arc','circle','block_instance','imported_graphic'].includes(entity.type)) return vectorEntityBounds(document,entity);
  if(entity.type==='text' && entity.height) { const p=entityPoints(entity,document.vertices)[0]!; const m=blockMatrix({position:p,rotationDeg:entity.rotationDeg??0,scaleX:1,scaleY:1},{x:0,y:0}); return textBounds(entity.content,entity.height).map(x=>transformPoint(x,m)); }
  if(entity.type==='symbol') return symbolBoundsPoints(entity);
  const points=entityPoints(entity,document.vertices);
  if(entity.type==='text' || entity.type==='label') {
    const p=entity.type==='label'?resolvedLabelPosition(document,entity):points[0];
    if(!p) return [];
    const font=entity.type==='text'?entity.fontSize:12,content=entity.type==='text'?entity.content:resolveLabelTemplate(document,entity);
    const unit=1/document.viewport.pixelsPerUnit;
    return [{x:p.x-7*unit,y:p.y-7*unit},{x:p.x+(content.length*font*.66+7)*unit,y:p.y+(font+7)*unit}];
  }
  if(entity.type==='dimension') {
    const d=alignedDimension(points[0]!,points[1]!,entity.offset,entity.textPosition),unit=1/document.viewport.pixelsPerUnit;
    return [...points,d.start,d.end,{x:d.label.x-40*unit,y:d.label.y-7*unit},{x:d.label.x+40*unit,y:d.label.y+24*unit}];
  }
  return points;
}
export const layerBounds=(document:GeoDocument,layerId:string)=>bounds(document.entities.filter(e=>e.layerId===layerId).flatMap(e=>entityBoundsPoints(document,e)));
export const modelSelectionBounds=(document:GeoDocument,ids:readonly string[])=>{const selected=new Set(ids);return bounds(document.entities.filter(e=>selected.has(e.id)).flatMap(e=>entityBoundsPoints(document,e)));};
