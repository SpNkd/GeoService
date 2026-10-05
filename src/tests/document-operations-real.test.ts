import { expect, it } from 'vitest';
import { loadEnv } from 'vite';
import { writeFileSync } from 'node:fs';
import { OpenRouterIntentProvider } from '../../server/ai';
import { modelConfig, routingConfig } from '../../server/aiConfig';
import { aiTaskSchema } from '../ai/intent';
import type { AiDiagnostic } from '../ai/reliability';
const enabled=process.env.AI_DOCUMENT_REAL_SMOKE==='1',env=enabled?loadEnv('development',process.cwd(),''):{},models=modelConfig(env);
const provider=new OpenRouterIntentProvider(env.OPENROUTER_API_KEY??'',models.primaryModel,undefined,models.fallbackModels,30000,routingConfig(env));
const reports:unknown[]=[];
const cases=[
  ['A','Выбери все здания.','select_entities',{query:{kind:'semantic_concept',concepts:['buildings']}}],
  ['B','Создай слой Здания и перенеси туда все здания.','move_entities_to_layer',{query:{kind:'semantic_concept',concepts:['buildings']},target:{kind:'created_layer',actionIndex:0}}],
  ['C','Скрой дороги и откосы.','set_layer_visibility',{query:{kind:'semantic_concept',concepts:expect.arrayContaining(['roads','slopes'])},visible:false}],
  ['D','Выбери все блоки VOLUME.','select_entities',{query:{kind:'block_name',name:'VOLUME'}}],
  ['E','Найди все надписи со словом грунт.','find_entities',{query:{kind:'text_contains',text:'грунт',sourceType:null}}],
  ['F','Выбери все мультивыноски.','select_entities',{query:{kind:'source_type',sourceType:'MULTILEADER'}}],
  ['G','Покажи только здания.','isolate_result',{query:{kind:'semantic_concept',concepts:['buildings']}}],
  ['H','Перенеси выбранные объекты в слой Архив.','move_entities_to_layer',{query:{kind:'current_selection'},target:{kind:'existing_layer',name:'Архив'}}],
] as const;
for(const [id,text,type,shape]of cases)for(let run=1;run<=5;run++)it.skipIf(!enabled)(`real document ${id}.${run}`,async()=>{
  let diagnostic:AiDiagnostic|undefined,result:unknown,passed=false;
  try {result=await provider.parseIntent({text,signal:new AbortController().signal,onDiagnostic:d=>{diagnostic=d;}});const task=aiTaskSchema.parse(result);expect(task.actions).toHaveLength(id==='B'?2:1);if(id==='B')expect(task.actions[0]).toEqual({type:'create_layer',name:'Здания'});expect(task.actions.at(-1)).toMatchObject({type,...shape});passed=true;}
  finally {reports.push({id,run,text,result,passed,model:diagnostic?.actualModel,provider:diagnostic?.actualProvider,schema:diagnostic?.schemaStatus,localValidation:diagnostic?.localValidationStatus,latencyMs:diagnostic?.latencyMs,errorCode:diagnostic?.errorCode});writeFileSync('/private/tmp/geoservice-document-real-smoke.json',JSON.stringify({primary:models.primaryModel,fallback:models.fallbackModels,reports},null,2)+'\n');}
},40000);
