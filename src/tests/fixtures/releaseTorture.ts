import { operationsFixture } from './documentOperations';
import { processFixtureDocument } from './topology';
import { candidateCommands } from '../../image/apply';
import { fullQuad } from '../../image/transform';
import { analyzeTopology } from '../../topology/analyze';
import { topologyCommands } from '../../topology/apply';
import { proposeRule, rememberedKnowledge } from '../../semantics/learning';
import { BUILTIN_CONCEPTS } from '../../semantics/concepts';
import { resolveAiTaskPlan, taskCommands } from '../../ai/task';
import { spatialConstraintsTask, ORIGINAL_SPATIAL_REQUEST } from './spatialConstraints';
import { editorReducer, initialEditorState } from '../../store/editor';
import type { DocumentCommand } from '../../domain/commands';
import type { RasterUnderlayEntity } from '../../domain/model';

/** All inputs are generated public fixtures. No reference files or saved user data. */
export function releaseTorture() {
 const initial=operationsFixture(),process=processFixtureDocument();
 initial.metadata={id:'release-torture',title:'Release torture · synthetic',description:'Safe composite document'};
 initial.vertices={...initial.vertices,...process.vertices};initial.entities.push(...process.entities);
 const raster:RasterUnderlayEntity={id:'rc-raster',type:'raster_underlay',name:'Synthetic underlay',layerId:'boundary',assetId:'synthetic-missing-asset',position:{x:40,y:40},width:20,height:20,rotationDeg:0,opacity:.6,locked:false};
 initial.entities.push(raster);
 let state=initialEditorState(initial);
 const snapshots=[initial],steps:string[]=[];
 const batch=(name:string,commands:DocumentCommand[])=>{state=editorReducer(state,{type:'execute-batch',commands});if(state.error)throw Error(state.error);steps.push(name);snapshots.push(state.document);};
 batch('create',[{type:'add-entity',entity:{id:'rc-manual',type:'line',name:'Manual line',startVertexId:'rc-v',endVertexId:'rc-v2',layerId:'boundary'},vertices:[{id:'rc-v',x:50,y:30},{id:'rc-v2',x:55,y:30}]},{type:'add-entity',entity:{id:'rc-point',type:'point',name:'Manual shared point',vertexId:'rc-v',layerId:'boundary'},vertices:[]}]);
 batch('move',[{type:'move-entities',entityIds:['rc-manual'],delta:{x:2,y:3}}]);
 batch('rotate',[{type:'transform-selection',entityIds:['rc-manual'],transform:{kind:'rotate',pivot:{x:40,y:40},angleDeg:30}}]);
 batch('style',[{type:'set-entity-style',entityIds:['rc-manual'],patch:{strokeColor:'#008800',lineWidth:2}}]);
 batch('text edit',[{type:'update-entity',entityId:'weak',patch:{content:'Synthetic text edited'}}]);
 batch('ATTRIB',[{type:'update-block-attribute',entityId:'mark-a',tag:'NAME',attributeIndex:0,patch:{value:'RC ATTRIBUTE'}}]);
 const ai=resolveAiTaskPlan(spatialConstraintsTask,state.document,new Map(),{id:'rc-spatial',text:ORIGINAL_SPATIAL_REQUEST});
 if(ai.resolutionStatus!=='RESOLVED')throw Error('Synthetic spatial plan failed');
 batch('AI Apply',taskCommands(ai));
 const concept=BUILTIN_CONCEPTS.find(c=>c.id==='pipe')!,rule=proposeRule(state.document,['path0','path1'],concept.id,'rc-rule').rule;
 batch('semantic Teach',[{type:'set-semantic-knowledge',knowledge:rememberedKnowledge(state.document,concept,rule,new Set(),new Set(['EXACT','STRONG']))}]);
 const calibration={quad:fullQuad(100,100),rectifiedWidth:100,rectifiedHeight:100};
 batch('image + OCR Apply',candidateCommands(state.document,raster,raster,calibration,[{id:'rc-trace',type:'line',points:[{x:10,y:50},{x:90,y:50}]},{id:'rc-ocr',type:'text',bounds:{x:10,y:10,width:50,height:12},recognizedText:'ГАЗ исправлен',originalText:'ГA3',confirmed:true,confidence:.82}],new Set(['rc-trace','rc-ocr']),'annotations','rc-image'));
 batch('PDF Apply',candidateCommands(state.document,{...raster,assetId:'synthetic-pdf'},raster,calibration,[{id:'rc-pdf',type:'line',points:[{x:10,y:90},{x:90,y:90}]}],new Set(['rc-pdf']),'annotations','rc-pdf','pdf-vector'));
 const graph=analyzeTopology(state.document,{kind:'layer',layerId:'buildings'});
 batch('topology Apply',topologyCommands(state.document,graph,Object.fromEntries(graph.routes.filter(r=>r.classification==='STRONG').map(r=>[r.id,{status:'confirmed' as const}]))));
 return {state,initial,document:state.document,snapshots,steps};
}
