import { createNewDocument } from '../../domain/newDocument';
import type { BlockInstanceEntity, GeoDocument } from '../../domain/model';
export function operationsFixture():GeoDocument {
  const base=createNewDocument(),source={kind:'dxf' as const,sourceDocumentId:'test-dxf',originalType:'INSERT',originalLayer:'0'},layerId=base.layers[0]!.id;
  const instance=(id:string,value:string,x:number):BlockInstanceEntity=>({type:'block_instance',id,name:id,layerId,blockDefinitionId:'volume',position:{x,y:20},rotationDeg:0,scaleX:1,scaleY:1,attributeCoordinateSpace:'block-local',attributes:{NAME:value},source:{...source,handle:id},attributePrimitives:[{kind:'text',content:value,attributeTag:'NAME',position:{x:1,y:1},height:1,rotationDeg:0,layerId,colorMode:'bylayer',source:{...source,originalType:'ATTRIB',handle:`attr-${id}`}}]});
  const d:GeoDocument={...base,sources:[{id:'test-dxf',filename:'synthetic.dxf',format:'DXF',dxfVersion:'AC1027',encoding:'utf-8',originalUnits:6}],blocks:[{id:'volume',sourceName:'VOLUME',basePoint:{x:0,y:0},primitives:[{kind:'circle',center:{x:0,y:0},radius:.5,layerId,colorMode:'bylayer'},{kind:'text',position:{x:0,y:-1},height:1,rotationDeg:0,content:'Отметка',attributeTag:'NAME',layerId,colorMode:'bylayer',source:{...source,originalType:'ATTDEF'}}]}],entities:[instance('mark-a','27.89',20),instance('mark-b','28.22',40)]};
  const styleId=d.layers[0]!.styleId,layer=(id:string,name:string)=>({id,name,visible:true,locked:false,order:d.layers.length,styleId});
  return {...d,blocks:d.blocks!,layers:[...d.layers.filter(l=>!['buildings','roads','slopes','notes'].includes(l.id)),layer('buildings','ГП_здания и сооружения'),layer('roads','Дороги'),layer('slopes','Откосы'),layer('notes','Примечания')],vertices:{...d.vertices,a:{id:'a',x:0,y:0},b:{id:'b',x:10,y:10}},entities:[...d.entities,
    {type:'line',id:'building',name:'Контур',layerId:'buildings',startVertexId:'a',endVertexId:'b',source:{...source,originalType:'LINE',originalLayer:'_ГП_ЗИС'}},
    {type:'line',id:'road',name:'Ось',layerId:'roads',startVertexId:'a',endVertexId:'b'},
    {type:'line',id:'slope',name:'Бровка',layerId:'slopes',startVertexId:'a',endVertexId:'b'},
    {type:'text',id:'weak',name:'Пояснение',layerId:'notes',vertexId:'a',content:'Здание за пределами участка',fontSize:12},
    {type:'dimension',id:'dimension',name:'Расстояние',layerId:'notes',startVertexId:'a',endVertexId:'b',offset:1},
    {type:'imported_graphic',id:'mleader',name:'Выноска',layerId:'notes',position:{x:0,y:0},primitives:[{kind:'text',position:{x:0,y:0},content:'Плодородный грунт, h=0.20 м',height:1,rotationDeg:0,layerId:'notes',colorMode:'bylayer'}],semanticContent:{primaryText:'Плодородный грунт, h=0.20 м'},source:{...source,originalType:'MULTILEADER',originalLayer:'_ПРИМЕЧАНИЯ'}},
  ]};
}
