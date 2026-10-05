import type { GeoDocument } from '../domain/model';
/** Pure local index. Contains no provider/network dependency or inferred building semantics. */
export function createProvenanceIndex(document:GeoDocument) {
  const layers=new Map<string,string[]>(),types=new Map<string,string[]>(),blocks=new Map<string,string[]>(),provenance=new Map(document.entities.filter(e=>e.source).map(e=>[e.id,e.source!]));
  const add=(map:Map<string,string[]>,key:string,id:string)=>{const list=map.get(key)??[];list.push(id);map.set(key,list);};
  for(const e of document.entities){if(e.source){add(layers,e.source.originalLayer,e.id);add(types,e.source.originalType,e.id);}if(e.type==='block_instance'){const name=document.blocks?.find(b=>b.id===e.blockDefinitionId)?.sourceName;if(name)add(blocks,name,e.id);}}
  return {getEntitiesBySourceLayer:(name:string)=>[...(layers.get(name)??[])],getEntitiesBySourceType:(type:string)=>[...(types.get(type)??[])],getBlockInstancesBySourceName:(name:string)=>[...(blocks.get(name)??[])],getImportedEntityProvenance:(id:string)=>{const p=provenance.get(id);return p?{...p,...(p.blockPath?{blockPath:[...p.blockPath]}:{})}:undefined;}};
}
