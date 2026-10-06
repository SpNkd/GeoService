import { projectionOf, projectAxonometricBasis } from '../view/projection';
import { AxonCanvasRenderer } from './AxonCanvasRenderer';
import type { Entity, GeoDocument, Viewport, WorldPoint } from '../domain/model';
import { entityPoints, entityVertexIds, type Vertex } from '../domain/model';
import { worldToScreen, type ViewSize } from '../geometry';
import { arcSweep, blockAttributeMatrix, blockDefinition, blockMatrix, multiply, transformPoint, type Matrix } from '../vectors/geometry';
import { VECTOR_LIMITS, type VectorPrimitive } from '../vectors/types';
import { prepareVectorSet, vectorRenderOrigin } from './vectorPreparation';
import { createVectorStyleResolver, type Paint } from './vectorStyle';
import { intersects, ownerBounds, viewportBounds } from './hybridScene';
import type { RenderItem } from './selectors';

interface PathCommand { kind: 'path'; path: Path2D; primitive: VectorPrimitive; fill: boolean }
type FillCache=WeakMap<GeoDocument['layers'],{path:Path2D;primitive:VectorPrimitive}|null>;
interface FillCommand { kind:'fill'; contours:{primitive:VectorPrimitive;path:Path2D}[]; visibility:[FillCache,FillCache] }
type Command = PathCommand | FillCommand | { kind: 'text' | 'block'; primitive: VectorPrimitive };
interface DrawList { commands: Command[]; origin: WorldPoint }
const initialMetrics = { draws: 0, drawMs: 0, compilations: 0, paths: 0, commands: 0, drawnOwners: 0, culledOwners: 0, frames: [] as number[] };
// Vite timestamped HMR imports and untimestamped benchmark imports share diagnostics,
// never geometry. This development-only object retains numbers, not documents/Path2D.
const diagnostics=globalThis as typeof globalThis & { __geoCanvasCounters?:typeof initialMetrics };
const metrics=import.meta.env.DEV?(diagnostics.__geoCanvasCounters??=initialMetrics):initialMetrics;
export const canvasMetrics = () => ({ ...metrics, frames: [...metrics.frames] });
/** The matrix maps small origin-relative coordinates to CSS/device pixels without huge cancelling products. */
export function canvasTransform(view: Viewport, size: ViewSize, origin: WorldPoint, dpr = 1): Matrix {
  const p = worldToScreen(origin, view, size), z = view.pixelsPerUnit;
  const projection=projectionOf(view);if(projection){const b=projectAxonometricBasis(projection.orientation);return [b.x.x*z*dpr,-b.x.y*z*dpr,b.y.x*z*dpr,-b.y.y*z*dpr,p.x*dpr,p.y*dpr];}
  return [z * dpr, 0, 0, -z * dpr, p.x * dpr, p.y * dpr];
}
export function appendPrimitive(path: Pick<Path2D, 'moveTo' | 'lineTo' | 'closePath' | 'arc'>, p: VectorPrimitive) {
  if (p.kind === 'path') {
    p.points.forEach((v, i) => i ? path.lineTo(v.x, v.y) : path.moveTo(v.x, v.y));
    if (p.closed) path.closePath();
  } else if (p.kind === 'arc' || p.kind === 'circle') {
    const start = p.kind === 'arc' ? p.startAngle : 0;
    path.moveTo(p.center.x + p.radius * Math.cos(start), p.center.y + p.radius * Math.sin(start));
    path.arc(p.center.x, p.center.y, p.radius, start, start + (p.kind === 'arc' ? arcSweep(start, p.endAngle) : Math.PI * 2));
    if(p.kind==='circle')path.closePath();
  }
}
const styleKey = (p: VectorPrimitive) => [p.layerId, p.colorMode, p.stroke, p.lineWeight, p.dash, p.visible, p.fillOpacity].join('|');

