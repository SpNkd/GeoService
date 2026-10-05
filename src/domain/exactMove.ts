import { entityPoints, type GeoDocument, type WorldPoint } from './model';
import { modelSelectionBounds } from '../geometry/entityBounds';
import { resolveSelectionMove } from './selectionMove';
import type { DocumentCommand } from './commands';
export type MoveAnchor='center'|'bottom-left'|'bottom-right'|'top-left'|'top-right';
export function selectionModelAnchor(document:GeoDocument,ids:readonly string[],anchor:MoveAnchor='center'):WorldPoint {
  if(ids.length===1) {
    const entity=document.entities.find(e=>e.id===ids[0]);
    if(entity && 'position' in entity) return {...entity.position};
    if(entity && 'center' in entity) return {...entity.center};
    if(entity?.type==='point'||entity?.type==='text') return entityPoints(entity,document.vertices)[0]!;
  }
  const b=modelSelectionBounds(document,ids);
  if(!b) throw new Error('У выбора нет MODEL bounds');
  return {x:anchor==='center'?b.minX/2+b.maxX/2:anchor.endsWith('left')?b.minX:b.maxX,y:anchor==='center'?b.minY/2+b.maxY/2:anchor.startsWith('bottom')?b.minY:b.maxY};
}
export function absoluteMoveCommand(document:GeoDocument,ids:readonly string[],requested:WorldPoint,anchor:MoveAnchor='center'):DocumentCommand {
  const resolved=resolveSelectionMove(document,ids),current=selectionModelAnchor(document,ids,anchor);
  if(!Number.isFinite(requested.x)||!Number.isFinite(requested.y)) throw new Error('MODEL X/Y должны быть конечными числами');
  return {type:'move-entities',entityIds:resolved.entityIds,delta:{x:requested.x-current.x,y:requested.y-current.y}};
}
