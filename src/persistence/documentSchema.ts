import { knowledgeSchema, validateSemanticKnowledge } from '../semantics/schema';
import { imageCalibrationSchema, imageProvenanceSchema } from '../image/schema';
import { layerStyleSchema, styleOverridesSchema } from '../styles/schema';
import { dxfLayoutsSchema } from '../layouts/schema';
import { validateConnectivity } from '../connectors/model';
import { connectorEndpointSchema } from '../connectors/schema';
import { semanticContentSchema, sourceSchema, sourceDocumentSchema, blockDefinitionSchema, primitivesSchema, blockTransformSchema, attributesSchema } from './vectorSchema';
import { validateVectorDocument } from '../vectors/geometry';
import { z } from 'zod';
import { requireSymbol } from '../symbols/registry';
import { symbolPositionSchema, symbolScaleSchema, symbolPropertiesSchema } from '../symbols/schema';
import { computeRigidTransform2D, documentModelFrame } from '../geometry/georeferencing';
import { entityVertexIds, type GeoDocument } from '../domain/model';

export const id = z.string().min(1).max(256).refine(value => value === value.trim() && !['__proto__', 'constructor', 'prototype'].includes(value), 'Unsafe or padded ID');
export const finiteNumber = z.number().finite();
export const worldPointSchema = z.object({ x: finiteNumber, y: finiteNumber, z: finiteNumber.optional() });
// Literal paint colours only: the layer swatch also uses this value in CSS background.
const paintColour = z.string().max(100).refine(value => /^(?:[a-z]*|#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|(?:rgb|hsl)a?\([\d\s.,%+\-/]+\))$/i.test(value.trim()), 'Ожидается цвет без URL, CSS variables или внешних ресурсов');
const base = { imageSource: imageProvenanceSchema.optional(), id, name: z.string().min(1).max(1000), layerId: id, styleId: id.optional(), style: styleOverridesSchema.optional(), visible: z.boolean().optional(), source: sourceSchema.optional() };
export const symbolEntitySchema = z.object({ ...base, type: z.literal('symbol'), libraryId: id, libraryVersion: id.optional(), symbolId: id, position: worldPointSchema, rotationDeg: finiteNumber.min(0).lt(360), scale: symbolScaleSchema, properties: symbolPropertiesSchema.optional() });
const rasterMetadataSchema=z.object({mimeType:z.enum(['image/png','image/jpeg','image/webp']),originalName:z.string().max(1000),byteSize:finiteNumber.int().min(1).max(40*1024*1024),widthPx:finiteNumber.int().positive().max(16384),heightPx:finiteNumber.int().positive().max(16384)});
export const rasterPatchSchema = z.strictObject({ position:z.strictObject({x:finiteNumber,y:finiteNumber}).optional(), width:finiteNumber.positive().max(1e9).optional(), height:finiteNumber.positive().max(1e9).optional(), rotationDeg:finiteNumber.optional(), opacity:finiteNumber.min(0).max(1).optional(), locked:z.boolean().optional(), assetId:id.optional(), assetMetadata:rasterMetadataSchema.optional(),imageCalibration:imageCalibrationSchema.optional() });
export const entitySchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('point'), vertexId: id }),
  z.object({ ...base, type: z.literal('line'), startVertexId: id, endVertexId: id }),
  z.object({ ...base, type: z.literal('dimension'), startVertexId: id, endVertexId: id, offset: finiteNumber, textPosition: finiteNumber.min(0.05).max(0.95).optional() }),
  z.object({ ...base, type: z.literal('polyline'), vertexIds: z.tuple([id, id]).rest(id) }),
  z.object({ ...base, type: z.literal('polygon'), vertexIds: z.tuple([id, id, id]).rest(id) }),
  z.object({ ...base, type: z.literal('text'), vertexId: id, content: z.string().min(1).max(10000), fontSize: finiteNumber.positive().max(1000), rotationDeg: finiteNumber.optional(), height: finiteNumber.positive().optional() }),
  z.object({ ...base, type: z.literal('label'), targetId: id, template: z.string().max(10000), dx: finiteNumber, dy: finiteNumber }),
  symbolEntitySchema,
  z.object({...base,type:z.literal('raster_underlay'),assetId:id,position:z.strictObject({x:finiteNumber,y:finiteNumber}),width:finiteNumber.positive().max(1e9),height:finiteNumber.positive().max(1e9),rotationDeg:finiteNumber,opacity:finiteNumber.min(0).max(1),locked:z.boolean(),assetMetadata:rasterMetadataSchema.optional(),imageCalibration:imageCalibrationSchema.optional()}),
  z.object({ ...base, type:z.literal('connector'), start:connectorEndpointSchema, end:connectorEndpointSchema, routing:z.enum(['direct','orthogonal']), waypoints:z.array(symbolPositionSchema).max(100).optional(), topologySource:z.strictObject({source:z.literal('topology-reconstruction'),sourceGeometryIds:z.array(id).min(1).max(2000),sourceImageRunId:id.optional(),resolution:z.literal('user-confirmed')}).optional() }),
  z.object({ ...base, type: z.literal('arc'), center: worldPointSchema, radius: finiteNumber.positive(), startAngle: finiteNumber, endAngle: finiteNumber }),
  z.object({ ...base, type: z.literal('circle'), center: worldPointSchema, radius: finiteNumber.positive() }),
  z.object({ ...base, type: z.literal('block_instance'), blockDefinitionId: id, ...blockTransformSchema, attributes: attributesSchema.optional(), attributePrimitives: primitivesSchema.optional(), attributeCoordinateSpace: z.literal('block-local').optional() }),
  z.object({ ...base, type: z.literal('imported_graphic'), position: worldPointSchema, primitives: primitivesSchema, semanticContent: semanticContentSchema.optional() }),
]);

