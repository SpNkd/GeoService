import { expect,it } from 'vitest';
import { loadEnv } from 'vite';
import { writeFileSync } from 'node:fs';
import { OpenRouterIntentProvider } from '../../server/ai';
import { modelConfig,routingConfig } from '../../server/aiConfig';
import { aiTaskSchema } from '../ai/intent';
import type { AiDiagnostic } from '../ai/reliability';
import { semanticFixture } from './fixtures/semanticLearning';
import { proposeRule,rememberedKnowledge } from '../semantics/learning';
import { BUILTIN_CONCEPTS } from '../semantics/concepts';
import { resolveDocumentPlan } from '../documentOperations/plan';
const enabled=process.env.AI_SEMANTIC_REAL_SMOKE==='1',env=enabled?loadEnv('development',process.cwd(),''):{},models=modelConfig(env),reports:unknown[]=[];
const provider=new OpenRouterIntentProvider(env.OPENROUTER_API_KEY??'',models.primaryModel,undefined,models.fallbackModels,30000,routingConfig(env));
for(const custom of [false,true])it.skipIf(!enabled)(`real semantic ${custom?'user category':'pipe'} text only`,async()=>{
  const text=custom?'выдели все трубы продувки':'выдели все трубы',d=semanticFixture(),concept=custom?{id:'blow-pipe',name:'Трубы продувки',aliases:[],parentConceptId:'pipe'}:BUILTIN_CONCEPTS.find(c=>c.id==='pipe')!,rule=proposeRule(d,['pipe-1','pipe-2'],concept.id,'real-demo').rule,learned={...d,semantics:rememberedKnowledge(d,concept,rule,new Set(['pipe-4']),new Set(['EXACT','STRONG']))};
  let diagnostic:AiDiagnostic|undefined,result:unknown,passed=false;
  try{result=await provider.parseIntent({text,signal:new AbortController().signal,onDiagnostic:value=>{diagnostic=value;}});const task=aiTaskSchema.parse(result);expect(task.actions).toHaveLength(1);expect(task.actions[0]).toMatchObject({type:'select_entities',query:custom?{kind:'learned_concept',name:'трубы продувки'}:{kind:'semantic_concept',concepts:['pipe']}});const plan=resolveDocumentPlan(task.actions as Parameters<typeof resolveDocumentPlan>[0],learned,[],'real-semantic',text);expect(plan.matchedEntityIds.sort()).toEqual(['pipe-1','pipe-2','pipe-3']);passed=true;}
  finally{reports.push({text,result,passed,model:diagnostic?.actualModel,provider:diagnostic?.actualProvider,latencyMs:diagnostic?.latencyMs,errorCode:diagnostic?.errorCode,requestData:'text only; no document/rules/features/IDs'});writeFileSync('/private/tmp/geoservice-semantic-real-smoke.json',JSON.stringify({primary:models.primaryModel,reports},null,2)+'\n');}
},40000);
