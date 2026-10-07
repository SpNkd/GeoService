import { describe,it,expect } from 'vitest';
import { aiTaskSchema, validateParserResult, type AiTaskIntent } from '../ai/intent';
import { resolveAiTaskPlan,taskCommands } from '../ai/task';
import { createNewDocument } from '../domain/newDocument';
import { initialEditorState } from '../store/editor';
import { applicationReducer,type ApplicationState } from '../ai/workflow';
import { ORIGINAL_SPATIAL_REQUEST,spatialConstraintsTask } from './fixtures/spatialConstraints';
import { boundaryRoute,shortestInside,segmentInside } from '../ai/constraintGeometry';
const doc=createNewDocument();
const plan=(task:AiTaskIntent=spatialConstraintsTask)=>resolveAiTaskPlan(task,doc,new Map(),{id:'constraints',text:ORIGINAL_SPATIAL_REQUEST});
const preview=(task:AiTaskIntent=spatialConstraintsTask)=>{let state:ApplicationState={editor:initialEditorState(doc),ai:{status:'idle'}};state=applicationReducer(state,{type:'ai-event',event:{type:'start',id:'constraints',text:ORIGINAL_SPATIAL_REQUEST}});return applicationReducer(state,{type:'ai-event',event:{type:'result',id:'constraints',result:task}});};
describe('spatial constraint planning',()=>{
 it('permanent exact user regression: local provenance, extents, boundary routing, atomic apply and undo',()=>{
   expect(validateParserResult(spatialConstraintsTask,ORIGINAL_SPATIAL_REQUEST)).toEqual(spatialConstraintsTask);
   const p=plan();expect(p.resolutionStatus).toBe('RESOLVED');expect(p.clarifications).toEqual([]);expect(p.generatedCommandCount).toBe(8);expect(p.proofs[2]).toMatchObject({provenance:'RESOLVER_DERIVED',coordinates:[{x:17,y:3}],dependencies:[0]});
   expect(p.actions[1]!.resolution).toMatchObject({geometry:[{x:3,y:21},{x:8,y:21},{x:8,y:27},{x:3,y:27}]});
   const route=p.actions[3]!.resolution;if(route.status!=='ready'||route.kind!=='polyline')throw Error();expect(route.geometry[0]).toEqual({x:17,y:3});expect(route.geometry.at(-1)).toEqual({x:8,y:21});expect(route.geometry.length).toBeGreaterThan(3);expect(doc.entities).toHaveLength(0);
   const state=preview(),applied=applicationReducer(state,{type:'ai-apply'});expect(applied.editor.past.length-state.editor.past.length).toBe(1);expect(applied.editor.document.entities).toHaveLength(8);
   const undone=applicationReducer(applied,{type:'undo'});expect(undone.editor.document).toEqual(doc);expect(taskCommands(p)).toHaveLength(8);
 });
 it('retains explicit coordinates but rejects invented x17 y3 or invented offsets',()=>{
   const raw={actions:[{type:'create_points',points:[{name:'Кран',x:17,y:3}]}]};expect(validateParserResult(raw,'Создай точку Кран X=17 Y=3')).toEqual(raw);
   expect(()=>validateParserResult(raw,ORIGINAL_SPATIAL_REQUEST)).toThrow(expect.objectContaining({code:'LOCAL_VALIDATION_ERROR'}));
   const t=structuredClone(spatialConstraintsTask),a=t.actions[2]!;if(a.type!=='create_spatial_point'||a.placement.type!=='inside_boundary')throw Error();a.placement.inset.east=17;
   expect(()=>validateParserResult(t,ORIGINAL_SPATIAL_REQUEST)).toThrow(expect.objectContaining({code:'LOCAL_VALIDATION_ERROR'}));
 });
 it('rejects future, cyclic, mismatched and multi-point output references',()=>{
   for(const r of [{kind:'action',actionIndex:3,result:'point'},{kind:'action',actionIndex:1,result:'point'},{kind:'action',actionIndex:2,result:'boundary'}]){const t=structuredClone(spatialConstraintsTask),a=t.actions[3]!;if(a.type!=='create_route')throw Error();Object.assign(a.source,r);expect(aiTaskSchema.safeParse(t).success).toBe(false);}
 });
 it('keeps partial resolution and answers in the same operation; orientation and route resume locally',()=>{
   const t=structuredClone(spatialConstraintsTask),house=t.actions[1]!,route=t.actions[3]!;if(house.type!=='create_rectangle'||route.type!=='create_route')throw Error();house.orientation='ASK';route.mode='ASK';
   let state=preview(t);if(state.ai.status!=='preview')throw Error();expect(state.ai.plan.resolutionStatus).toBe('NEEDS_CLARIFICATION');expect(state.ai.plan.clarifications).toHaveLength(2);const editor=state.editor,id=state.ai.plan.id;
   state=applicationReducer(state,{type:'ai-answer',questionId:'constraints-action-2:orientation',value:'SWAPPED'});state=applicationReducer(state,{type:'ai-answer',questionId:'constraints-action-4:route',value:'ORTHOGONAL'});
   if(state.ai.status!=='preview')throw Error();expect(state.ai.plan.id).toBe(id);expect(state.ai.plan.text).toBe(ORIGINAL_SPATIAL_REQUEST);expect(state.ai.plan.task).toEqual(t);expect(state.editor).toBe(editor);expect(state.ai.plan.resolutionStatus).toBe('RESOLVED');expect(state.ai.plan.actions[1]!.resolution).toMatchObject({width:6,height:5});
   expect(applicationReducer(state,{type:'ai-cancel'}).editor).toBe(editor);
 });
 it('rejects impossible clearances and oversized extents with a readable explanation',()=>{
   const t=structuredClone(spatialConstraintsTask),a=t.actions[1]!;if(a.type!=='create_rectangle')throw Error();a.width=25;a.height=35;
   const p=plan(t);expect(p.resolutionStatus).toBe('INVALID');expect(p.resolution).toMatchObject({status:'invalid',message:expect.stringContaining('не помещается')});expect(p.projectedDocument).toBeNull();
 });
 it.each(['DIRECT','FOLLOW_BOUNDARY','ORTHOGONAL','SHORTEST_INSIDE'] as const)('resolves %s using the same typed point/object ends',mode=>{const t=structuredClone(spatialConstraintsTask),a=t.actions[3]!;if(a.type!=='create_route')throw Error();a.mode=mode;expect(plan(t).resolutionStatus).toBe('RESOLVED');});
 it.each(['center','north','south','east','west','north_east','north_west','south_east','south_west'] as const)('does not ask for coordinates for %s',anchor=>{const t=structuredClone(spatialConstraintsTask),a=t.actions[2]!;if(a.type!=='create_spatial_point'||a.placement.type!=='inside_boundary')throw Error();a.placement.anchor=anchor;expect(plan(t).clarifications).toEqual([]);});
 it('boundary routing chooses shorter direction and shortest-inside goes around a concave notch',()=>{
   const p=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];const route=boundaryRoute({x:9,y:1},{x:1,y:9},p);expect(route).toContainEqual({x:10,y:10});
   const notch=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:6,y:10},{x:6,y:5},{x:4,y:5},{x:4,y:10},{x:0,y:10}],path=shortestInside({x:2,y:8},{x:8,y:8},notch)!;expect(path.length).toBeGreaterThan(2);expect(path.slice(1).every((v,i)=>segmentInside(path[i]!,v,notch))).toBe(true);
 });
});
describe('conflicts and local relation completeness',()=>{
 it.each(([
  [{type:'anchor',value:'south'}],
  [{type:'containment',value:'outside'},{type:'containment',value:'inside'}],
  [{type:'fixed_side_distance',side:'west',distance:3},{type:'fixed_side_distance',side:'west',distance:4}],
  [{type:'fixed_side_distance',side:'west',distance:0}],
 ] as const).map(constraints=>({constraints})))('reports incompatible constraints, not clarification: %j',({constraints})=>{
  const task=structuredClone(spatialConstraintsTask),a=task.actions[1]!;if(a.type!=='create_rectangle')throw Error();a.constraints=JSON.parse(JSON.stringify(constraints));const p=plan(task);expect(p.resolutionStatus).toBe('INVALID');expect(p.clarifications).toEqual([]);expect(p.projectedDocument).toBeNull();expect(p.resolution).toMatchObject({status:'invalid',message:expect.stringMatching(/Противореч|Несовместим|противореч/)});
 });
 it('resolves mid-point of explicit point results and a clear gap east of the house without questions',()=>{
  const task:AiTaskIntent={actions:[{type:'create_points',points:[{name:'P1',x:0,y:0}]},{type:'create_points',points:[{name:'P2',x:10,y:20}]},{type:'create_spatial_point',name:'Середина',placement:{type:'between',from:{kind:'action',actionIndex:0,result:'point'},to:{kind:'action',actionIndex:1,result:'point'}}}]};const p=plan(task);expect(p.actions[2]!.resolution).toMatchObject({geometry:[{x:5,y:10}]});expect(p.clarifications).toEqual([]);
  const t=structuredClone(spatialConstraintsTask),a=t.actions[2]!;if(a.type!=='create_spatial_point')throw Error();a.placement={type:'relative_to',reference:{kind:'action',actionIndex:1,result:'object'},direction:'east',distance:5};expect(plan(t).actions[2]!.resolution).toMatchObject({geometry:[{x:13,y:24}]});
 });
 it('supports local axis parallel/perpendicular orientation and reports conflicting explicit orientation',()=>{
  const t=structuredClone(spatialConstraintsTask),a=t.actions[1]!;if(a.type!=='create_rectangle')throw Error();a.constraints=[{type:'alignment',relation:'perpendicular',reference:{kind:'action',actionIndex:0,result:'boundary'}}];expect(plan(t).actions[1]!.resolution).toMatchObject({width:6,height:5});a.orientation='MODEL';expect(plan(t).resolution).toMatchObject({status:'invalid',message:expect.stringContaining('противоречит')});
 });
 it('named road ambiguity is a local entity-choice and preserves the original intent after answering',()=>{
  const document=createNewDocument();document.vertices={a:{id:'a',x:0,y:0},b:{id:'b',x:20,y:0},c:{id:'c',x:0,y:20},d:{id:'d',x:20,y:20}};document.entities=[{type:'line',id:'road1',name:'Дорога',layerId:'boundary',startVertexId:'a',endVertexId:'b'},{type:'line',id:'road2',name:'Дорога',layerId:'boundary',startVertexId:'c',endVertexId:'d'}];const task:AiTaskIntent={actions:[{type:'create_rectangle',name:'Дом',width:5,height:6,placement:{type:'relative_to_entity',reference:{kind:'named_entity',name:'Дорога'},direction:'north',gapMeters:3}}]};const p=resolveAiTaskPlan(task,document);expect(p.resolutionStatus).toBe('NEEDS_CLARIFICATION');expect(p.clarifications[0]).toMatchObject({kind:'entity_choice',options:expect.arrayContaining([{value:'road1',label:expect.any(String)},{value:'road2',label:expect.any(String)}])});expect(resolveAiTaskPlan(task,document,new Map([['entity:дорога','road2']])).resolutionStatus).toBe('RESOLVED');
 });
});
it('known impossibility wins over orientation/route questions',()=>{
 const task=structuredClone(spatialConstraintsTask),house=task.actions[1]!,route=task.actions[3]!;if(house.type!=='create_rectangle'||route.type!=='create_route')throw Error();house.width=25;house.height=35;house.orientation='ASK';route.mode='ASK';expect(plan(task)).toMatchObject({resolutionStatus:'INVALID',clarifications:[],projectedDocument:null});
});
it('capability limit has UNSUPPORTED outcome, not malformed data',()=>{
 const document=createNewDocument();document.vertices={a:{id:'a',x:0,y:0},b:{id:'b',x:20,y:0},c:{id:'c',x:10,y:30}};document.entities=[{type:'polygon',id:'triangle',name:'Участок',layerId:'boundary',vertexIds:['a','b','c']}];const task:AiTaskIntent={actions:[{type:'create_spatial_point',name:'Кран',placement:{type:'inside_boundary',reference:{kind:'named_entity',name:'Участок'},anchor:'south_east',inset:{north:3,south:3,east:3,west:3},minimumClearance:3,offsetAlongSide:null}}]};expect(resolveAiTaskPlan(task,document)).toMatchObject({resolutionStatus:'UNSUPPORTED',resolution:{status:'unsupported',message:expect.stringContaining('прямоугольной')},projectedDocument:null});
});
it('new semantic points can feed legacy named-point dimensions and measurements',()=>{
 const task=structuredClone(spatialConstraintsTask);task.actions.push({type:'create_points',points:[{name:'P1',x:0,y:0}]},{type:'measure_between_named_points',pointNames:['Кран','P1']});const text=ORIGINAL_SPATIAL_REQUEST+' Создай P1 (0,0) и измерь Кран-P1.';expect(validateParserResult(task,text)).toEqual(task);expect(plan(task).resolutionStatus).toBe('RESOLVED');
});
it('natural inflected names keep coordinate checks unchanged',()=>{
 expect(validateParserResult(spatialConstraintsTask,ORIGINAL_SPATIAL_REQUEST.replace('труба','трубу'))).toEqual(spatialConstraintsTask);
 const task=structuredClone(spatialConstraintsTask),a=task.actions[3]!;if(a.type!=='create_route')throw Error();a.name='НовыйМаршрут';expect(()=>validateParserResult(task,ORIGINAL_SPATIAL_REQUEST)).toThrow(expect.objectContaining({code:'LOCAL_VALIDATION_ERROR'}));
});
it('multiple incompatible alignments are never silently resolved by last value',()=>{
 const task=structuredClone(spatialConstraintsTask),a=task.actions[1]!;if(a.type!=='create_rectangle')throw Error();a.constraints=[{type:'alignment',relation:'parallel',reference:{kind:'action',actionIndex:0,result:'boundary'}},{type:'alignment',relation:'perpendicular',reference:{kind:'action',actionIndex:0,result:'boundary'}}];expect(plan(task).resolution).toMatchObject({status:'invalid',message:expect.stringContaining('Несовместимые')});
});
