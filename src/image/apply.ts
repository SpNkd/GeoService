import { isConfirmedRegion } from './understanding';
import { normalizeSymbolRotation } from '../symbols/types';
import { requireSymbol } from '../symbols/registry';
import { emptyKnowledge } from '../semantics/model';
import type { DocumentCommand } from '../domain/commands';
import type { Entity, GeoDocument, RasterUnderlayEntity, Vertex } from '../domain/model';
import { newGeometryId } from '../domain/geometryIntent';
import { pixelToModel } from './transform';
import type { Candidate, ImageCalibration, ImageProvenance, PixelPoint } from './types';
export function isGeometry(candidate: Candidate) { return 'points' in candidate || candidate.type === 'circle'||candidate.type==='arc'; }
export function vectorizationCommands(document: GeoDocument, original: RasterUnderlayEntity, placed: RasterUnderlayEntity, calibration: ImageCalibration, candidates: Candidate[], included: ReadonlySet<string>, targetLayer: string, runId: string): DocumentCommand[] {
  const current = document.entities.find(e => e.id === original.id), sourceLayer = document.layers.find(l => l.id === original.layerId);
  if (current !== original || original.locked || sourceLayer?.locked) throw new Error('Подложка изменена или заблокирована. Откройте обработку заново.');
  return candidateCommands(document,original,placed,calibration,candidates,included,targetLayer,runId);
}
/** Shared canonical candidate conversion; PDF native vectors have no RasterUnderlay owner to mutate. */
export function candidateCommands(document:GeoDocument,original:Pick<RasterUnderlayEntity,'assetId'|'layerId'>,placed:RasterUnderlayEntity,calibration:ImageCalibration,candidates:Candidate[],included:ReadonlySet<string>,targetLayer:string,runId:string,sourceKind?:'pdf-vector'):DocumentCommand[]{
  const accepted = candidates.filter(c => included.has(c.id) && (isGeometry(c)||isConfirmedRegion(c))); if (!accepted.length) throw new Error('Выберите геометрию для применения. Текстовые области требуют OCR или ручного ввода и подтверждения.');
  // Calibration/placement belongs to the result transform; the source underlay stays unchanged.
  const commands: DocumentCommand[] = [];
  const layerId = targetLayer === '__new' ? newGeometryId('image-layer') : targetLayer;
  if (targetLayer === '__new') commands.push({ type: 'create-layer', layer: { id: layerId, name: 'Векторизация изображения', visible: true, locked: false, order: Math.max(...document.layers.map(l => l.order)) + 1, styleId: document.layers.find(l => l.id === original.layerId)!.styleId } });
  else { const layer = document.layers.find(l => l.id === layerId); if (!layer || layer.locked || !layer.visible) throw new Error('Выберите видимый незаблокированный слой.'); }
  const registry = new Map<string, string>(), annotations:import('../semantics/model').SemanticAnnotation[]=[];
  for (const [index, candidate] of accepted.entries()) {
    const source: ImageProvenance = { source: sourceKind??(candidate.type==='text'?'image-ocr':candidate.type==='symbol'?'image-symbol-match':'image-vectorization'), sourceAssetId: original.assetId, vectorizationRunId: runId, candidateType: candidate.type, ...(candidate.confidence !== undefined ? { confidence: candidate.confidence } : {}) };
    const base = { id: newGeometryId('image-geometry'), name: `Изображение · ${index + 1}`, layerId, imageSource: source };
    const vertices: Vertex[] = [];
    const vertex = (p: PixelPoint) => { const world = pixelToModel(p, placed, calibration), key = `${world.x.toFixed(8)}:${world.y.toFixed(8)}`; let id = registry.get(key); if (!id) { id = newGeometryId('vertex'); registry.set(key, id); vertices.push({ id, ...world }); } return id; };
    let entity: Entity;
    if (candidate.type === 'circle'||candidate.type==='arc') {
      const sx = placed.width / calibration.rectifiedWidth, sy = placed.height / calibration.rectifiedHeight;
      if (Math.abs(sx / sy - 1) < 1e-5) entity = candidate.type==='circle'?{ ...base, type: 'circle', center: pixelToModel(candidate.center, placed, calibration), radius: candidate.radius * sx }:{...base,type:'arc',center:pixelToModel(candidate.center,placed,calibration),radius:candidate.radius*sx,startAngle:placed.rotationDeg*Math.PI/180-candidate.endAngle,endAngle:placed.rotationDeg*Math.PI/180-candidate.startAngle};
      else { const start=candidate.type==='arc'?candidate.startAngle:0,sweep=candidate.type==='arc'?candidate.endAngle-start:Math.PI*2,ids = Array.from({ length: 64 }, (_, i) => vertex({ x: candidate.center.x + Math.cos(start+i / (candidate.type==='arc'?63:64) * sweep) * candidate.radius, y: candidate.center.y + Math.sin(start+i / (candidate.type==='arc'?63:64) * sweep) * candidate.radius })); entity = candidate.type==='arc'?{...base,type:'polyline',vertexIds:ids as [string,string,...string[]]}:{ ...base, type: 'polygon', vertexIds: ids as [string, string, string, ...string[]] }; }
    } else if ('points' in candidate) { const ids = candidate.points.map(vertex);
      if (candidate.type === 'line') entity = { ...base, type: 'line', startVertexId: ids[0]!, endVertexId: ids[1]! };
      else if (candidate.type === 'contour') entity = { ...base, type: 'polygon', vertexIds: ids as [string, string, string, ...string[]] };
      else entity = { ...base, type: 'polyline', vertexIds: ids as [string, string, ...string[]] };
    } else if(candidate.type==='text'&&candidate.confirmed&&candidate.recognizedText?.trim()){
      if(candidate.originalText)source.originalText=candidate.originalText;
      const rotation=candidate.rotationDeg??0,h=candidate.textHeight?candidate.textHeight*placed.height/calibration.rectifiedHeight:(Math.abs(rotation%180)===90?candidate.bounds.width:candidate.bounds.height)*placed.height/calibration.rectifiedHeight;
      entity={...base,type:'text',name:candidate.recognizedText.trim(),content:candidate.recognizedText.trim(),vertexId:vertex(candidate.anchor??{x:candidate.bounds.x,y:candidate.bounds.y+candidate.bounds.height}),fontSize:16,height:Math.max(.001,h),rotationDeg:placed.rotationDeg-rotation};
    }else if(candidate.type==='symbol'&&candidate.proposedSymbol?.confirmed){
      const proposed=candidate.proposedSymbol,definition=requireSymbol(proposed.libraryId,proposed.symbolId),sx=placed.width/calibration.rectifiedWidth,sy=placed.height/calibration.rectifiedHeight;
      if(Math.abs(sx/sy-1)>1e-5)throw new Error('Для символов нужен равномерный масштаб изображения.');
      const scale=candidate.bounds.width*sx/((proposed.localWidth??1)*definition.defaultSize);if(scale<.01||scale>100)throw new Error('Масштаб символа вне диапазона 0.01–100. Проверьте калибровку.');
      const center=pixelToModel({x:candidate.bounds.x+candidate.bounds.width/2,y:candidate.bounds.y+candidate.bounds.height/2},placed,calibration),offset=proposed.localCenter??{x:0,y:0},angle=placed.rotationDeg*Math.PI/180;
      source.candidateGroupId=candidate.groupId??candidate.id;source.libraryId=proposed.libraryId;source.symbolId=proposed.symbolId;if(proposed.matchClass)source.matchClass=proposed.matchClass;
      entity={...base,type:'symbol',name:definition.name,libraryId:proposed.libraryId,symbolId:proposed.symbolId,position:{x:center.x-(offset.x*Math.cos(angle)-offset.y*Math.sin(angle))*definition.defaultSize*scale,y:center.y-(offset.x*Math.sin(angle)+offset.y*Math.cos(angle))*definition.defaultSize*scale},rotationDeg:normalizeSymbolRotation(placed.rotationDeg+(proposed.rotationDeg??0)),scale};
    } else continue;
    if('semanticConceptId'in candidate&&candidate.semanticConceptId&&candidate.semanticConfirmed)annotations.push({entityId:entity.id,conceptId:candidate.semanticConceptId,polarity:'positive',source:'user-explicit'});
    commands.push({ type: 'add-entity', entity, vertices });
  }
  if(annotations.length){const knowledge=document.semantics??emptyKnowledge();commands.push({type:'set-semantic-knowledge',knowledge:{...knowledge,annotations:[...knowledge.annotations,...annotations]}});}
  return commands;
}
