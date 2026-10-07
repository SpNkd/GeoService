# Image / photo / scan → editable scheme V1

Current reconstruction/deskew supersedes the original extraction description below: [Geometry reconstruction](GEOMETRY_RECONSTRUCTION.md). PDF routing: [PDF import](PDF_IMPORT.md). Unified persistent configuration: [Settings / preferences](SETTINGS_PREFERENCES.md). Historical measurements remain evidence of their own earlier slice.
## User workflow

1. In MODEL Plan, choose **Файл / данные → Подложка** and import PNG, JPEG or static WebP. Import uses the existing local AssetRegistry and is a separate existing Undo boundary.
2. Choose **Файл / данные → Векторизация изображения**. The selected RasterUnderlay is preferred; otherwise choose an existing image in stage 1. If there is no image, the dialog directs back to the standard underlay import.
3. **Перспектива**: drag numbered TL/TR/BR/BL handles clockwise, use arrow keys on a handle, or enter source pixel coordinates. Reset restores the full source rectangle. The corrected preview updates at bounded resolution after an 80 ms debounce. Apply correction advances the workflow; it does not yet change the document. For a photograph, enter a known drawing width/height ratio when available: four corners alone cannot determine the physical aspect ratio.
4. **Масштаб**: pick A, then B on the corrected image and enter their real distance in metres. Image distance, metres per pixel and resulting dimensions are displayed. Reset/redo or enter metres per pixel manually. MODEL centre and rotation reuse underlay placement semantics.
5. **Извлечение**: choose detail, noise removal and endpoint joining, then start the local job. Named stages and Cancel are available. Escape cancels a running extraction first; a subsequent Escape closes the workflow.
6. **Проверка**: inspect overlays, hover/focus/select a candidate, exclude/restore it, show/hide and accept/exclude categories, select/clear all geometry, adjust raster opacity and compare image only versus overlay. Line patterns, category labels, counts, hover and selection strokes supplement colour. Text regions now support local OCR and confirmed library symbols in [Image Understanding V2](IMAGE_UNDERSTANDING_V2.md).
7. Choose the current/another visible unlocked layer or **Создать: Векторизация изображения**, then **Применить геометрию**. Native entities appear in the existing editor. One Undo removes the whole result/new layer and restores prior underlay settings; the raster entity itself remains.

The dialog uses the shared [Dialog primitive and contract](DIALOG_SYSTEM.md). The canonical editor is inert while the modal is active. Text/numeric fields retain text keyboard semantics; after closing, focus returns to the opener (or its visible menu summary); canvas interaction restores the editor context. There are no alternate document, drawing tools or miniature editable canvas in the workflow; the image view is a transient calibration/review surface.

## Architecture and ownership

`src/image/types.ts` defines transient candidates: line, connected polyline, closed contour, circle, text region and a future symbol-region hook. V2 attaches local recognizedText/confidence and proposed library matches with explicit confirmation; V1 extraction itself fabricates none. V1 returns no semantic symbol match, fabricated text or engineering ConnectorEntity.

`src/image/transform.ts` owns pure perspective/calibration/coordinate functions. `extract.ts` is the focused local algorithm without runtime dependencies. `client.ts` bounds preparation and owns a Worker per job; `worker.ts` rectifies, extracts, cleans and maps candidates. Cancellation terminates the Worker immediately. Error, message-error, creation/allocation failures and a 60-second timeout terminate it too. No fallback to a remote provider exists.

`ImageVectorizationDialog` owns temporary configuration, candidates and review choices. Before Apply, no candidate geometry, perspective, placement or calibration is written into GeoDocument. Cancel discards them. Document identity, source underlay identity/locks and layer eligibility guard Apply; the existing `execute-batch` reducer is the canonical mutation/history boundary.

RasterUnderlay adds optional `imageCalibration`: original-pixel quad, logical corrected dimensions and optional A/B/reference length. Original `assetId`/Blob remain unchanged. No new asset store and no full-resolution corrected asset are created. Relinking a different asset clears incompatible calibration. The existing raster renderer derives a bounded corrected bitmap locally from these persisted parameters. It releases that bitmap when invalidated/unmounted and never reuses a closed bitmap after Undo/Redo.

Result entities carry optional `imageSource` metadata (`source: image-vectorization`, sourceAssetId, vectorizationRunId, candidateType, optional shape confidence). This distinct field keeps DXF-only source indexes/types intact. Properties exposes it under collapsed **Источник**. Geometry has no dependency on the original asset or transient candidates; moving/deleting the raster later cannot change the vector result.

## Perspective and coordinates

Coordinates are pixel boundaries with x right/y down. Corners are TL/TR/BR/BL clockwise. Validation rejects nonfinite/out-of-bounds points, sides under 2 px, crossed/mirrored/nonconvex or nearly zero-area quadrilaterals. Eight projective point-correspondence equations are solved by pivoted Gaussian elimination. The Worker samples with the inverse homography at output pixel centres using bilinear interpolation.

