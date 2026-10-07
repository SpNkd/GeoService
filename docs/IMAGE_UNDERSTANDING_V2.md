# Image Understanding V2

Current reconstruction/deskew supersedes the original extraction description below: [Geometry reconstruction](GEOMETRY_RECONSTRUCTION.md). PDF routing: [PDF import](PDF_IMPORT.md). Unified persistent configuration: [Settings / preferences](SETTINGS_PREFERENCES.md). Historical measurements remain evidence of their own earlier slice.
Extends Image Vectorization V1 and Semantic Learning V1. Recognition is local; candidates remain transient until an explicit atomic Apply. V3 topology is available as a separate local, explicit review → Apply workflow: [Topology reconstruction](TOPOLOGY_RECONSTRUCTION.md).

## Workflow

Import PNG/JPEG/static WebP through the existing AssetRegistry → **Файл / данные → Векторизация изображения** → V1 perspective/physical scale/placement → extraction → **Распознать текст и символы** → Geometry/Text/Symbols/Semantics review. The shared [Dialog contract](DIALOG_SYSTEM.md) applies to the entire workflow.

Preview width and aspect ratio jointly bound height without stretching raster coordinates; the SVG and raster retain the same transform, including portrait sources and fitted crops. Rows and raster overlays share selection; selecting an overlay reveals its review row. Fit focuses a candidate crop without changing GeoDocument. Geometry can be included individually or by category. OCR text can be corrected and orientation adjusted; confirmation is always explicit, even above the review threshold. “Подтвердить читаемый текст” only offers nonempty results with engine confidence ≥80/100. This is an engine heuristic, not a correctness guarantee. Lower/failed results can be manually entered and confirmed.

Symbol groups show possible/strong/no reliable match, occurrence count and understandable evidence. Confirm a group, inspect individual exceptions, reject back to source geometry, or explicitly assign an existing library entry. Confirmed symbols replace only accepted geometric candidates fully inside their bounds; rejected instances restore those choices. No new permanent library is authored. Changing text/orientation/library invalidates its prior acceptance. A fresh OCR job clears earlier text/confidence/acceptance so failed OCR cannot present old labels as a new result. Re-running recognition clears confirmations and restores geometric choices that earlier symbol confirmations replaced.

Semantic suggestions require an exact own-text/own-symbol-name match to an existing concept/alias. Category assignment is separate and explicit. “ГАЗ” near lines does not classify them as a pipeline. Applied owners can use the existing **Научить GeoService**, Search and AI local resolver; no parallel image knowledge store.

## Engine evaluation and dependency budget

Tesseract.js **6.0.1**, lockfile-resolved tesseract.js-core **6.1.2**, LSTM-only OCR; **rus+eng**, official `tessdata_fast` tag **4.1.0**, Apache-2.0. This supports required Russian/English/numeric labels with a maintained JS/WASM browser engine. Full npm core packages contain alternate legacy/ESM/SIMD engines; only two embedded-WASM LSTM JS runtimes are distributed. The Tesseract JS loader is statically bundled inside the lazy understanding Worker; a separate dynamic module import failed the strict offline Chrome smoke despite being precached. A newer v7 runtime was considered but had a larger package footprint; adopting the pinned v6 did not require another canvas/vision library.

Official architecture/options: [Tesseract.js local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md), [API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md), [fixed official language source](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0). License, source notice and the bundled worker’s third-party notices ship under `public/ocr`.

| Asset | Exact uncompressed file bytes |
| --- | ---: |
| runtime worker.min.js | 111,162 |
| tesseract-core-lstm.wasm.js (embedded WASM) | 3,954,181 |
| tesseract-core-simd-lstm.wasm.js (embedded WASM) | 3,954,569 |
| eng.traineddata.gz | 1,967,599 |
| rus.traineddata.gz | 1,599,713 |

