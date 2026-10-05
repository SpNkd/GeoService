import { expect, it } from 'vitest';
import { loadEnv } from 'vite';
import { writeFileSync } from 'node:fs';
import { OpenRouterIntentProvider } from '../../server/ai';
import { modelConfig, routingConfig } from '../../server/aiConfig';
import { aiTaskSchema } from '../ai/intent';
import { resolveAiTaskPlan } from '../ai/task';
import { spatialDocument } from './fixtures/spatialDocument';
import type { AiDiagnostic } from '../ai/reliability';
const enabled=process.env.AI_SPATIAL_REAL_SMOKE==='1';
const env=enabled?loadEnv('development',process.cwd(),''):{};
const models=modelConfig(env);
const provider=new OpenRouterIntentProvider(env.OPENROUTER_API_KEY??'',models.primaryModel,undefined,models.fallbackModels,30000,routingConfig(env));
const reports:unknown[]=[];
const cases=[
  ['A','Поставь сарай 3×5 метра в двух метрах восточнее дома.','create_rectangle'],
  ['B','На севере существующего участка поставь дом 6×5.','create_rectangle'],
  ['C','Проведи газовую трубу вдоль западной границы участка с отступом 1,5 метра.','create_line_along_polygon_edge'],
  ['D','Размести четыре грядки 1×4 метра южнее дома с промежутком 0,8 метра.','create_rectangle_array'],
  ['E','Поставь прямоугольник 4×3 справа от выбранного объекта.','create_rectangle'],
  ['F','Спроектируй нормативную газовую сеть с автоматическим обходом препятствий, портами и проверкой всех норм.','unsupported'],
] as const;
for(const [id,text,type]of cases)it.skipIf(!enabled)(`real spatial ${id}`,async()=>{
  let diagnostic:AiDiagnostic|undefined,result:unknown;
  try{
    result=await provider.parseIntent({text,signal:new AbortController().signal,onDiagnostic:d=>{diagnostic=d;}});
    if(type==='unsupported')expect(result).toEqual({status:'unsupported'});
    else {
      const task=aiTaskSchema.parse(result);expect(task.actions).toHaveLength(1);expect(task.actions[0]!.type).toBe(type);
      const action=task.actions[0]!;
      if(id==='A')expect(action).toMatchObject({width:3,height:5,placement:{type:'relative_to_entity',direction:'east',gapMeters:2,reference:{kind:'named_entity',name:expect.stringMatching(/^дом$/i)}}});
      if(id==='B')expect(action).toMatchObject({width:6,height:5,placement:{type:'inside_entity',anchor:'north',reference:{kind:'named_entity',name:expect.stringMatching(/^участок$/i)}}});
      if(id==='C')expect(action).toMatchObject({side:'west',offsetMeters:1.5,offsetSide:'outside'});
      if(id==='D')expect(action).toMatchObject({count:4,width:1,height:4,direction:'south',itemGap:.8});
      if(id==='E')expect(action).toMatchObject({width:4,height:3,placement:{type:'relative_to_entity',direction:'east',reference:{kind:'current_selection'}}});
      expect(resolveAiTaskPlan(task,spatialDocument(),new Map(),{selectionEntityIds:['house'],targetLayerId:'annotations'}).resolution.status).toBe('ready');
    }
  } finally {
    reports.push({id,text,result,model:diagnostic?.actualModel,provider:diagnostic?.actualProvider,schema:diagnostic?.schemaStatus,localValidation:diagnostic?.localValidationStatus,latencyMs:diagnostic?.latencyMs,...(id==='D'?{rawResponse:diagnostic?.rawResponse}:{}),errorCode:diagnostic?.errorCode});
    writeFileSync('/private/tmp/geoservice-spatial-real-smoke.json',JSON.stringify(reports,null,2));
  }
},40000);
