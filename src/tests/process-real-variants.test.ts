import { expect, it } from 'vitest';
import { loadEnv } from 'vite';
import { writeFileSync } from 'node:fs';
import { OpenRouterIntentProvider } from '../../server/ai';
import { modelConfig, routingConfig } from '../../server/aiConfig';
import { aiTaskSchema } from '../ai/intent';
import { isProcessAction } from '../process/schema';
import { resolveProcessPlan } from '../process/plan';
import { chainAction } from '../process/fixtures';
import { createNewDocument } from '../domain/newDocument';
const enabled=process.env.AI_PROCESS_REAL_SMOKE==='1',env=enabled?loadEnv('development',process.cwd(),''):{},models=modelConfig(env),provider=new OpenRouterIntentProvider(env.OPENROUTER_API_KEY??'',models.primaryModel,undefined,models.fallbackModels,30000,routingConfig(env)),reports:unknown[]=[];
for(const [text,type]of [
  ['Нарисуй технологическую цепочку из входа, запорного крана, фильтра, регулятора давления и счётчика.','create_process_chain'],
  ['После фильтра поставь регулятор давления, затем счётчик и соедини их.','append_process_symbols'],
  ['Между краном и фильтром вставь ещё один фильтр.','insert_symbol_between'],
  ['После счётчика добавь запорный кран.','append_process_symbols'],
] as const)it.skipIf(!enabled)(`real natural variant ${text}`,async()=>{
  const raw=await provider.parseIntent({text,signal:new AbortController().signal});const report={text,result:raw};reports.push(report);writeFileSync('/private/tmp/geoservice-process-real-variants.json',JSON.stringify(reports,null,2)+'\n');const result=aiTaskSchema.parse(raw);expect(result.actions[0]!.type).toBe(type);expect(result.actions.every(isProcessAction)).toBe(true);
  const base=createNewDocument();let fixture=resolveProcessPlan([chainAction(text.includes('Между')?['input','shutoff_valve','filter','pressure_regulator','gas_meter','output']:['input','shutoff_valve','filter','gas_meter'])],base,{id:'private-fixture',text:'local fixture',targetLayerId:'buildings',origin:{x:0,y:0}}).projectedDocument!;
  if(text.startsWith('После фильтра'))fixture={...fixture,entities:fixture.entities.filter(e=>e.type!=='connector'||e.start.symbolEntityId!==fixture.entities.find(s=>s.name==='Ф-1')!.id)};
  const plan=resolveProcessPlan(result.actions.filter(isProcessAction),fixture,{id:'variant',text,targetLayerId:'buildings',origin:{x:0,y:10}});
  Object.assign(report,{resolverStatus:plan.status,message:plan.message});writeFileSync('/private/tmp/geoservice-process-real-variants.json',JSON.stringify(reports,null,2)+'\n');expect(plan.status).toBe('ready');
},40000);
