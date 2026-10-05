import type { Entity, GeoDocument } from '../domain/model';
import { createProvenanceIndex, type SemanticTextHit } from '../dxf/provenance';
import { conceptEvidence, conceptLabels, normalizeQuery } from './aliases';
import { DOCUMENT_QUERY_LIMITS, documentQuerySchema, type DocumentQuery, type SemanticConcept } from './schema';
export interface MatchEvidence {source:string;reason:string;tier:'EXACT'|'STRONG'|'WEAK';path:string[];text?:string;tag?:string;sourceHandle?:string;attributeIndex?:number}
export interface QueryGroup {id:string;source:string;reason:string;tier:MatchEvidence['tier'];entityIds:string[]}
export interface ResolvedEntitySet {entityIds:string[];groups:QueryGroup[];evidence:Map<string,MatchEvidence[]>;query:DocumentQuery;querySummary:string;documentRevision:number;selectionFingerprint:string|null;error:string|null}
interface RecordEntry {entity:Entity;layerName:string;sourceLayer:string;blockName:string;sourceTypes:string[];texts:SemanticTextHit[];search:string}
export const selectionFingerprint=(ids:readonly string[])=>JSON.stringify([...new Set(ids)].sort());
const revisions=new WeakMap<GeoDocument,number>();let revisionCounter=0;
export function documentRevision(document:GeoDocument) {let revision=revisions.get(document);if(revision===undefined){revision=++revisionCounter;revisions.set(document,revision);}return revision;}
const emptyLibrary={};
const recordContents=new WeakMap<Entity,WeakMap<object,{texts:SemanticTextHit[];blockName:string;sourceTypes:string[]}>>();
const indexes=new WeakMap<GeoDocument,DocumentQueryIndex>();
export interface DocumentQueryIndex {records:Map<string,RecordEntry>;sourceLayers:Map<string,string[]>;currentLayers:Map<string,string[]>;blockNames:Map<string,string[]>;sourceTypes:Map<string,string[]>;entityTypes:Map<string,string[]>;names:Map<string,string[]>}
export function documentQueryIndex(document:GeoDocument):DocumentQueryIndex {
  const cached=indexes.get(document);if(cached)return cached;
  const provenance=createProvenanceIndex(document),layers=new Map(document.layers.map(l=>[l.id,l.name]));
  const index:DocumentQueryIndex={records:new Map(),sourceLayers:new Map(),currentLayers:new Map(),blockNames:new Map(),sourceTypes:new Map(),entityTypes:new Map(),names:new Map()};
  const add=(map:Map<string,string[]>,key:string,id:string)=>{if(!key)return;key=normalizeQuery(key);const ids=map.get(key)??[];ids.push(id);map.set(key,ids);};
  for(const entity of document.entities) {
    const library=document.blocks??emptyLibrary;let cache=recordContents.get(entity);if(!cache){cache=new WeakMap();recordContents.set(entity,cache);}let content=cache.get(library);
    if(!content){const summary=provenance.getEntitySemanticSummary(entity.id)!;content={texts:summary.texts,blockName:summary.blockName??'',sourceTypes:provenance.getEntitySourceTypes(entity.id)};cache.set(library,content);}
    const {texts,sourceTypes}=content;
    const record:RecordEntry={entity,layerName:layers.get(entity.layerId)??'',sourceLayer:entity.source?.originalLayer??'',blockName:content.blockName,sourceTypes,texts,search:''};
    record.search=normalizeQuery([entity.name,record.layerName,record.sourceLayer,record.blockName,...texts.flatMap(t=>[t.text,t.tag??''])].join('\n'));
    index.records.set(entity.id,record);add(index.names,entity.name,entity.id);add(index.currentLayers,record.layerName,entity.id);add(index.sourceLayers,record.sourceLayer,entity.id);add(index.blockNames,record.blockName,entity.id);add(index.entityTypes,entity.type,entity.id);for(const type of sourceTypes)add(index.sourceTypes,type,entity.id);
  }
  indexes.set(document,index);return index;
}
export function querySummary(query:DocumentQuery):string {
  switch(query.kind){case 'semantic_concept':return query.concepts.map(c=>conceptLabels[c]).join(', ');case 'current_selection':return 'Текущее выделение';case 'entity_type':return query.entityType;case 'source_type':return `DXF тип: ${query.sourceType}`;case 'text_contains':return `Текст: ${query.text}${query.sourceType?` · ${query.sourceType}`:''}`;case 'block_attribute':return `ATTRIB: ${query.tag??'любой tag'} = ${query.value??'любое значение'}`;default:return `${query.kind}: ${query.name}`;}
}
const intrinsic=(record:RecordEntry,concept:SemanticConcept)=>({dimensions:record.entity.type==='dimension'||record.sourceTypes.includes('DIMENSION'),text:record.texts.length>0,blocks:record.entity.type==='block_instance',hatches:record.sourceTypes.includes('HATCH'),symbols:record.entity.type==='symbol',annotations:['label','text'].includes(record.entity.type)||record.sourceTypes.includes('MULTILEADER')}[concept as 'dimensions'|'text'|'blocks'|'hatches'|'symbols'|'annotations']??false);
export function resolveDocumentQuery(raw:DocumentQuery,document:GeoDocument,selection:readonly string[]=[],excluded:ReadonlySet<string>=new Set()):ResolvedEntitySet {
  const parsed=documentQuerySchema.safeParse(raw);
  const result:ResolvedEntitySet={query:raw,entityIds:[],groups:[],evidence:new Map(),querySummary:parsed.success?querySummary(parsed.data):'Неверный запрос',documentRevision:documentRevision(document),selectionFingerprint:raw.kind==='current_selection'?selectionFingerprint(selection):null,error:null};
  if(!parsed.success){result.error='Неверный запрос документа';return result;}
  const query=parsed.data,index=documentQueryIndex(document),groups=new Map<string,QueryGroup>();
  const match=(id:string,evidence:MatchEvidence)=>{
    const key=JSON.stringify([evidence.source,evidence.reason,evidence.tier]);let group=groups.get(key);if(!group){group={id:key,source:evidence.source,reason:evidence.reason,tier:evidence.tier,entityIds:[]};groups.set(key,group);}if(!group.entityIds.includes(id))group.entityIds.push(id);
    const reasons=result.evidence.get(id)??[];if(reasons.length<DOCUMENT_QUERY_LIMITS.evidencePerOwner)reasons.push(evidence);result.evidence.set(id,reasons);
  };
  const exact=(ids:readonly string[],source:string,reason:string)=>ids.forEach(id=>match(id,{source,reason,tier:'EXACT',path:[]}));
  switch(query.kind) {
    case 'source_layer':exact(index.sourceLayers.get(normalizeQuery(query.name))??[],query.name,'Исходный DXF-слой — точное совпадение');break;
    case 'geoservice_layer':exact(index.currentLayers.get(normalizeQuery(query.name))??[],query.name,'Текущий GeoService слой — точное совпадение');break;
    case 'block_name':exact(index.blockNames.get(normalizeQuery(query.name))??[],query.name,'Имя определения блока — точное совпадение');break;
    case 'source_type':exact(index.sourceTypes.get(normalizeQuery(query.sourceType))??[],query.sourceType,'Исходный DXF-тип (включая вложенный content)');break;
    case 'entity_type':exact(index.entityTypes.get(query.entityType)??[],query.entityType,'Тип GeoService объекта');break;
    case 'entity_name':exact(index.names.get(normalizeQuery(query.name))??[],query.name,'Имя объекта — точное совпадение');break;
    case 'current_selection':exact([...new Set(selection)].filter(id=>index.records.has(id)),'Выделение','Текущее выделение');break;
    case 'block_attribute':
    case 'text_contains': {
      if(query.kind==='block_attribute'&&!query.tag&&!query.value){result.error='Нужен tag или значение ATTRIB';break;}
      for(const [id,r] of index.records)for(const hit of r.texts) {
        const hitType=hit.sourceKind==='multileader'?'MULTILEADER':hit.sourceKind==='block_attribute'?'ATTRIB':hit.sourceKind==='dimension'?'DIMENSION':hit.sourceKind==='block_text'?hit.path.find(p=>['TEXT','MTEXT','ATTDEF','ATTRIB'].includes(p))??'TEXT':r.entity.source?.originalType??'TEXT';
        const found=query.kind==='text_contains'?normalizeQuery(hit.text).includes(normalizeQuery(query.text))&&(!query.sourceType||r.sourceTypes.some(t=>normalizeQuery(t)===normalizeQuery(query.sourceType!))&&normalizeQuery(hitType)===normalizeQuery(query.sourceType)):hit.sourceKind==='block_attribute'&&(!query.tag||normalizeQuery(hit.tag??'')===normalizeQuery(query.tag))&&(!query.value||normalizeQuery(hit.text)===normalizeQuery(query.value));
        if(found)match(id,{source:hit.sourceKind,reason:query.kind==='text_contains'?`Текст содержит «${query.text}»`:'Текущее значение/tag ATTRIB',tier:'EXACT',path:hit.path,text:hit.text,...(hit.tag?{tag:hit.tag}:{}),...(hit.sourceHandle?{sourceHandle:hit.sourceHandle}:{}),...(hit.attributeIndex===undefined?{}:{attributeIndex:hit.attributeIndex})});
      }break;
    }
    case 'semantic_concept':
      for(const [id,r] of index.records)for(const concept of [...new Set(query.concepts)]) {
        if(intrinsic(r,concept))match(id,{source:conceptLabels[concept],reason:`Тип содержимого: ${conceptLabels[concept]}`,tier:'EXACT',path:[]});
        for(const [kind,value] of [['Текущий слой',r.layerName],['DXF-слой',r.sourceLayer],['Имя блока',r.blockName],['Имя объекта',r.entity.name]] as const) {const tier=conceptEvidence(value,concept);if(tier)match(id,{source:`${kind}: ${value}`,reason:`${conceptLabels[concept]}: словарь alias (${normalizeQuery(value)})`,tier,path:[]});}
        for(const hit of r.texts)if(conceptEvidence(hit.text,concept))match(id,{source:`Текст: ${hit.sourceKind}`,reason:`${conceptLabels[concept]}: упоминание в тексте`,tier:'WEAK',path:hit.path,text:hit.text});
      }break;
  }
  result.groups=[...groups.values()];
  if(result.evidence.size>DOCUMENT_QUERY_LIMITS.results||result.groups.length>DOCUMENT_QUERY_LIMITS.groups){result.error=`Превышен лимит запроса (${DOCUMENT_QUERY_LIMITS.results} объектов / ${DOCUMENT_QUERY_LIMITS.groups} групп). Уточните запрос.`;result.entityIds=[];return result;}
  result.entityIds=[...new Set(result.groups.filter(g=>!excluded.has(g.id)).flatMap(g=>g.entityIds))];return result;
}
export function defaultExcludedGroups(result:ResolvedEntitySet):Set<string>{return new Set(result.groups.filter(g=>g.tier==='WEAK').map(g=>g.id));}
export interface LocalSearchRow {entityId:string;name:string;entityType:Entity['type'];layer:string;sourceLayer:string;matches:SemanticTextHit[]}
export function searchDocument(document:GeoDocument,text:string):{rows:LocalSearchRow[];total:number} {
  const needle=normalizeQuery(text);if(!needle)return {rows:[],total:0};const rows:LocalSearchRow[]=[];let total=0;
  for(const [id,r] of documentQueryIndex(document).records)if(r.search.includes(needle)){total++;if(rows.length<DOCUMENT_QUERY_LIMITS.searchRows)rows.push({entityId:id,name:r.entity.name,entityType:r.entity.type,layer:r.layerName,sourceLayer:r.sourceLayer,matches:r.texts.filter(t=>normalizeQuery(`${t.text}\n${t.tag??''}`).includes(needle)).slice(0,5)});}
  return {rows,total};
}
