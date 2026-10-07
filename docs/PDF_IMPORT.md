# Local PDF ingestion

File/data → Underlay accepts PDF alongside PNG/JPEG/static WebP. The shared **Import PDF** Dialog reads a local File, lists pages and processes only the selected page. Select → inspect operator list / Unicode text → bounded preview → explicit candidate review / scale / layer → atomic Apply. One Undo removes the accepted import. Cancel/unmount destroys the loading/page job and releases previews; an unfinished raster asset is removed before any stale Apply.

Routing:

| Content | Default path |
| --- | --- |
| Supported native vectors/text | Direct candidates → canonical Line/Polygon/Polyline/Arc/Circle/Text |
| Raster scan with no supported native content | Local page PNG → RasterUnderlay → existing Image Understanding workflow |
| Native content + image operators | Direct native candidates; optional preview underlay; no automatic raster vectorization |

Native Text uses `getTextContent` Unicode, actual baseline/height, page rotation and graphics transform; it never invokes OCR. Text requires confirmation, and editing clears confirmation. Native geometry is selected by default, with per-candidate exclusion. First 200 review rows are shown; counts/Apply include the bounded complete candidate set. Page scale defaults to physical pt→m (25.4/72000), not the unknown engineering drawing scale. The user supplies m/pt for engineering scale. Placement currently uses the stored document viewport center. Import is restricted to MODEL Plan and a visible unlocked layer.

The pinned PDF.js 5.4 DrawOPS adapter reads constructPath paint/path arrays with save/restore/transform/Form matrix. Page viewport transforms include crop and rotation; pixel Y inversion is applied once during canonical conversion. Straight paths become Line, closed paths become Polygon; Bézier/quadratic flattening uses .25 pt flatness/depth10, then .5 pt circular residual acceptance. Unicode Cyrillic/Latin and a rotated second page are original fixtures.

## Fidelity boundaries

This is candidate extraction, not a complete CAD PDF round trip. Arbitrary clipping paths are skipped with warnings; compound filled paths with holes stay preview-only. Text render modes/complex clipping, fill/color/dash fidelity, image occlusion, arbitrary Form bounding-box clipping and annotations are not reconstructed as CAD content. Circular curves may retain Polyline fallback. Unsupported native content can require the explicit scan/image path; password-protected files fail with a readable error (no password UI). Original PDF bytes are transient and are not persisted/cached; direct `pdf-vector` provenance identifies import/page/run but does not promise a retrievable original PDF asset. Optional page raster preview uses the normal AssetRegistry.

## Dependency / offline budget

`pdfjs-dist` **5.4.624**, exact lock; PDF.js Apache-2.0. [Official API](https://mozilla.github.io/pdf.js/api/) and [pinned source](https://github.com/mozilla/pdf.js/tree/v5.4.624). Package fonts/CMaps/WASM have their own included license files. Node20.20.1 satisfies its >=20.16 engine; newer PDF.js requiring Node22 was not adopted.

PDF Dialog/parser are lazy; Worker is an emitted local module. All optional CMaps, standard fonts and WASM are served/emitted same-origin by `server/localPdfAssets.ts`; no CDN or remote converter. Initial main JS delta versus d547e16 is +14.05 kB /+4.41 kB gzip for this entire slice, including settings/selection changes. PDF Dialog/parser chunk 417.67 kB /125.16 kB gzip, separate Worker 1,078.61 kB, optional local fonts/CMaps/WASM 2,390,091 bytes (plus 37,441 bytes of license notices). Unused PDF generates **0** PDF/parser/Worker requests. Existing large main-chunk warning remains.

Limits: 40 MiB File, 500 pages, 200,000 operators, 5,000 candidates, 100,000 vertices, bounded preview edge2400 (scale≤2), image/canvas budgets and 60s loading/render watchdog. Parser lives in PDF.js Worker; operator adaptation/text normalization are bounded main-thread work. A pathological complex page can still pause UI during those bounded operations; no claim of streaming/zero-copy PDF or measured full-process peak memory.

## Reproduce

`benchmarks/generate-pdf-fixtures.py` generates original deterministic vector (2 pages), scan and mixed PDFs with ReportLab/Pillow. Set `PDF_FIXTURE_FONT` to a local font with Cyrillic/Latin embedding support (default macOS Arial). Fixtures contain no private user drawing bytes. Rendered pages and application previews were visually reviewed. `node benchmarks/pdf-offline.mjs` targets a production preview at5179 (override PRODUCTION_URL); fresh browser context, warm allowed assets, disconnect network, re-open File/read another page/start scan analysis. UI/atomic Apply/Undo and routing assertions are also in `e2e/geometry-pdf-settings.spec.ts`.

Production builds include PDF.js and optional CMap/font/WASM license notices under `pdf/licenses/`; these notices do not load on the initial app route.

## Topology V3 integration

Native vector candidates offer local signature-based Symbol Library review and Fit. Ambiguous signatures require manual library assignment; confirmation replaces only fully contained accepted geometry, using the same image review policy. Re-running recognition restores substituted choices and clears confirmation. Vector signatures use native coordinates; page rendering is only a visual preview. After native Apply, select the import/geometry scope in [Восстановить связи](TOPOLOGY_RECONSTRUCTION.md). The deterministic native process PDF produces five confirmed symbols and four ordinary faithful connectors with one topology Undo; no raster entity is created.
