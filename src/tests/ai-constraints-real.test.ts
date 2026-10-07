import { it,expect } from 'vitest';
import { loadEnv } from 'vite';
import { writeFileSync } from 'node:fs';
import { OpenRouterIntentProvider } from '../../server/ai';
import { modelConfig,routingConfig } from '../../server/aiConfig';
import { aiTaskSchema } from '../ai/intent';
import { resolveAiTaskPlan } from '../ai/task';
import { createNewDocument } from '../domain/newDocument';
import type { AiDiagnostic } from '../ai/reliability';
import { ORIGINAL_SPATIAL_REQUEST } from './fixtures/spatialConstraints';
const enabled=process.env.AI_CONSTRAINTS_REAL==='1',env=enabled?loadEnv('development',process.cwd(),''):{},models=modelConfig(env);
const provider=new OpenRouterIntentProvider(env.OPENROUTER_API_KEY??'',models.primaryModel,undefined,models.fallbackModels,30000,routingConfig(env)),reports:unknown[]=[];
for(const [id,text]of [
 ['original',ORIGINAL_SPATIAL_REQUEST],
 ['clarification','Создай участок 20 на 30 метров, на севере дом 5 на 6 метров. Ориентация дома строго требует моего выбора, не выбирай её автоматически.'],
 ['explicit','Создай точку Кран X=17 Y=3'],
 ['route','Создай участок 20 на 30 метров, на северо-западе дом 5 на 6 метров, на юго-востоке кран, все сооружения на 3 метра от границ. Проведи трубу по границе участка от крана до дома.'],
] as const)it.skipIf(!enabled)(`real constraints ${id}`,async()=>{
 let resumed:ReturnType<typeof resolveAiTaskPlan>|undefined;let diagnostic:AiDiagnostic|undefined,result:unknown,plan:ReturnType<typeof resolveAiTaskPlan>|undefined;
 try{
   result=await provider.parseIntent({text,signal:new AbortController().signal,onDiagnostic:d=>{diagnostic=d;}});
   const task=aiTaskSchema.parse(result);plan=resolveAiTaskPlan(task,createNewDocument(),new Map(),{id,text});
   expect(plan.resolutionStatus).toBe(id==='clarification'?'NEEDS_CLARIFICATION':'RESOLVED');
   if(id==='original'||id==='route'){
     expect(task.actions.some(a=>a.type==='create_spatial_point')).toBe(true);expect(task.actions.some(a=>a.type==='create_route')).toBe(true);
     const point=plan.actions.find(a=>a.kind==='spatial-point')!;expect(point.resolution).toMatchObject({geometry:[{x:17,y:3}]});expect(plan.proofs.find(p=>p.actionIndex===plan!.actions.indexOf(point))?.provenance).toBe('RESOLVER_DERIVED');
     if(id==='original')expect(plan.actions.find(a=>a.kind==='bulk-dimensions')?.resolution).toMatchObject({status:'ready',dimensions:expect.any(Array)});
   }
   if(id==='clarification'){resumed=resolveAiTaskPlan(task,plan.basedOnDocument,plan.choices,{id,text,answers:new Map(plan.clarifications.map(q=>[q.questionId,'MODEL']))});expect(resumed.resolutionStatus).toBe('RESOLVED');}
   if(id==='explicit')expect(plan.proofs[0]?.provenance).toBe('USER_EXPLICIT');
 }finally{reports.push({id,text,result,rawProviderIntent:diagnostic?.rawResponse,model:diagnostic?.actualModel,provider:diagnostic?.actualProvider,latencyMs:diagnostic?.latencyMs,schema:diagnostic?.schemaStatus,semanticValidation:diagnostic?.localValidationStatus,error:diagnostic?.errorCode,resolution:plan?.resolutionStatus,resumedResolution:resumed?.resolutionStatus,providerHttpAttempts:diagnostic?.attempts.length,questions:plan?.clarifications,proofs:plan?.proofs,timings:plan?.timings,assumptions:plan?.assumptions});writeFileSync('/private/tmp/geoservice-constraints-real.json',JSON.stringify(reports,null,2));}
},40000);
