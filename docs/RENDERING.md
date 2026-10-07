# Hybrid renderer

GeoDocument schema v2, canonical MODEL coordinates, ownership, provenance and portable JSON are unchanged. Rendering is a disposable presentation representation. There are no CanvasEntity/CanvasBlock records, flattened canonical instances, raster documents or provider operations.

## Composition

`renderItems` resolves visible owners in the existing layer order and puts text/labels last within each layer. `composeScene` partitions that exact sequence into consecutive Canvas/SVG runs. Imported DXF LINE, Polyline/Polygon, TEXT/MTEXT, Arc/Circle, BlockInstance and ImportedGraphic use Canvas. Native editable entities, dimensions, points and symbols retain SVG. Imported points also retain the existing SVG marker/label UI.

Each Canvas run is one stable HTML canvas in an SVG `foreignObject`, spanning the viewport, with transparent pixels and `pointer-events: none`. Native SVG runs between canvases preserve the exact mixed paint order, including within-layer order. This avoids the incorrect alternative of always putting imported blocks behind native geometry. The reference's 127 layers produce **one** canvas, not one canvas per layer.

At most eight Canvas runs are materialized. If a mixed document exceeds this budget, the **whole base scene falls back to SVG**, retaining order. The renderer never groups nonconsecutive owners to force a lower canvas count. The budget also limits full-viewport backing-store memory; it is a correctness-preserving performance fallback, not a layer-semantic exception.

Grid precedes the scene. AI previews precede the Canvas owner/deep-selection overlays; transient construction, snap and cursor UI remain lightweight SVG/HTML. Selected native geometry keeps its existing editable SVG grips. Canvas owners get an independent visible-primitive contour/glyph halo; native imported types also retain selected SVG editing grips. Complex SVG fallback owners share the same single contour Canvas instead of allocating an image surface per owner or drawing individual bounds rectangles. Selecting an INSERT inside a block highlights its bounds; selecting a leaf highlights only that primitive, never materializes the complete library. No hidden bulk SVG hit rectangles or complete inactive renderer tree remain.

Canvas is the default. Development builds provide `DXF renderer` and `?dxfRenderer=svg|canvas` for A/B on the same loaded document/camera. The control and URL override are absent in production. Switching removes the inactive base renderer; native SVG and the selected leaf overlay remain intentionally available.

## Renderer service, camera and DPR

`CanvasStratum` owns a stable canvas/ref and the lifecycle of `CanvasSceneRenderer`; drawing code is outside React. Camera/document updates replace the service's pending input. One requestAnimationFrame coalesces them into at most one draw per canvas per frame. Dispose cancels pending work.

Canvas and SVG use the same `Viewport`, `ViewSize`, worldToScreen/screenToWorld and MODEL coordinates. The device matrix for small origin-relative coordinates is:

```
[ z*dpr, 0, 0, -z*dpr,
  ((origin.x-center.x)*z + width/2)*dpr,
  ((center.y-origin.y)*z + height/2)*dpr ]
```

CSS dimensions remain in CSS pixels; backing dimensions are rounded CSS width/height × DPR. Resize also detects monitor/DPR changes. Prepared block/proxy geometry is centered around cached local origins. Nested matrices already account for original INSERT/base points. The camera subtracts world origins **before** scaling; it does not multiply million-scale canonical coordinates and cancel huge SVG translations. Consecutive commands reuse their current transform; text and nonuniform strokes restore the pass matrix explicitly.

Top-level culling intersects cached owner WORLD bounds with a fresh camera-derived world viewport plus a small screen-space safety margin. Bounds and prepared geometry do not depend on the current camera. Internal visible block commands are directly drawn, without per-frame recursive bounds rebuilding. The giant reference block benefits from cached spatial bounds for **interaction**; rendering does not add an expensive internal culling pass. Text extents remain the existing approximate fallback-font bounds.

## Immutable blocks and paths

`prepareVectorSet` is shared with SVG. Weak library/primitive keys and descendant definition identities reuse preparation across camera, selection, instance movement and unrelated library revisions. A replaced descendant invalidates its ancestors; unrelated prepared sets survive. Canonical primitives/base points are never edited.

Each active Canvas service weakly caches a local draw list by prepared primitive array. Path2D stores LINE/polyline/polygon/arc/circle geometry. Consecutive compatible unfilled strokes share a style bucket; ordering across fills, text and nested references is retained. Nested commands reference cached child definitions and compose affine matrices, guarded by the existing cycle/depth budget. Unreachable definitions are not compiled. Native imported paths compare their actual vertex references, not the entire vertex-registry identity.