Language gzip files decompress to 4,113,088 and 3,861,738 bytes. Both cores ship for browser compatibility; a recognition job selects one. Runtime URLs resolve within the application base path on the same origin, including Pages subdirectories. No CDN/remote OCR fallback exists. `server/localOcrAssets.ts` serves pinned installed runtimes in development and emits identical production files. The image dialog and recognition Worker/Tesseract loader are lazy; normal editor startup does not fetch OCR assets.

The production build emits a versioned allow-list Service Worker, registered only on the first recognition. It caches the app’s static JS/CSS, app shell and pinned OCR assets for subsequent offline recognition. GET-only allow-list excludes AI/API, image bytes, document data, OCR text and user uploads. Cache version derives from build asset filenames; old recognition caches are deleted on activation. Browsers that refuse Service Worker/cache storage retain local recognition while a local origin is reachable. Development HMR is intentionally not cached by this worker. Language data also uses Tesseract’s own local IndexedDB cache. The first production OCR precaches both cores, worker and languages (11,587,224 bytes) plus the app shell/static assets; one chosen core + worker + languages is 7,633,043 bytes with SIMD.

## Pipeline / threading / memory

`client.ts` / `worker.ts` retain bounded V1 extraction. `understanding.ts` is the typed local recognizer boundary; a future remote adapter would require a separate opt-in/privacy contract. No remote adapter exists. `understanding.worker.ts` performs grouping/matching and owns a child Tesseract Worker. Each job owns its workers; cancellation/error/watchdog terminates the parent and its owned child. Initialization failures have a bounded timeout; partial errors leave geometry and other recognition results intact.

Text regions → inverse homography to original pixel quad → bounded cropped `createImageBitmap` decode → local rectification → grayscale/alpha compositing, dominant-dark inversion, adaptive local mean threshold, padding, bounded upscale → single-line RU+EN OCR. Original-resolution bytes are only read for each region; the entire 8K image is not submitted to OCR. At most 40 regions are processed sequentially. Balanced uses one orientation; Accurate tests 0/−6/+6° deskew and retains the best engine score. Horizontal/vertical component groups initialize orientation; arbitrary orientation/page layout/handwriting remain outside guarantees.

Raw engine confidence is retained in transient examples; canonical provenance retains normalized confidence and original OCR text. User correction becomes normal TextEntity content/name, with MODEL position, physical height and rotation. Estimated bounding-box baseline/height need review; there is no claim of exact font metrics.

Analysis edge ≤1200 / 1.44M pixels. Crop decode ≤800k pixels, normalized OCR crop ≤1.5M pixels, one crop at a time; ImageBitmap closes and temporary canvases reset. A maximum-four-entry workflow cache keys asset/calibration/options/quality/region bounds and orientation. Failed recognition is not cached as success. Review choices do not mutate cached source results. Cache dies when workflow closes; no crops, descriptors or OCR cache enter GeoDocument. Native browser decode memory can exceed the bounded JS copy: 8K RGBA alone is ~126.6 MiB. Main JS heap telemetry excludes browser decoder/GPU/child WASM heaps and cannot certify total peak memory.

## Geometry / photo processing

V1 Otsu mode remains the default. **Фото / тени / слабый контраст** uses an integral-image local mean-minus-threshold mask, removing broad gradients while retaining dark local strokes. This is an analysis-only enhancement, preserving the source Blob. Severe blur, contrast loss, noisy patterned/color background, dense text touching lines and missing text regions still require manual review.

Skeleton junction clusters contract to shared centroid endpoints before tracing. T/X networks keep geometric branches/shared vertices, without engineering semantics. Short gaps only join when tangents agree and no competing junction exists. There is no general crossing/overlap union solver and no Connector inference.

## Symbol signatures / false positives

`symbolRecognition.ts` detects at most 300 compact connected ink regions (12–190 analysis px, bounded aspect/density). Text-contained components are excluded. Normalized 48×48 descriptors compare symmetric local stroke coverage, preserving aspect ratio. Repeated grouping tolerates quarter rotations and scale; no mirror equivalence. Disconnected or attached-to-network symbols may not be isolated in V2.

