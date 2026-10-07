# AI Document Operations

The provider extracts intent from user text. A strict runtime contract is followed by a deterministic **local** resolver, an explainable preview and explicit Apply. Concrete owner IDs never appear in provider input/output. Existing Spatial AI uses the same endpoint/schema but a separate resolver; geometry creation and document operations cannot be mixed within one task.

## Contract

`DocumentQuery` is a strict tagged union in `src/documentOperations/schema.ts`:

| kind | Parameters | Meaning |
| --- | --- | --- |
| entity_name | name | Exact current entity name |
| geoservice_layer | name | Exact current owner layer name |
| source_layer | name | Exact original top-level DXF source layer |
| source_type | sourceType | DXF type, including nested definition/ATTRIB content; return owners |
| block_name | name | Exact source definition name, top-level instances |
| text_contains | text, sourceType (nullable) | Current semantic text, optional DXF text kind |
| block_attribute | tag, value (nullable) | Exact current tag/value; at least one supplied |
| entity_type | entityType | Native GeoService type |
| semantic_concept | concepts[] | Bounded local concept union |
| learned_concept | name | Exact local user-category name/alias; provider knows only user text |
| current_selection | — | Locally captured owner selection |

No arbitrary predicates, expressions, code, IDs or command arrays. Named layers/blocks and searched literal values must occur in user text. Comparison uses Unicode NFKC, case folding, trimming and ё/е. Exact names retain separators; token evidence normalizes underscores, dashes and whitespace. This is not fuzzy search.

Semantic actions embed a typed query: `find_entities`, `select_entities`, `fit_result`, `isolate_result`; `set_layer_visibility` also carries boolean `visible`. `create_layer` carries `name`. `move_entities_to_layer` carries query and a narrow target: `existing_layer {name}` or `created_layer {actionIndex}` referring to an earlier create_layer. Up to eight actions; no generic DAG.

## Predictable language

## Concepts, evidence and ambiguity

Centralized aliases support buildings, roads, slopes, utilities, annotations, dimensions, text, blocks, hatches and symbols. Evidence comes from current/source layers, entity/block names, intrinsic content types and semantic text. There is no geometry recognition, embedding, RAG or probabilistic score.

A resolved set includes IDs, evidence paths/ATTRIB source handles, query summary, local document revision and, when needed, selection fingerprint. The revision is an ephemeral token keyed by immutable GeoDocument identity; it is not saved. Committed document changes or relevant selection changes stale the preview and hide highlights. Refresh recomputes the set; a separate Apply is still required. Active coordinate/drag transactions block Apply.

## Search, semantic text and ownership

«Поиск в документе» is a debounced (180 ms) local UI. It searches entity names, current/source layers, block names, semantic text and current ATTRIB tags/values. Rows show type, layers and nested paths; click selects the top-level owner and Fit frames it. At most 100 rows are displayed; total count remains visible. It never calls the provider.

Queries return owners, never standalone nested primitives. They do not edit fixed block text or ATTRIB. Source-type queries include nested content types but source-layer queries target the original **owner** source layer; they do not pretend individual definition primitives are ordinary entities.

## Preview, view operations and mutation

Preview uses lightweight owner-bound SVG rectangles. Selection and base Canvas geometry are unchanged; shared definition Path2D is not recompiled. Fit and selection are editor state and create no document/history/autosave mutation.

Layer create/move and visibility use the existing command/reducer boundary. A validated bulk `set-entities-layer` command checks all owners and source/target locks before mapping the entity array once. Native, block-instance and proxy owners can move. Source provenance, vertices and definitions are preserved. Layer-0/BYBLOCK internals are not rewritten. Hidden target layers follow existing manual layer policy; source/target locks block the entire move. Visibility follows the existing manual policy: locked layers can still be hidden/shown.

Create+move compiles into one atomic batch. Preflight and execution validate the full task. If any step fails, no layer or moved prefix is left behind; Undo/Redo operate once for the whole batch. Whole-layer visibility changes are allowed only if every owner on each affected layer belongs to the included result. Partial coverage is blocked with the actual layer name and collateral count, suggesting isolation or an exact layer query. Empty entity results cannot Apply.

Isolation stores owner IDs/label in EditorState, filters rendering/hit testing/snapping, and temporarily exposes result layers. A banner offers **Выйти из изоляции**. Canonical layer visibility is never changed, so exiting restores it exactly. Isolation has no history, dirty change, JSON or IndexedDB representation, and clears on New/Open. It is a snapshot owner set; later newly created owners are not automatically included.