Default corrected width/height are the mean lengths of opposite source edges. A known aspect ratio overrides corrected height. This is an estimate until the user supplies the physical ratio; a single distance calibration cannot repair an incorrect aspect ratio in both axes.

The exact chain is:

`original pixels → bounded source pixels → inverse projective sampling → analysis pixels → logical corrected pixels → centred underlay-local metres (Y inverted) → underlay rotation → MODEL translation`.

For reference pixels A/B, `metresPerPixel = enteredMetres / hypot(B−A)`. Zero image distance, nonpositive/nonfinite real length and invalid placement are rejected. `localX=(px/rectifiedWidth−0.5)*underlayWidth`, `localY=(0.5−py/rectifiedHeight)*underlayHeight`. MODEL coordinates then use the existing planar underlay rotation formula. Calibration does not change existing unrelated geometry, document frame, SURVEY horizontal controls or vertical reference. Raster alignment is independent of survey georeferencing.

## Actual extraction and cleanup

1. Composite alpha on white and compute luminance.
2. Otsu histogram threshold, conservatively constrained to luminance 60–200. A dominant dark area is rejected with a light-background-drawing explanation.
3. Eight-connected components remove tiny/short noise using the selected noise level. Compact similarly sized components in aligned rows form heuristic text regions; their pixels are withheld from geometry. This is region detection, not OCR.
4. Bounded Zhang–Suen thinning (up to 40 iterations) extracts stroke skeletons.
5. Trace skeleton adjacency into paths, splitting at degree changes; orthogonal corner triangle shortcuts are suppressed while true diagonal strokes are retained. Remaining cycles become closed paths.
6. On original cycle samples, fit a least-squares circle. Require at least 20 samples, radius ≥6 analysis px, radial RMS ≤max(0.65 px, 2.5% radius) and at least 15/16 angular bins. Partial arcs and irregular loops remain paths; no invented circles.
7. Iterative Ramer–Douglas–Peucker simplification uses 2.5/1.3/0.65 analysis-pixel tolerances. Remove short paths, very small closed areas, identical/reversed paths. Optional deterministic endpoint joining connects gaps ≤2.8 analysis px while retaining ambiguous junctions; almost-closed chains can become contours. It is not a general geometric union/overlap solver.
8. Restore logical corrected pixel scale. Circles map to native Circle when MODEL scaling is isotropic; an anisotropic placement uses a 64-point native Polygon rather than claiming an exact Circle. Lines/Polyline/Polygon use deduplicated shared vertices within the accepted batch. All participate in normal selection, vertex/midpoint snapping, Move/Rotate, styles, Save/Open, IndexedDB and Undo/Redo.

Analysis and tolerances operate in the bounded image and are mapped back continuously; they are not arbitrary fixed MODEL-metre thresholds. At 8K, one analysis pixel represents multiple source pixels, so subpixel CAD accuracy is not promised. Work is capped at 20,000 components/fragments and 5,000 final candidates with explicit errors rather than silent truncation.

## Deterministic fixtures

`src/tests/fixtures/imagePlan.ts` generates original synthetic data; no third-party drawings are committed. The deterministic default-medium extraction result is:

| Fixture | Lines | Polylines | Closed contours | Circles | Text regions |
|---|---:|---:|---:|---:|---:|
| Clean rectangle/line plan | 2 | 1 | 1 | 0 | 0 |
| Rotated/scaled plan | 2 | 1 | 1 | 0 | 0 |
| Perspective-skewed, corrected to known ratio | 2 | 1 | 1 | 0 | 0 |
| Noisy scan, medium cleanup | 1 | 2 | 1 | 0 | 0 |
| Circle plus clean plan | 2 | 1 | 1 | 1 | 0 |
| Text-like glyph row | 0 | 0 | 0 | 0 | 1 |

These are fixture results, not an accuracy claim for arbitrary scans. In the noisy fixture a noise fragment changes path topology; stronger cleanup reduces spurious results, but manual review remains necessary.

## Privacy and AI preparation

**Обработка выполняется локально.** Image import, rectification, extraction, preview and Apply send no image bytes to any endpoint. Image modules have no provider/network dependency. Worker URLs are local application code. E2E and browser benchmarks record zero external requests and zero `/api/ai/intent` calls during local vectorization.

The separate existing AI panel adds enabled/provider/key/primary/fallback/Test connection settings. A typed key lives in session memory only, never localStorage/sessionStorage, document JSON, IndexedDB document or Git. Leaving the key empty uses the ignored existing server configuration. Explicit Test connection sends only a small test prompt through the same text-only HttpAiIntentProvider, creates no geometry and reports actual success/failure; default “готов” does not claim verified online. OpenRouter uses its existing fallback/routing abstraction. OpenAI retains its existing single-model transport. Mock is an explicit demonstration choice, never a real-provider fallback. The main dev-server remains REAL OpenRouter.