/** Per active Canvas service; weak geometry keys never retain an obsolete document or SVG representation. */
export class CanvasSceneRenderer {
  private axon=new AxonCanvasRenderer();
  private lists = new WeakMap<VectorPrimitive[], DrawList>();
  private native = new WeakMap<Entity, { vertices: Vertex[]; list: DrawList }>();
  private pending: number | null = null;
  private input: { document: GeoDocument; items: RenderItem[]; view: Viewport; size: ViewSize; dpr: number } | null = null;
  private drawn = new Set<string>();
  constructor(private readonly canvas: HTMLCanvasElement) {}
  schedule(document: GeoDocument, items: RenderItem[], view: Viewport, size: ViewSize, dpr = window.devicePixelRatio || 1) {
    this.input = { document, items, view, size, dpr };
    if (this.pending === null) this.pending = requestAnimationFrame(() => { this.pending = null; this.draw(); });
  }
  dispose() { if (this.pending !== null) cancelAnimationFrame(this.pending); this.pending = null; this.input = null; }
  drawnOwners() { return [...this.drawn]; }
  private compile(document: GeoDocument, primitives: VectorPrimitive[]): DrawList {
    const prepared = prepareVectorSet(document, primitives), cached = this.lists.get(prepared.primitives);
    if (cached) return cached;
    const commands: Command[] = [], fills = new Map<string, FillCommand>();
    for (const p of prepared.primitives) if (p.kind === 'path' && p.fill && p.fillGroup) {
      let fill = fills.get(p.fillGroup);
      if (!fill) { fill = {kind:'fill',contours:[],visibility:[new WeakMap(),new WeakMap()]}; fills.set(p.fillGroup, fill); }
      const path=new Path2D();appendPrimitive(path,p);fill.contours.push({primitive:p,path});metrics.paths++;
    }
    commands.push(...fills.values());
    for (const p of prepared.primitives) {
      if (p.kind === 'text' || p.kind === 'block') { commands.push({ kind: p.kind, primitive: p }); continue; }
      const fill = p.kind === 'path' && !!p.fill && !p.fillGroup;
      const previous = commands.at(-1);
      if (!fill && previous?.kind === 'path' && !previous.fill && styleKey(previous.primitive) === styleKey(p)) appendPrimitive(previous.path, p);
      else { const path = new Path2D(); appendPrimitive(path, p); commands.push({ kind: 'path', path, primitive: p, fill }); metrics.paths++; }
    }
    const list = { origin: prepared.origin, commands }; this.lists.set(prepared.primitives, list);
    metrics.compilations++; metrics.commands += commands.length; return list;
  }
  private nativeList(document: GeoDocument, e: Entity): DrawList {
    const cached = this.native.get(e);
    const vertices=entityVertexIds(e).map(id=>document.vertices[id]!);
    if (cached && cached.vertices.length===vertices.length && cached.vertices.every((v,i)=>v===vertices[i])) return cached.list;
    const paint = { layerId: e.layerId, colorMode: 'byblock' as const };
    let primitives: VectorPrimitive[] = [];
    if (e.type === 'arc') primitives = [{ ...e, ...paint, kind: 'arc' }];
    if (e.type === 'circle') primitives = [{ ...e, ...paint, kind: 'circle' }];
    if (e.type === 'line' || e.type === 'polyline' || e.type === 'polygon') primitives = [{ ...paint, kind: 'path', points: entityPoints(e, document.vertices), closed: e.type === 'polygon' }];
    if (e.type === 'text') primitives = [{ ...paint, kind: 'text', position: document.vertices[e.vertexId]!, content: e.content, height: e.height ?? e.fontSize / document.viewport.pixelsPerUnit, rotationDeg: e.rotationDeg ?? 0 }];
    const list = this.compile(document, primitives); this.native.set(e, { vertices, list }); return list;
  }
  private draw() {
    if (!this.input) return;
    const { document, items, view, size, dpr } = this.input, ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const start = performance.now(), width = Math.round(size.width * dpr), height = Math.round(size.height * dpr);
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
    if(projectionOf(view)){this.drawn=new Set(this.axon.draw(ctx,document,items,view,size,dpr));const ms=performance.now()-start;metrics.draws++;metrics.drawMs+=ms;metrics.drawnOwners+=this.drawn.size;metrics.culledOwners+=items.length-this.drawn.size;metrics.frames.push(ms);if(metrics.frames.length>512)metrics.frames.shift();if(import.meta.env.DEV)this.canvas.dataset.drawnOwners=JSON.stringify([...this.drawn]);return;}
    const visible = viewportBounds(view, size), resolve = createVectorStyleResolver(document);
    this.drawn.clear();
    let currentMatrix:Matrix|null=null;
    const set = (m: Matrix) => {if(currentMatrix&&m.every((v,i)=>v===currentMatrix![i]))return;ctx.setTransform(m[0]*dpr,m[1]*dpr,m[2]*dpr,m[3]*dpr,m[4]*dpr,m[5]*dpr);currentMatrix=m;};
    const drawList = (list: DrawList, matrix: Matrix, parent: Paint, inheritAll: boolean, stack: string[]) => {
      if (stack.length > VECTOR_LIMITS.depth) return;
      for (const command of list.commands) {
        if(command.kind==='fill') {
          // SVG groups all currently visible contours of a HATCH and takes the first contour's paint.
          // Cache the compound path per visibility revision; holes remain holes across style buckets.
          const cache=command.visibility[inheritAll?1:0];let fill=cache.get(document.layers);
          if(fill===undefined){const contours=command.contours.filter(c=>resolve(c.primitive,parent,inheritAll).visible);if(!contours.length)fill=null;else{const path=new Path2D();for(const c of contours)path.addPath(c.path);fill={path,primitive:contours[0]!.primitive};metrics.paths++;}cache.set(document.layers,fill);}
          if(fill){const paint=resolve(fill.primitive,parent,inheritAll);set(matrix);ctx.fillStyle=paint.stroke;ctx.globalAlpha=fill.primitive.fillOpacity??1;ctx.fill(fill.path,'evenodd');ctx.globalAlpha=1;}continue;
        }
        const p = command.primitive, paint = resolve(p, parent, inheritAll);
        if (!paint.visible) continue;
        if (command.kind === 'block' && p.kind === 'block') {
          const block = blockDefinition(document, p.blockDefinitionId);
          if (block && !stack.includes(block.id) && stack.length < VECTOR_LIMITS.depth) drawList(this.compile(document, block.primitives), multiply(matrix, blockMatrix(p, { x: 0, y: 0 })), paint, false, [...stack, block.id]);
          continue;
        }
        set(matrix); ctx.globalAlpha = 1; ctx.fillStyle = paint.stroke; ctx.strokeStyle = paint.stroke;
        if (command.kind === 'text' && p.kind === 'text') {
          ctx.translate(p.position.x, p.position.y); ctx.rotate(p.rotationDeg * Math.PI / 180); ctx.scale(1, -1);
          ctx.font = `${p.height}px sans-serif`; ctx.textBaseline = 'alphabetic';
          p.content.split('\n').forEach((line, i) => ctx.fillText(line, 0, i * p.height * 1.2));
          currentMatrix=null;
        } else if (command.kind === 'path') {
          if (command.fill) { ctx.globalAlpha = p.fillOpacity ?? 1; ctx.fill(command.path, 'evenodd'); ctx.globalAlpha = 1; }
          const sx = Math.hypot(matrix[0], matrix[1]), sy = Math.hypot(matrix[2], matrix[3]);
          const dash = paint.dash?.split(/[ ,]+/).map(Number).filter(n => Number.isFinite(n) && n >= 0) ?? [];
          if (Math.abs(sx - sy) > Math.max(sx, sy) * 1e-8 || Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) > sx * sy * 1e-8) {
            // Nonuniform INSERT: stroke in CSS pixels, exactly like SVG non-scaling-stroke.
            // Only the affine projection is transient; canonical paths remain compiled and shared.
            const projected = new Path2D(); projected.addPath(command.path, new DOMMatrix([...matrix]));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0); currentMatrix=null; ctx.lineWidth = paint.lineWeight; ctx.setLineDash(dash); ctx.stroke(projected);
          } else { ctx.lineWidth = paint.lineWeight / sx; ctx.setLineDash(dash.map(n => n / sx)); ctx.stroke(command.path); }
        }
      }
    };
    for (const item of items) {
      const e = item.entity, box = ownerBounds(document, e);
      if (!box || !intersects(box, visible)) { metrics.culledOwners++; continue; }
      this.drawn.add(e.id); metrics.drawnOwners++;
      const paint: Paint = { stroke: item.style.stroke, lineWeight: item.style.lineWeight, dash: item.style.dash };
      if (e.type === 'block_instance') {
        const block = blockDefinition(document, e.blockDefinitionId); if (!block) continue;
        const matrix = blockMatrix(e, block.basePoint), anchor = canvasTransform(view, size, vectorRenderOrigin(document, e));
        drawList(this.compile(document, block.primitives), multiply(anchor, [...matrix.slice(0, 4), 0, 0] as unknown as Matrix), paint, false, [block.id]);
        if (e.attributePrimitives?.length) { const list = this.compile(document, e.attributePrimitives),attribute=blockAttributeMatrix(e,block),worldOrigin=transformPoint(list.origin,attribute),anchor=canvasTransform(view,size,worldOrigin),linear:Matrix=[attribute[0],attribute[1],attribute[2],attribute[3],0,0];drawList(list,multiply(anchor,linear),paint,true,[]); }
      } else if (e.type === 'imported_graphic') {
        const list = this.compile(document, e.primitives); drawList(list, canvasTransform(view, size, vectorRenderOrigin(document, e)), paint, true, []);
      } else {
        const list = this.nativeList(document, e);
        // Native polygons use their existing layer fill; imported DXF styles usually have fill=none.
        if (e.type === 'polygon' && item.style.fill !== 'none') for (const c of list.commands) if (c.kind === 'path') { set(canvasTransform(view, size, list.origin)); ctx.fillStyle = item.style.fill; ctx.fill(c.path); }
        drawList(list, canvasTransform(view, size, list.origin), paint, true, []);
      }
    }
    const ms = performance.now() - start; metrics.draws++; metrics.drawMs += ms; metrics.frames.push(ms);
    if (metrics.frames.length > 512) metrics.frames.shift();
    if (import.meta.env.DEV) this.canvas.dataset.drawnOwners = JSON.stringify([...this.drawn]);
  }
}
