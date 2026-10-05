import { moveDocument } from './moveDocument';
import type { SymbolEntity } from '../../domain/model';
export function symbolInstance(id='valve',symbolId='shutoff-valve',x=10,y=8):SymbolEntity {
  return {type:'symbol',id,name:id,layerId:'buildings',libraryId:'gas-process-demo',symbolId,position:{x,y},rotationDeg:0,scale:1};
}
export function symbolDocument() {
  const d=moveDocument();d.entities.push(symbolInstance(),symbolInstance('filter','filter',15,8),symbolInstance('regulator','pressure-regulator',20,8));return d;
}
