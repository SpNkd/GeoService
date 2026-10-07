# Client-side DXF Open

DXF → ArrayBuffer → decode → inventory + `dxf-parser` → deterministic normalization → validated GeoDocument v2 → atomic replacement. Toolbar **DXF** is separate from JSON Open and coordinate CSV Import. It opens a new drawing; merging and DXF export are outside this slice.

## Parser spike

Pinned dependency: `dxf-parser@1.1.2`, MIT, browser-compatible JavaScript/TypeScript. Primary source: [upstream repository](https://github.com/gdsestimating/dxf-parser). Inspected its scanner, common properties, layer/block parsing and entity handlers, then parsed the local AC1024 reference and synthetic fixtures. No DXF is sent to the Vite AI backend.

| Feature | Upstream spike | Adapter / decision |
| --- | --- | --- |
| AC1024 ASCII / HEADER | Parsed successfully | Validate complete group pairs, EOF and entity section; reject binary DXF |
| LINE / LWPOLYLINE / old POLYLINE | Coordinates, closure, bulge, XYZ available | Editable native geometry; 2D bulges tessellated with maximum MODEL sagitta 0.01 m, up to 4096 segments per arc |
| ARC / CIRCLE | Native geometry, ARC angles in radians | Canonical Arc/Circle and native SVG; negative-Z OCS reflection handled for these and LW paths |
| TEXT / MTEXT | Content / insertion available | Safe plain text, native MODEL height and rotation; formatting/alignment/fonts simplified |
| Layers | Names / colour / off/frozen available; lock/weight omitted | Focused raw-table adapter retains bit-4 lock, bit-1 freeze, off colour flag and styles; viewport-only freeze does not hide Model Space |
| Blocks / nested INSERT | Definitions and transforms available | Document-local shared definitions + instances; no SymbolEntity mapping or eager explode |
| Handles | Available | Generic provenance; IDs independently generated from source order |
| INSERT attributes | ATTRIB not associated by upstream | Focused association until SEQEND, including nested INSERT; values and visible text retained |
| HATCH | Dropped by upstream | Focused boundary normalizer: polyline/line/circular arc loops, solid fill and even-odd islands; patterns/gradients simplified |
| DIMENSION | Anonymous block name available | Safe vector proxy referencing that definition, without invented GeoService dimension references |
| MULTILEADER | Dropped by upstream | Focused context adapter for text + leader lines and simplified arrowheads; block-content variants may remain unsupported |
| Encoding | Parser expects a decoded JS string | Strict UTF-8 validation + Windows-1251 decoding before parser; selectable unknown-codepage fallback |

The adapter is an inventory/normalizer for gaps, not a replacement full DXF parser. Model Space is identified using the `*Model_Space` BLOCK_RECORD owner handle, falling back to group 67/layout 410 when absent. Reactor handle groups are excluded from the owner decision. Paper Space is counted and explicitly skipped.

## Preview, Apply and cancellation

The dialog shows filename, version, declared/actual encoding, INSUNITS/factor, frame, layers, Model Space, definitions/instances, converted/simplified/proxy/unsupported totals, tables for top-level and definition entities, warnings and timings. Decoding/parsing/conversion/schema validation/JSON size preflight run in a dedicated module Worker. Transferring the ArrayBuffer avoids a second input-buffer copy. Option changes terminate the previous Worker; stale replies cannot enable Apply. Cancel/Escape unmounts and terminates the Worker. The editor remains intact until a ready candidate replaces it.

Unknown units require an explicit mm/cm/m choice before Apply. Supported INSUNITS: 4=mm (×0.001), 5=cm (×0.01), 6=m (×1). Preview can override declared units. No automatic origin shift, geographic inference or fake calibration occurs. Frame is visible: Projected / Survey defaults to direct E=X, N=Y, or Local for later georeferencing.

Dirty replacement uses the same confirmation policy as JSON Open. The reducer owns validated data and sets the current layer in the same replacement action; `$CLAYER` is preserved if available, otherwise the first visible unlocked layer (or first layer) is selected. A malformed file or invalid candidate cannot partially change document/history.

## Canonical mapping

| DXF | GeoDocument | Editing |
| --- | --- | --- |
| LINE | LineEntity + XYZ vertices | Ordinary geometry editing / Move |
| LWPOLYLINE / POLYLINE | Polyline or valid closed Polygon | Ordinary geometry editing; bulges explicitly simplified; mesh/polyface unsupported |
| TEXT / MTEXT | TextEntity with `height` in metres and `rotationDeg` | Content, insertion, Move; CAD formatting/justification/width/attachment simplified |
| ARC / CIRCLE | ArcEntity / CircleEntity, center/radius, ARC start/end radians CCW | Select, Move, layer, delete; read-only geometric inspector |
| INSERT | BlockInstanceEntity | One selectable/movable instance, layer and deletion; no explode/block editor |
| HATCH | ImportedGraphicEntity with safe path loops | Select, Move, layer, delete; no hatch editor |
| DIMENSION | ImportedGraphicEntity with shared anonymous-block reference | Vector representation, no reconstructed semantic dimensions |
| MULTILEADER | ImportedGraphicEntity | Safe plain text and geometry; CAD placement/style simplified |
| SOLID / 3DFACE / POINT inside blocks | Declarative filled path / path / marker | Part of the instance; source geometry retained |

Text extends v2 additively: legacy `fontSize` remains screen px; imported `height` is MODEL metres. Existing JSON remains valid. New entities own center/position rather than fake shared vertices. Move Selection, exact placement, drag, WINDOW/CROSSING marquee, layer Fit, global Fit and Save/Open use the common domain paths. Curve/block/proxy marquee uses conservative bounds. Initial pointer selection follows painted geometry so empty block AABBs cannot obscure other objects; selected instances expose a bounds area for Move. Multiline text bounds use line count and longest line, not a single unrotated baseline.

## Shared blocks, layers and styles

`GeoDocument.blocks[]` contains each source definition once: independent ID, sourceName, basePoint and sanitized primitives, including nested block references. Instances contain definition ID, XYZ insertion, rotation degrees, non-uniform X/Y/Z scales, optional attributes and per-instance attribute text. Nested references also retain attribute values; their text stays in the enclosing shared definition, in its coordinates. Hidden values survive with their visibility flag. Child definition coordinates and XYZ are retained; the editor is a 2D view and does not offer a 3D evaluator/editor. Transform order is insertion × rotation × scale × negative basePoint; nested SVG references compose this order.

SVG `<defs>` is prepared once and repeated instances use `<use>`. Definition bounds are cached per immutable document; nested AABBs are conservative. The numeric path encoder is shared with Symbol rendering, while semantic Symbols retain their registered libraries/ports and DXF definitions remain document-local.

Layer names/order are retained exactly as decoded. Independent layer IDs keep Unicode names out of object keys. Layers store source provenance, visible/locked flags and basic styles. In a block, layer 0 inherits the instance context; nonzero child layers retain their own colour/visibility. BYBLOCK colour inherits context, BYLAYER resolves from the effective layer, ACI/truecolour are supported (ACI 7 is dark foreground on this light canvas). SVG strokes are screen-width strokes; positive DXF line weights and linetype dash patterns are approximate. BYBLOCK lineweight/linetype, CAD linetype text/shape elements and plot styles are not faithfully reproduced. A layer referenced by definition/proxy geometry cannot be deleted leaving dangling references.

## Provenance and semantic readiness

`EntityBase.source`, `Layer.source` and primitive source records use `SourceProvenance { kind:'dxf', sourceDocumentId, handle?, originalType, originalLayer, blockName?, blockPath? }`. `GeoDocument.sources[]` records filename (basename only), DXF version, actual encoding, original INSUNITS and applied unitScaleToMeters. No local filesystem path, raw file, XREF path, font URL or HTML is persisted. Deterministic non-cryptographic source fingerprints are identifiers within this single-source workflow, not authenticity/security checks.

`createProvenanceIndex(document)` is a pure local API:

- `getEntitiesBySourceLayer(name)` → independent editor entity IDs;
- `getEntitiesBySourceType(type)` → IDs;
- `getBlockInstancesBySourceName(name)` → instance IDs;
- `getImportedEntityProvenance(id)` → owned copy of provenance.

The index deliberately addresses top-level selectable entities. Definition primitives retain their intrinsic layer/handle/type; the enclosing definition supplies the intrinsic block path; resolving an instance-specific nested path is a later local operation, since one shared definition cannot store different parent paths for every instance. Renaming/reassigning an editor layer does not rewrite source provenance. No building classifier, semantic AI command or provider schema extension is implemented; original layer/block identity is available for a future local selection slice.

## Security and budgets

No fetch/backend upload or automatic XREF/image/font/local-path access. XREF definitions are identified from BLOCK flags/path metadata and imports referencing them are explicitly unsupported. IMAGE and other unhandled types appear in the report. Proxy geometry is a bounded strict declarative union; raw SVG/HTML, URL paint, unsafe IDs, dangling sources/layers/blocks, cyclic JSON graphs and invalid numbers fail runtime validation. Prototype-sensitive parser table/block/layer names are rejected before invoking upstream.

Limits: 32 MiB input, 50,000 top-level entities, 1,000 layers/styles, 2,000 definitions, 200,000 normalized vector primitives, 1,000,000 normalized points, nested depth 16 and 500,000 virtual rendered primitives. GeoService JSON has a separate **100 MiB** budget; this can reject a file below the DXF input limit. Cyclic/over-deep source references are removed with warnings and definition unsupported counts; malformed persisted graphs are rejected. An exponentially expanding graph fails the render-cost preflight, without expanding the canonical graph.

## Real reference acceptance and measurements

127 layers, 458 Model Space objects, 450 definitions, 102 instances. Top-level inventory matches: LINE 135, INSERT 102, POLYLINE 63, HATCH 42, LWPOLYLINE 38, TEXT 24, MTEXT 19, MULTILEADER 16, DIMENSION 13, ARC 6. All 458 obtain native or proxy representations; Paper Space 89 is skipped/reported. All 42 top-level HATCH and 16 MULTILEADER are preserved with simplification warnings. All 1,664 definition ARC are retained, including negative-Z OCS arcs.

Inside definitions, ATTDEF templates (153), WIPEOUT (7), ELLIPSE (11), VIEWPORT (17), SPLINE (8), 16 unsupported HATCH boundaries/OCS and 4 unsupported LW paths/OCS are reported. Nested ATTRIB: 3,228 records; 2,970 text primitives retained and 258 unrenderable text records reported without losing their stored attribute values. Actual INSERT ATTRIB values are retained separately; ATTDEF templates do not render over them. Tilted OCS, mesh/polyface, MINSERT arrays, ellipse/spline hatch edges and unhandled leaders remain limitations, with counts/warnings rather than silent loss.

Measured locally (development build; CPU/browser numbers are illustrative, not CI thresholds):

| Stage | Measurement |
| --- | ---: |
| File read (Node) | 4.7 ms |
| Decode / group inventory / library parse | 15.9 / 161.4 / 219.2 ms |
| Normalization / validation + size preflight | 165.8 / 254.0 ms |
| Full conversion (Node) | 872 ms |
| MODEL bounds + Fit (Node) | 13.7 ms |
| Save / Open (Node) | 223 / 127 ms |
| File selection → ready browser preview | 1.15 s |
| Apply → first rendered scene | 1.58 s |
| UI select layer + Fit + paint | 450 ms |
| Shared stored normalized primitives | 25,647 |
| SVG path/circle nodes incl. definitions | 16,601 |

Node retained heap delta ~72 MiB includes two validated documents, roundtrip JSON and bounds cache. Process RSS ~602 MiB includes the Vitest runtime/parser transient allocations; this is not a browser memory guarantee or per-document measurement. The real reference uses cached/shared definitions instead of eagerly duplicating >20k INSERT descendants as editor entities.

## Block attribute ownership and editing

`ATTDEF` is a template owned by its `BlockDefinition`; it remains visible/selectable as definition content and read-only because changing it would affect every insert. `ATTRIB` is the value and placement attached to one concrete `INSERT`, so it is stored on that `BlockInstanceEntity` alongside the existing tag/value map. Its primitive keeps text/style fields, tag, source handle and provenance; editing it never changes the shared definition, ATTDEF, or another insert.

New imports normalize visible ATTRIB insertion points into block-local coordinates and store `attributeCoordinateSpace: "block-local"`. The INSERT base point, rotation and non-uniform scale are then applied at draw, bounds and hit-test time. Older v2 documents omit this marker and retain their historic insert-relative display until the attribute is edited; the first edit converts the old point into local coordinates while preserving its current MODEL position. The optional marker is additive, so the document schema version remains v2.

The inspector edits value through the document command/reducer and edits placement through one drag transaction. Undo/Redo, JSON Save/Open and IndexedDB autosave persist both. The semantic provenance index is derived from the current immutable document revision, so searches and summaries see the new value without mutating an imported cache. Instance changes replace only that instance's attribute primitive array; shared definition arrays and Canvas Path2D caches remain reusable. Fixed definition TEXT and ATTDEF continue to show why their shared content is read-only. No Block Editor, explode or DXF export is included.

Final verification: typecheck, lint and production build passed; 627 unit tests passed (6 paid-provider tests skipped); 127 standard E2E passed (paid-provider and local-reference cases opt-in). The additional real-reference browser E2E and CPU benchmark passed separately. Console/page errors: 0. `npm audit`: 0 vulnerabilities. Build retains the known Zod PURE-comment and main-chunk size warnings.

CI uses small synthetic ASCII/Windows-1251, layer flags, nested/repeated blocks + attributes, arcs/circles, proxy, unitless and malformed fixtures. Tests cover safe runtime persistence, budgets/cycles, XREF privacy, XYZ/bulges/large coordinates, lock/layer behavior, Move/Undo, reports and atomic failure.

## Architecture assessment and next slice

The import pipeline is separate from the AI workflow and avoids forcing arbitrary CAD content into semantic Symbol libraries. Canonical definitions + transform instances and generic provenance are suitable for local semantic selection. Remaining architectural pressure: localStorage capacity, full-document runtime validation/fingerprinting costs and conservative nested bounds. Large-document persistence uses the dedicated IndexedDB adapter described in [PERSISTENCE](PERSISTENCE.md); document validation limits remain unchanged.

Suggested next vertical slice: **local semantic selection by original DXF layer and block name**, using the provenance index, previewing exact entity IDs and applying selection without sending the DXF/definition tree to an LLM. Do not infer buildings merely from arbitrary geometry.

## Deep Selection / DXF Hit Stack / Block Inspection

Imported INSERT остаётся одним canonical BlockInstance. Обычный click использует SVG painted target; Alt/Option строит explicit stack с nested INSERT и primitives. Повторный click в пределах 5 px выбирает следующий путь. Вложенные paths transient/read-only, не сериализуются и не изменяют общую definition. Inspector использует source block name и показывает attributes/transform/provenance/recursive leaf count/instance count. Hatch fill следует за foreground; пересечения остаются в Alt stack.

## Imported Semantic Text

Native TEXT/MTEXT остаются TextEntity; plain text, height, rotation и source provenance сохраняются, rich CAD formatting упрощается и отражается в import report. MULTILEADER сохраняет leader/arrow/text composite и controlled `semanticContent { primaryText, textRuns: [{text,position}] }`. Text и position берутся из уже нормализованной geometry, не из raw payload в документе. Пример reference handle `58829`: «Плодородный грунт, h=0.20 м».

DIMENSION остаётся anonymous-block proxy. Visible text берётся из anonymous definition TEXT; source text override используется только при отсутствии displayed text. Group 42 сохраняется как measuredValue (linear units → metres; angular types без length scaling), group 70 как исходный dimensionType bit field. Полноценного DimensionEntity/надежных vertex refs не создаётся. Metadata optional: отсутствие source measurement не заменяется вычисленным предположением.

ATTDEF plain text/tag сохраняются controlled primitive metadata; derived definitions содержат textContent, attributeDefinitions, sourceTypes, nestedBlockNames. Instance projection добавляет реальный ATTRIB и definition text без новых TextEntity. Existing saved JSON без semanticContent остаётся совместим; local search может читать его proxy primitives, а новые primary headings появляются после нового DXF import.

## Semantic Index / Performance Architecture

`dxf/provenance.ts` — pure local queries by source layer/type/block name плюс structured text/attribute search и entity/definition summaries. NFKC + Russian lowercase substring, document order, no AI/fuzzy/network. По умолчанию searchText включает definition text; `{includeBlockDefinitions:false}` оставляет native/proxy/actual attributes. Source layer в hit — original DXF layer, даже после reassignment.

Immutable library/definition identity — revision для cached recursive bounds; заменённый child инвалидирует ancestor. World bounds instance вычисляются из cached local bounds + transform. Marquee/Fit используют те же caches. Generic SVG geometry остаётся controlled `<defs>/<use>`. Оптимизации, browser acceptance и измерения: [DXF_UX_PERFORMANCE](DXF_UX_PERFORMANCE.md).

## Hybrid display

Imported DXF bulk now defaults to Canvas: LINE/Polyline/Polygon, TEXT/MTEXT, Arc/Circle, INSERT/nested blocks and safe HATCH/MULTILEADER/anonymous DIMENSION proxy geometry. Canonical blocks, source paths, semantic text, ownership and JSON remain identical. TEXT/MTEXT preserve content/position/rotation/height/color with safe fallback fonts and the existing formatting limitations. HATCH solid fills preserve even/odd holes; simplified patterns and proxy semantics do not change.

Shared local preparation, cached Path2D/style draw lists, DPR, world viewport culling and exact Canvas/SVG layer strata are presentation-only. Native editing and selected/deep/grip UI remain SVG; ordinary/Alt selection, marquee, Move and semantic queries do not require DXF DOM nodes. Development-only A/B removes inactive bulk without reimport. The SVG-specific acceptance remains as fallback coverage; dedicated Canvas acceptance uses the real reference without bulk SVG. See [RENDERING](RENDERING.md) and [A/B profile](DXF_UX_PERFORMANCE.md#hybrid-canvas-renderer).

## Zoom / portable-file hardening

Large projected coordinates in position-zero INSERTs previously exceeded Chrome SVG layout's coordinate range when camera translation grew during wheel zoom. Derived local-origin `<defs>/<use>` preparation now cancels projected coordinates in JavaScript before SVG, including nested base points/rotation/scales, imported proxies and deep highlights. Source/canonical coordinates, block sharing, provenance, visibility and world bounds remain intact. Camera-specific screen transforms do not pollute immutable bounds caches. The SVG hardening stage did not introduce viewport culling/LOD; the hybrid Canvas stage above adds top-level world viewport culling.

Portable JSON now allows 100 MiB with byte preflight and unchanged geometry complexity budgets; DXF import still preflights its encoded result. The edited real reference (10,591,324 compact bytes) saves and reopens identically as 20,553,407-byte pretty JSON. [Zoom, JSON and performance evidence](DXF_UX_PERFORMANCE.md#rendering-hardening-2026-10-05).

## Local document operations

## Paper Space inventory

The raw scanner also retains OBJECTS. A focused adapter reads LAYOUT subclasses and Paper Space BLOCK_RECORD owners, model windows, clip restrictions and repeated 331 layer handles. Missing LAYOUT names/paper settings remain explicitly unavailable; paper-block names are provenance fallbacks. MODEL geometry is not duplicated. See the actual reference inventory in [DXF_LAYOUTS](DXF_LAYOUTS.md).

## Transform, style and navigation polish

Imported source style remains the baseline until explicit user layer/entity intent. Source BYLAYER/BYBLOCK, original color/dashes/lineweight and provenance remain intact. DXF Views exposes every imported Paper Space container using exact source block names when LAYOUT names are unavailable.

## Production import UX

The picker/drop target reports filename and size, followed by styled encoding, units and coordinate controls. Source data remains in the browser Worker. The summary separates MODEL owners, shared definitions/instances, Paper containers, MODEL viewport windows and warnings. Technical type/timing tables are collapsed under «Подробный отчёт»; actions remain in the modal's sticky footer.

The former «Paper Space skipped: 89» was misleading: 89 is the number of top-level ENTITIES records outside MODEL, including source VIEWPORT records, not a count of discarded sheet objects. Paper presentation is imported from owner containers and block records. The reference has 5 containers, 15 MODEL windows and 317 normalized Paper primitives across them. Raw-record and normalized-primitive counts must not be compared as the same entity count. The existing 18 warnings describe import fidelity; they are not lost-paper warnings.
