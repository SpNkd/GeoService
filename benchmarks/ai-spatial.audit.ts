/** Opt-in paid endpoint smoke; excluded from mandatory CI. AI_SPATIAL_SMOKE=1 npm run bench:ai-spatial */
import { expect, test } from 'vitest';
import { loadEnv } from 'vite';
import { writeFileSync } from 'node:fs';
import { HttpAiIntentProvider, validateReliableResult } from '../src/ai/provider';
import { createDiagnostic, newTraceId, safeDiagnostic } from '../src/ai/reliability';
import { createNewDocument } from '../src/domain/newDocument';
import { resolveAiTaskPlan } from '../src/ai/task';
import { modelConfig } from '../server/aiConfig';

const cases = [
  { label:'A', text:'Создай участок двадцать на тридцать метров, на севере участка поставь дом 5 на 6. На доме проставь размеры', anchor:'north', site:[20,30], house:[5,6], actions:3 },
  { label:'B', text:'Участок 20x30, дом 5x6 сверху участка, размеры дома', anchor:'north', site:[20,30], house:[5,6], actions:3 },
  { label:'C', text:'Нарисуй участок 30×20, на западе размести дом 6×4', anchor:'west', site:[30,20], house:[6,4], actions:2 },
  { label:'D', text:'Участок 20×30, дом 5×6 в северо-восточной части', anchor:'north_east', site:[20,30], house:[5,6], actions:2 },
  { label:'E', text:'Создай точку P1', anchor:null, site:[], house:[], actions:0 },
  { label:'F', text:'Создай участок', anchor:null, site:[], house:[], actions:0 },
] as const;
test.skipIf(process.env.AI_SPATIAL_SMOKE !== '1')('configured REAL OpenRouter routing, five repetitions of A–F', async () => {
  const env=loadEnv('development',process.cwd(),''); expect(Boolean(env.OPENROUTER_API_KEY)).toBe(true);
  const config=await fetch('http://127.0.0.1:5173/api/ai/config').then(r=>r.json()); expect(config.mode).toBe('openrouter');
  const provider = new HttpAiIntentProvider((input,init)=>fetch(new URL(String(input),'http://127.0.0.1:5173'),init));
  const selectedCases = process.env.AI_SPATIAL_CASES ? cases.filter(c=>process.env.AI_SPATIAL_CASES!.split(',').includes(c.label)) : cases;
  expect(selectedCases.length).toBeGreaterThan(0);
  const reportPath = process.env.AI_SPATIAL_REPORT ?? 'docs/audit-results/ai-spatial-placement.json';
  const rows: Record<string,unknown>[] = [];
  const run=async (fixture: typeof cases[number], iteration:number) => {
    const traceId=newTraceId(), started=performance.now(); let diagnostic=createDiagnostic(traceId,fixture.text), state='error', relation:string|null=null, success=false, errorCode:string|null=null, resolved:unknown=null;
    try {
      const result=validateReliableResult(await provider.parseIntent({text:fixture.text,traceId,signal:new AbortController().signal,onDiagnostic:d=>{diagnostic=d;}}),fixture.text);
      state='actions' in result ? 'supported' : result.status;
      if('actions' in result) {
        const plan=resolveAiTaskPlan(result,createNewDocument(),new Map(),{id:traceId,text:fixture.text}); diagnostic.resolverStatus=plan.resolution.status;
        const [site,house,dimensions]=result.actions;
        relation=house?.type==='create_rectangle' && house.placement.type==='anchored_in_action_result' ? house.placement.anchor : null;
        success=state==='supported' && result.actions.length===fixture.actions && relation===fixture.anchor && plan.resolution.status==='ready'
          && site?.type==='create_rectangle' && site.width===fixture.site[0] && site.height===fixture.site[1] && site.placement.type==='local_origin'
          && house?.type==='create_rectangle' && house.width===fixture.house[0] && house.height===fixture.house[1] && house.placement.type==='anchored_in_action_result' && house.placement.polygonActionIndex===0
          && (fixture.actions!==3 || dimensions?.type==='create_dimensions_for_boundary_edges' && dimensions.boundaryActionIndex===1 && plan.generatedCommandCount===6);
        resolved={status:plan.resolution.status,commandCount:plan.generatedCommandCount,assumptions:plan.assumptions,geometry:plan.actions.map(a=>a.resolution.status==='ready' && 'geometry' in a.resolution?a.resolution.geometry:null)};
      } else success=fixture.actions===0 && state==='needs_clarification';
    } catch(error) {errorCode=error && typeof error==='object' && 'code' in error ? String(error.code) : 'UNCLASSIFIED';}
    const row={label:fixture.label,text:fixture.text,iteration,success,state,actionCount:diagnostic.actionCount??0,relation,latencyMs:Math.round(performance.now()-started),model:diagnostic.actualModel??null,provider:diagnostic.actualProvider??null,schemaStatus:diagnostic.schemaStatus,errorCode,resolved,diagnostics:safeDiagnostic(diagnostic,[env.OPENROUTER_API_KEY!])};
    rows.push(row); writeFileSync(reportPath,JSON.stringify({timestamp:new Date().toISOString(),...modelConfig(env),rows},null,2));
    console.info(JSON.stringify({label:row.label,iteration,success,state,relation,latencyMs:row.latencyMs,model:row.model,provider:row.provider,schemaStatus:row.schemaStatus,errorCode}));
  };
  for(let iteration=1;iteration<=5;iteration++) for(let i=0;i<selectedCases.length;i+=2) await Promise.all(selectedCases.slice(i,i+2).map(f=>run(f,iteration)));
  expect(rows).toHaveLength(selectedCases.length * 5); expect(rows.every(r=>r.success), 'See recorded outcomes for individual failures').toBe(true);
},600000);
