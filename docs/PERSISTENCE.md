# Local document persistence

The current canonical GeoDocument autosave is stored in browser IndexedDB at database `geoservice.autosave`, object store `documents`, record `current`. The record contains the validated canonical v2 document, persistence/schema versions, saved timestamp, approximate UTF-8 JSON byte size, entity count, source format when present, and dirty flag. It excludes renderer/session state, selection, history, AI diagnostics, API credentials, filesystem paths, object URLs, and original DXF file bytes. Imported source metadata and document-local DXF blocks/provenance remain part of the canonical document and are restored with it.

`localStorage` is reserved for small editor preferences such as `geoservice.snap-step`. It no longer receives the GeoDocument payload. Browser IndexedDB is local to the browser profile and origin; autosave is not a portable backup. **Save JSON** remains the user-controlled file copy. Imported DXF bytes are not persisted after import.

## Previous failure

The previous path serialized the full document as JSON and synchronously called `localStorage.setItem('geoservice.document.v2', payload)` after committed state changes. In Chromium, the actual reference DXF call failed with `QuotaExceededError`: the UTF-8 payload was 10,432,816 bytes. The old catch block collapsed that concrete quota error together with unrelated storage failures into the generic “Локальное сохранение недоступно (лимит браузера или доступ запрещён)” warning. Serialization itself had completed; IndexedDB now stores the validated canonical document without changing the DXF importer or the document JSON size limit.

## Startup and migration

Startup awaits IndexedDB hydration before exposing the editor or scheduling any autosave. The app shows `Восстановление документа…` during this short asynchronous step. A valid IndexedDB record wins. If it is absent, the app checks legacy keys `geoservice.document.v2` and `geoservice.document.dirty.v2`, parses and validates the canonical document, writes it to IndexedDB, and removes those old keys only after the write transaction commits. If the write fails, the original legacy payload is retained. Corrupt legacy data is preserved for diagnosis and the app opens its sample document with a warning. A corrupt IndexedDB record is likewise reported and does not crash the editor.

## Save lifecycle

Only committed editor documents are autosaved. Pointer movement, camera changes, selection, previews, and in-progress drag transactions do not trigger writes. Committed document changes, undo/redo, Open, and New are coalesced with a 500 ms debounce. Writes are serialized and carry monotonically increasing revisions, so queued obsolete snapshots are skipped and later state cannot be replaced by an older queued write. Page hide performs a best-effort flush; browsers do not guarantee completion during shutdown.

Autosave does not mark a document as explicitly saved and does not clear its dirty marker. Reload restores document contents and dirty state, but not undo history or selection. A saved-status label appears in the editor footer; approximate byte size, entity count, format, and timestamp are available in its diagnostic tooltip.

## Failures and size

Storage errors have typed categories for quota, unavailable IndexedDB, open/transaction/write/read failures, corrupt records, and schema validation failures. A failed save leaves the current document and editor history untouched and keeps editing available. The UI reports the category and recommends saving JSON manually; it does not label unrelated failures as quota errors.

The document JSON validator has a 100 MiB maximum, while browser quotas vary by browser, profile, device, and available disk space. IndexedDB supports substantially larger values than typical localStorage limits, but is not unlimited. The app does not request persistent-storage permission automatically. A future quota failure remains recoverable through Save JSON.

## Measurements

A 5,584-byte sample document took about 4.5 ms to serialize, 2.7 ms to save (including another serialization), 2.6 ms to read and validate, and 0.7 ms for direct schema validation. A valid synthetic 9.53 MB canonical document saved and restored with fake IndexedDB in about 57 ms and 10 ms respectively, including canonical serialization/schema validation for save and validation for restore (`npx vitest run src/tests/autosave.test.ts`). These unit timings are a fast local mock, not a browser storage guarantee.

## Autosave preparation Worker

Committed autosave schema validation, JSON size checks/encoding and canonicalization now run in `autosave.worker.ts`; the main-thread store still owns the ordered IndexedDB queue. Revision is checked before preparation and again before commit, including revisions superseded while Worker work is pending. This does not change the record format or Save/Open JSON format. Structured clone and IDB put remain browser costs. Worker-unavailable environments use the existing synchronous preparation. Committed metadata is cached for status so a save does not immediately re-read the full 10 MB record. Measurements and remaining limits: [DXF_UX_PERFORMANCE](DXF_UX_PERFORMANCE.md).

## Large document policy

Portable GeoService JSON Open/Save is bounded at **100 MiB UTF-8 = 104,857,600 bytes**. Open checks File.size before File.text/JSON.parse; error reports actual and allowed bytes/MiB. The string boundary also checks UTF-8 bytes, including multibyte text. Save prefers pretty JSON and falls back to compact near the same ceiling. DXF normalization retains its portable encode preflight; an accepted import remains reopenable. This replaces the historical 10 MiB MVP ceiling; it does not change IndexedDB quotas or remove limits.

Independent budgets: 50,000 entities, 1,000 layers/styles, 2,000 block definitions, 200,000 normalized vector primitives, 1,000,000 normalized points, nested depth 16 and 500,000 virtual rendered primitives; DXF source bytes remain 32 MiB. Cycle/reference/style/schema checks remain mandatory. [15/30 MB browser phase measurements and reference Save/Open](DXF_UX_PERFORMANCE.md#portable-json) justify headroom while showing that initial rendering and synchronous portable processing can pause the UI. 100 MiB is a safety ceiling, not a tested responsiveness promise. Worker preparation, record format, serialized queue and superseded-revision checks are unchanged.

## Semantic knowledge (optional schema-v2 field)

`GeoDocument.semantics` uses `SemanticKnowledge.version=1`: document concept definitions/overrides, annotations and transparent document rules. Optional field, no document-schema bump, backward compatible with old JSON. Strict payload and reference validation reject duplicate/ambiguous names, aliases, cycles, unknown owners/concepts, duplicate conditions and invalid scopes. The existing document fingerprint, autosave worker, IndexedDB and JSON serializer include this field; no raster bytes or secrets are present.

Teaching confirmation and knowledge edits use the canonical `set-semantic-knowledge` command with ordinary Undo/Redo, no-op detection and owned payload. Entity deletion prunes associated labels/example/exception references. Preview, Fit, view navigation, Search and temporary isolation are view-only and leave dirty/history/autosave unchanged. Reload restores knowledge but does not restore transient dialog/search/Undo state. Local-user reusable rules are not implemented. [Full details](SEMANTIC_LEARNING.md).
