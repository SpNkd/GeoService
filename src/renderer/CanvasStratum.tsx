import { memo, useEffect, useRef } from 'react';
import { entityVertexIds } from '../domain/model';
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
},(a,b)=>a.viewport===b.viewport&&a.size===b.size&&a.document.layers===b.document.layers&&a.document.styles===b.document.styles&&a.document.blocks===b.document.blocks&&a.items.length===b.items.length&&a.items.every((item,i)=>item.entity===b.items[i]?.entity&&item.layer===b.items[i]?.layer&&item.style===b.items[i]?.style&&entityVertexIds(item.entity).every(id=>a.document.vertices[id]===b.document.vertices[id])));
