import {test,expect,type Page} from '@playwright/test';
import {editorCommand,openRightTab} from './helpers/editorCommands';
import {readAutosaveDocument,autosaveSnapshot} from './helpers/autosave';
import {ORIGINAL_SPATIAL_REQUEST,spatialConstraintsTask} from '../src/tests/fixtures/spatialConstraints';
import type {AiTaskIntent} from '../src/ai/intent';
async function setup(page:Page,task:unknown){let calls=0;await page.route('**/api/ai/config',r=>r.fulfill({json:{mode:'mock'}}));await page.route('**/api/ai/intent',r=>{calls++;expect(Object.keys(r.request().postDataJSON())).toEqual(['text']);return r.fulfill({json:{intent:task,unsupported:false}});});await page.goto('/');await editorCommand(page,'Новый документ');await openRightTab(page,'ai');return ()=>calls;}
async function generate(page:Page,text=ORIGINAL_SPATIAL_REQUEST){await page.getByRole('textbox',{name:'Запрос',exact:true}).fill(text);await page.getByRole('button',{name:'Generate plan',exact:true}).click();}
test('exact request shows derived relations, eight previews, no mutation before Apply, one Undo',async({page})=>{
 const calls=await setup(page,spatialConstraintsTask),before=await autosaveSnapshot(page);await generate(page);
 await expect(page.getByTestId('ai-local-clarification')).toHaveCount(0);await expect(page.getByTestId('ai-ghost')).toHaveCount(8);
 await expect(page.getByTestId('ai-assumptions')).toContainText('север 3');await expect(page.getByTestId('ai-assumptions')).toContainText('5 м по X и 6 м по Y');await expect(page.getByTestId('ai-plan')).toContainText('Кратчайший из двух обходов');expect(await autosaveSnapshot(page)).toEqual(before);
 await page.getByRole('button',{name:'Apply 8 changes',exact:true}).click();const document=await readAutosaveDocument(page);expect(document.entities).toHaveLength(8);const crane=document.entities.find(e=>e.name==='Кран')!;if(crane.type!=='point')throw Error();expect(document.vertices[crane.vertexId]).toMatchObject({x:17,y:3});
 await page.getByRole('button',{name:'Отменить',exact:true}).click();expect(await autosaveSnapshot(page)).toEqual(before);expect(calls()).toBe(1);
});
test('structured orientation and route clarification resumes original plan locally then cancel preserves autosave',async({page})=>{
 const task=structuredClone(spatialConstraintsTask),house=task.actions[1]!,route=task.actions[3]!;if(house.type!=='create_rectangle'||route.type!=='create_route')throw Error();house.orientation='ASK';route.mode='ASK';
 const calls=await setup(page,task),before=await autosaveSnapshot(page);await generate(page);await expect(page.getByTestId('ai-local-clarification')).toBeVisible();await expect(page.getByRole('button',{name:'Apply 2 changes',exact:true})).toBeDisabled();
 await page.getByLabel('Как ориентировать «Дом»?',{exact:true}).selectOption('SWAPPED');await page.getByLabel('Как провести маршрут?',{exact:true}).selectOption('ORTHOGONAL');await expect(page.getByTestId('ai-local-clarification')).toHaveCount(0);await expect(page.getByTestId('ai-plan')).toContainText(ORIGINAL_SPATIAL_REQUEST);
 await expect(page.getByRole('button',{name:'Apply 8 changes',exact:true})).toBeEnabled();expect(calls()).toBe(1);expect(await autosaveSnapshot(page)).toEqual(before);await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByTestId('ai-ghost')).toHaveCount(0);expect(await autosaveSnapshot(page)).toEqual(before);
});
test('preview assumptions can change orientation and route without a second provider call',async({page})=>{
 const calls=await setup(page,spatialConstraintsTask);await generate(page);await page.getByLabel('Ориентация Дом',{exact:true}).selectOption('SWAPPED');await page.getByLabel('Маршрут Труба',{exact:true}).selectOption('DIRECT');await expect(page.getByTestId('ai-plan')).toContainText('Напрямую');await expect(page.getByTestId('ai-assumptions')).toContainText('6 м по X и 5 м по Y');expect(calls()).toBe(1);
});
test('explicit XY remains accepted; invented XY has a readable message and collapsed technical detail',async({page})=>{
 const raw={actions:[{type:'create_points',points:[{name:'Кран',x:17,y:3}]}]};await setup(page,raw);await generate(page,'Создай точку Кран X=17 Y=3');await expect(page.getByTestId('ai-ghost')).toHaveCount(1);
 await generate(page,ORIGINAL_SPATIAL_REQUEST);await expect(page.getByRole('alert')).toContainText('Координаты «Кран»');await expect(page.getByRole('alert')).not.toContainText('LOCAL_VALIDATION_ERROR');await expect(page.getByTestId('ai-ghost')).toHaveCount(0);expect(await page.locator('.ai-error-state details').getAttribute('open')).toBeNull();
});
test('impossible dimensions wrap with no clipped human explanation and no mutation',async({page})=>{
 const task=structuredClone(spatialConstraintsTask),house=task.actions[1]!;if(house.type!=='create_rectangle')throw Error();house.width=25;house.height=35;await setup(page,task);const before=await autosaveSnapshot(page);await generate(page,ORIGINAL_SPATIAL_REQUEST.replace('5 на 6','25 на 35'));
 await expect(page.getByTestId('ai-plan')).toContainText('не помещается');const error=page.locator('.ai-preview > .ai-error');expect(await error.evaluate(e=>({clip:e.scrollHeight>e.clientHeight,overflow:getComputedStyle(e).overflowY}))).toEqual({clip:false,overflow:'visible'});await expect(page.getByTestId('ai-ghost')).toHaveCount(0);expect(await autosaveSnapshot(page)).toEqual(before);
});
test('provider clarification sends only original text and structured user answer',async({page})=>{
 await page.route('**/api/ai/config',r=>r.fulfill({json:{mode:'mock'}}));const payloads:unknown[]=[];
 await page.route('**/api/ai/intent',r=>{payloads.push(r.request().postDataJSON());return r.fulfill({json:{result:payloads.length===1?{status:'needs_clarification',questions:['Укажите координаты Кран.']}:{actions:[{type:'create_points',points:[{name:'Кран',x:17,y:3}]}]}}});});
 await page.goto('/');await editorCommand(page,'Новый документ');await openRightTab(page,'ai');await generate(page,'Создай точку Кран');await page.getByRole('textbox',{name:'Ответ на уточнение',exact:true}).fill('Кран X=17 Y=3');await page.getByRole('button',{name:'Generate plan',exact:true}).click();await expect(page.getByTestId('ai-ghost')).toHaveCount(1);
 expect(payloads).toEqual([{text:'Создай точку Кран'},{text:'Создай точку Кран',clarificationAnswers:[{questionId:'provider-clarification',answer:'Кран X=17 Y=3'}]}]);
});
// A true document-dependent ambiguity is resolved by the existing local entity chooser.
test('two equally named roads produce a local entity question without sharing geometry',async({page})=>{
 const task:AiTaskIntent={actions:[{type:'create_rectangle',name:'Дом',width:5,height:6,placement:{type:'relative_to_entity',reference:{kind:'named_entity',name:'Дорога'},direction:'north',gapMeters:3}}]};
 const calls=await setup(page,task);
 // Supply the two road objects through a normal document import, not provider context.
 const {createNewDocument}=await import('../src/domain/newDocument');const d=createNewDocument();d.vertices={a:{id:'a',x:0,y:0},b:{id:'b',x:20,y:0},c:{id:'c',x:0,y:20},e:{id:'e',x:20,y:20}};d.entities=[{type:'line',id:'road1',name:'Дорога',layerId:'boundary',startVertexId:'a',endVertexId:'b'},{type:'line',id:'road2',name:'Дорога',layerId:'boundary',startVertexId:'c',endVertexId:'e'}];
 await page.getByLabel('Файл GeoDocument',{exact:true}).setInputFiles({name:'roads.geoservice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(d))});
 await generate(page,'Поставь Дом 5 на 6 метров в 3 метрах севернее Дорога.');await expect(page.getByTestId('ai-local-clarification')).toContainText('Выберите Дорога');await page.getByLabel('Выберите Дорога',{exact:true}).first().selectOption('road2');await expect(page.getByRole('button',{name:'Apply',exact:true})).toBeEnabled();expect(calls()).toBe(1);
});
test('small semantic plans have bounded parse/solve/route/preview cost and no >50ms long task',async({page})=>{
 await setup(page,spatialConstraintsTask);
 await page.evaluate(async()=>{
  // Import before measurement; module loading is outside local solver cost.
  await Promise.all(['/src/ai/task.ts','/src/ai/intent.ts','/src/domain/newDocument.ts'].map(path=>import(/* @vite-ignore */ path)));
  const w=window as unknown as {constraintLongTasks:number[];constraintObserver:PerformanceObserver};w.constraintLongTasks=[];w.constraintObserver=new PerformanceObserver(list=>w.constraintLongTasks.push(...list.getEntries().map(e=>e.duration)));w.constraintObserver.observe({type:'longtask',buffered:false});
 });
 const metrics=await page.evaluate(async({task,text})=>{
  const taskPath='/src/ai/task.ts',intentPath='/src/ai/intent.ts',documentPath='/src/domain/newDocument.ts';const {resolveAiTaskPlan,taskPreviews}=await import(/* @vite-ignore */ taskPath),{validateParserResult}=await import(/* @vite-ignore */ intentPath),{createNewDocument}=await import(/* @vite-ignore */ documentPath);const rows=[];
  for(let i=0;i<20;i++){const start=performance.now(),intent=validateParserResult(task,text),parsed=performance.now();if(!('actions'in intent))throw Error();const plan=resolveAiTaskPlan(intent,createNewDocument(),new Map(),{text}),solved=performance.now();taskPreviews(plan);rows.push({semanticParseMs:parsed-start,...plan.timings,previewMs:performance.now()-solved});}return rows;
 },{task:spatialConstraintsTask,text:ORIGINAL_SPATIAL_REQUEST});
 await generate(page);await expect(page.getByTestId('ai-ghost')).toHaveCount(8);await page.waitForTimeout(100);
 const longTasks=await page.evaluate(()=>{const w=window as unknown as {constraintLongTasks:number[];constraintObserver:PerformanceObserver};w.constraintObserver.disconnect();return w.constraintLongTasks;});
 const {writeFileSync}=await import('node:fs');writeFileSync('docs/audit-results/spatial-constraints-performance.json',JSON.stringify({runtime:'Chrome',samples:metrics,longTasks,smallPlanActions:5,generatedCommands:8},null,2)+'\n');
 expect(Math.max(...metrics.map(m=>m.totalMs+m.semanticParseMs+m.previewMs))).toBeLessThan(50);expect(longTasks).toEqual([]);
});
