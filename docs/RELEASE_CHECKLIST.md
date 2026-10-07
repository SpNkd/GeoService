# Repeatable release candidate checklist

Use sanitized public history. Never merge an older private-history branch without auditing it. A hardening pass does not authorize publication.

## Intake and baseline

1. Record `git status`, branch, HEAD, last 15 commits and remotes. Read HANDOFF, README, applicable AGENTS and deployment docs. Verify ancestry against the chosen sanitized public baseline.
2. Run typecheck, lint, unit, full Chrome E2E, build and `npm audit --registry=https://registry.npmjs.org`. Preserve exact pass/skip/failure counts. Run unit and browser/performance workloads sequentially; do not interpret CPU contention as a product regression.
3. Give every additional Playwright run its own temporary output directory, e.g. `--output=/private/tmp/geoservice-rc-e2e`. Two runs must not clean each other's traces.

## Core acceptance

- Full E2E covers geometry, shared vertices/dimensions, Arc/Circle, Move/Rotate/style/ByLayer/Match, snapping/grid/ORTHO, selection and layers.
- Run `e2e/interaction-polish.spec.ts`, `editor-view-hardening`, `dialog-system`, `geometry-pdf-settings`, `rc-hardening`: nested click/parent/Ctrl/Tab/Shift+Tab, stationary ATTRIB cycle, popup Escape priority, pointer select → Space pan, text Space, Dialog trap/restore, smaller desktop, exclusive tab visibility and preserved drafts.
- Run `src/tests/release-torture.test.ts` and `e2e/rc-hardening.spec.ts`: all Undo/Redo revisions, indexes, autosave/reload/Save/Open, missing raster/relink, corrupted JSON/preferences, actual failed write status, pagehide and asset quota failure. Existing autosave units check older asynchronous preparation cannot replace a newer revision.
- PDF: safe `e2e/fixtures/pdf/{vector,scan,mixed}.pdf`; page chooser, native Unicode, scan routing, mixed without raster duplicates, Cancel/Apply/Undo/Search/reload; corrupt files/Worker errors stay recoverable.
- Image: perspective/deskew/calibration, Line/Arc/Circle, OCR edits, symbol confirmation, Semantic Teach, topology preview/Apply/Undo. Worker failure and Cancel must preserve committed data. Run current-only `node benchmarks/geometry-reconstruction.mjs` and `node benchmarks/image-understanding.mjs` while DEV is running. `node benchmarks/reconstruction-visual.mjs` generates safe actual primitive overlays; inspect them, not only counts. OCR has known glyph/lighting limits.
- Capacity: `node benchmarks/release-persistence.mjs` generates 50k safe native owners, actual Save/Open/reload and canonical SHA-256 equality. Run separately from other CPU/browser workloads. UI wall time includes automation/download; report observed long tasks and do not present capacity-limit rendering as smooth.
- Topology: manual/raster/PDF, T/X/gaps/ambiguous or incompatible ports, retained unsupported routes and exact one-Undo restoration. Never silently force engineering identity.
- Settings: no-key CAD, AI Settings link, session key disappears on reload, explicit Remember survives/revokes separately, models/preferences persist and never dirty GeoDocument. No credential may enter diagnostics, document JSON or autosave.

## Optional private DXF

Set `DXF_REFERENCE` to a private absolute local file. Never copy it into fixtures or commit source text, coordinates, screenshots or traces. Use `--workers=1 --output=/private/tmp/geoservice-private-acceptance`.

Run the reference tests in `viewing-ux`, `hardening-acceptance`, `dxf-attribute-editing`, `dxf-render-hardening`, `dxf-ux`, `transform-style-toolbar`, `topology-reconstruction`. Verify Model, 5 Paper containers, 15 MODEL viewports distributed 2/2/3/6/2, the heaviest Paper, all Fit actions, clipping/VP Freeze independently of global layers, readonly Paper versus active MODEL editing. Test structural ATTRIB selection/edit/move/Search/Undo/Redo/reload without hardcoded private strings. The structural TEXT/MTEXT/LINE/LWPOLYLINE/HATCH inspection uses isolated source-owner views, complementary to full-document reference flows.

Run `DXF_REFERENCE=... PROFILE_LABEL=rc node benchmarks/interaction-polish.mjs`. Commit only reviewed neutral timings/counts; full CPU/timeline traces stay temporary/private. Check Fit/Search, pan/zoom/hover/click/Tab/Properties/layers against the generous budgets in acceptance.

## REAL AI opt-in

The ignored `.env.local` must already hold the developer's key; never echo it. The default requested model is `qwen/qwen3.5-27b`, with configured provider exclusions. Do not replace it with an expensive model or implicit mock.

- `RC_REAL_AI=1 npx vitest run src/tests/rc-real-ai.test.ts`: exact golden, Russian cardinal/corner/center/relative/boundary paraphrases, clarification, semantic selection and process creation. Reports default to private temporary storage. Compare semantic geometry, not provider JSON equality.
- `RC_REAL_AI=1 npm run test:e2e -- e2e/rc-real-ai.spec.ts --workers=1 --output=/private/tmp/geoservice-real-ui`: REAL golden Apply/one Undo and local clarification without a second parse call.
- Deterministic `ai-constraints` also checks two referenced objects, orientation/routing, original prompt retention, local resume, Cancel and provider clarification transport.
- Inspect request bodies: user text/structured answers + fixed instructions/schema/model/routing only. No geometry, images/PDF/DXF bytes, selected IDs, semantic rules, layer catalog, history or key in body. Authorization/header values must never be recorded.
- Failure units/E2E cover auth, rate limit, timeout/network, malformed/truncated/unsupported/local validation/stale responses and useful retry/cancel; no partial Apply.

## Production and public Pages

Build locally with a relative base and use `npm run preview:static` (`/GeoService/`, no API). Run `PRODUCTION_URL=http://127.0.0.1:5180/GeoService/ node scripts/smoke-pages.mjs`.

Read-only public regression, never deploy implicitly:

- `PRODUCTION_URL=https://spnkd.github.io/GeoService/ PAGES_REAL_AI=1 PAGES_REPORT=/private/tmp/github-rc.json node scripts/smoke-pages.mjs`
- `PRODUCTION_URL=https://spnkd.gitverse.site/geoservice/ PAGES_REAL_AI=1 PAGES_REPORT=/private/tmp/gitverse-rc.json node scripts/smoke-pages.mjs`
- `node benchmarks/startup.mjs`: three isolated contexts per host; report HTML/main assets/usable editor and lazy feature loading. Network/caches are variable.

Expect no `/api/ai` calls from production, no asset 404/CORS/Worker errors, no unexpected console errors or document uploads. Ordinary local DXF/PDF/image/OCR/Teach/topology/storage must not contact external services. REAL AI alone contacts OpenRouter. First production OCR populates the explicit allow-listed local cache; offline recognition requires successful initial caching.

## Final gate

1. Repeat affected checks and the full suite sequentially. Do not globally inflate timeouts to conceal flakes. Document actual roots and unknowns.
2. Update acceptance matrix, known issues, architecture facts and HANDOFF. Record measurements, limitations, source/test references and exact count totals.
3. Scan tracked current history and dist for the exact configured key (in memory only), private filenames/content/coordinates and source screenshots. Check `.env.local` ignored/untracked and no custom publication workflow added. Inspect every new audit artifact. Safe synthetic screenshots only.
4. Make focused local commits; report their list, clean status, baseline ancestry, READY/NOT READY and one evidence-based next direction. Do not push or deploy without a later explicit request.
