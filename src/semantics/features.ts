import { connectivityIndex } from '../connectors/model';
import { entityVertexIds, type Entity, type GeoDocument, type Layer, type Vertex } from '../domain/model';
import { documentQueryIndex } from '../documentOperations/query';
import { semanticTokens } from '../documentOperations/aliases';
import { lineTypes, resolveEntityStyle } from '../styles/model';
import type { BlockDefinition } from '../vectors/types';
import { featureIdentity, type FeatureCondition, type FeatureKey } from './model';
import { normalizeConcept } from './concepts';
export const FEATURE_LABELS: Record<FeatureKey,string>={kind:'Тип объекта',sourceLayer:'Исходный DXF-слой',layer:'Слой GeoService',sourceType:'Исходный DXF-тип',importKind:'Происхождение',blockDefinition:'Определение блока',blockName:'Имя блока',definitionSignature:'Состав определения',attributeKeys:'Схема ATTRIB',textToken:'Слово в собственном тексте/ATTRIB',styleMode:'Источник цвета',color:'Цвет',lineType:'Тип линии',width:'Толщина',fill:'Заливка',opacity:'Непрозрачность',textSize:'Размер текста',length:'Диапазон длины, м',area:'Диапазон площади, м²',vertices:'Число вершин',closed:'Замкнутость',aspect:'Пропорция',size:'Размерный класс, м',imageCandidate:'Кандидат векторизации',libraryId:'Библиотека символа',symbolId:'Тип символа',symbolProperty:'Свойство символа',connections:'Связи по концам / портам',connectedKind:'Тип связанного объекта'};
const kindLabels:Record<string,string>={point:'Точка',line:'Линия',polyline:'Полилиния',polygon:'Полигон',circle:'Окружность',arc:'Дуга',text:'Текст',label:'Подпись',dimension:'Размер',block_instance:'Экземпляр блока',imported_graphic:'Импортированная графика',symbol:'Символ',connector:'Соединение',raster_underlay:'Подложка',contour:'Контур'};
export function describeCondition(f:FeatureCondition,document?:GeoDocument):string {
  let value=f.value;
  if(['kind','imageCandidate','connectedKind'].includes(f.key))value=kindLabels[value]??value;
  if(f.key==='closed')value=value==='true'?'Да':'Нет';
  if(f.key==='lineType')value=lineTypes.find(t=>t.id===value)?.label??value;
  if(f.key==='importKind')value=value==='image-vectorization'?'Векторизация изображения':value==='native'?'Геометрия GeoService':value;
  if(f.key==='styleMode')value=({bylayer:'По слою',explicit:'Явно задан',source:'Исходный стиль'} as Record<string,string>)[value]??value;
  if(f.key==='blockDefinition'&&document)value=document.blocks?.find(b=>b.id===value)?.sourceName??value;
  return `${FEATURE_LABELS[f.key]}: ${value}`;
}
export interface FeatureSummary { entityId:string; facts:FeatureCondition[]; values:ReadonlySet<string> }
export interface FeatureIndex { summaries:Map<string,FeatureSummary>; byFact:Map<string,Set<string>>; derived:number; reused:number }
const caches=new WeakMap<Entity,{layer:Layer;styles:GeoDocument['styles'];blocks:GeoDocument['blocks'];vertices:Vertex[];summary:FeatureSummary}>();
const signatures=new WeakMap<BlockDefinition,string>();
const indexes=new WeakMap<GeoDocument['entities'],{vertices:GeoDocument['vertices'];layers:GeoDocument['layers'];styles:GeoDocument['styles'];blocks:GeoDocument['blocks'];index:FeatureIndex}>();
const bucket=(value:number)=>{if(!Number.isFinite(value)||value<1e-8)return '0';const lower=2**Math.floor(Math.log2(Number(value.toPrecision(6))));return `${Number(lower.toPrecision(6))}–${Number((lower*2).toPrecision(6))}`;};
function signature(definition:BlockDefinition):string {let value=signatures.get(definition);if(value)return value;const counts=new Map<string,number>();for(const p of definition.primitives){const key=p.kind==='path'?`path:${p.closed}:${bucket(p.points.length)}`:p.kind==='text'?`text:${normalizeConcept(p.attributeTag??'static')}`:p.kind==='block'?`block:${p.blockDefinitionId}`:p.kind;counts.set(key,(counts.get(key)??0)+1);}value=JSON.stringify([...counts].sort()).slice(0,512);signatures.set(definition,value);return value;}
function derive(document:GeoDocument,entity:Entity,layer:Layer,vertices:Vertex[],record:ReturnType<typeof documentQueryIndex>['records'] extends Map<string,infer R>?R:never):FeatureSummary {
  const facts:FeatureCondition[]=[],add=(key:FeatureKey,value:string|number|boolean|undefined)=>{if(value===undefined||value==='')return;facts.push({key,value:(['textToken','color','fill'].includes(key)?normalizeConcept(String(value)):String(value).normalize('NFKC').trim()).slice(0,512)});};
  add('kind',entity.type);add('layer',layer.name);add('sourceLayer',record.sourceLayer);add('sourceType',entity.source?.originalType);add('importKind',entity.imageSource?'image-vectorization':entity.source?.kind??'native');
  if(entity.imageSource)add('imageCandidate',entity.imageSource.candidateType);
  const style=resolveEntityStyle(document,entity,layer);add('color',style.stroke);add('lineType',lineTypes.find(t=>t.dash===style.dash)?.id??style.dash??'continuous');add('width',Number(style.lineWeight.toPrecision(3)));add('fill',style.fill);add('opacity',Number(style.opacity.toFixed(2)));add('styleMode',entity.style?.strokeColor===null?'bylayer':entity.style?.strokeColor?'explicit':entity.source?'source':'bylayer');
  if(entity.type==='text')add('textSize',bucket(entity.height??entity.fontSize));
  for(const token of [...new Set(record.texts.flatMap(hit=>semanticTokens(hit.text)).filter(t=>t.length>=2))].sort().slice(0,64))add('textToken',token);
  if(entity.type==='block_instance'){add('blockDefinition',entity.blockDefinitionId);add('blockName',record.blockName);const definition=document.blocks?.find(b=>b.id===entity.blockDefinitionId);if(definition)add('definitionSignature',signature(definition));const keys=[...new Set([...Object.keys(entity.attributes??{}),...record.texts.flatMap(t=>t.tag?[t.tag]:[])])].map(normalizeConcept).sort();if(keys.length)add('attributeKeys',keys.join(' · '));add('size',bucket(Math.max(Math.abs(entity.scaleX),Math.abs(entity.scaleY))));}
  if(entity.type==='symbol'){add('libraryId',entity.libraryId);add('symbolId',entity.symbolId);add('size',bucket(entity.scale));for(const [key,value] of Object.entries(entity.properties??{}).slice(0,24))add('symbolProperty',`${key}=${value}`);}
  if(vertices.length>1){const closed=entity.type==='polygon';let length=0,area=0;for(let i=1;i<vertices.length;i++)length+=Math.hypot(vertices[i]!.x-vertices[i-1]!.x,vertices[i]!.y-vertices[i-1]!.y);if(closed){const a=vertices.at(-1)!,b=vertices[0]!;length+=Math.hypot(a.x-b.x,a.y-b.y);for(let i=0;i<vertices.length;i++){const p=vertices[i]!,q=vertices[(i+1)%vertices.length]!;const origin=vertices[0]!;area+=(p.x-origin.x)*(q.y-origin.y)-(q.x-origin.x)*(p.y-origin.y);}add('area',bucket(Math.abs(area)/2));}add('length',bucket(length));add('vertices',bucket(vertices.length));add('closed',closed);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of vertices){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}const width=maxX-minX,height=maxY-minY;add('size',bucket(Math.max(width,height)));if(width>1e-8&&height>1e-8)add('aspect',bucket(Math.max(width,height)/Math.min(width,height)));}
  if(entity.type==='circle'||entity.type==='arc'){add('size',bucket(entity.radius*2));add('closed',entity.type==='circle');if(entity.type==='circle'){add('length',bucket(Math.PI*2*entity.radius));add('area',bucket(Math.PI*entity.radius**2));}}
  const unique=[...new Map(facts.map(f=>[featureIdentity(f),f])).values()];return {entityId:entity.id,facts:unique,values:new Set(unique.map(featureIdentity))};
}
/** Reuses the existing owner/text index; nested definitions are summarized once. No image pixels or coordinates as identity. */
export function featureIndex(document:GeoDocument):FeatureIndex {
  const old=indexes.get(document.entities);if(old&&old.vertices===document.vertices&&old.layers===document.layers&&old.styles===document.styles&&old.blocks===document.blocks)return old.index;
  const metadata=documentQueryIndex(document),layers=new Map(document.layers.map(l=>[l.id,l])),base=new Map<string,FeatureSummary>();let derived=0,reused=0;
  for(const entity of document.entities){const layer=layers.get(entity.layerId)!;const vertices=entityVertexIds(entity).map(id=>document.vertices[id]!);const cached=caches.get(entity);let summary:FeatureSummary;
    if(cached&&cached.layer===layer&&cached.styles===document.styles&&cached.blocks===document.blocks&&cached.vertices.length===vertices.length&&cached.vertices.every((v,i)=>v===vertices[i])){summary=cached.summary;reused++;}
    else {summary=derive(document,entity,layer,vertices,metadata.records.get(entity.id)!);caches.set(entity,{layer,styles:document.styles,blocks:document.blocks,vertices,summary});derived++;}base.set(entity.id,summary);
  }
  // Real topology only: shared canonical endpoint IDs and explicit Symbol/Connector ports. Never proximity.
  const endpoints=new Map<string,string[]>(),degrees=new Map<string,number>(),kinds=new Map<string,Set<string>>();
  const addRelation=(id:string,kind:string,count=1)=>{degrees.set(id,(degrees.get(id)??0)+count);const set=kinds.get(id)??new Set<string>();set.add(kind);kinds.set(id,set);};
  const topology=connectivityIndex(document),ownerMap=topology.entities;
  for(const e of document.entities){if(e.type==='line'||e.type==='polyline'){const ids=entityVertexIds(e);for(const id of new Set([ids[0]!,ids.at(-1)!])){const list=endpoints.get(id)??[];list.push(e.id);endpoints.set(id,list);}}}
  for(const [id,ports]of topology.byConnector)for(const endpoint of [ports.start,ports.end]){const symbol=ownerMap.get(endpoint.symbolEntityId);if(symbol?.type==='symbol'){addRelation(id,`symbol:${symbol.libraryId}/${symbol.symbolId}`);addRelation(symbol.id,'connector');}}
  for(const list of endpoints.values())if(list.length>1){const counts=new Map<string,number>();for(const id of list){const kind=ownerMap.get(id)!.type;counts.set(kind,(counts.get(kind)??0)+1);}for(const id of list){const own=ownerMap.get(id)!.type;degrees.set(id,(degrees.get(id)??0)+list.length-1);for(const [kind,count]of counts)if(count>(kind===own?1:0)){const set=kinds.get(id)??new Set<string>();set.add(kind);kinds.set(id,set);}}}
  const summaries=new Map<string,FeatureSummary>(),byFact=new Map<string,Set<string>>();
  for(const [id,s]of base){const facts=[...s.facts,{key:'connections' as const,value:bucket(degrees.get(id)??0)},...[...(kinds.get(id)??[])].sort().map(value=>({key:'connectedKind' as const,value}))];const summary={entityId:id,facts,values:new Set(facts.map(featureIdentity))};summaries.set(id,summary);for(const f of facts){const key=featureIdentity(f),set=byFact.get(key)??new Set();set.add(id);byFact.set(key,set);}}
  const index={summaries,byFact,derived,reused};indexes.set(document.entities,{vertices:document.vertices,layers:document.layers,styles:document.styles,blocks:document.blocks,index});return index;
}
