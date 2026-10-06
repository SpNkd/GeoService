import type { WorldPoint } from '../domain/model';
import type { VectorPrimitive } from '../vectors/types';
export interface DxfViewport {id:string;number:number;centerPaper:WorldPoint;sizePaper:{width:number;height:number};modelCenter:WorldPoint;viewHeight:number;scale:number;twist:number;frozenSourceLayerNames:string[];clip:{kind:'rectangle'}|{kind:'unsupported';handle?:string};unsupportedReason?:string}
export interface DxfLayout {id:string;sourceDocumentId:string;name:string;nameAvailable:boolean;paperSpaceOwner:string;paper?:{width:number;height:number;units:'mm'|'inches'|'pixels'};paperPrimitives:VectorPrimitive[];viewports:DxfViewport[]}
