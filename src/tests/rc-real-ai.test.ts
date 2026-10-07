import { expect, it } from 'vitest';
import { loadEnv } from 'vite';
import { writeFileSync } from 'node:fs';
import { OpenRouterIntentProvider } from '../ai/openrouter';
import { modelConfig, routingConfig } from '../ai/config';
import { aiTaskSchema } from '../ai/intent';
import { resolveAiTaskPlan } from '../ai/task';
import { createNewDocument } from '../domain/newDocument';
import { semanticFixture } from './fixtures/semanticLearning';
import { proposeRule, rememberedKnowledge } from '../semantics/learning';
import { BUILTIN_CONCEPTS } from '../semantics/concepts';
import { resolveDocumentPlan } from '../documentOperations/plan';
import type { AiDiagnostic } from '../ai/reliability';
import { spatialParaphrases } from './fixtures/spatialParaphrases';
import { resolveProcessPlan } from '../process/plan';
import { isProcessAction } from '../process/schema';

const enabled=process.env.RC_REAL_AI==='1', env=enabled?loadEnv('development',process.cwd(),''):{}, models=modelConfig(env);
const provider=new OpenRouterIntentProvider(env.OPENROUTER_API_KEY??'',models.primaryModel,undefined,models.fallbackModels,45000,routingConfig(env));
const reports:unknown[]=[];
const extra=[
 {id:'clarification',kind:'clarification',text:'Создай Участок 20 на 30 метров, Дом 5 на 6 метров на севере участка. Ориентацию Дома уточни у меня, не выбирай её автоматически.'},
 {id:'semantic',kind:'semantic',text:'Выдели все трубы.'},
 {id:'process',kind:'process',text:'Собери линию: вход, кран, фильтр, регулятор давления, счётчик, выход.'},
];
for(const {id,kind,text} of [...spatialParaphrases,...extra])it.skipIf(!enabled)(`release REAL semantic equivalence: ${id}`,async()=>{
 let diagnostic:AiDiagnostic|undefined,classification='FAIL',resolved:string|undefined,semantic:unknown;
 try{
  const result=await provider.parseIntent({text,signal:new AbortController().signal,onDiagnostic:d=>{diagnostic=d;}});
  const task=aiTaskSchema.parse(result);semantic=task;
  if(kind==='semantic'){
   const d=semanticFixture(),concept=BUILTIN_CONCEPTS.find(c=>c.id==='pipe')!,rule=proposeRule(d,['pipe-1','pipe-2'],concept.id,'release').rule;
   const learned={...d,semantics:rememberedKnowledge(d,concept,rule,new Set(['pipe-4']),new Set(['EXACT','STRONG']))};
   const plan=resolveDocumentPlan(task.actions as Parameters<typeof resolveDocumentPlan>[0],learned,[],'release',text);
   expect(plan.matchedEntityIds.sort()).toEqual(['pipe-1','pipe-2','pipe-3']);resolved='RESOLVED';
  }else if(kind==='process'){
   const d=createNewDocument();expect(task.actions.every(isProcessAction)).toBe(true);
   const actions=task.actions.filter(isProcessAction),choices=new Map<string,string>();
   let plan=resolveProcessPlan(actions,d,{id,text,targetLayerId:'buildings',origin:{x:0,y:0},choices});
   while(plan.status==='unresolved'&&choices.size<10){const q=plan.issues[0]!;choices.set(q.key,q.options[0]!.value);plan=resolveProcessPlan(actions,d,{id,text,targetLayerId:'buildings',origin:{x:0,y:0},choices});}
   expect(plan.status).toBe('ready');expect(plan.symbols).toHaveLength(6);expect(plan.connectors).toHaveLength(5);resolved='RESOLVED';
  }else{
   const plan=resolveAiTaskPlan(task,createNewDocument(),new Map(),{id,text});resolved=plan.resolutionStatus;
   if(kind==='clarification'){
    expect(resolved).toBe('NEEDS_CLARIFICATION');
    const resumed=resolveAiTaskPlan(task,plan.basedOnDocument,plan.choices,{id,text,answers:new Map(plan.clarifications.map(q=>[q.questionId,'MODEL']))});
    expect(resumed.resolutionStatus).toBe('RESOLVED');
   }else{
    expect(resolved).toBe('RESOLVED');
    if(kind==='golden'){
     const point=plan.actions.find(a=>a.kind==='spatial-point')!;
     expect(point.resolution).toMatchObject({geometry:[{x:17,y:3}]});
     expect(plan.proofs.find(p=>p.actionIndex===plan.actions.indexOf(point))?.provenance).toBe('RESOLVER_DERIVED');
     expect(plan.actions.some(a=>a.kind==='bulk-dimensions')).toBe(true);
     expect(plan.actions.some(a=>a.kind==='route')).toBe(true);
     expect(plan.actions.find(a=>a.kind==='rectangle'&&a.resolution.status==='ready'&&a.resolution.width===5)?.resolution).toMatchObject({geometry:[{x:3,y:21},{x:8,y:21},{x:8,y:27},{x:3,y:27}]});
    }else if(kind==='center'||kind==='relative'){
     expect(plan.actions.find(a=>a.kind==='rectangle'&&a.resolution.status==='ready'&&a.resolution.width===5)?.resolution).toMatchObject({geometry:[{x:7.5,y:12},{x:12.5,y:12},{x:12.5,y:18},{x:7.5,y:18}]});
     if(kind==='relative')expect(plan.actions.find(a=>a.kind==='spatial-point')?.resolution).toMatchObject({geometry:[{x:17.5,y:15}]});
    }else expect(plan.generatedCommandCount).toBeGreaterThan(5);
   }
  }
  classification='PASS';
 }finally{
  reports.push({id,text,classification,requestedModel:models.primaryModel,actualModel:diagnostic?.actualModel,actualProvider:diagnostic?.actualProvider,latencyMs:diagnostic?.latencyMs,httpAttempts:diagnostic?.attempts.length,errorCode:diagnostic?.errorCode,localResolution:resolved,semantic});
  writeFileSync(process.env.RC_REAL_REPORT??'/private/tmp/geoservice-rc-real-ai.json',JSON.stringify({reports},null,2)+'\n');
 }
},60000);
