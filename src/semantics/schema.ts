import { z } from 'zod';
import type { GeoDocument } from '../domain/model';
import { BUILTIN_CONCEPTS, normalizeConcept } from './concepts';
import { FEATURE_KEYS } from './model';
const id=z.string().trim().min(1).max(256).refine(v=>!['__proto__','prototype','constructor'].includes(v)), name=z.string().trim().min(1).max(128);
export const conceptSchema=z.strictObject({id,name,aliases:z.array(name).max(32),parentConceptId:id.optional(),description:z.string().max(1000).optional()});
export const conditionSchema=z.strictObject({key:z.enum(FEATURE_KEYS),value:z.string().min(1).max(512)});
export const ruleSchema=z.strictObject({id,conceptId:id,scope:z.literal('document'),version:z.literal(1),conditions:z.array(conditionSchema).min(1).max(12),supporting:z.array(conditionSchema).max(12),enabled:z.boolean(),enabledTiers:z.array(z.enum(['EXACT','STRONG','WEAK'])).max(3),positiveExamples:z.array(id).max(50000),exclusions:z.array(id).max(50000)});
export const annotationSchema=z.strictObject({entityId:id,conceptId:id,polarity:z.enum(['positive','negative']),source:z.enum(['user-explicit','rule-confirmed'])});
export const knowledgeSchema=z.strictObject({version:z.literal(1),concepts:z.array(conceptSchema).max(200),annotations:z.array(annotationSchema).max(100000),rules:z.array(ruleSchema).max(200)});
export function validateSemanticKnowledge(document:GeoDocument) {
  const knowledge=document.semantics;if(!knowledge)return;
  const concepts=new Map(BUILTIN_CONCEPTS.map(c=>[c.id,c])), ids=new Set<string>();
  for(const c of knowledge.concepts){if(ids.has(c.id))throw new Error('Повторяющийся ID категории');ids.add(c.id);concepts.set(c.id,c);}
  const names=new Map<string,string>();
  for(const c of concepts.values()) {for(const text of [c.id,c.name,...c.aliases]){const n=normalizeConcept(text),other=names.get(n);if(other&&other!==c.id)throw new Error(`Название/синоним «${text}» относится к двум категориям`);names.set(n,c.id);}const chain=new Set([c.id]);let parent=c.parentConceptId;while(parent){if(chain.has(parent)||!concepts.has(parent))throw new Error('Некорректный родитель или цикл категорий');chain.add(parent);parent=concepts.get(parent)!.parentConceptId;}}
  const owners=new Set(document.entities.map(e=>e.id)), pairs=new Set<string>(), rules=new Set<string>();
  for(const a of knowledge.annotations){const pair=JSON.stringify([a.entityId,a.conceptId]);if(pairs.has(pair)||!owners.has(a.entityId)||!concepts.has(a.conceptId))throw new Error('Некорректная или повторяющаяся смысловая метка');pairs.add(pair);}
  for(const r of knowledge.rules){if(rules.has(r.id)||!concepts.has(r.conceptId)||[...r.positiveExamples,...r.exclusions].some(id=>!owners.has(id)))throw new Error('Правило ссылается на отсутствующую категорию/объект');rules.add(r.id);if(new Set(r.enabledTiers).size!==r.enabledTiers.length||new Set(r.positiveExamples).size!==r.positiveExamples.length||new Set(r.exclusions).size!==r.exclusions.length)throw new Error('Повторяющиеся уровни или примеры правила');const facts=[...r.conditions,...r.supporting].map(f=>JSON.stringify([f.key,f.value]));if(new Set(facts).size!==facts.length)throw new Error('Повторяющиеся условия правила');}
}