Budgets: 10,000 unique owners, 2,000 groups, 20 evidence records per owner, 100 displayed rows. An oversized query is blocked, never silently applied as a truncated prefix.

## Privacy and diagnostics

The browser sends only `{text}`. The model receives fixed parser instructions, the strict schema and user text. It receives no document, geometry/coordinates stored in the document, IDs, selection, provenance/catalog/layer dump, block content, source DXF or IndexedDB. Explicit names, values or coordinates written by the user are naturally part of user text.

AI Diagnostics retain provider response/trace/routing information. Current local query diagnostics show query/normalized summary, counts, groups/reasons/tiers, ambiguity, operation and document revision without dumping owner IDs or document content. Local diagnostics are not forwarded to the model.

No AI delete, arbitrary coordinate/text/ATTRIB editing, definition editor, rename-block, connectors or DXF export.

## Reference acceptance and timings

Opt-in commands:

The real smoke uses the current primary/fallback configuration and server-only `.env.local` key. Eight examples × five runs validate semantic structure only; exact IDs stay local. Reference DXF and paid requests are excluded from normal CI.

## Limitations and next architecture boundary

Aliases classify metadata, not actual geometry. An object hidden behind an opaque/abbreviated source family may remain unclassified. WEAK evidence requires user review. Partial-layer hide is blocked rather than changing unrelated objects. A source-type query may select a large block containing only one matching nested primitive. Text/evidence counts are owner based.

Layer visibility is a document command with normal history; isolation is a separate view filter. Existing general atomic execution still validates/serializes the final document, which can dominate mutation latency for large files. Semantic metadata arrays/indexes are local derived caches, not canonical document fields. Extending editing of text/ATTRIB via AI requires a separate typed target/path and reviewed mutation slice; it is intentionally not part of these operations.

## Final verification

`npm run typecheck`, `npm run check` (lint, 713 unit tests, production build, 149 E2E), and HTTPS `npm audit` passed (0 vulnerabilities). Normal suites skip 46 unit opt-ins and 7 reference E2E opt-ins. A separate reference run passed all four browser workflows with zero console/page errors, including manual ATTRIB edit followed by AI current-value query; reference tracing was disabled to avoid large trace files on the nearly full host volume. Real semantic smoke: 40/40. Exact configured-key scan of non-ignored source files and production output: zero matches.

## Current-view scope and Find UX

Query scope may be current_view or document (old queries without scope retain document semantics). Provider output schema requires an explicit scope; only user text goes to the LLM. The local resolver intersects current_view results with global visibility, active DXF viewport freeze/clip bounds and temporary isolation. Scoped preview tracks the view context and must refresh after layout/viewport/isolation changes. Find Apply preserves real selection and retains a clearable query result list/highlight with optional Fit. Select Apply uses selectedEntityIds; contour overlay, Move, properties and layer tools are shared with manual selection. See [DXF_LAYOUTS](DXF_LAYOUTS.md).

## Abstract local view scopes

Queries accept `document`, `current_view`, `current_layout` and `active_viewport`, plus `kind: all_entities` for a scoped select-all. Paper-mode current view resolves the supported sheet union; active MODEL viewport mode resolves only its visible clip. Current layout always uses the sheet union, and active viewport always its selected source window. Scope preview staleness includes mode, layout, viewport and isolation. All matching, canonical owner IDs, visibility/VP Freeze and source-geometry intersections are resolved locally.

Only user text and static instructions/schema reach OpenRouter. No document/layout catalog, viewport ID, geometry, selection list, angle, table cells or source metadata are added to requests. Static examples describe natural Russian scope wording; they do not implement hardcoded phrase matching. Table detection/search and view navigation require no provider.

## Document semantic learning V1

The existing resolver merges explicit annotations and learned rules with intrinsic/source-alias evidence. Negative labels override the queried category; declared descendants are included. Weak rule hints use the existing default-excluded preview groups. Static concept IDs now include pipe/gas_pipe/water_pipe/cable/electricity/fence/equipment/valve/well; old plural IDs remain compatible. Custom categories use strict `learned_concept {name, scope}`. `name` must occur in user text and identify one category locally. Unknown names fail closed. No document knowledge/catalog/features/IDs enter the provider payload.

Search recognizes names/aliases and shares this resolver. Its optional Weak switch is off by default. Results distinguish explicit labels from Exact/Strong/Weak rule evidence, with Select/Fit/temporary isolation using all results even when only 100 rows render. MODEL knowledge is resolved against canonical owners; merged Paper plaintext rows do not inherit rules. Details: [SEMANTIC_LEARNING](SEMANTIC_LEARNING.md).