Draw lists preserve text as strings/position/rotation/height. TEXT/MTEXT use safe sans-serif fallback, alphabetic baseline and the SVG-equivalent local Y inversion; multiline spacing is 1.2 × height. External DXF fonts, rich MTEXT formatting and exact original font metrics remain unsupported. Solid HATCH contours form one visible compound path with even/odd holes; visibility revisions cache the compound path and its first visible contour's paint, matching SVG. Complex patterns retain the importer's existing simplified representation. MULTILEADER line/arrow/text and anonymous DXF dimension proxies remain composite owners; semantic metadata is unchanged.

`createVectorStyleResolver` is shared by SVG and Canvas for layer-0 inheritance, BYLAYER/BYBLOCK/explicit color, visibility, width and dash. Fill opacity remains per primitive. Stroke width/dashes retain screen-space semantics. Uniform transforms compensate width/dash by scale; nonuniform/sheared INSERTs stroke an affine projection in CSS pixels, like non-scaling-stroke. Those projections are transient Path2D objects; canonical paths are compiled once. There is no offscreen bitmap/tile cache and no bitmap zoom.

## Renderer-independent interaction

The path for normal selection and hover is screen→world→immutable owner BVH→primitive BVH→geometric hit. Definition primitive indices are built lazily and reused by normal/Alt queries. Bounds provide candidates only: a large empty INSERT bounding box does not select the block. Line segment, circle, arc-sweep, rotated text bounds and solid-fill even/odd tests decide actual hits. Native SVG annotations keep screen-space hit areas using the **current** zoom; dimension lines/extensions and text use their derived geometry. Source vectors retain the smaller painted-stroke tolerance, and native paths retain their 14px hit bands, allowing marquee to begin between dense block lines.

Deterministic foreground ordering and the existing background-HATCH priority are shared by both modes. Explicit Alt/Option builds/cycles the same owner/nested path stack; blockPath/primitivePath and provenance remain canonical. Nested content stays read-only. Native SVG handles are UI affordances and keep priority. Selected vector owner bound areas retain the existing Move-body fallback through a world-bounds test; they are not unselected bulk hit surfaces. No Canvas-pixel hit testing is used.

WINDOW/CROSSING marquee, snapping, layer/selection Fit, Move resolution and MODEL/SURVEY transforms still use existing domain/world geometry. Canvas receives the existing transient `selectionMove.previewDocument` (or native transaction projection), so it shows motion before commit without mutating or autosaving the committed document. Block translation reuses definition Path2D/draw lists. Imported native paths whose vertices change recompile only changed owner geometry; a massive mixed selection can still create many short-lived path revisions.

## Invalidation

| Change | Base Canvas | Geometry preparation/Path2D | SVG interaction |
| --- | --- | --- | --- |
| Pan/zoom/size/DPR | Coalesced redraw | Reused | Camera projection |
| Owner/vertex geometry | Redraw current projection | Changed owners/dependencies | Current selected geometry/grips |
| Styles/layer visibility/order | Redraw / repartition if necessary | Paths retained; visible HATCH compound cache follows layer revision | Native layer paint / overlays |
| Ordinary/deep selection | No redraw | Reused | Selected owners/leaf only |
| Hover/cursor | No redraw | Reused | Cursor/readout only |
| Transient Move | Redraw preview | Block definitions reused; changed native paths update | Bounds/grips follow preview |
| Switch renderer | Dispose/remove inactive base | Active Canvas service builds its own paths | Native/selected UI retained |

Document identity is the service input revision; metadata-only document edits may cause an unnecessary redraw, but do not rebuild geometry. Lock-only layer edits likewise redraw. This conservative invalidation favors correctness. Selection and hover carry no base-document changes. Sidebar memoization and Worker/IndexedDB latest-revision-wins preparation remain unchanged.

## Verification and profiling

`hybrid-renderer.test.ts` covers camera/DPR, nested base-point/negative/nonuniform transforms, arcs/circles, paint, mixed strata/fallback, visibility, culling, text Y inversion, geometric owner/deep hits, caches, rAF, transient Move and projected coordinates. Canvas E2E asserts that bulk SVG is absent, verifies selection/Alt/hover/marquee/Relative and Absolute Move/Undo, native text edit, proxy paint/inspection, layers/Fit, JSON and IndexedDB reload, DPR 1/2 and 63/100 px/m. Existing SVG-specific DXF tests explicitly exercise the dev SVG fallback; native editor/AI/persistence tests run with the default hybrid renderer.

Local opt-in reference acceptance:

The source DXF is not committed. Raw A/B measurements and reference acceptance are in `docs/audit-results`. Both modes use the same reference, Chrome headless, 1440×900, semantic hit probes, event sequence and instrumentation. Stage latency includes Playwright delivery and two rAFs; it is **not** pure handler time or FPS. rAF interval, CDP script/layout/style/paint, React actualDuration and Canvas draw are collected separately. React render and Canvas draw are subsets of script time and must not be added again. Development instrumentation and host load affect numbers; no CI timing threshold is imposed.

