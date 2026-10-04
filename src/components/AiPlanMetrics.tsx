import type { ReadyResolution } from '../ai/resolver';
import { formatAzimuth, formatDistance, formatMeasure } from '../geometry/format';

function BoundaryMetrics({ result }: { result: Extract<ReadyResolution, { kind: 'boundary' }> }) {
  return <><dt>Вершин</dt><dd>{result.references.length}</dd><dt>Perimeter</dt><dd>{formatDistance(result.perimeter)}</dd>
    <dt>Area</dt><dd>{formatMeasure(result.area, 3)} м²</dd><dt>Целевой слой</dt><dd>{result.targetLayer}</dd></>;
}
function PolylineMetrics({ result }: { result: Extract<ReadyResolution, { kind: 'polyline' }> }) {
  return <><dt>Segments</dt><dd>{result.segments}</dd><dt>Length</dt><dd>{formatDistance(result.length)}</dd><dt>Целевой слой</dt><dd>{result.targetLayer}</dd></>;
}
function DimensionMetrics({ result }: { result: Extract<ReadyResolution, { kind: 'dimension' }> }) {
  return <><dt>Distance</dt><dd>{formatDistance(result.metrics.horizontal)}</dd><dt>Azimuth</dt><dd>{formatAzimuth(result.metrics.azimuth)}</dd><dt>Целевой слой</dt><dd>{result.targetLayer}</dd></>;
}
function MeasureMetrics({ result }: { result: Extract<ReadyResolution, { kind: 'measure' }> }) {
  const m = result.metrics;
  return <><dt>Horizontal distance</dt><dd>{formatDistance(m.horizontal)}</dd><dt>ΔX</dt><dd>{formatDistance(m.delta.x)}</dd>
    <dt>ΔY</dt><dd>{formatDistance(m.delta.y)}</dd><dt>Azimuth</dt><dd>{formatAzimuth(m.azimuth)}</dd>
    {m.delta.z !== undefined && <><dt>ΔZ</dt><dd>{formatDistance(m.delta.z)}</dd><dt>3D distance</dt><dd>{formatDistance(m.spatial!)}</dd></>}</>;
}
export function AiPlanMetrics({ result }: { result: ReadyResolution }) {
  switch (result.kind) {
    case 'boundary': return <BoundaryMetrics result={result} />;
    case 'polyline': return <PolylineMetrics result={result} />;
    case 'dimension': return <DimensionMetrics result={result} />;
    case 'measure': return <MeasureMetrics result={result} />;
  }
}
