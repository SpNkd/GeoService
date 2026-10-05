import ACI from 'dxf-parser/dist/AutoCadColorIndex';
import DxfParser, { type IEntity, type IDxf } from 'dxf-parser';
import type { Entity, GeoDocument, WorldPoint } from '../domain/model';
import { blockMatrix, invertMatrix, multiply, transformPoint } from '../vectors/geometry';
import type { ImportedSemanticContent, BlockDefinition, PrimitiveStyle, SourceProvenance, VectorPrimitive } from '../vectors/types';
import { VECTOR_LIMITS } from '../vectors/types';
import { validateDocument } from '../persistence/documentSchema';
import { encodeDocument } from '../persistence/serialization';
import { polygonSelfIntersects } from '../geometry/survey';
import { decodeDxf } from './encoding';
import { number, scanRecords, value, type RawRecord } from './raw';
import { bulgePath, plainDxfText } from './curves';
import { hatchPrimitives, leaderPrimitives } from './supplement';
import type { DxfOptions, DxfPlan, TypeReport } from './types';
// Parser interfaces do not discriminate types; own this narrow adapter instead of spreading parser payloads.
interface Parsed extends IEntity { vertices?: (WorldPoint & {bulge?:number})[]; position?:WorldPoint; center?:WorldPoint; radius?:number; startAngle?:number; endAngle?:number; shape?:boolean; elevation?:number; startPoint?:WorldPoint; text?:string; textHeight?:number; height?:number; rotation?:number; directionVector?:WorldPoint; xScale?:number; yScale?:number; zScale?:number; name?:string; block?:string; points?:WorldPoint[] }
const unitFactor={mm:.001,cm:.01,m:1} as const;
const reportRow=():TypeReport=>({total:0,converted:0,simplified:0,proxy:0,unsupported:0});
const nonEntities=new Set(['SECTION','ENDSEC','BLOCK','ENDBLK','VERTEX','SEQEND','ATTRIB']);
export function importDxf(buffer:ArrayBuffer,filename:string,options:DxfOptions={},progress:(phase:string)=>void=()=>{}):DxfPlan {
  const t0=performance.now();progress('Декодирование');const decoded=decodeDxf(buffer,options.encoding);const t1=performance.now();
  const records=scanRecords(decoded.text);for(const r of records)if(['LAYER','BLOCK','LTYPE','BLOCK_RECORD'].includes(r.type)&&['__proto__','constructor','prototype'].includes(value(r,2)??''))throw new Error('DXF unsafe table/block name');const t2=performance.now();progress('Парсинг');const parsed=new DxfParser().parseSync(decoded.text);if(!parsed)throw new Error('DXF parser returned no document');const t3=performance.now();progress('Нормализация');
  let fingerprint=2166136261;for(const byte of new Uint8Array(buffer))fingerprint=Math.imul(fingerprint^byte,16777619);
  return normalize(parsed,records,filename,options,decoded,`dxf-${(fingerprint>>>0).toString(16)}`,{decode:t1-t0,inventory:t2-t1,parse:t3-t2},progress);
}
function normalize(parsed:IDxf,records:RawRecord[],filename:string,options:DxfOptions,decoded:ReturnType<typeof decodeDxf>,sourceId:string,timings:Record<string,number>,progress:(phase:string)=>void):DxfPlan {
  filename=filename.replace(/^.*[\\/]/,'');
  const start=performance.now(),warnings=new Set(decoded.warnings),header=parsed.header??{},originalUnits=Number(header.$INSUNITS??0),recognized=({4:.001,5:.01,6:1} as Record<number,number>)[originalUnits],factor=options.units?unitFactor[options.units]:recognized??1;
  const layers:GeoDocument['layers']=[],styles:GeoDocument['styles']=[],layerIds=new Map<string,string>(),blockIds=new Map<string,string>();
  const document:GeoDocument={schemaVersion:2,modelFrame:options.frame??'projected',metadata:{id:`document-${sourceId}`,title:filename,description:'Импорт DXF'},coordinateSystem:{kind:options.frame??'projected',xAxis:'east',yAxis:'north',zAxis:'up'},units:{length:'m',area:'m2'},vertices:{},layers,styles,entities:[],blocks:[],sources:[{id:sourceId,filename:filename.replace(/^.*[\\/]/,''),format:'DXF',dxfVersion:String(header.$ACADVER??'unknown'),encoding:decoded.encoding,originalUnits,unitScaleToMeters:factor}],viewport:{center:{x:0,y:0},pixelsPerUnit:10}};
  const source=(r:RawRecord):SourceProvenance=>({kind:'dxf',sourceDocumentId:sourceId,...(value(r,5)?{handle:value(r,5)!}:{}),originalType:r.type,originalLayer:value(r,8)??'0',...(r.block?{blockName:r.block}:r.type==='INSERT'?{blockName:value(r,2)??''}:{})});
  const color=(n:number)=>`#${Math.max(0,Math.min(0xffffff,n)).toString(16).padStart(6,'0')}`;
  // DXF ACI 7 is foreground, white in AutoCAD's dark canvas; GeoService has a light canvas.
  const aci=(n:number)=>{if(n===7||n===0)return '#333333';return color(ACI[n]??0x666666);};
  const dash=(r:RawRecord)=>{const name=value(r,6);const pattern=name?parsed.tables?.lineType?.lineTypes?.[name]?.pattern:undefined;return pattern?.length?pattern.map(n=>Math.max(.5,Math.abs(Number(n))*factor*4)).join(' '):undefined;};
  const layerRecords=records.filter(r=>r.section==='TABLES'&&r.type==='LAYER');
  const addLayer=(name:string,r?:RawRecord)=>{
    if(layerIds.has(name))return layerIds.get(name)!;if(layers.length>=1000)throw new Error('DXF: layer budget exceeded');
    const index=layers.length,id=`dxf-layer-${index}`,styleId=`dxf-style-${index}`,lib=parsed.tables?.layer?.layers?.[name],flags=r?number(r,70):0,indexColor=r?Math.abs(number(r,62,7)):7;
    const stroke=r&&value(r,420)?color(number(r,420)):indexColor===7?'#333333':lib?.color===undefined?aci(indexColor):color(lib.color);
    const weight=r?number(r,370,-1):-1,pattern=r?dash(r):undefined;
    styles.push({id:styleId,stroke,fill:'none',lineWeight:weight>0?Math.max(.5,weight/25):1,...(pattern?{dash:pattern}:{})});
    layers.push({id,name,visible:(r?number(r,62,7)>=0:true)&&!(flags&1),locked:!!(flags&4),order:index,styleId,source:{kind:'dxf',sourceDocumentId:sourceId,originalType:'LAYER',originalLayer:name}});layerIds.set(name,id);return id;
  };
  for(const r of layerRecords)addLayer(value(r,2)??'0',r);if(!layers.length)addLayer('0');
  for(const r of records)if(['ENTITIES','BLOCKS'].includes(r.section)&&!nonEntities.has(r.type))addLayer(value(r,8)??'0');
  const blocks=records.filter(r=>r.section==='BLOCKS'&&r.type==='BLOCK');if(blocks.length>VECTOR_LIMITS.blocks)throw new Error('DXF: block budget exceeded');for(const [i,r]of blocks.entries())blockIds.set(value(r,2)??'',`dxf-block-${i}`);
  const style=(r:RawRecord):PrimitiveStyle=>{const index=number(r,62,256),trueColor=value(r,420),p=dash(r),lw=number(r,370,-1);return {layerId:layerIds.get(value(r,8)??'0')!,colorMode:trueColor||index!==0&&index!==256?'explicit':index===0?'byblock':'bylayer',...(trueColor?{stroke:color(number(r,420))}:index!==0&&index!==256?{stroke:aci(Math.abs(index))}:{}),...(lw>0?{lineWeight:Math.max(.5,lw/25)}:{}),...(p?{dash:p}:{}),...(number(r,60)!==0?{visible:false}:{}),source:source(r)};};
  const point=(p:WorldPoint|undefined):WorldPoint=>{if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.z!==undefined&&!Number.isFinite(p.z))throw new Error('Missing/invalid DXF point');return {x:p.x*factor||0,y:p.y*factor||0,...(p.z===undefined?{}:{z:p.z*factor||0})};};
  const rawPoint=(r:RawRecord,code=10):WorldPoint=>point({x:number(r,code),y:number(r,code+10),...(value(r,code+20)===undefined?{}:{z:number(r,code+20)})});
  const parsedIndex=(entities:IEntity[]|undefined)=>{const map=new Map<string,Parsed>(),queues=new Map<string,Parsed[]>();for(const e of entities??[]){if(e.handle!==undefined)map.set(String(e.handle),e as Parsed);const q=queues.get(e.type)??[];q.push(e as Parsed);queues.set(e.type,q);}return {get(r:RawRecord){const handle=value(r,5);return handle?map.get(handle):queues.get(r.type)?.shift();}};};
  const mainIndex=parsedIndex(parsed.entities),blockIndex=new Map(blocks.map(r=>[value(r,2)??'',parsedIndex(parsed.blocks?.[value(r,2)??'']?.entities)]));
  const types:Record<string,TypeReport>=Object.create(null),blockTypes:Record<string,TypeReport>=Object.create(null);let primitiveCount=0,pointCount=0,serial=0;
  const counted=(ps:VectorPrimitive[])=>{primitiveCount+=ps.length;for(const p of ps)if(p.kind==='path')pointCount+=p.points.length;if(primitiveCount>VECTOR_LIMITS.primitives||pointCount>VECTOR_LIMITS.points)throw new Error('DXF normalized geometry budget exceeded');return ps;};
  const geometry=(r:RawRecord,p:Parsed|undefined):VectorPrimitive[]=>{
    const st=style(r);const mirrored=number(r,230,1)===-1; const normal=()=>{const nx=number(r,210),ny=number(r,220),nz=number(r,230,1);if(nx!==0||ny!==0||![-1,1].includes(nz))throw new Error('Tilted OCS is unsupported');if(mirrored&&!['ARC','CIRCLE','LWPOLYLINE'].includes(r.type))throw new Error('Reflected OCS unsupported for this type');};
    if(['ARC','CIRCLE','LWPOLYLINE','TEXT','INSERT','HATCH'].includes(r.type))normal();
    switch(r.type){
      case 'LINE': if(!p?.vertices?.length)throw new Error('Missing LINE endpoints');return [{...st,kind:'path',points:p.vertices.map(point),closed:false}];
      case 'LWPOLYLINE': case 'POLYLINE': {if(!p?.vertices||p.vertices.length<2)throw new Error('Missing polyline vertices');if(r.type==='POLYLINE'&&(number(r,70)&(16|64)))throw new Error('Mesh/polyface unsupported');if(p.vertices.some(v=>v.bulge!==undefined&&!Number.isFinite(v.bulge)))throw new Error('Invalid bulge');const pts=p.vertices.map(v=>({...point({...v,...(v.z===undefined&&p.elevation!==undefined?{z:p.elevation}:{})}),...(mirrored?{x:-v.x*factor||0,...((v.z??p.elevation)===undefined?{}:{z:-(v.z??p.elevation)!*factor||0})}:{}),...(v.bulge?{bulge:mirrored?-v.bulge:v.bulge}:{})}));return [{...st,kind:'path',points:bulgePath(pts,!!p.shape),closed:!!p.shape}];}
      case 'ARC': case 'CIRCLE': if(!p?.center||!p.radius||p.radius<=0)throw new Error('Invalid arc/circle');return [{...st,kind:r.type==='ARC'?'arc':'circle',center:mirrored?{...point(p.center),x:-p.center.x*factor||0,...(p.center.z===undefined?{}:{z:-p.center.z*factor||0})}:point(p.center),radius:p.radius*factor,...(r.type==='ARC'?{startAngle:mirrored?Math.PI-(p.endAngle??0):p.startAngle??0,endAngle:mirrored?Math.PI-(p.startAngle??0):p.endAngle??2*Math.PI}:{})} as VectorPrimitive];
      case 'TEXT': case 'MTEXT': case 'ATTRIB': case 'ATTDEF': {const content=plainDxfText(p?.text??value(r,1)??'');if(!content)throw new Error('Empty DXF text');const rotationDeg=p?.directionVector?Math.atan2(p.directionVector.y,p.directionVector.x)*180/Math.PI:p?.rotation??number(r,50);return [{...st,kind:'text',position:p?.startPoint||p?.position?point(p.startPoint??p.position):rawPoint(r),content,...(['ATTRIB','ATTDEF'].includes(r.type)?{attributeTag:value(r,2)??''}:{}),height:(p?.textHeight??p?.height??number(r,40,1))*factor,rotationDeg}];}
      case 'INSERT': {if(number(r,70,1)>1||number(r,71,1)>1)throw new Error('MINSERT array unsupported');const id=blockIds.get(value(r,2)??'');if(!id)throw new Error('Missing block');return [{...st,kind:'block',blockDefinitionId:id,position:rawPoint(r),rotationDeg:number(r,50),scaleX:number(r,41,1),scaleY:number(r,42,1),...(number(r,43,1)===1?{}:{scaleZ:number(r,43,1)})}];}
      case 'DIMENSION': {const id=blockIds.get(p?.block??value(r,2)??'');if(!id)throw new Error('Missing dimension anonymous block');return [{...st,kind:'block',blockDefinitionId:id,position:{x:0,y:0},rotationDeg:0,scaleX:1,scaleY:1}];}
      case 'HATCH': {const fillGroup=`dxf-fill-${serial++}`;return hatchPrimitives(r,{...st,fillGroup,fillOpacity:number(r,70)===1?1:.12},factor);}
      case 'MULTILEADER': return leaderPrimitives(r,st,factor);
      case 'SOLID': case '3DFACE': {const pts=[10,11,12,13].filter(c=>value(r,c)!==undefined).map(c=>rawPoint(r,c));if(pts.length<3)throw new Error('Invalid face');return [{...st,kind:'path',points:pts,closed:true,fill:r.type==='SOLID'}];}
      case 'POINT': {const pt=rawPoint(r),s=.1*factor;return [{...st,kind:'path',points:[{x:pt.x-s,y:pt.y},{x:pt.x+s,y:pt.y}],closed:false},{...st,kind:'path',points:[{x:pt.x,y:pt.y-s},{x:pt.x,y:pt.y+s}],closed:false}];}
      default:throw new Error(`${r.type} unsupported`);
    }
  };
  const attributeValues=(r:RawRecord)=>{const attributes:Record<string,string>=Object.create(null),index=records.indexOf(r);for(let j=index+1;records[j]?.type==='ATTRIB';j++){const a=records[j]!,key=value(a,2)??`attribute-${j}`;if(['__proto__','constructor','prototype'].includes(key))throw new Error('Unsafe attribute name');attributes[key]=plainDxfText(value(a,1)??'');}return attributes;};
  const externalNames=new Set(blocks.filter(r=>number(r,70)&(4|8)||!!value(r,1)).map(r=>value(r,2)??''));
  if(externalNames.size)warnings.add(`Внешние XREF (${externalNames.size}) отключены; файлы, изображения и шрифты не загружаются.`);
  const blockRecords=new Map<string,RawRecord[]>(),blockAttributes=new Map<string,VectorPrimitive[]>();for(const r of records)if(r.section==='BLOCKS'&&r.block&&(!nonEntities.has(r.type)||r.type==='ATTRIB')){const list=blockRecords.get(r.block)??[];list.push(r);blockRecords.set(r.block,list);}
  for(const r of blocks){const name=value(r,2)??'',definition:BlockDefinition={id:blockIds.get(name)!,sourceName:name,basePoint:rawPoint(r),primitives:[]};
    if(!externalNames.has(name))for(const entity of blockRecords.get(name)??[]){const row=blockTypes[entity.type]??=reportRow();row.total++;try{if(entity.type==='INSERT'&&externalNames.has(value(entity,2)??''))throw new Error('External XREF disabled');const parsedEntity=blockIndex.get(name)?.get(entity),ps=geometry(entity,parsedEntity);if(entity.type==='INSERT'&&ps[0]?.kind==='block'){const attributes=attributeValues(entity);if(Object.keys(attributes).length)ps[0].attributes=attributes;}if(['ATTRIB','ATTDEF'].includes(entity.type)&&(number(entity,70)&1))ps.forEach(p=>p.visible=false);if(entity.type==='ATTRIB'){const attributes=blockAttributes.get(name)??[];attributes.push(...ps.map(p=>p.kind==='text'?{...p,attributeTag:value(entity,2)??'ATTRIB'}:p));blockAttributes.set(name,attributes);}else definition.primitives.push(...counted(ps));if(entity.type==='MTEXT'||entity.type==='MULTILEADER'||entity.type==='HATCH'&&number(entity,70)!==1||parsedEntity?.vertices?.some(v=>v.bulge)){row.simplified++;}else row.proxy++;}catch(e){row.unsupported++;warnings.add(`В блоках ${entity.type}: ${e instanceof Error?e.message:'unsupported'}`);}}
    document.blocks!.push(definition);
  }
  // Remove unsafe references before constructing a document; definitions remain shared, never exploded.
  const definitions=new Map(document.blocks!.map(b=>[b.id,b]));
  const sanitized=new Set<string>();
  const sanitize=(id:string,stack:string[])=>{if(sanitized.has(id))return;const b=definitions.get(id)!;b.primitives=b.primitives.filter(p=>{if(p.kind!=='block')return true;if(stack.includes(p.blockDefinitionId)||stack.length>=VECTOR_LIMITS.depth){warnings.add('Циклическая/слишком глубокая ссылка блока пропущена.');const row=blockTypes[p.source?.originalType??'INSERT'];if(row){if(row.proxy)row.proxy--;else if(row.simplified)row.simplified--;row.unsupported++;}return false;}sanitize(p.blockDefinitionId,[...stack,p.blockDefinitionId]);return true;});sanitized.add(id);};
  for(const id of definitions.keys())sanitize(id,[id]);
  const collectBlockAttributes=(id:string,matrix:ReturnType<typeof blockMatrix>,stack:string[]=[],output:VectorPrimitive[]=[]):VectorPrimitive[]=>{if(stack.includes(id)||stack.length>=VECTOR_LIMITS.depth)return output;const definition=definitions.get(id);if(!definition)return output;const angle=Math.atan2(matrix[1],matrix[0])*180/Math.PI,heightScale=Math.sqrt(Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2]));for(const primitive of blockAttributes.get(definition.sourceName)??[])if(primitive.kind==='text')output.push({...primitive,position:transformPoint(primitive.position,matrix),rotationDeg:primitive.rotationDeg+angle,height:primitive.height*heightScale,attributeTag:primitive.attributeTag??'ATTRIB'});for(const primitive of definition.primitives)if(primitive.kind==='block'){const child=definitions.get(primitive.blockDefinitionId);if(child)collectBlockAttributes(child.id,multiply(matrix,blockMatrix(primitive,child.basePoint)),[...stack,id],output);}return output;};
  const modelOwner=records.find(r=>r.type==='BLOCK_RECORD'&&value(r,2)?.toUpperCase()==='*MODEL_SPACE');const owner=value(modelOwner??{type:'',groups:[],section:''},5);
  const ownerHandle=(r:RawRecord)=>{const end=r.groups.findIndex(g=>g.code===100&&g.value==='AcDbEntity');return (end<0?r.groups:r.groups.slice(0,end)).filter(g=>g.code===330).at(-1)?.value;};
  const top=records.filter(r=>r.section==='ENTITIES'&&!nonEntities.has(r.type));const model=top.filter(r=>owner&&ownerHandle(r)?ownerHandle(r)===owner:number(r,67)===0&&(!value(r,410)||value(r,410)?.toUpperCase()==='MODEL'));
  if(model.length>50000)throw new Error('DXF model entity budget exceeded');
  const vertex=(p:WorldPoint)=>{const id=`dxf-v-${serial++}`;document.vertices[id]={id,...p};return id;};
  const entityStyle=(r:RawRecord,st:PrimitiveStyle)=>{if(st.colorMode!=='explicit'&&!st.lineWeight&&!st.dash)return undefined;const base=styles.find(s=>s.id===layers.find(l=>l.id===st.layerId)!.styleId)!;const id=`dxf-explicit-${styles.length}`;if(styles.length>=1000)throw new Error('DXF style budget exceeded');styles.push({...base,id,...(st.stroke?{stroke:st.stroke}:{}),...(st.lineWeight?{lineWeight:st.lineWeight}:{}),...(st.dash?{dash:st.dash}:{})});if(number(r,62)===0)warnings.add('BYBLOCK вне блока использует цвет слоя.');return id;};
  for(const [i,r]of model.entries()){
    const row=types[r.type]??=reportRow();row.total++;
    try{
      if(r.type==='INSERT'&&externalNames.has(value(r,2)??''))throw new Error('External XREF disabled');
      const p=mainIndex.get(r),ps=geometry(r,p),st=style(r),styleId=entityStyle(r,st),base={id:`dxf-entity-${i}`,name:r.type==='INSERT'?value(r,2)??'Block':`${r.type} ${value(r,5)??i+1}`,layerId:st.layerId,source:source(r),...(number(r,60)!==0?{visible:false}:{}),...(styleId?{styleId}:{})};let entity:Entity;
      const first=ps[0]!;
      if(r.type==='LINE'&&first.kind==='path'){entity={...base,type:'line',startVertexId:vertex(first.points[0]!),endVertexId:vertex(first.points[1]!)};row.converted++;}
      else if(['POLYLINE','LWPOLYLINE'].includes(r.type)&&first.kind==='path'){
        const ids=first.points.map(vertex),closed=first.closed&&ids.length>=3&&!polygonSelfIntersects(first.points);entity=closed?{...base,type:'polygon',vertexIds:ids as [string,string,string,...string[]]}:{...base,type:'polyline',vertexIds:ids as [string,string,...string[]]};
        if(p?.vertices?.some(v=>v.bulge)||first.closed&&!closed)row.simplified++;else row.converted++;if(p?.vertices?.some(v=>v.bulge))warnings.add('Bulge tessellation: maximum sagitta 0.01 м.');if(first.closed&&!closed){warnings.add('Невалидная закрытая граница сохранена как замкнутая полилиния.');(entity as Extract<Entity,{type:'polyline'}>).vertexIds.push(ids[0]!);}
      }
      else if((r.type==='TEXT'||r.type==='MTEXT')&&first.kind==='text'){entity={...base,type:'text',vertexId:vertex(first.position),content:first.content,fontSize:12,height:first.height,rotationDeg:first.rotationDeg};if(r.type==='MTEXT'||plainDxfText(p?.text??'')!==p?.text){row.simplified++;warnings.add('Текст: rich formatting, font, justification и ширина упрощены; plain text/rotation/height сохранены.');}else row.converted++;}
      else if(first.kind==='arc'&&r.type==='ARC'){entity={...base,type:'arc',center:first.center,radius:first.radius,startAngle:first.startAngle,endAngle:first.endAngle};row.converted++;}
      else if(first.kind==='circle'&&r.type==='CIRCLE'){entity={...base,type:'circle',center:first.center,radius:first.radius};row.converted++;}
      else if(first.kind==='block'&&r.type==='INSERT'){
        const attributes=attributeValues(r),attributePrimitives:VectorPrimitive[]=[],index=records.indexOf(r),definition=definitions.get(first.blockDefinitionId)!;
        const transform=blockMatrix(first,definition.basePoint),inverse=invertMatrix(transform);if(!inverse)throw new Error('Singular INSERT transform');
        for(let j=index+1;records[j]?.type==='ATTRIB';j++){const a=records[j]!,key=value(a,2)??`attribute-${j}`;if(['__proto__','constructor','prototype'].includes(key))throw new Error('Unsafe attribute name');attributes[key]=plainDxfText(value(a,1)??'');try{for(const ap of geometry(a,undefined)){if(ap.kind==='text'&&!(number(a,70)&1))attributePrimitives.push({...ap,source:{...(ap.source??source(a)),blockName:definition.sourceName},attributeTag:key,position:transformPoint(ap.position,inverse),rotationDeg:ap.rotationDeg-first.rotationDeg});}}catch{warnings.add('INSERT attribute geometry unsupported; value preserved.');}}
        attributePrimitives.push(...collectBlockAttributes(first.blockDefinitionId,[1,0,0,1,0,0]));
        entity={...base,type:'block_instance',blockDefinitionId:first.blockDefinitionId,position:first.position,rotationDeg:first.rotationDeg,scaleX:first.scaleX,scaleY:first.scaleY,...(first.scaleZ===undefined?{}:{scaleZ:first.scaleZ}),...(Object.keys(attributes).length||attributePrimitives.length?{...(Object.keys(attributes).length?{attributes}:{}),attributePrimitives:counted(attributePrimitives),attributeCoordinateSpace:'block-local' as const}:{})};row.converted++;
      }else{const semanticContent: ImportedSemanticContent = {};
        if (r.type === 'MULTILEADER') { const runs = ps.filter(p=>p.kind==='text').map(p=>({text:p.content,position:p.position})); if(runs.length){semanticContent.textRuns=runs;semanticContent.primaryText=runs.map(p=>p.text).join('\n');} }
        if (r.type === 'DIMENSION') {
          const definition = first.kind==='block' ? definitions.get(first.blockDefinitionId) : undefined;
          const runs = definition?.primitives.filter(p=>p.kind==='text').map(p=>({text:p.content,position:p.position})) ?? [];
          const override = plainDxfText(value(r,1)??'');
          if (runs.length) semanticContent.textRuns = runs;
          const text = runs.map(p=>p.text).join('\n') || (override && override!=='<>' ? override : '');
          if(text)semanticContent.primaryText=text;
          if(value(r,42)!==undefined && Number.isFinite(number(r,42))) semanticContent.measuredValue=number(r,42)*([2,5].includes(number(r,70)&7)?1:factor);
          if(value(r,70)!==undefined) semanticContent.dimensionType=number(r,70);
        }
        entity={...base,type:'imported_graphic',position:{x:0,y:0},primitives:counted(ps),...(Object.keys(semanticContent).length?{semanticContent}:{})};if(r.type==='HATCH'&&number(r,70)!==1){row.simplified++;warnings.add('HATCH pattern/gradient упрощён до границ и базовой заливки.');}else if(r.type==='MULTILEADER'){row.simplified++;warnings.add('MULTILEADER: текст и leader lines сохранены, CAD placement/style/arrowheads упрощены.');}else row.proxy++;}
      document.entities.push(entity);
    }catch(e){row.unsupported++;warnings.add(`${r.type}: ${e instanceof Error?e.message:'unsupported'}`);}
  }
  progress('Валидация документа');timings.normalization=performance.now()-start;const vt=performance.now();const validated=validateDocument(document);encodeDocument(validated);timings.validation=performance.now()-vt;
  const currentLayerId=layerIds.get(String(header.$CLAYER??''))??layers.find(l=>l.visible&&!l.locked)?.id??layers[0]!.id;
  warnings.add('CAD fidelity: fonts, text alignment, complex line types/weights and paper space are simplified. No external resources are loaded.');
  return {document:validated,currentLayerId,report:{filename,version:String(header.$ACADVER??'unknown'),encoding:decoded.encoding,declaredCodepage:decoded.codepage,originalUnits,factor,requiresUnitsChoice:recognized===undefined&&!options.units,requiresEncodingChoice:decoded.requiresEncodingChoice,layerCount:layers.length,modelSpaceCount:model.length,blockCount:blocks.length,blockInstances:validated.entities.filter(e=>e.type==='block_instance').length,paperSpaceCount:top.length-model.length,types,blockTypes,warnings:[...warnings],timings,normalizedPrimitives:primitiveCount}};
}
