import type { Viewport } from '../domain/model';
import { screenToWorld, worldToScreen, type ViewSize } from '../geometry';
import type { RenderCamera } from '../view/projection';
import type { DxfViewport } from './types';
/** Full-canvas camera for one source viewport, rebased at the paper camera center. */
export function modelViewportCamera(vp: DxfViewport, paper: Viewport, size?: ViewSize): RenderCamera { const a = vp.twist * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), x = (paper.center.x - vp.centerPaper.x) / vp.scale, y = (paper.center.y - vp.centerPaper.y) / vp.scale; return { center: { x: vp.modelCenter.x + x * c + y * s, y: vp.modelCenter.y - x * s + y * c }, pixelsPerUnit: paper.pixelsPerUnit * vp.scale, rotationDeg: vp.twist, ...(size ? { screenClip: viewportScreenRect(vp, paper, size) } : {}) }; }
export function viewportScreenRect(vp: DxfViewport, paper: Viewport, size: ViewSize) { const p = worldToScreen({ x: vp.centerPaper.x - vp.sizePaper.width / 2, y: vp.centerPaper.y + vp.sizePaper.height / 2 }, paper, size); return { x: p.x, y: p.y, width: vp.sizePaper.width * paper.pixelsPerUnit, height: vp.sizePaper.height * paper.pixelsPerUnit }; }
export const pointerModel = (p: {
    x: number;
    y: number;
}, vp: DxfViewport, paper: Viewport, size: ViewSize) => screenToWorld(p, modelViewportCamera(vp, paper), size);
/** Temporary MODEL navigation leaves the imported viewport and the sheet camera intact. */
export interface ViewportNavigation {
    viewportId: string;
    modelCenter: {
        x: number;
        y: number;
    };
    scale: number;
}
const navigationViews = new WeakMap<DxfViewport, WeakMap<ViewportNavigation, DxfViewport>>();
export function navigationViewport(vp: DxfViewport, context: {
    viewportEditing?: boolean;
    viewportNavigation?: ViewportNavigation | null;
}) { const n = context.viewportNavigation; if (!context.viewportEditing || !n || n.viewportId !== vp.id)
    return vp; let cache = navigationViews.get(vp); if (!cache) {
    cache = new WeakMap();
    navigationViews.set(vp, cache);
} let result = cache.get(n); if (!result) {
    result = { ...vp, modelCenter: n.modelCenter, scale: n.scale, viewHeight: vp.sizePaper.height / n.scale };
    cache.set(n, result);
} return result; }
export function navigationFromCamera(vp: DxfViewport, camera: RenderCamera, paper: Viewport): ViewportNavigation { const scale = camera.pixelsPerUnit / paper.pixelsPerUnit, a = vp.twist * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), x = (paper.center.x - vp.centerPaper.x) / scale, y = (paper.center.y - vp.centerPaper.y) / scale; return { viewportId: vp.id, scale, modelCenter: { x: camera.center.x - x * c - y * s, y: camera.center.y + x * s - y * c } }; }