Runtime choices use validated same-origin request headers; backend response/diagnostic/log redaction includes the supplied key. The request body remains strict `{text}`. Privacy mode defaults to prompt only. Semantic Assist and image analysis remain visibly disabled extension points; there is no vision upload, external OCR, analytics or third-party CV.

## Performance and memory

Measured medians, milliseconds (three runs per size; clean synthetic strokes):

| Source | Decode | Preparation | Rectification | Detection | Cleanup | Candidate mapping | Preview paint | Apply | Worker wall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1920×1080 | 3.7 | 4.2 | 52.1 | 155.2 | 2.3 | <0.1 | 16.1 | 1.2 | 223.4 |
| 3840×2160 | 8.9 | 4.7 | 37.5 | 724.0 | 1.7 | 0.1 | 15.5 | 0.6 | 769.8 |
| 7680×4320 | 47.7 | 5.0 | 36.5 | 829.6 | 2.4 | 0.1 | 7.9 | 1.0 | 878.8 |

All nine measured runs produced four native entities: one Line, one Polyline, one Polygon and one Circle. Main-thread long-task count was zero. Results are not monotonic by source resolution: all use the same bounded analysis size, while resampling changes stroke thickness/topology and skeleton iteration cost. Browser/process scheduling also varies.

Original decoded bitmap memory remains proportional to source size through AssetRegistry. An 8K 7680×4320 RGBA image is approximately 126.6 MiB; 4K is 31.6 MiB. No additional full-resolution rectified bitmap is retained. At 1200×675 each RGBA work buffer is 3.09 MiB (worst square 1200×1200: 5.49 MiB). The workflow keeps a bounded source preview and bounded result; a job receives one transferred copy and emits one transferred result. Threshold/visited/adjacency masks and a component stack are bounded; component pixel lists are discarded before skeleton tracing. Renderer canvases and ImageBitmaps are native memory and are not included in JS heap telemetry. Peak native/browser memory is estimated, not directly measured: for the 8K benchmark source plus bounded buffers/masks/stack is about 150–175 MiB before editor canvas/backing/compositor overhead. Extremely dense images can add JS component/path allocation within the explicit caps; allocation/crash errors remain cancellable.

Worker termination drops temporary buffers. Preview canvases zero their dimensions on cleanup; AssetRegistry retain/release remains unchanged. Persisted metadata is small; raw candidates, masks and pixel arrays are not canonical or autosaved.

## Verification and limits

Final: typecheck/lint/build pass; 1061 unit passed / 75 opt-in skipped; 226 reference E2E passed / 3 opt-in skipped. After the final small changes, 24 affected image/focus E2E passed / 1 reference-only skipped (covered by the full run). Audit reports zero vulnerabilities. No new dependencies. Main JS is 836.03 kB / 249.81 kB gzip (+12.80 / +4.23 kB versus baseline); the lazy image dialog is 23.47 kB / 7.93 kB gzip, its CSS 4.35 kB, and the local image Worker 10.81 kB. The existing main-chunk warning remains.

Limitations: best suited to dark line drawings on a light background; arbitrary photos, shadows, coloured fills, thick filled regions, dashed engineering lines and dense junctions can need manual cleanup or give poor results. Perspective needs manual corners and a known aspect ratio for reliable metric shape. No OCR, general symbol recognition, engineering connectivity, connectors, remote vision, two-point MODEL snapping alignment, interactive candidate-merge editor or raster editing. A missing source asset still uses the existing relink/placeholder workflow; JSON is not a portable image bundle. Current V1 supports local Workers in modern browsers and does not introduce WASM/OpenCV/OCR dependencies.

Recommended V2: bounded adaptive lighting/threshold experiments with real authorised scans, better junction/duplicate-overlap cleanup, controlled local OCR module and user-confirmed Symbol Library mapping. Any remote image analysis must remain a separate explicit opt-in action with disclosure; do not start it as part of V1.

## V2 extension

[Image Understanding V2](IMAGE_UNDERSTANDING_V2.md) adds bounded crop OCR, adaptive lighting, clustered geometric junctions and conservative repeated library matching. The extraction/Worker/calibration/native Apply boundaries remain. Global Otsu remains the default. Short-gap joining now requires compatible tangents; nearby ambiguous corners stay separate. Text and Symbol conversion require explicit review.

V2 Apply leaves the source RasterUnderlay unchanged. Perspective/scale/placement transform only the accepted native result; unlike historical V1, these reviewed settings are not persisted on the source. One Undo removes the result and keeps the source intact.
