import type { GeoDocument } from '../domain/model';
import type { SemanticConcept } from './model';
const entries: [string,string,string[],string?][] = [
  ['buildings','Здания',['здание','здания','building']],['roads','Дороги',['дорога','дороги','road']],['slopes','Откосы',['откос','откосы']],
  ['utilities','Инженерные сети',['сети','инженерные сети','utility']],['annotations','Аннотации',['аннотация','аннотации']],['dimensions','Размеры',['размер','размеры']],
  ['text','Текст',['текст']],['blocks','Блоки',['блок','блоки']],['hatches','Штриховки',['штриховка','штриховки']],['symbols','Символы',['символ','символы']],
  ['pipe','Трубы',['труба','трубы','трубопровод','трубопроводы'],'utilities'],['gas_pipe','Газопровод',['газопровод','газопроводы'],'pipe'],
  ['water_pipe','Водопровод',['водопровод','водопроводы'],'pipe'],['cable','Кабель',['кабель','кабели'],'utilities'],['electricity','Электричество',['электричество'],'utilities'],
  ['fence','Ограда',['ограда','ограды','забор']],['equipment','Оборудование',['оборудование']],['valve','Клапан',['клапан','клапаны'],'equipment'],['well','Колодец',['колодец','колодцы']],
];
export const BUILTIN_CONCEPTS: readonly SemanticConcept[] = entries.map(([id,name,aliases,parentConceptId])=>({id,name,aliases,...(parentConceptId?{parentConceptId}:{})}));
export const normalizeConcept = (value:string)=>value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').trim();
export function conceptsFor(document: GeoDocument): SemanticConcept[] { const map=new Map(BUILTIN_CONCEPTS.map(c=>[c.id,c])); for(const c of document.semantics?.concepts??[])map.set(c.id,c);return [...map.values()]; }
export function conceptsNamed(document:GeoDocument, value:string): SemanticConcept[] { const n=normalizeConcept(value);return conceptsFor(document).filter(c=>[c.id,c.name,...c.aliases].some(a=>normalizeConcept(a)===n)); }
export function descendants(document:GeoDocument, id:string):Set<string> { const result=new Set([id]);let changed=true;const all=conceptsFor(document);while(changed){changed=false;for(const c of all)if(c.parentConceptId&&result.has(c.parentConceptId)&&!result.has(c.id)){result.add(c.id);changed=true;}}return result; }
