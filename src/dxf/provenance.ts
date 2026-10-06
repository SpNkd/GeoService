import type { Entity, GeoDocument } from '../domain/model';
import type { BlockDefinition, VectorPrimitive } from '../vectors/types';
import { VECTOR_LIMITS } from '../vectors/types';
export interface SemanticTextHit {
  ownerEntityId: string;
  sourceKind: 'native_text' | 'multileader' | 'dimension' | 'imported_text' | 'block_text' | 'block_attribute';
  text: string; path: string[]; primitivePath: number[]; layer: string; tag?: string; sourceHandle?:string; attributeIndex?:number;
}
interface DefinitionText { text: string; path: string[]; primitivePath: number[]; layer: string; tag?: string; attributeValue?: boolean }
export interface DefinitionSemantics {
  textContent: DefinitionText[]; attributeDefinitions: { tag: string; text: string; path: string[] }[];
  sourceTypes: string[]; nestedBlockNames: string[]; primitiveCount: number;
}
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ru-RU');
const definitionLibraries = new WeakMap<BlockDefinition[], Map<string, DefinitionSemantics>>();
/** Derived library metadata, never materialized as canonical document entities. */
function definitionIndex(document: GeoDocument) {
  const definitions = new Map(document.blocks?.map(b=>[b.id,b]) ?? []);
  const cache = document.blocks ? definitionLibraries.get(document.blocks) ?? new Map<string, DefinitionSemantics>() : new Map<string, DefinitionSemantics>();
  if(document.blocks) definitionLibraries.set(document.blocks, cache);
  const derive = (id: string, stack: string[] = []): DefinitionSemantics => {
    const empty: DefinitionSemantics = { textContent: [], attributeDefinitions: [], sourceTypes: [], nestedBlockNames: [], primitiveCount: 0 };
    if(stack.includes(id) || stack.length>=VECTOR_LIMITS.depth) return empty;
    const cached=cache.get(id);if(cached)return cached;
    const definition=definitions.get(id);if(!definition)return empty;
    const types=new Set<string>(),names=new Set<string>();
    for(const [i,p] of definition.primitives.entries()) {
      types.add(p.source?.originalType ?? p.kind);
      if(p.kind==='text') {
        empty.textContent.push({text:p.content,path:[definition.sourceName,p.source?.originalType??'TEXT'],primitivePath:[i],layer:p.source?.originalLayer??p.layerId,...(p.attributeTag?{tag:p.attributeTag}:{})});
        if(p.attributeTag)empty.attributeDefinitions.push({tag:p.attributeTag,text:p.content,path:[definition.sourceName]});
      }
      if(p.kind==='block') {
        const child=derive(p.blockDefinitionId,[...stack,id]),name=definitions.get(p.blockDefinitionId)?.sourceName??p.blockDefinitionId;
        names.add(name);child.nestedBlockNames.forEach(n=>names.add(n));child.sourceTypes.forEach(t=>types.add(t));
        empty.primitiveCount+=child.primitiveCount;
        empty.textContent.push(...child.textContent.map(t=>({...t,path:[definition.sourceName,...t.path],primitivePath:[i,...t.primitivePath]})));
        empty.attributeDefinitions.push(...child.attributeDefinitions.map(t=>({...t,path:[definition.sourceName,...t.path]})));
        for(const [tag,text] of Object.entries(p.attributes??{}))empty.textContent.push({text,tag,attributeValue:true,path:[definition.sourceName,name,'ATTRIB',tag],primitivePath:[i],layer:p.source?.originalLayer??p.layerId});
      } else empty.primitiveCount++;
    }
    empty.sourceTypes=[...types];empty.nestedBlockNames=[...names];cache.set(id,empty);return empty;
  };
  return {definitions,derive};
}
function proxyTexts(document: GeoDocument, primitives: VectorPrimitive[], path: string[] = [], indices: number[] = [], stack: string[] = []): DefinitionText[] {
  const {definitions,derive}=definitionIndex(document),texts: DefinitionText[]=[];
  for(const [i,p] of primitives.entries()) {
    if(p.kind==='text')texts.push({text:p.content,path:[...path,p.source?.originalType??'TEXT'],primitivePath:[...indices,i],layer:p.source?.originalLayer??p.layerId});
    if(p.kind==='block' && !stack.includes(p.blockDefinitionId)) {
      const name=definitions.get(p.blockDefinitionId)?.sourceName??p.blockDefinitionId;
      texts.push(...derive(p.blockDefinitionId).textContent.map(t=>({...t,path:[...path,name,...t.path.slice(1)],primitivePath:[...indices,i,...t.primitivePath]})));
    }
  }
  return texts;
}
/** Deterministic, local-only provenance and text search. Queries return owned copies. */
export function createProvenanceIndex(document:GeoDocument) {
  const {definitions,derive}=definitionIndex(document),layers=new Map<string,string[]>(),types=new Map<string,string[]>(),blocks=new Map<string,string[]>(),entities=new Map(document.entities.map(e=>[e.id,e]));
  const add=(map:Map<string,string[]>,key:string,id:string)=>{const list=map.get(key)??[];list.push(id);map.set(key,list);};
  for(const e of document.entities){if(e.source){add(layers,e.source.originalLayer,e.id);add(types,e.source.originalType,e.id);}if(e.type==='block_instance'){const name=definitions.get(e.blockDefinitionId)?.sourceName;if(name)add(blocks,name,e.id);}}
  const entityTexts=(e: Entity): SemanticTextHit[] => {
    const layer=e.source?.originalLayer??document.layers.find(l=>l.id===e.layerId)?.name??e.layerId;
    const hit=(text:string,sourceKind:SemanticTextHit['sourceKind'],path:string[]=[],primitivePath:number[]=[],sourceLayer=layer,tag?:string):SemanticTextHit=>({ownerEntityId:e.id,sourceKind,text,path,primitivePath,layer:sourceLayer,...(tag?{tag}:{})});
    if(e.type==='text')return [hit(e.content,'native_text',[e.source?.originalType??'TEXT'])];
    if(e.type==='block_instance') {
      const name=definitions.get(e.blockDefinitionId)?.sourceName??e.name;
      const attributes=(e.attributePrimitives??[]).flatMap((p,attributeIndex)=>p.kind==='text'&&p.source?.originalType==='ATTRIB'?[{primitive:p,attributeIndex}]:[]),represented=new Set(attributes.map(({primitive:p})=>p.attributeTag).filter((tag):tag is string=>!!tag));
      return [...Object.entries(e.attributes??{}).filter(([tag])=>!represented.has(tag)).map(([tag,text])=>hit(text,'block_attribute',[name,'ATTRIB',tag],[],layer,tag)),...attributes.map(({primitive:p,attributeIndex})=>({...hit(p.content,'block_attribute',[name,'ATTRIB',p.attributeTag??'ATTRIB',p.source?.handle??String(attributeIndex)],[attributeIndex],p.source?.originalLayer??layer,p.attributeTag),attributeIndex,...(p.source?.handle?{sourceHandle:p.source.handle}:{})})),...derive(e.blockDefinitionId).textContent.filter(t=>!t.attributeValue).map(t=>hit(t.text,'block_text',t.path,t.primitivePath,t.layer,t.tag))];
    }
    if(e.type==='imported_graphic') {
      const kind=e.source?.originalType==='MULTILEADER'?'multileader':e.source?.originalType==='DIMENSION'?'dimension':'imported_text';
      const result=proxyTexts(document,e.primitives).map(t=>hit(t.text,kind,t.path,t.primitivePath,t.layer));
      const text=e.semanticContent?.primaryText;if(text&&!result.some(h=>h.text===text))result.unshift(hit(text,kind,[e.source?.originalType??'proxy']));
      if(e.semanticContent?.measuredValue!==undefined)result.push(hit(String(e.semanticContent.measuredValue),'dimension',['DIMENSION','measurement']));
      return result;
    }
    return [];
  };
  let textIndex: {hit:SemanticTextHit; normalized:string}[]|undefined;
  const query=(text:string,attributes=false,includeDefinitions=true)=>{
    const needle=normalize(text.trim());if(!needle)return [];
    textIndex??=document.entities.flatMap(entity=>entityTexts(entity).map(hit=>({hit,normalized:normalize(hit.text)})));
    return textIndex.filter(({hit,normalized})=>(!attributes||hit.sourceKind==='block_attribute')&&(includeDefinitions||hit.sourceKind!=='block_text')&&normalized.includes(needle)).map(({hit})=>({...hit,path:[...hit.path],primitivePath:[...hit.primitivePath]}));
  };
  return {
    getEntitySourceTypes:(id:string)=>{const e=entities.get(id);if(!e)return [];const result=new Set([e.source?.originalType??e.type]);if(e.type==='block_instance'){derive(e.blockDefinitionId).sourceTypes.forEach(t=>result.add(t));if(Object.keys(e.attributes??{}).length||e.attributePrimitives?.some(p=>p.source?.originalType==='ATTRIB'))result.add('ATTRIB');}if(e.type==='imported_graphic')for(const p of e.primitives){result.add(p.source?.originalType??p.kind);if(p.kind==='block')derive(p.blockDefinitionId).sourceTypes.forEach(t=>result.add(t));}return [...result];},
    getEntitiesBySourceLayer:(name:string)=>[...(layers.get(name)??[])],
    getEntitiesBySourceType:(type:string)=>[...(types.get(type)??[])],
    getBlockInstancesBySourceName:(name:string)=>[...(blocks.get(name)??[])],
    getImportedEntityProvenance:(id:string)=>{const p=entities.get(id)?.source;return p?{...p,...(p.blockPath?{blockPath:[...p.blockPath]}:{})}:undefined;},
    getBlockDefinitionSemantics:(id:string)=>structuredClone(derive(id)),
    searchText:(text:string,options:{includeBlockDefinitions?:boolean}={})=>query(text,false,options.includeBlockDefinitions!==false),
    searchImportedText:(text:string)=>query(text).filter(h=>entities.get(h.ownerEntityId)?.source?.kind==='dxf'),
    searchBlockAttributes:(text:string)=>query(text,true),
    getEntitySemanticSummary:(id:string,options:{includeTexts?:boolean}={})=>{
      const e=entities.get(id);if(!e)return undefined;
      const definition=e.type==='block_instance'?definitions.get(e.blockDefinitionId):undefined;
      return {ownerEntityId:id,name:e.name,sourceType:e.source?.originalType??e.type,sourceLayer:e.source?.originalLayer,blockName:definition?.sourceName,
        ...(definition?{primitiveCount:derive(definition.id).primitiveCount,instanceCount:blocks.get(definition.sourceName)?.length??0}:{}),texts:(options.includeTexts===false?[]:entityTexts(e)).map(hit=>({...hit,path:[...hit.path],primitivePath:[...hit.primitivePath]})),...(e.type==='imported_graphic'?{semanticContent:e.semanticContent?structuredClone(e.semanticContent):undefined}:{})};
    },
  };
}
