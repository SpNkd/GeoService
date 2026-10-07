# Local raster underlays

`RasterUnderlayEntity` is a canonical MODEL object with `assetId`, center XY, width/height in metres, rotation in degrees, opacity 0–1, lock and optional asset metadata (MIME, filename, bytes and pixel dimensions). Pixels, data URLs and external image URLs never enter GeoDocument JSON. Center + independent width/height + rotation + translation can support a future two-control-point binding; that binding is not implemented here.

Toolbar **Подложка** imports a local PNG/JPEG/static WebP in Model Plan, persists the asset, creates one entity/history action centered in the current Plan camera, selects it and shows editing controls. Pick an unlocked visible layer. Underlays have a dedicated background stratum regardless of geometry layer order. Layer order sorts images within that stratum; all engineering geometry, symbols and selection overlays stay above images.

Plan supports Move Selection, numeric center XY/width/height/rotation, opacity slider + percent input, corner resize and locking. Corner resize preserves aspect ratio by default; Shift permits independent axes. Rotation uses a Plan grip above the image and a numeric inspector field; a grip drag commits one Undo step. Slider changes preview inside an editor transaction; pointer release, key release or blur commits one Undo step. Undo/Redo reuse browser-local assets. Locked images are omitted from normal click hits, while explicit local search/layer selection allows inspection and unlocking. CAD hit targets have priority even over an unlocked image.

Axon renders the image as an affine XY plane at MODEL Z=0 using the existing projection basis. It never becomes an unprojected screen background. Free image manipulation stays Plan-only, consistent with Axon editing policy. Paper MODEL viewports can render underlays through their independent clip/scale/freeze passes.

## Asset registry and persistence

`src/assets/registry.ts` owns `assetId -> Blob + metadata` in IndexedDB database `geoservice-assets`, store `rasters`, version 1. The document autosave remains in its existing database. Asset persistence completes before the entity is added, so a committed reference is not intentionally written before its blob. Failure leaves the drawing unchanged and surfaces the error. Concurrent document changes are guarded by the existing expected-document mutation boundary.

Decoded ImageBitmap promises are cached by asset ID. Background and inspector consumers retain/release references; when the last consumer unmounts, the bitmap is closed while its persistent Blob stays available for Undo. Decode and storage failures produce a missing placeholder. Reload releases the old context's bitmap cache. Saved asset dimensions are rechecked against binary headers before decode.

Limits: 40 MiB/file, 16384 pixels per side, 70 million decoded pixels. PNG IHDR, JPEG SOF and WebP VP8/VP8L/VP8X dimensions are inspected **before** createImageBitmap; unsupported/animated formats, invalid headers and excessive dimensions are rejected. SVG, external resources and arbitrary URLs are not supported. Browser decoding confirms dimensions. Pixel-budget validation protects against huge claimed dimensions; browser codec memory and IndexedDB quota remain browser constraints.

Deletion does **not** delete the Blob: another image, Undo/Redo snapshot or saved JSON may still refer to it. `assetRegistry.collect(retainedDocuments)` is an explicit maintenance API; callers must supply every current/history/export document they intend to preserve. It removes only IDs unreferenced by that retention set and closes their decoded bitmaps. No destructive automatic GC is run on an entity deletion. Persisted assets may therefore accumulate until explicit cleanup; this is intentional.

## Save/Open and missing assets

Save JSON contains references, transform and metadata, with the visible notice **«JSON не включает файлы подложек.»**. It is not a portable image package. Opening the JSON in the same browser/origin resolves assets from IndexedDB. A different browser, cleared storage or missing asset does not reject the document: it shows a transformed placeholder and **«Подложка недоступна»** in the inspector. **Перепривязать изображение** imports a replacement asset and updates the reference through one canonical command. Existing geometry is untouched.

No ZIP packaging, survey image georeferencing, map tiles/WMS, OCR or AI image recognition is implemented. Local geometric extraction is available through the image vectorization workflow below. Portable projects containing both document and asset files are a separate future slice.

## Verification

Unit tests cover format headers, dimensions/pixels/bytes, schema, no-vertex creation, opacity transaction, translation, resize/rotation, locking/hit priority, JSON references, missing assets, IndexedDB cache/GC and projected Z=0 bounds. Chrome E2E imports a synthetic PNG, drags opacity, checks one-step Undo, edits/moves/resizes/rotates/locks, downloads JSON, reloads persisted assets, removes a test asset, reopens JSON and relinks. A separate test verifies that locked images do not steal clicks from CAD. The opt-in reference DXF E2E measures 4K and 8K images with pan/zoom.

Relink changes asset ID and image metadata together in one command. Import rejects hidden/locked current layers and rechecks document/projection/transaction state after asynchronous decoding. Unused successfully imported assets can remain until explicit retention-aware cleanup. Raster components are memoized so selection changes do not redraw unchanged image canvases.

JPEG EXIF orientation is respected by browser decoding. Header and decoded dimensions may be swapped by a 90° orientation; pixel budgets remain based on the raw dimensions, while persisted metadata records actual decoded dimensions. Reload checks the same raw/decoded pair and uses the oriented bitmap. Chrome acceptance covers PNG, EXIF-rotated JPEG and static WebP, including reload.

## Transform, style and navigation polish

Raster rotation grips now use shared SelectionTransform with the selection center pivot and 15° Shift snap; asset references/opacity/dimensions are retained. Corner scaling remains the dedicated aspect-preserving underlay operation. Exact intrinsic rotation stays available around MODEL Z. Raster opacity is separate from vector style.

## Local image vectorization V1

**Файл / данные → Векторизация изображения** uses an existing selected/chosen underlay. Manual four-corner perspective correction, A/B metric calibration and MODEL placement remain transient until Apply. Apply persists small `imageCalibration` metadata on the original raster and creates accepted native Line/Polyline/Polygon/Circle entities in one atomic history action; no resampled asset or second asset store is created. Undo restores previous raster settings and removes the result; the original raster entity/asset remain.

The renderer derives a bounded corrected ImageBitmap from the original source and persisted calibration, releases it on invalidation/unmount, and avoids reusing closed bitmaps across Undo/Redo. Relinking to a different asset clears calibration. Source blobs stay unchanged and browser-local. Native vector results retain lightweight `imageSource` provenance and are independent of later raster movement/deletion. [Workflow, transforms, extraction, privacy, performance and limitations](IMAGE_VECTORISATION.md).
