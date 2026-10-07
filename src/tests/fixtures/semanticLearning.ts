import { createNewDocument } from '../../domain/newDocument';
import type { GeoDocument, LineEntity } from '../../domain/model';
export function semanticFixture():GeoDocument {
  const d=createNewDocument(),layerId=d.layers[0]!.id;
  d.layers=d.layers.map(l=>({...l,name:l.id===layerId?'0':l.name}));
  d.metadata.title='Semantic fixture';
  d.sources=[{id:'source',filename:'semantic.dxf',format:'DXF',encoding:'utf-8',dxfVersion:'AC1027',originalUnits:6}];
  for(let i=0;i<12;i++){
    const id=i<4?`pipe-${i+1}`:`other-${i}`,length=i===0?1.3:i===1?19:i===2?300:5+i;
    d.vertices[`${id}-a`]={id:`${id}-a`,x:i*4,y:0};d.vertices[`${id}-b`]={id:`${id}-b`,x:i*4,y:length};
    const entity:LineEntity={id,name:id,type:'line',layerId,startVertexId:`${id}-a`,endVertexId:`${id}-b`,style:{strokeColor:i===2?'#008800':i<4?'#0055FF':'#BB2200',lineType:i<4?'dashed':'continuous',lineWidth:i<4?2:1},source:{kind:'dxf',sourceDocumentId:'source',originalType:'LINE',originalLayer:i<4?'_ИИ_ТРАССА_025':'0',handle:String(i)}};
    d.entities.push(entity);
  }
  return d;
}
