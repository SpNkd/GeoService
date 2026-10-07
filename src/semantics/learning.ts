import type { GeoDocument } from '../domain/model';
import { BUILTIN_CONCEPTS, conceptsFor, descendants } from './concepts';
import { describeCondition, featureIndex, type FeatureIndex } from './features';
import { emptyKnowledge, featureIdentity, type FeatureCondition, type FeatureKey, type MatchTier, type SemanticConcept, type SemanticKnowledge, type SemanticRule } from './model';
export interface LearnedMatch { entityId:string; conceptId:string; tier:MatchTier; origin:'explicit'|'rule'; ruleId?:string; reasons:string[] }
export interface ProposedRule { rule:SemanticRule; shared:{fact:FeatureCondition; examples:number; documentCount:number; useful:boolean}[]; warning:string|null }
const priorities:Partial<Record<FeatureKey,number>>={blockDefinition:100,symbolId:95,sourceLayer:90,layer:80,imageCandidate:65,attributeKeys:60,lineType:50,definitionSignature:45,color:40,width:35,connectedKind:30,importKind:25,libraryId:20,fill:15,closed:12,vertices:10,length:8,area:8,size:8,aspect:8,textToken:6};
const anchors=new Set<FeatureKey>(['blockDefinition','symbolId','sourceLayer','layer','imageCandidate','attributeKeys','lineType','color','width']);
export function proposeRule(document:GeoDocument,examples:readonly string[],conceptId:string,ruleId:string):ProposedRule {
  const index=featureIndex(document),ids=[...new Set(examples)],summaries=ids.map(id=>index.summaries.get(id));if(!ids.length||summaries.some(s=>!s))throw new Error('Выберите существующие объекты MODEL.');
  const first=summaries[0]!,shared=first.facts.filter(f=>summaries.every(s=>s!.values.has(featureIdentity(f)))).map(fact=>{const count=index.byFact.get(featureIdentity(fact))!.size;return {fact,examples:ids.length,documentCount:count,useful:false};});
  for(const entry of shared)entry.useful=entry.documentCount/index.summaries.size<.8&&!(['layer','sourceLayer'].includes(entry.fact.key)&&['0','default'].includes(entry.fact.value));
  const ranked=shared.filter(s=>s.useful&&priorities[s.fact.key]!==undefined).sort((a,b)=>(priorities[b.fact.key]!-priorities[a.fact.key]!)||a.documentCount-b.documentCount||featureIdentity(a.fact).localeCompare(featureIdentity(b.fact)));
  const kind=shared.find(s=>s.fact.key==='kind')?.fact,anchor=ranked.find(s=>anchors.has(s.fact.key))?.fact;
  const conditions=[...(kind?[kind]:[]),...(anchor?[anchor]:[])];if(!conditions.length)throw new Error('У примеров нет общего признака. Выберите более однородную группу.');
  const used=new Set(conditions.map(featureIdentity));const supporting=ranked.filter(s=>!used.has(featureIdentity(s.fact))&&s.fact.key!=='blockName'&&s.fact.key!=='libraryId').slice(0,3).map(s=>s.fact);
  return {rule:{id:ruleId,conceptId,scope:'document',version:1,conditions,supporting,enabled:true,enabledTiers:['EXACT','STRONG'],positiveExamples:ids,exclusions:[]},shared,warning:anchor?null:'Нет отличительного общего признака. Сходство только по типу — слабая подсказка; выбранные примеры можно запомнить явно.'};
}
export function ruleMatches(document:GeoDocument,rule:SemanticRule,index:FeatureIndex=featureIndex(document)):LearnedMatch[] {
  if(!rule.enabled)return [];
  const candidates=new Set<string>();for(const fact of [...rule.conditions,...rule.supporting])for(const id of index.byFact.get(featureIdentity(fact))??[])candidates.add(id);
  const excluded=new Set(rule.exclusions),specific=rule.conditions.some(f=>f.key!=='kind'&&f.key!=='textToken'&&f.key!=='importKind');const matches:LearnedMatch[]=[];
  for(const id of candidates){if(excluded.has(id))continue;const values=index.summaries.get(id)!.values,core=rule.conditions.filter(f=>values.has(featureIdentity(f))),support=rule.supporting.filter(f=>values.has(featureIdentity(f)));if(!core.length)continue;
    const tier:MatchTier=core.length===rule.conditions.length&&specific?(support.length===rule.supporting.length?'EXACT':'STRONG'):'WEAK';
    matches.push({entityId:id,conceptId:rule.conceptId,tier,origin:'rule',ruleId:rule.id,reasons:[...core.map(f=>describeCondition(f,document)),...support.map(f=>`Поддержка · ${describeCondition(f,document)}`),...rule.supporting.filter(f=>!values.has(featureIdentity(f))).map(f=>`Не совпала поддержка · ${describeCondition(f,document)}`),...rule.conditions.filter(f=>!values.has(featureIdentity(f))).map(f=>`Не совпало · ${describeCondition(f,document)}`),`На основе ${rule.positiveExamples.length} примеров`,...(!specific?['Общий тип сам по себе не определяет категорию']:[])]});
  }return matches;
}
const resultCache=new WeakMap<GeoDocument,Map<string,LearnedMatch[]>>();
const negativeCache=new WeakMap<GeoDocument,Map<string,Set<string>>>();
export function rejectedFor(document:GeoDocument,id:string,conceptId:string):boolean {
  let index=negativeCache.get(document);if(!index){index=new Map();for(const a of document.semantics?.annotations??[])if(a.polarity==='negative'){const ids=index.get(a.conceptId)??new Set<string>();ids.add(a.entityId);index.set(a.conceptId,ids);}negativeCache.set(document,index);}return index.get(conceptId)?.has(id)??false;
}
export function learnedMatches(document:GeoDocument,conceptId:string,includeWeak=false):LearnedMatch[] {
  let cache=resultCache.get(document);if(!cache){cache=new Map();resultCache.set(document,cache);}const cacheKey=JSON.stringify([conceptId,includeWeak]),cached=cache.get(cacheKey);if(cached)return cached;
  const targets=descendants(document,conceptId),matches:LearnedMatch[]=[],knowledge=document.semantics;
  if(knowledge){for(const annotation of knowledge.annotations)if(targets.has(annotation.conceptId)&&annotation.polarity==='positive'&&!rejectedFor(document,annotation.entityId,conceptId))matches.push({entityId:annotation.entityId,conceptId:annotation.conceptId,tier:'EXACT',origin:'explicit',reasons:[annotation.source==='user-explicit'?'Пользователь явно назначил категорию':'Пользователь подтвердил слабую подсказку']});
    for(const rule of knowledge.rules)if(targets.has(rule.conceptId))for(const match of ruleMatches(document,rule))if((rule.enabledTiers.includes(match.tier)||includeWeak&&match.tier==='WEAK')&&!rejectedFor(document,match.entityId,match.conceptId)&&!rejectedFor(document,match.entityId,conceptId))matches.push(match);
  }
  cache.set(cacheKey,matches);return matches;
}
/** Preview choices are compiled into a single canonical knowledge command by the caller. */
export function rememberedKnowledge(document:GeoDocument,concept:SemanticConcept,rule:SemanticRule,excluded:ReadonlySet<string>,tiers:ReadonlySet<MatchTier>):SemanticKnowledge {
  const knowledge=document.semantics??emptyKnowledge(),examples=new Set(rule.positiveExamples),matches=ruleMatches(document,{...rule,exclusions:[]}),pairs=new Map(knowledge.annotations.map(a=>[JSON.stringify([a.entityId,a.conceptId]),a]));
  const reviewed=new Set([...matches.map(m=>m.entityId),...rule.exclusions]);
  for(const a of knowledge.annotations)if(a.conceptId===concept.id&&a.polarity==='negative'&&reviewed.has(a.entityId)&&!excluded.has(a.entityId))pairs.delete(JSON.stringify([a.entityId,a.conceptId]));
  for(const id of examples)if(!excluded.has(id))pairs.set(JSON.stringify([id,concept.id]),{entityId:id,conceptId:concept.id,polarity:'positive',source:'user-explicit'});
  for(const id of excluded)pairs.set(JSON.stringify([id,concept.id]),{entityId:id,conceptId:concept.id,polarity:'negative',source:'user-explicit'});
  for(const m of matches)if(m.tier==='WEAK'&&tiers.has('WEAK')&&!excluded.has(m.entityId)&&!examples.has(m.entityId))pairs.set(JSON.stringify([m.entityId,concept.id]),{entityId:m.entityId,conceptId:concept.id,polarity:'positive',source:'rule-confirmed'});
  return {version:1,concepts:[...knowledge.concepts.filter(c=>c.id!==concept.id),concept],annotations:[...pairs.values()],rules:[...knowledge.rules.filter(r=>r.id!==rule.id),{...rule,positiveExamples:rule.positiveExamples.filter(id=>!excluded.has(id)),enabledTiers:[...tiers],exclusions:[...excluded]}]};
}
export function withoutEntities(knowledge:SemanticKnowledge,removed:ReadonlySet<string>):SemanticKnowledge {return {...knowledge,annotations:knowledge.annotations.filter(a=>!removed.has(a.entityId)),rules:knowledge.rules.map(r=>({...r,positiveExamples:r.positiveExamples.filter(id=>!removed.has(id)),exclusions:r.exclusions.filter(id=>!removed.has(id))}))};}
export function removeConcept(document:GeoDocument,id:string):SemanticKnowledge {const knowledge=document.semantics??emptyKnowledge();if(!BUILTIN_CONCEPTS.some(c=>c.id===id)&&conceptsFor(document).some(c=>c.parentConceptId===id))throw new Error('Сначала измените родителя дочерних категорий.');return {...knowledge,concepts:knowledge.concepts.filter(c=>c.id!==id),annotations:knowledge.annotations.filter(a=>a.conceptId!==id),rules:knowledge.rules.filter(r=>r.conceptId!==id)};}
