import type { DocumentCommand } from '../domain/commands';
import type { Entity, GeoDocument, RasterUnderlayEntity, Vertex } from '../domain/model';
import { newGeometryId } from '../domain/geometryIntent';
import { pixelToModel } from './transform';
import type { Candidate, ImageCalibration, ImageProvenance, PixelPoint } from './types';
export function isGeometry(candidate: Candidate) { return 'points' in candidate || candidate.type === 'circle'; }
export function vectorizationCommands(document: GeoDocument, original: RasterUnderlayEntity, placed: RasterUnderlayEntity, calibration: ImageCalibration, candidates: Candidate[], included: ReadonlySet<string>, targetLayer: string, runId: string): DocumentCommand[] {
  const current = document.entities.find(e => e.id === original.id), sourceLayer = document.layers.find(l => l.id === original.layerId);
  if (current !== original || original.locked || sourceLayer?.locked) throw new Error('Подложка изменена или заблокирована. Откройте обработку заново.');
  const accepted = candidates.filter(c => included.has(c.id) && isGeometry(c)); if (!accepted.length) throw new Error('Выберите геометрию для применения. Текстовые области требуют OCR.');
  const commands: DocumentCommand[] = [{ type: 'update-underlay', entityId: original.id, patch: { position: placed.position, rotationDeg: placed.rotationDeg, width: placed.width, height: placed.height, imageCalibration: calibration } }];
  const layerId = targetLayer === '__new' ? newGeometryId('image-layer') : targetLayer;
  if (targetLayer === '__new') commands.push({ type: 'create-layer', layer: { id: layerId, name: 'Векторизация изображения', visible: true, locked: false, order: Math.max(...document.layers.map(l => l.order)) + 1, styleId: document.layers.find(l => l.id === original.layerId)!.styleId } });
  else { const layer = document.layers.find(l => l.id === layerId); if (!layer || layer.locked || !layer.visible) throw new Error('Выберите видимый незаблокированный слой.'); }
  const registry = new Map<string, string>();
  for (const [index, candidate] of accepted.entries()) {
    const source: ImageProvenance = { source: 'image-vectorization', sourceAssetId: original.assetId, vectorizationRunId: runId, candidateType: candidate.type, ...(candidate.confidence !== undefined ? { confidence: candidate.confidence } : {}) };
    const base = { id: newGeometryId('image-geometry'), name: `Изображение · ${index + 1}`, layerId, imageSource: source };
    const vertices: Vertex[] = [];
    const vertex = (p: PixelPoint) => { const world = pixelToModel(p, placed, calibration), key = `${world.x.toFixed(8)}:${world.y.toFixed(8)}`; let id = registry.get(key); if (!id) { id = newGeometryId('vertex'); registry.set(key, id); vertices.push({ id, ...world }); } return id; };
    let entity: Entity;
    if (candidate.type === 'circle') {
      const sx = placed.width / calibration.rectifiedWidth, sy = placed.height / calibration.rectifiedHeight;
      if (Math.abs(sx / sy - 1) < 1e-5) entity = { ...base, type: 'circle', center: pixelToModel(candidate.center, placed, calibration), radius: candidate.radius * sx };
      else { const ids = Array.from({ length: 64 }, (_, i) => vertex({ x: candidate.center.x + Math.cos(i / 64 * Math.PI * 2) * candidate.radius, y: candidate.center.y + Math.sin(i / 64 * Math.PI * 2) * candidate.radius })); entity = { ...base, type: 'polygon', vertexIds: ids as [string, string, string, ...string[]] }; }
    } else if ('points' in candidate) { const ids = candidate.points.map(vertex);
      if (candidate.type === 'line') entity = { ...base, type: 'line', startVertexId: ids[0]!, endVertexId: ids[1]! };
      else if (candidate.type === 'contour') entity = { ...base, type: 'polygon', vertexIds: ids as [string, string, string, ...string[]] };
      else entity = { ...base, type: 'polyline', vertexIds: ids as [string, string, ...string[]] };
    } else continue;
    commands.push({ type: 'add-entity', entity, vertices });
  }
  return commands;
}
