import type { ReadyResolution } from '../ai/resolver';
import type { Viewport } from '../domain/model';
import { worldToScreen, type ViewSize } from '../geometry';
import { DimensionView } from './DimensionView';
import { GeometryPath, MeasurementLine } from './PreviewPrimitives';

export function AiPreviewView({ result, viewport, size, actionNumber }: { result: ReadyResolution; viewport: Viewport; size: ViewSize; actionNumber?: number | undefined }) {
  const points = result.geometry.map(point => worldToScreen(point, viewport, size));
  return <g data-testid="ai-ghost" pointerEvents="none" stroke="#6279ba" strokeWidth={2} strokeDasharray="8 5" fill="none">
    {result.kind === 'dimension' ? <DimensionView a={result.geometry[0]!} b={result.geometry[1]!} offset={result.offset} viewport={viewport} size={size} preview color="#6279ba" />
      : result.kind === 'measure' ? <MeasurementLine a={points[0]!} b={points[1]!} />
      : <GeometryPath points={points} closed={result.kind === 'boundary'} fill={result.kind === 'boundary' ? '#6279ba18' : 'none'} />}
    {actionNumber && <text x={points[0]!.x + 7} y={points[0]!.y - 7 - (actionNumber - 1) * 15} stroke="none" fill="#405ba0" fontSize={12}>{actionNumber}</text>}
  </g>;
}
