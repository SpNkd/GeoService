import { memo, useEffect, useRef } from 'react';
import type { GeoDocument, Viewport } from '../domain/model';
import type { ViewSize } from '../geometry';
import type { RenderItem } from './selectors';
import { CanvasSceneRenderer } from './CanvasSceneRenderer';
export const CanvasStratum = memo(function CanvasStratum({ document, items, viewport, size }: { document: GeoDocument; items: RenderItem[]; viewport: Viewport; size: ViewSize }) {
  const ref = useRef<HTMLCanvasElement>(null), renderer = useRef<CanvasSceneRenderer | null>(null);
  useEffect(() => { if (ref.current) renderer.current = new CanvasSceneRenderer(ref.current); return () => { renderer.current?.dispose(); renderer.current = null; }; }, []);
  useEffect(() => {
    const draw = () => renderer.current?.schedule(document, items, viewport, size);
    draw(); window.addEventListener('resize', draw); return () => window.removeEventListener('resize', draw);
  }, [document, items, viewport, size]);
  return <foreignObject x={0} y={0} width={size.width} height={size.height} pointerEvents="none" data-testid="canvas-stratum">
    <canvas ref={ref} data-testid="dxf-canvas" style={{ width: size.width, height: size.height, display: 'block' }} />
  </foreignObject>;
});
