import { getVertex, vertexPoint, type GeoDocument } from '../domain/model';
import { polygonOrientation } from '../geometry';
import { AI_LIMITS, type AiAction } from './intent';
import { defaultDimensionOffset, resolveReferencedIntent, type DimensionReady, type ResolvedBoundaryOutput,
  type ResolvedReference, type ResolutionFailure } from './resolver';

/** Read-only resolution inputs; only explicitly typed prior boundary outputs are exposed. */
export interface ResolveContext {
  readonly baseDocument: GeoDocument;
  readonly projectedDocument: GeoDocument;
  readonly boundaryOutputs: ReadonlyMap<number, ResolvedBoundaryOutput>;
  readonly referenceResolutions: ReadonlyMap<string, ResolvedReference>;
}
export type BulkDimensionsReady = { status: 'ready'; kind: 'bulk-dimensions'; boundaryActionIndex: number;
  dimensions: DimensionReady[]; references: ResolvedReference[]; warnings: string[] };
export function resolveBoundaryEdgeDimensions(intent: Extract<AiAction, { type: 'create_dimensions_for_boundary_edges' }>,
  context: ResolveContext, actionId: string): BulkDimensionsReady | ResolutionFailure {
  const output = context.boundaryOutputs.get(intent.boundaryActionIndex);
  if (!output) return { status: 'blocked', dependencyIndex: intent.boundaryActionIndex,
    message: `Сначала исправьте Action ${intent.boundaryActionIndex + 1}: размеры сторон заблокированы зависимостью.` };
  const count = output.vertexIds.length;
  if (count > AI_LIMITS.bulkDimensions) return { status: 'invalid', message: `Создание размеров для ${count} сторон превышает лимит ${AI_LIMITS.bulkDimensions}` };
  const references = output.references.map((ref, index) => ({ ...ref,
    position: vertexPoint(getVertex(context.projectedDocument.vertices, output.vertexIds[index]!)) }));
  const orientation = polygonOrientation(references.map(ref => ref.position));
  if (orientation === 'degenerate') return { status: 'invalid', message: 'Граница имеет нулевую ориентированную площадь' };
  // DimensionView uses the left normal of A→B. CCW interior is left, so outward offset is negative.
  const sign = orientation === 'ccw' ? -1 : 1;
  const dimensions: DimensionReady[] = [];
  let layerDocument = context.projectedDocument;
  for (let index = 0; index < count; index++) {
    const pair = [references[index]!, references[(index + 1) % count]!];
    const length = Math.hypot(pair[1]!.position.x - pair[0]!.position.x, pair[1]!.position.y - pair[0]!.position.y);
    const dimension = resolveReferencedIntent({ type: 'create_dimension_between_named_points', pointNames: pair.map(ref => ref.name) },
      { references: pair, geometry: pair.map(ref => ref.position), warnings: [] }, layerDocument,
      { entityId: `geometry-${actionId}-edge-${index + 1}`, offset: sign * defaultDimensionOffset(length) });
    if (dimension.status !== 'ready') return dimension;
    if (dimension.kind !== 'dimension') throw new Error('Dimension resolver/output mismatch');
    dimensions.push(dimension);
    if (dimension.command.type === 'add-entity' && dimension.command.layer)
      layerDocument = { ...layerDocument, layers: [...layerDocument.layers, dimension.command.layer] };
  }
  return { status: 'ready', kind: 'bulk-dimensions', boundaryActionIndex: intent.boundaryActionIndex, dimensions, references,
    warnings: ['Offset: Auto. Автоматическое устранение пересечений и наложений размеров пока не поддерживается.'] };
}
