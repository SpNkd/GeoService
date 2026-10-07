import type { SemanticConcept } from './schema';
export const normalizeQuery = (value:string) => value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').trim();
export const semanticTokens = (value:string) => normalizeQuery(value).replace(/[_\-\s]+/g,' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Deterministic lexical evidence, not geometry recognition. Prefixes are centralized and bounded to tokens. */
export const CONCEPT_ALIASES: Record<SemanticConcept,{prefixes:readonly string[];exact:readonly string[]}> = {
  pipe:{prefixes:['труб','pipe'],exact:[]},gas_pipe:{prefixes:['газопровод'],exact:[]},water_pipe:{prefixes:['водопровод'],exact:[]},cable:{prefixes:['кабел'],exact:[]},electricity:{prefixes:['электр'],exact:[]},fence:{prefixes:['ограда','забор','fence'],exact:[]},equipment:{prefixes:['оборудован','equipment'],exact:[]},valve:{prefixes:['клапан','valve'],exact:[]},well:{prefixes:['колод','well'],exact:[]},
  buildings:{prefixes:['здани','зданий','сооружен','building'],exact:['зис']},
  roads:{prefixes:['дорог','дорож','проезд','road'],exact:[]},
  slopes:{prefixes:['откос','slope'],exact:[]},
  utilities:{prefixes:['трубопровод','газопровод','газов','кабел','водопровод','канализац','utility'],exact:['сеть','сети','сетей','газ']},
  annotations:{prefixes:['аннотац','подпис','надпис','выноск','annotation'],exact:[]},
  dimensions:{prefixes:['размер','dimension'],exact:[]},
  text:{prefixes:['текст','text'],exact:[]},
  blocks:{prefixes:['блок','block'],exact:[]},
  hatches:{prefixes:['штрихов','hatch'],exact:[]},
  symbols:{prefixes:['символ','symbol'],exact:[]},
};
export const conceptLabels:Record<SemanticConcept,string>={pipe:'Трубы',gas_pipe:'Газопровод',water_pipe:'Водопровод',cable:'Кабель',electricity:'Электричество',fence:'Ограда',equipment:'Оборудование',valve:'Клапан',well:'Колодец',buildings:'Здания',roads:'Дороги',slopes:'Откосы',utilities:'Сети',annotations:'Аннотации',dimensions:'Размеры',text:'Текст',blocks:'Блоки',hatches:'Штриховки',symbols:'Символы'};
export function conceptEvidence(value:string,concept:SemanticConcept):'STRONG'|'WEAK'|null {
  const tokens=semanticTokens(value),aliases=CONCEPT_ALIASES[concept];
  if(tokens.some(t=>aliases.prefixes.some(p=>t.startsWith(p))))return 'STRONG';
  if(tokens.some(t=>aliases.exact.includes(t)))return concept==='buildings'&&tokens.join(' ')!=='гп зис'?'WEAK':'STRONG';
  return null;
}
