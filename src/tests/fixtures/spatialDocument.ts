import { createNewDocument } from '../../domain/newDocument';
import type { GeoDocument } from '../../domain/model';
export function spatialDocument():GeoDocument {
  const d=createNewDocument();
  d.metadata={id:'spatial-fixture',title:'Spatial QA',description:''};
  d.viewport={center:{x:10,y:12},pixelsPerUnit:16};
  d.vertices={a:{id:'a',x:7,y:12},b:{id:'b',x:13,y:12},c:{id:'c',x:13,y:17},d:{id:'d',x:7,y:17},p:{id:'p',x:0,y:0},q:{id:'q',x:20,y:0},r:{id:'r',x:20,y:30},s:{id:'s',x:0,y:30}};
  d.entities=[{id:'house',name:'Дом',type:'polygon',layerId:'buildings',vertexIds:['a','b','c','d']},{id:'site',name:'Участок',type:'polygon',layerId:'boundary',vertexIds:['p','q','r','s']}];
  return d;
}