export const vertexSchema = worldPointSchema.extend({ id });
export const layerSchema = z.object({ id, name: z.string().min(1).max(1000), visible: z.boolean(), locked: z.boolean(), order: finiteNumber.int(), styleId: id, style: layerStyleSchema.optional(), source: sourceSchema.optional() });

export const surveyXYSchema = z.strictObject({ e: finiteNumber, n: finiteNumber });
const horizontalControlSchema = z.strictObject({ pointEntityId: id, vertexId: id, modelSnapshot: z.strictObject({ x: finiteNumber, y: finiteNumber }), survey: surveyXYSchema });
export const horizontalReferenceSchema = z.strictObject({ controls: z.tuple([horizontalControlSchema, horizontalControlSchema]), transform: z.strictObject({ rotation: finiteNumber, translation: surveyXYSchema, scale: z.literal(1) }) });
export const verticalReferenceSchema = z.strictObject({ modelZero: z.literal(0), absoluteAtModelZero: finiteNumber });

/** Structure first; referential integrity is checked separately below. Unknown UI fields are stripped. */
export const documentSchema = z.object({
  semantics: knowledgeSchema.optional(),
  dxfLayouts:dxfLayoutsSchema.optional(),
  sources: z.array(sourceDocumentSchema).max(100).optional(),
  blocks: z.array(blockDefinitionSchema).max(2000).optional(),
  schemaVersion: z.literal(2),
  modelFrame: z.enum(['local', 'projected']).optional(),
  horizontalReference: horizontalReferenceSchema.optional(),
  verticalReference: verticalReferenceSchema.optional(),
  metadata: z.object({ id, title: z.string().min(1).max(1000), description: z.string().max(10000) }),
  units: z.object({ length: z.literal('m'), area: z.literal('m2') }),
  coordinateSystem: z.object({ kind: z.enum(['local', 'projected', 'unknown']), name: z.string().max(1000).optional(),
    epsg: finiteNumber.int().positive().optional(), xAxis: z.literal('east'), yAxis: z.literal('north'), zAxis: z.literal('up') }),
  vertices: z.record(id, vertexSchema),
  layers: z.array(layerSchema).min(1).max(1000),
  entities: z.array(entitySchema).max(50000),
  styles: z.array(z.object({ id, stroke: paintColour, fill: paintColour, lineWeight: finiteNumber.positive().max(100), dash: z.string().max(100).optional() })).min(1).max(1000),
  viewport: z.object({ center: worldPointSchema, pixelsPerUnit: finiteNumber.min(0.00001).max(100000) }),
});