Memory is approximate post-GC CDP JS heap plus exact RGBA backing pixel bytes and DOM node count. Browser-native Path2D/GPU allocations are not individually measurable here. Canvas diagnostics retain only bounded numeric timing history; compilation/path counters are lifetime allocations, **not live cache size**, especially after multiselection previews. Only the active full presentation is materialized. Shared prepared vector coordinates and semantic BVHs are renderer-neutral, and canonical Undo snapshots remain managed by the editor.

See [DXF_UX_PERFORMANCE](DXF_UX_PERFORMANCE.md#hybrid-canvas-renderer) for measured results and remaining costs. Export/printing, block editing, WebGL/WebGPU, tiles and AI document operations are outside this slice.

## Axonometric View V1

Plan rendering remains unchanged. RenderCamera optionally selects a parallel XYZ projection shared by native SVG and DXF Canvas. Axon uses camera-independent MODEL 3D bounds → orientation owner bounds/BVH → current camera culling. Shared block primitives retain nested XY/basePoint/Z scale transforms; derived orientation Path2D are separate caches. Text faces screen; curves become projected paths, Symbols stay flat XY glyphs. Stable layer/depth ordering is approximate, Canvas base below native overlay; selected content is last. No giant DXF SVG fallback in Axon. [Policy and measured evidence](AXONOMETRIC_VIEW.md).

## Viewing strata

Selection contours render on an independent transparent Canvas using the shared visible MODEL primitive traversal; no base Canvas recoloring/recompilation. Simple imported native geometry retains editing grips. Paper layouts use clipped, rotated Canvas/SVG MODEL passes per viewport and a separate paper Canvas, without a giant DXF SVG tree. Raster images form a dedicated background stratum, sorted by layer inside that stratum, and project affinely at Z=0 in Axon. See [DXF_LAYOUTS](DXF_LAYOUTS.md) / [RASTER_UNDERLAYS](RASTER_UNDERLAYS.md).

### Viewing UX reference measurements (Chrome, 1440×900)

127-layer pure filters take 0.04–0.11 ms in the reference audit. UI search takes 197.9–271.2 ms including the 150 ms debounce and explicit 180 ms test wait. Panel hide-empty is 104.6 ms (23 remaining rows), selected isolation/exit 83.3/100 ms, hide/show all 384.6/333.4 ms. Model→Layout is 136.3 ms, Layout→Layout 99.9 ms, active viewport switch 50 ms. These UI measurements include Playwright overhead and two animation frames.

4K/8K synthetic PNG (4096×2048 / 8192×4096) import is 248.4/332.4 ms; pan is 65.1/48.5 ms and zoom 78.8/79.6 ms. Importing an image leaves base CAD compilation and draw counters unchanged: raster entities belong only to the background stratum, with no empty SVG stratum/duplicate selection marker. Decoded bitmaps are shared and released on final unmount; camera updates draw from the cache, and selection alone does not rerender unchanged raster components. Browser/source complexity and image codec/quota constraints still matter.

## Transform, style and navigation polish

Sparse style intent uses shared native/primitive precedence in Plan Canvas/SVG, Paper Space and Axon. Display widths/dash patterns are CSS px. Layer style changes preserve entity/definition geometry; rotation retains shared BlockDefinitions. Rotation previews are independent snapshots and leave committed autosave untouched. See [STYLES](STYLES.md) and [TRANSFORMS](TRANSFORMS.md).

## Working orientation and sheet reuse

All Plan camera paths subtract a stable origin before rotation. Canvas affine matrices, vector SVG groups, native primitives, raster corners, grid and selection contours use the same camera angle/inverse. Screen clips feed conservative four-corner MODEL culling. Plan Fit/selection Fit preserve the working angle; Axon and Paper presentation remain independent.

Supported Paper windows use a complete cached presentation surface during ordinary sheet motion, refresh at resting resolution, and switch to bounded vector rendering above 2048 CSS px per side. Definition/Path2D/native draw-list caches are weak and shared across viewport renderers; no canonical flattening or cloned MODEL owners are introduced. Layer/global/VP-freeze changes invalidate view masks independently. Selection overlay backing stores are resized only when their actual CSS/device dimensions change and explicitly cleared between draws. Transient MODEL drag prioritizes the active window; commit/Undo updates all windows.

The final paired Paper289 trace and limitations are recorded in [DXF_UX_PERFORMANCE](DXF_UX_PERFORMANCE.md#editor--dxf-view-hardening-2026-10-06): 659 → 195 Canvas draws, 432.700 → 78.100 ms total draw work, p95 5.600 → 0.600 ms, long tasks 1 → 0. React scheduling and paint did not improve in that run, so the result is not a general FPS claim. Table indices reuse immutable geometry across layer presentation changes; renamed layers or changed geometry invalidate them.