Templates are generated from existing vector definitions (line/polyline/polygon/rect/circle), never hand-embedded screenshots. Library matching searches 15° rotation increments, checks aspect ratio, symmetric stroke distance and the separation from the next distinct symbol. Strong/possible tiers are conservative engineering-neutral visual proposals. An ambiguous valve/safety-valve outline stays “possible”, even when visually clean. Unknown repeated square/cross fixtures have no reliable library claim. Each occurrence must match independently; a group’s known result does not promote a nonmatching exception.

Confirmed conversion uses canonical libraryId/symbolId/position/normalized MODEL rotation/uniform scale. Template bounds offsets account for definitions not centred on their geometry. Anisotropic scaling and invalid canonical scale fail atomically; no synthetic “ImageSymbol” entity exists.

## Apply / provenance / semantics / privacy

One `execute-batch` applies accepted native geometry, TextEntity and SymbolEntity, optional new layer and explicitly confirmed semantic annotations. Reviewed calibration/placement transforms only the new objects. Apply never updates the source RasterUnderlay or its asset ID/Blob; those settings remain transient and must be re-entered for another extraction. One Undo removes all results/categories/layer. Moving/deleting raster afterwards never moves these independent owners. Locks/stale document/view checks use existing command validation.

`imageSource` extends V1: image-ocr (source asset/run, confidence/originalText), image-symbol-match (asset/run/group/library/symbol/match class). Properties keeps metadata collapsed. Existing schema version 2, JSON/IndexedDB and canonical Search/Teach remain the persistence boundaries.

Default OpenRouter request remains `{text}` + server static schema/instructions. No image, crop, OCR text, geometry, category/rule, coordinates, candidate groups or owner IDs are automatically sent. Network interception covers browser and nested Worker requests. AI tests intercept only the user-authored prompt and resolve learned categories locally. Server prompt/schema/provider code is unchanged; no REAL provider smoke is needed for this slice.

## Evidence / reproduction

- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run test:e2e`, `npm audit`.
- `node benchmarks/image-understanding.mjs`: actual local OCR 1080p/4K/8K, extraction/text/OCR/grouping/matching/semantic/preview/Apply, >50ms long tasks, memory estimates.
- `e2e/image-understanding.spec.ts`: OCR corrections/edit/Search/Undo/reload, group/instance confirmation, Move/Rotate, unknown/manual assignment, rotated/photo labels, failures/cancel/cache, Teach/Search/local AI and strict text-only payload.
- `e2e/dialog-system.spec.ts`: shared shell/focus/scroll/backdrop/nested Escape/mobile.

Known limits: component-based text regions miss dense/overlapping/short labels; no OCR precision guarantee, full-page layout or handwriting. 15° symbol orientation is approximate; attached/disconnected/blurred forms and near-identical library entries may remain unknown. There is no automatic network topology, Connector creation, mirrored-match claim, custom symbol authoring or remote vision. V3 may propose ports+line-network topology with explicit confirmation and error analysis; it is not started.

## Measured acceptance (Chrome, 2026-10-07)

Actual synthetic runs use six RU/EN labels or four vector-derived valve occurrences at each resolution; source fixture generation is excluded. Recognition is real local OCR, not a mock. All analyses were bounded to 1200×675 pixels. Timings are single-run measurements, not latency guarantees or an accuracy corpus.

| Source | Decode / prepare ms | Extraction ms | OCR ms | Grouping ms | Matching ms | Semantic ms | Preview ms | Apply ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OCR 1080p | 1.9 / 7.1 | 108.4 | 220.4 | 17.3 | 0.0 | 1.1 | 17.4 | 3.0 |
| OCR 4K | 8.9 / 3.3 | 138.5 | 213.7 | 16.9 | 0.0 | 1.0 | 9.1 | 0.7 |
| OCR 8K | 28.0 / 3.4 | 114.2 | 409.1 | 18.3 | 0.0 | 1.0 | 17.4 | 0.5 |
| Symbols 1080p | 1.8 / 2.7 | 123.1 | 0.0 | 19.6 | 43.4 | 2.4 | 15.1 | 2.0 |
| Symbols 4K | 6.9 / 3.1 | 120.3 | 0.0 | 18.9 | 43.3 | 2.2 | 9.6 | 0.8 |
| Symbols 8K | 27.9 / 3.4 | 190.3 | 0.0 | 19.0 | 43.8 | 2.4 | 2.1 | 1.0 |

Text-region detection was 0.1–0.3ms within extraction. Benchmark preview measures a bounded raster canvas/frame (not the complete React review); Apply measures canonical command execution, with all explicit confirmations simulated. UI replacement of symbol source geometry is covered separately by E2E. Every symbol run found four occurrences across two rotations/scales; proposals remain possible, not automatic conversions. No main-thread tasks >50ms occurred in these six measured job intervals. Observed main JS heap was 23.7–42.5 MiB, excluding native decoder/AssetRegistry bitmaps/child OCR WASM; this is not peak process RSS. Source 8K RGBA alone is 126.6 MiB; analysis RGBA is 3.09 MiB at 1200×675, crop cap 3.05 MiB, normalized OCR cap 5.72 MiB. Browser decoding may allocate native intermediate buffers despite crop limits.

| Expected (1080p synthetic) | OCR result | Engine confidence / 100 | Review |
| --- | --- | ---: | --- |
| ГАЗ | ГАЗ | 96 | Explicit confirmation |
| ВОДА | ВОДА | 96 | Explicit confirmation |
| ТК-3 | TK-3 | 91 | Correct Latin/Cyrillic lookalikes manually |
| H=28.40 | Н=28.40 | 90 | Correct Cyrillic Н manually if Latin H is required |
| V-101 | V-101 | 91 | Explicit confirmation |
| Ø57 | O57 | 83 | Correct O → Ø manually |

The private local reference scan produced 87 line / 64 polyline / 5 contour candidates and seven text regions. All seven regions returned nonempty OCR, but slanted phrases were fragmented and some dimension labels were wrong. This is **not** seven correctly understood labels. No reliable symbol groups were inferred. The source image and its recognised private content are not committed.

Main JS: 865.52 kB / 258.69 kB gzip (base HEAD 861.84 / 257.64: +3.68 / +1.05 kB). Lazy image dialog 40.29 / 13.17 kB gzip; understanding Worker 131.75 kB including its Tesseract JS loader; image CSS 5.10 kB. Static OCR worker/cores/languages ship 11.59 MB uncompressed file bytes (gzip language files already compressed). These are lazy OCR/offline resources; the existing >500kB main-chunk warning remains.

## Final verification

Typecheck, lint, build and audit pass (zero vulnerabilities). Units: **1117 passed / 77 opt-in skipped**, 39 files passed / 5 skipped. Affected Chrome E2E: **28 passed / 1 reference-only skipped** (that reference is covered in the full run). Full reference E2E: **247 passed / 1 saved-ATTRIB polling timeout / 3 opt-in skipped** in 12.8 minutes. The final targeted retry passed in 55 seconds after projecting just the persisted target owner before CDP and allowing 30 seconds for its saved-value polls; canonical full-document/Undo/Search/reload assertions remain unchanged. Thus **248 unique E2E cases are verified**, with the full-run timeout and successful retry reported separately. The three skips are two external REAL AI opt-ins and one large Connector observation opt-in.

## V3 integration

After native image Apply, use Правка → Восстановить связи with a selected geometry/import scope. Compact disconnected internal strokes are combined before signature ranking; single ambiguous library signatures remain reviewable with manual assignment. Accepted image provenance freezes MODEL units per analysis pixel for later reconstruction, independent of underlay edits. Topology emits only faithful confirmed ordinary ConnectorEntity; OCR does not prove network meaning. See the V3 source-replacement/privacy/performance policy above.