export function validateDocument(raw: unknown): GeoDocument {
  const result = documentSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new Error(`Неверный документ: ${issue.path.join('.') || 'GeoDocument'} — ${issue.message}`);
  }
  const document = result.data as GeoDocument;
  validateDocumentSemantics(document);
  return document;
}
/** Referential/geometry checks on structurally validated canonical data. */
export function validateDocumentSemantics(document: GeoDocument): void {
  validateSemanticKnowledge(document);
  for (const [kind, items] of [['layer', document.layers], ['entity', document.entities], ['style', document.styles]] as const) {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.id)) throw new Error(`Duplicate ${kind} ID ${item.id}`);
      seen.add(item.id);
    }
  }
  const layers = new Set(document.layers.map(layer => layer.id));
  const styles = new Set(document.styles.map(style => style.id));
  for (const [key, vertex] of Object.entries(document.vertices)) if (key !== vertex.id) throw new Error(`Vertex key ${key} does not match ID ${vertex.id}`);
  for (const layer of document.layers) if (!styles.has(layer.styleId)) throw new Error(`Layer ${layer.id} references missing style ${layer.styleId}`);
  for (const entity of document.entities) {
    if(entity.type==='raster_underlay'&&entity.imageCalibration&&entity.assetMetadata&&entity.imageCalibration.quad.some(p=>p.x>entity.assetMetadata!.widthPx||p.y>entity.assetMetadata!.heightPx))throw new Error('Углы перспективы выходят за пределы исходного изображения');
    if (entity.type === 'symbol') { const definition = requireSymbol(entity.libraryId, entity.symbolId, entity.libraryVersion); if (definition.allowedRotations && !definition.allowedRotations.includes(entity.rotationDeg)) throw new Error(`Поворот символа ${entity.id} не разрешён определением`); }
    if (!layers.has(entity.layerId)) throw new Error(`Entity ${entity.id} references missing layer ${entity.layerId}`);
    if (entity.styleId && !styles.has(entity.styleId)) throw new Error(`Entity ${entity.id} references missing style ${entity.styleId}`);
    for (const id of entityVertexIds(entity)) if (!Object.hasOwn(document.vertices, id)) throw new Error(`Entity ${entity.id} references missing vertex ${id}`);
    if (entity.type === 'label') {
      const target = document.entities.find(candidate => candidate.id === entity.targetId);
      if (!target || !['point', 'line', 'polyline', 'polygon', 'symbol'].includes(target.type)) throw new Error(`Label ${entity.id} references missing or unsupported target ${entity.targetId}`);
    }
  }
  validateConnectivity(document);
  validateVectorDocument(document);
  const reference = document.horizontalReference;
  if (reference) {
    if (documentModelFrame(document) !== 'local') throw new Error('Horizontal reference requires local modelFrame');
    const [a, b] = reference.controls;
    if (a.pointEntityId === b.pointEntityId) throw new Error('Duplicate control point');
    for (const control of reference.controls) {
      const entity = document.entities.find(item => item.id === control.pointEntityId);
      if (!entity || entity.type !== 'point' || entity.vertexId !== control.vertexId) throw new Error('Missing or changed control PointEntity/vertex reference');
    }
    // Check committed snapshots, never silently recalibrate from current (possibly stale) vertices.
    const expected = computeRigidTransform2D(a.modelSnapshot, b.modelSnapshot, a.survey, b.survey);
    if (expected.status === 'INVALID' || !expected.transform) throw new Error('Invalid committed calibration');
    const actual = reference.transform, computed = expected.transform;
    if (Math.abs(actual.rotation - computed.rotation) > 1e-12 || Math.abs(actual.translation.e - computed.translation.e) > 1e-8 || Math.abs(actual.translation.n - computed.translation.n) > 1e-8) throw new Error('Transform does not match committed control snapshots');
  }
}
