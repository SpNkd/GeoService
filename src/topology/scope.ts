import { entityPoints, entityVertexIds, type SymbolEntity, type GeoDocument } from '../domain/model';
import { conceptsFor } from '../semantics/concepts';
import { learnedMatches } from '../semantics/learning';
import { connectivityIndex, portCapacity, portKey } from '../connectors/model';
import { visibleSymbolPorts } from '../connectors/ports';
import { symbolWorldBounds } from '../symbols/transforms';
import { requireSymbol, listLibraries } from '../symbols/registry';
import type { AnalysisRequest, Point, PortOption, Scope } from './types';
import { box, SpatialIndex } from './spatial';
export interface SourcePath {id:string;points:Point[];vertexIds:string[];layerId:string;concepts:string[];ancestors:string[];imageRunId?:string}
export function scopedPaths(document:GeoDocument,scope:Scope):{paths:SourcePath[];suppressed:number;ports:PortOption[];scale:number;pixel:number;stroke:number}{
 const selected=new Set(scope.kind==='selection'?scope.ids:[]),matches=scope.kind==='concept'?learnedMatches(document,scope.conceptId,false):[],semanticIds=new Set(matches.map(m=>m.entityId));
 const layers=new Map(document.layers.map(l=>[l.id,l])),annotations=new Map<string,string[]>();
 for(const a of document.semantics?.annotations??[])if(a.polarity==='positive'){const values=annotations.get(a.entityId)??[];values.push(a.conceptId);annotations.set(a.entityId,values);}
 const parents=new Map(conceptsFor(document).map(c=>[c.id,c.parentConceptId])),lineage=(id:string)=>{const ids:string[]=[],seen=new Set<string>();let parent=parents.get(id);while(parent&&!seen.has(parent)){seen.add(parent);ids.push(parent);parent=parents.get(parent);}return ids;};
 const symbolBounds=document.entities.filter((e):e is SymbolEntity=>e.type==='symbol'&&!!e.imageSource).map(e=>({bounds:symbolWorldBounds(e),value:e}));
 const masks=new SpatialIndex(symbolBounds);let suppressed=0,stroke=0,pixel=0,segmentCount=0;
 const paths:SourcePath[]=[];
 for(const e of document.entities){const layer=layers.get(e.layerId);if((e.type!=='line'&&e.type!=='polyline')||!layer?.visible||e.visible===false)continue;
 if(scope.kind==='selection'&&!selected.has(e.id)||scope.kind==='layer'&&scope.layerId!==e.layerId||scope.kind==='concept'&&!semanticIds.has(e.id)||scope.kind==='image-group'&&e.imageSource?.vectorizationRunId!==scope.runId)continue;
 const points=entityPoints(e,document.vertices);if(points.some(p=>p.z!==undefined&&p.z!==0))continue;
 const bounds=points.reduce((b,p)=>({minX:Math.min(b.minX,p.x),maxX:Math.max(b.maxX,p.x),minY:Math.min(b.minY,p.y),maxY:Math.max(b.maxY,p.y)}),box(points[0]!));
 // An area selects complete owners only. It never truncates a polyline silently.
 if(scope.kind==='area'&&(bounds.minX<scope.bounds.minX||bounds.maxX>scope.bounds.maxX||bounds.minY<scope.bounds.minY||bounds.maxY>scope.bounds.maxY))continue;
 if(e.imageSource&&masks.query(bounds).some(s=>s.imageSource?.sourceAssetId===e.imageSource!.sourceAssetId&&(()=>{const b=symbolWorldBounds(s);return bounds.minX>b.minX&&bounds.maxX<b.maxX&&bounds.minY>b.minY&&bounds.maxY<b.maxY;})())){suppressed++;continue;}
 segmentCount+=points.length-1;if(segmentCount>6000)throw new Error('Слишком много сегментов. Сузьте область анализа до 6000 сегментов.');
  const own=annotations.get(e.id)??[],specific=own.filter(c=>!own.some(other=>other!==c&&lineage(other).includes(c)));
  paths.push({id:e.id,points,vertexIds:entityVertexIds(e),layerId:e.layerId,concepts:specific,ancestors:specific.flatMap(lineage),...(e.imageSource?{imageRunId:e.imageSource.vectorizationRunId}:{})});
 if(paths.length>2000)throw new Error('Слишком много линий. Сузьте выбор, слой или область до 2000 объектов.');
 const width=e.style?.lineWidth??layer.style?.lineWidth;if(typeof width==='number')stroke=Math.max(stroke,width/Math.max(document.viewport.pixelsPerUnit,1));
 if(e.imageSource?.modelUnitsPerPixel)pixel=Math.max(pixel,e.imageSource.modelUnitsPerPixel);
 else if(e.imageSource?.source==='image-vectorization'){const raster=document.entities.find(r=>r.type==='raster_underlay'&&r.assetId===e.imageSource!.sourceAssetId);if(raster?.type==='raster_underlay'&&raster.assetMetadata)pixel=Math.max(pixel,raster.width/raster.assetMetadata.widthPx);}
 }
 const index=connectivityIndex(document),ports=visibleSymbolPorts(document).filter(p=>p.world.z===undefined||p.world.z===0).map(p=>{const used=index.byPort.get(portKey(p.endpoint))?.length??0;return {endpoint:p.endpoint,point:p.world,label:`${p.symbolName} · ${p.port.id}`,kind:p.port.kind,directionDeg:p.world.directionDeg,available:used<portCapacity(p.port),distance:0,...(used>=portCapacity(p.port)?{reason:'Порт уже имеет максимальное число подключений.'}:{})};});
 const lengths=paths.flatMap(path=>path.points.slice(1).map((p,i)=>Math.hypot(p.x-path.points[i]!.x,p.y-path.points[i]!.y))).filter(n=>n>0).sort((a,b)=>a-b);
 const span=paths.flatMap(p=>p.points).reduce((b,p)=>({minX:Math.min(b.minX,p.x),maxX:Math.max(b.maxX,p.x),minY:Math.min(b.minY,p.y),maxY:Math.max(b.maxY,p.y)}),{minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity}),margin=(lengths[Math.floor(lengths.length/2)]??1)*.1,nearby=new SpatialIndex(document.entities.filter((e):e is SymbolEntity=>e.type==='symbol').map(e=>({bounds:symbolWorldBounds(e),value:e}))).query({minX:span.minX-margin,maxX:span.maxX+margin,minY:span.minY-margin,maxY:span.maxY+margin});
 const sizes=nearby.map(e=>e.scale*requireSymbol(e.libraryId,e.symbolId,e.libraryVersion).defaultSize).sort((a,b)=>a-b);
 return {paths,suppressed,ports,scale:sizes[Math.floor(sizes.length/2)]??lengths[Math.floor(lengths.length/2)]??1,pixel,stroke};
}
/** Bound structured-clone size before entering the Worker; no nested DXF expansion. */
export function analysisRequest(document:GeoDocument,scope:Scope,decisions:AnalysisRequest['decisions']):AnalysisRequest {
 const selected=new Set(scope.kind==='selection'?scope.ids:[]);
 const entities=document.entities.filter(e=>{
  if(['symbol','connector','raster_underlay'].includes(e.type))return true;
  if(e.type==='text')return scope.kind==='concept';
  if(e.type!=='line'&&e.type!=='polyline')return false;
  if(scope.kind==='selection')return selected.has(e.id);
  if(scope.kind==='layer')return e.layerId===scope.layerId;
  if(scope.kind==='image-group')return e.imageSource?.vectorizationRunId===scope.runId;
  if(scope.kind==='area')return entityVertexIds(e).every(id=>{const p=document.vertices[id]!;return p.x>=scope.bounds.minX&&p.x<=scope.bounds.maxX&&p.y>=scope.bounds.minY&&p.y<=scope.bounds.maxY;});
  return true;
 }),vertices:GeoDocument['vertices']={};
 for(const e of entities)for(const id of entityVertexIds(e))vertices[id]=document.vertices[id]!;
 const libraryIds=new Set(entities.flatMap(e=>e.type==='symbol'?[e.libraryId]:[]));
 return {document:{...document,entities,vertices,blocks:[],dxfLayouts:[]},scope,decisions,libraries:listLibraries().filter(l=>libraryIds.has(l.id))};
}
