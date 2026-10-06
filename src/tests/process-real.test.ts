import { expect, it } from 'vitest';
import { loadEnv } from 'vite';
import { writeFileSync } from 'node:fs';
import { OpenRouterIntentProvider } from '../../server/ai';
import { modelConfig, routingConfig } from '../../server/aiConfig';
import { aiTaskSchema } from '../ai/intent';
import type { AiDiagnostic } from '../ai/reliability';
import { PROCESS_REQUESTS, INITIAL_PROCESS_KINDS } from '../process/fixtures';
const enabled=process.env.AI_PROCESS_REAL_SMOKE==='1',env=enabled?loadEnv('development',process.cwd(),''):{},models=modelConfig(env);
const provider=new OpenRouterIntentProvider(env.OPENROUTER_API_KEY??'',models.primaryModel,undefined,models.fallbackModels,30000,routingConfig(env));
const reports:unknown[]=[];
for(const id of ['A','B','C','D','E'] as const)for(let run=1;run<=5;run++)it.skipIf(!enabled)(`real process ${id}.${run}`,async()=>{
  let diagnostic:AiDiagnostic|undefined,result:unknown,passed=false;
  try{
    result=await provider.parseIntent({text:PROCESS_REQUESTS[id],signal:new AbortController().signal,onDiagnostic:d=>{diagnostic=d;}});
    if(id==='E')expect(result).toEqual({status:'unsupported'});
    else {const task=aiTaskSchema.parse(result);expect(task.actions).toHaveLength(1);const a=task.actions[0]!;expect(a.type).toBe(id==='A'||id==='B'?'create_process_chain':id==='C'?'append_process_symbols':'insert_symbol_between');
      if(a.type==='create_process_chain')expect(a.items.map(i=>i.symbolKind)).toEqual(id==='A'?INITIAL_PROCESS_KINDS:['input','filter','pressure_regulator','output']);
      if(a.type==='append_process_symbols'){expect(a.reference).toEqual({kind:'current_selection'});expect(a.items.map(i=>i.symbolKind)).toEqual(['pressure_regulator','gas_meter']);}
      if(a.type==='insert_symbol_between'){expect(a.from).toEqual({kind:'named_entity',name:'К-1'});expect(a.to).toEqual({kind:'named_entity',name:'РД-1'});expect(a.item.symbolKind).toBe('filter');}
    }passed=true;
  }finally{reports.push({id,run,text:PROCESS_REQUESTS[id],result,passed,model:diagnostic?.actualModel,provider:diagnostic?.actualProvider,schema:diagnostic?.schemaStatus,localValidation:diagnostic?.localValidationStatus,latencyMs:diagnostic?.latencyMs,errorCode:diagnostic?.errorCode});writeFileSync('/private/tmp/geoservice-process-real-smoke.json',JSON.stringify({primary:models.primaryModel,fallback:models.fallbackModels,reports},null,2)+'\n');}
},40000);
