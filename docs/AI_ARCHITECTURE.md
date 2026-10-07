# AI task architecture

## Pipeline and trust boundaries

User text → `AiIntentProvider` → strict `AiTaskIntent { actions[] }` → shared named references → sequential local resolution and private projection → `ResolvedAiTaskPlan` → combined transient preview → explicit Apply → common execution gate → general atomic command batch → GeoDocument → ONE history step.

Single, independent multi-action and dependent requests share this pipeline. Legacy single-intent fixtures normalize into one action at validation. The existing four direct operation resolvers remain available. Read-only Measure produces no command and stays transient after mixed Apply.

## Dependent actions

The backward polygon-edge action is `create_dimensions_for_boundary_edges`. The model says “dimensions of all sides of the result of action 0.” The local resolver obtains the actual ordered edges and compiles ordinary Dimension commands. Spatial constraints additionally expose an explicit backward dependency graph and a typed point/object/boundary result registry. There is no generic expression interpreter or provider tool loop.

## Prior-action references

```json
{
  "actions": [
    {"type":"create_boundary_from_named_points","pointNames":["P1","P2","P3","P4"]},
    {"type":"create_dimensions_for_boundary_edges","boundaryActionIndex":0}
  ]
}
```

`boundaryActionIndex` is a zero-based integer bounded to 0–7. Before resolving names, strict task validation requires the referenced action to exist, precede the dependent action and produce a polygon (`create_boundary_from_named_points` or `create_rectangle`). Self, future, out-of-range and wrong-kind references are invalid. Unknown fields, arbitrary entity IDs/UUIDs, semantic keys, JSON pointers, property paths, expressions and command references are forbidden. Backward-only ordering prevents cycles without a graph engine.

Runtime action IDs derive locally from request ID and ordinal. Boundary/Rectangle expose `ResolvedPolygonOutput (legacy alias ResolvedBoundaryOutput) {kind: 'created_polygon', entityId, vertexIds, references}`. This transient typed contract is separate from UI plan data and command payload internals; the dependent resolver consumes it explicitly. The model cannot supply it.

## Projected document

`resolveAiTaskPlan` resolves unique point names once against the base document, then evaluates actions in semantic order. Each ready mutation is compiled and applied to an unpublished temporary document with pure `applyCommandsAtomically`. `ResolveContext` exposes read-only base/projected documents, resolved reference map and typed prior boundary outputs. Only successfully projected polygon-producing actions enter the output map. New point names are resolved against private projection after their create_points action; existing names still share a cached base-document lookup.

Dependent dimensions obtain full-precision positions from the projected vertex registry. They reuse the boundary's ordered chosen references; no second ambiguity lookup occurs. Measures between existing points use the same base references and need no dependent geometry. Missing/ambiguous/invalid boundary yields its root error and one “blocked by Action N” message for the bulk action, rather than errors for every edge.

Projection never enters the editor reducer, history, dirty checks, autosave or notifications. The original document identity/content and shared vertex registry stay unchanged. If any action fails, the whole task is blocked, the public `projectedDocument` is null, all ghosts disappear and Apply cannot execute. Successful action metrics may remain visible for explanation; intermediate candidates never become canonical.

## Bulk semantic actions

A polygon stores ordered vertices without repeating the first. For `[v1,v2,v3,v4]`, local expansion creates `v1→v2`, `v2→v3`, `v3→v4`, `v4→v1`. The closing edge is mandatory. Each edge uses the existing Dimension resolver, target validation, geometry helpers and renderer.

Dimensions reference existing vertex IDs with `vertices: []`; they do not reference the polygon entity. Deleting the polygon therefore leaves dimensions valid while their vertices have consumers. Manual source-point edits update their lengths through the usual shared-reference behavior. Stable edge entity IDs derive from local runtime action ID plus edge ordinal and survive refresh, Apply and Redo. Canonical entities have no AI/dependency provenance.

World XY signed shoelace area uses a translated origin to avoid cancellation at large coordinates. `polygonOrientation` returns CW/CCW/degenerate. `alignedDimension` uses the left normal of A→B: CCW interior is left, so outward signed offset is negative; CW uses positive. Magnitude remains `clamp(horizontal length × 0.1, 0.5, 10)` metres. Each edge gets its own directed normal. This guarantees the local exterior side of each oriented edge; concave/narrow polygons can still have collisions or overlap elsewhere.

Bulk offset is Auto, without per-edge inputs. Existing explicit Dimension keeps its transient editable signed offset, bounded to ±10,000 m. Geometry/layout styles are not supplied by the model.

## Semantic action vs generated editor commands

Boundary + bulk is **two semantic mutation actions** but **N+1 editor commands**. With Measure added there are three semantic actions, N+1 commands and one read-only result. `mutationCount` counts semantic mutation actions; `generatedCommandCount` counts compiled commands. `taskCommands` flattens them in semantic order: polygon first, then all dimensions. The panel's “Apply N changes” uses compiled command count; a single command or unresolved plan retains “Apply”.

## Generated-command budgets

Central `AI_LIMITS` separately enforces:

| Budget | Limit |
| --- | --- |
| Semantic actions | 1–8 |
| Aggregate named point references | 1,000 |
| Generated mutation commands, whole task | 128 |
| Dimensions in one bulk action | 100 |

100 sides compile to 101 commands and succeed; 101 sides block the entire task before generating dimensions. Several bulk groups share the aggregate 128-command ceiling: two 63-side boundaries with dimensions compile to exactly 128; 129 is blocked. No prefix of an oversized group/task can Apply. The 128 ceiling leaves room for the 100-edge acceptance case plus other actions.

Other unchanged limits: 3–500 names for Boundary, 2–500 for Polyline, exactly two for Dimension/Measure; names 1–128 characters; request 8 KiB UTF-8, semantic response 96 KiB, upstream envelope 256 KiB, timeout 30 s, output-token cap 12,000. Streaming byte limits apply without Content-Length. Exact duplicate actions are rejected after name trimming. Local capacity is 50,000 entities / 1,000 layers and includes all projected mutations. Read-only tasks work at the entity ceiling. The independent general command-batch ceiling is 1,000.

## Atomic dependent execution

The execution gate checks task validity/readiness, immutable base-document revision, active coordinate transaction, all command schemas, command count/budget and availability of the completed projection. It dispatches the already compiled commands through `execute-batch` once. `applyCommandsAtomically` validates every input, applies to private candidates and checks final document/reference integrity and serialized-size budget before one commit.

The general addition kernel now processes consecutive `add-entity` commands with one entity-array copy and one entity/layer/style index per run. New vertices are copied lazily once and immediately become available to later commands. Added layers/entities/vertices own their payloads; locks/styles/capacity/references remain enforced. Single add-entity uses this same kernel. Mixed non-add commands preserve sequential semantics. Final validation/serialization remains centralized, independent of AI.

Any generated command failure leaves the original document, past/future, saved fingerprint and dirty/autosave inputs unchanged. One Undo removes polygon and all N dimensions while preserving points; one Redo restores the same objects/IDs. Snapshot history architecture is unchanged.

## Shared ambiguity and literal names

`resolveAiTaskPlan` collects unique requested names and looks each up once in `PointNameIndex`, cached by immutable entity-array identity. Names/choices are shared across boundary, explicit Dimension and Measure. Bulk uses the boundary output directly. Current positions come from the full-precision vertex registry. Alias/distinct-vertex validation stays per geometry action. Explicit choices are revalidated on refresh rather than silently replaced.

Literal provenance/order checks require exact case-sensitive names in user text. Pair notation P1-P2 is accepted with outer token boundaries; full hyphenated IDs such as КН-7 remain intact. There is no fuzzy name lookup or local NLP fallback. Hidden/locked sources can be references with warnings; targets must be visible/unlocked. Missing target layers are compiled once into the first relevant addition.

## Preview, stale and mixed results

`taskPreviews` flattens a ready bulk resolution into the existing `AiPreviewView`/`DimensionView` components. No parallel bulk SVG path exists. Both preview and command compilation consume the same references/positions/offsets; tests compare projected/applied entities and actual rendered dimension-line coordinates exactly. The panel shows ordered action cards, dependency target as “Action 1”, edge name pairs and local lengths, dimension count and Auto offset.

The immutable base document is an O(1) revision token. Any committed edit makes the entire mutation task stale: all ghosts disappear, Apply disables, refresh recomputes names, boundary geometry/area/perimeter, all edge lengths/outward default offsets and measurements. A stale Apply only refreshes; another explicit Apply is required. Explicit Dimension overrides survive only while endpoint identities match; bulk always recomputes Auto. Camera/selection/save do not invalidate a plan; New/Open clear it. Active coordinate drafts hide ghosts until commit rather than resolve every pointermove.

Measure-only tasks never generate commands/history/dirty/autosave and have no Apply. Mixed Apply commits only mutations; measurement results are recalculated against the final document with original runtime IDs and remain transient through Undo/Redo. No repeated mutation Apply is offered. Cancel/new request/New/Open clears results. One request runner preserves cancellation, timeout and obsolete-response guards for the whole task; there are no per-edge model calls.

## Security and privacy

The DEV endpoint accepts `{text}` and, for provider clarification, bounded structured `clarificationAnswers`; production sends the same user text/answers with the fixed prompt/schema directly to OpenRouter. The model receives user text, fixed parser instructions and strict JSON Schema. It receives **no GeoDocument, stored coordinates/geometry, actual edge list, point catalog, IDs, selection, ambiguity candidates, SVG, camera or history**. Explicit coordinates in user text are transmitted as user text. Bulk expansion is entirely local. User text itself is transmitted in full.

Output remains untrusted: strict wrapper/actions, literal names, bounded typed dependency checks and ordinary command validation are mandatory. Supported+unsupported mixed requests return null/unsupported for the whole task; no automatic extraction of a supported subset exists. Semantic completeness is a constrained model classification, not a mathematical proof of natural-language intent, so preview and explicit confirmation remain necessary.

DEV server credentials stay in ignored `.env.local`, without `VITE_` prefix. Production has no backend: the visitor configures a browser OpenRouter key in Settings. Upstream errors/bodies/keys are not logged or reflected. Loopback Host/same-origin checks, strict POST, byte caps, disconnect cancellation and deadlines remain. Static production output has no AI backend; without a visitor key it shows «AI не настроен», while CAD remains available. Exact configured-key scans of non-ignored repository files and production output print only safe results.

## Providers

`AiIntentProvider.parseIntent({text, signal})` remains SDK-independent. Canonical structured output is `{intent: {actions: [...]}, unsupported: false}` or `{intent: {status: "needs_clarification", questions: [...]}, unsupported: false}` or `{intent: null, unsupported: true}`; the endpoint returns task/clarification/unsupported. Prompt/schema instruct all-side requests to use one `create_dimensions_for_boundary_edges` with a prior boundary index, never enumerate pairs. A dangling bulk request, named/selected existing boundary or polyline-side request is unsupported at this stage.

OpenRouter uses configured primary `qwen/qwen3.5-27b` and instruct fallback `qwen/qwen3-30b-a3b-instruct-2507`, Chat Completions strict structured output, `provider.require_parameters: true`, temperature 0 and compatible reasoning settings. OpenAI retains Responses structured output/store:false with the same schema. Refusal, truncation, multiple completions, malformed JSON, unknown fields and invented names are rejected. There is no silent mock fallback or implicit model upgrade. Bounded transport retry/fallback follows [AI_OPERATIONS](AI_OPERATIONS.md); schema/provenance failures never retry. [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs). Local LLM provider and production backend remain deferred; production browser OpenRouter transport is implemented. Real providers are excluded from CI.

Mock fixtures cover all previous independent operations and the new boundary+bulk synonyms, Cyrillic names and mixed measurement example. `npm run dev:mock` supports the manual acceptance phrase exactly.

## Current dependency limitations

Prior newly created boundary/rectangle → all-edge dimensions, new points → named actions, and polygon → centered rectangle are supported. Existing-boundary all-side dimensions remain deferred. Named-entity/current-selection references and ambiguity for spatial placement are now supported by Spatial AI below; document selection queries use the separate local contract. No forward refs, arbitrary dependencies, DAG, arbitrary placement expressions, dependent Measure, polyline-side bulk, styles, label-mode action, offset boundary, partial Apply, per-action editing or collision-avoidance engine exists.

## Extensibility assessment and architecture concerns

| Possible later slice | Required contract/capability, not implemented |
| --- | --- |
| All edges of existing selected/named boundary | Explicit locally captured boundary target plus revision/selection gate and ambiguity policy; produce the same typed boundary output and reuse bulk expansion. Never infer selection in LLM. |
| Set point label mode | Strict schema and application-state gate/preview; this is currently EditorState, not a GeoDocument addition. |
| Offset boundary | Pure geometry resolver, robust offset/topology validation, explicit polygon output and generated-command budget. Complex geometry needs a separate policy. |
| Create point then use it | Typed created-point output, explicit allowed backward reference, projected vertex registry and shared-reference/ownership validation. Do not overload pointNames with runtime IDs. |
| Dependent Measure | Explicit typed allowed prior result and read-only resolver against projection; no command/history mutation. |

These can extend explicit unions/context/output contracts without a generic graph engine. No unresolved correctness concern is known in this slice. Known scale constraints remain full final validation/serialization, snapshot history and large SVG scenes. Projection performs full checks per semantic mutation group (maximum eight), not per generated edge. Consecutive additions avoid O(document size × edge count) copying/scanning. Future non-add bulk actions would need their own measurements; no general complexity claim is made for arbitrary mixed domain batches.

## Performance

| Edges | Resolve ms | Preview SSR ms | Atomic Apply ms | JSON growth bytes |
| --- | ---: | ---: | ---: | ---: |
| 4 | 51.28 | 0.71 | 26.40 | 1,151 |
| 20 | 58.86 | 2.52 | 27.19 | 5,420 |
| 50 | 57.33 | 6.34 | 28.49 | 13,372 |
| 100 | 57.19 | 12.65 | 29.16 | 26,617 |

Preview timing is SSR of shared components, excluding browser layout/paint. Resolution includes projection validation/serialization. One history snapshot retains the original document; old entities and the vertex registry are shared. At 10k points post-GC retained heap delta was about 112 kB for 50 edges / 120 kB for 100; GC readings are noisy (some small-document deltas negative), not exact allocations. Exact JSON growth and identity assertions accompany them. No timing threshold or heavy benchmark is added to CI.

## Previous dependent iteration verification

289 unit / 50 E2E: existing 249/44 retained (the previously unsupported bulk fixture now tests an unsupported delete suffix), plus 40 dependency/geometry/projection/budget/atomic/shared-vertex cases and six browser scenarios. All pass; typecheck, lint, production build and npm audit pass (0 vulnerabilities). Browser console/page errors: none. The existing two Zod Rollup annotation warnings remain.

Real OpenRouter, 2026-10-04, Qwen3.5-9B: boundary+all sides → two actions (2.544 s); Cyrillic contour+all sides → two (2.161 s); dangling all sides → unsupported (0.826 s); triangle+bulk+P1-P3 measurement → three (1.741 s). Every bulk references index 0; no edge enumeration. Only synthetic user text was sent.

Manual mock, 2026-10-04: imported full-precision P1–P4/КН-7; three semantic actions showed polygon+four dimensions+measurement, while canonical document stayed at five saved points with unchanged dirty/history. CW boundary area 650.237 m², perimeter 114.167 m; edges 17.395 / 27.822 / 42.824 / 26.126 m; Measure 14.894 m (3D 14.919 m). All four directed screen crosses were negative, the exterior side for this world-CW polygon. Apply produced ten entities; one Undo returned five and cleared dirty, one Redo restored the same IDs. Chrome Save exported ordinary entities, then the actual file opened in the in-app browser with ten entities/five vertices and identical mutation IDs; Measure was not persisted. The browser extension required additional file-URL access, so Open used the built-in browser without changing permissions. Proof: `/private/tmp/geoservice-ai-dependent-preview.png` and `/private/tmp/geoservice-ai-dependent-open.png`. Exact preview/Apply SVG geometry, no preview autosave writes and ordinary Save/Open are also verified by E2E.

## Point and rectangle construction

`create_points {points:[{name,x,y,z?}]}` extracts explicit X/Easting, Y/Northing, Z/Height. Up to 500 points/action, all creation names also count toward 1000 task references. Repeated names in an action or existing/projected points block; overwrite never occurs. Local literal provenance validates each requested point tuple or X/Y/Z assignment exactly, including optional Z; invented coordinates are rejected even if the provider returns a schema-valid task. Missing coordinates require clarification. Structured output null Z normalizes to absent Z, without dropping unknown fields. Unsupported axis remapping is not inferred.

`create_rectangle {name,width,height,placement}` accepts positive finite explicit dimensions, safe semantic name, and lower_left (explicit X/Y), center (explicit X/Y), local_origin (first action only), centered_in_action_result or anchored_in_action_result (backward polygonActionIndex; see Spatial Placement). The local resolver builds four axis-aligned corners in world units, obtains the previous polygon centroid locally and creates ordinary PolygonEntity. Rotation and arbitrary relations are not supported. Local origin (0,0) is disclosed in Preview assumptions; it does not assert real geodetic coordinates. Missing position for a second rectangle requires clarification only when neither explicit coordinates nor a supported spatial relation is supplied. Explicit dimensions/names/placements are guarded locally against user text.

Examples: `Создай P1 (0,0), P2 (30,0), P3 (30,20), P4 (0,20) и построй по ним границу` → points + boundary, one Apply/Undo; `Нарисуй участок 20×30 м, в центре дом 6×4 м и проставь размеры дома` → two rectangles + bulk (boundaryActionIndex 1), six ordinary commands, one history entry. House dimensions reuse the actual rectangle vertices and update when edited. Preview is rendered directly from command-bound resolutions and camera fits it once; ghosts/viewport are not document mutations.

## Clarification

`needs_clarification` permits 1–3 display-only questions, 1–240 chars each, no actions. It changes only AI state. The UI collects a user answer and sends original request plus `Уточнение пользователя: ...` as bounded USER TEXT; no document/context payload. Missing point coordinates, site size, garden details or network placement must not be invented. Unsupported gardens/gas engineering layout remains unsupported even after parameters are supplied. The mock is explicitly a fixed-fixture provider, not an NLP fallback.

## Future local model georeferencing

Rectangle construction operates in local coordinates. A later explicit georeferencing transform can map this local model to real projected coordinates; neither EPSG conversion nor hidden absolute elevation/CRS assumptions are part of this iteration.

## Precision/construction verification — 2026-10-04

334 unit tests / 60 E2E pass, retaining all previous 313/54. Typecheck, lint and production build pass. `npm audit --registry=https://registry.npmjs.org`: 0 vulnerabilities (the host default registry uses HTTP; no configuration was changed). Existing Zod annotation warnings remain. Browser regressions found during development (overlapping extension hits and duplicate Properties keys) were repaired before the final complete run.

Real OpenRouter `qwen/qwen3.5-9b`: six synthetic requests passed — points + boundary; site with local-origin assumption; site + centered house; site + house + four dimensions; missing point coordinates → clarification; vague site/gardens/gas request → clarification or unsupported, without geometry. The prompt explicitly treats local-origin placement of the first sized rectangle as complete. No document or secrets were included in model input or logs.

Manual browser: created/renamed/reordered a layer, double-click selected layer geometry, set 0.5 m grid, drew Shift45 and F8 Ortho lines, added a linked line label and moved its endpoint (10.000 → 10.548 m), dragged dimension offset and then text independently, applied points+boundary with one Undo/Redo, reviewed combined site+house+four-dimension preview and applied. Opened exported verification JSON with six layers, seven ordinary entities, linked “Дом” label and 6/4/6/4 dimensions. Browser console errors: 0. Proof images: `/private/tmp/geoservice-precision-preview.png`, `/private/tmp/geoservice-precision-result.png`.

## Spatial Placement

### Contract and clarification

`unwrapProviderEnvelope` in `src/ai/intent.ts` is shared by server adapters and client validation. The canonical strict JSON schema requests **root** `intent` and boolean `unsupported`. The runtime compatibility boundary also accepts the older `{intent}` envelope. It validates flag consistency: task/clarification → false, null/unsupported → true. Unknown root or nested fields, contradictory flags, malformed questions, extra geometry/inset fields and invalid references remain `INVALID_STRUCTURED_OUTPUT`. No unknown fields are stripped (only declared nullable Z/sizeSource normalize to absent optional fields).

The reported `{intent:{status:"needs_clarification",questions:[...]},unsupported:false}` now succeeds, with schema/local validation valid, action count 0 and no error code. Provider failures retain their HTTP taxonomy; unsupported and clarification are successful semantic states. Clarification never changes editor/history/dirty/autosave. The client collects a text-only follow-up.

Clarification means missing engineering information: explicit point coordinates, dimensions, absolute height datum or requested engineering distance. Missing absolute placement of a first sized site uses disclosed local origin; an approximate anchor with known object sizes uses disclosed sketch layout. A house without dimensions still requires clarification, even in a corner. A second rectangle without any relation still needs a position. Unsupported operations cannot be partially dropped.

### Semantic model and provenance

`anchored_in_action_result {polygonActionIndex, anchor}` has eight bounded anchors: north, south, east, west, north_east, north_west, south_east, south_west. Center keeps `centered_in_action_result`; explicit `lower_left`/`center` coordinates and first-action `local_origin` remain compatible. Both relative modes require a strictly earlier polygon-producing action. There are no IDs, forward references, expressions, offset fields or generic spatial DSL. Future north_of/along_edge/between would need separate typed variants and local resolvers.

The LLM extracts name, width, height, relation and backward index. It never computes child corners, inset, polygon metrics or dimensions and never sees GeoDocument. Digit dimensions retain exact numeric provenance checks. For word dimensions the model also returns bounded `sizeSource`, an exact user-text span containing a size pair. Local validation checks lexical presence and structure; it does **not** translate words into numbers. Numeric-only spans (including units) cannot bypass numeric checks. This is evidence of a source, not a proof that every numeral was translated correctly; normalized widths/heights must remain visible in Preview. There is no application phrase matching or numeral dictionary.

### Pure local policy and projection

`src/geometry/autoPlacement.ts` centralizes `resolvePlacement(parentBounds, childSize, anchor, options)`. MODEL metres are the only units. `AUTO LAYOUT INSET = min(2, max(0.5, 0.05 * min(parentWidth,parentHeight)))`. North/south center along X, east/west along Y, corners inset both axes. Each used inset is capped at `(parentAxisSize-childAxisSize)/2`, explicitly disclosed when reduced, including zero for exact fit. Center uses the existing geometric centroid (bounds center for rectangle parents), with no auto inset. Screen/viewport state is absent.

Parents come from typed projected outputs. Candidates use parent MODEL bounds and then test the entire child rectangle perimeter against the actual polygon, including concave notches, with boundary contact allowed. Oversized children or candidates outside a nonrectangular parent block the **whole** plan. There is no clipping, shape change or search for an alternative fit. No overlap detection/optimization is attempted.

`ResolvedAiTaskPlan.assumptions: LayoutAssumption[]` carries local_origin, relative_placement, auto_layout_inset and sketch_layout records. `formatAssumption` is presentation only. Preview shows one assumptions section with actual local inset values, second-axis centering and the non-normative disclaimer. Directions mean +Y/+X MODEL, not transformed SURVEY/true north. This slice never changes georeferencing or endpoint-retarget.

Site → house → edge dimensions resolves in private projection. For 20×30 and north 5×6, parent bounds (0,0)–(20,30), child bounds (7.5,23)–(12.5,29), inset 1 m, edge lengths 5/6/5/6. Commands and six ghosts use the same resolved geometry. Assumptions are not document metadata. Apply requires the unchanged full-plan gate, commits six ordinary commands via one batch/history entry; one Undo/Redo preserves IDs and references. An invalid fit cannot commit partial site geometry.

### Verification

## Existing-object spatial resolution

Canonical naming: Entity.name, derived normalized entity index, separate entity choice namespace. Strict named_entity/current_selection/prior_action_result references. Base document anchors named/selection sources; private projected outputs support backward dependencies. No document catalog/provider coupling.

Pure spatialLayout определяет compass frame, bbox gap, AutoPlacement containment и однозначную прямую side/chain. spatial resolver создаёт обычные Polyline или композицию RectangleReady; arrays reuse task commands/ghosts. Workflow captures current layer/selection; local layer switch preserves identities/choices and reruns projection. Selection changes invalidate only tasks using current_selection. Low-level/manual legacy layer policy retained; all AI task creation receives explicit targetLayerId. [SPATIAL_AI](SPATIAL_AI.md).

## AI Document Operations

The shared strict action schema now includes bounded document queries and select/find/fit/isolate/create-layer/move-to-layer/visibility intents. `src/documentOperations` owns deterministic local indexes, concept aliases/evidence, revision/selection guards and layer preflight. A task uses either the geometry resolver or document resolver; the provider never sees document IDs/catalogs/results. Document preview uses owner-bound overlays without rebuilding Canvas base geometry. Atomic layer commands use the general editor batch; view selection/fit/isolation has no history. [Full contract, privacy and acceptance](AI_DOCUMENT_OPERATIONS.md).

## Technological process semantic pipeline

Process actions join the unified strict wire schema but use a dedicated local resolver in src/process. Central semantic vocabulary/mapping/aliases → version-pinned definitions → role/facing/occupancy port choice → bounds-based layout → canonical command preflight. No low-level symbol/connector APIs are exposed to LLM. Process/geometry/document mixing is rejected. Dedicated process preview/stale states protect revision and selection; ghosts and Apply use the same canonical instances and routes. [Contract and concerns](AI_PROCESS_SCHEMES.md).

## Session AI settings and image privacy

Settings Center → AI owns enabled/provider/API key/model/fallback/Test connection. The assistant retains a compact status and settings button. Ordinary preferences persist separately from GeoDocument. By default the key stays in tab memory; explicit Remember writes the separate browser-local key record and unchecking removes it. No key enters document JSON or autosave. DEV can use the ignored server credential when the override key is empty; production requires the visitor's OpenRouter key and calls OpenRouter directly. Diagnostics/errors redact configured keys. Request content is user text, optional structured clarification answers, and fixed parser instructions/schema, never document context. See [Settings](SETTINGS_PREFERENCES.md) and [static deployment](PAGES_DEPLOYMENT.md).

Changing settings cancels an in-flight AI plan. Explicit Test connection sends a short static text prompt and validates a semantic response without document mutation. Only a successful check reports online; configured mode alone reports ready/unverified. Default privacy is prompt-only; future Semantic Assist/image analysis options remain disabled.

Image rectification, local vectorization and review are independent of the AI provider. They never send pixels, coordinates, geometry, layers or candidate arrays. No remote vision/OCR endpoint exists in V1. [Image architecture and verification](IMAGE_VECTORISATION.md).

## Semantic Learning V1

Teaching is an entirely local document operation. `GeoDocument.semantics` stores strict concepts/explicit positive or negative annotations/transparent rules via one canonical `set-semantic-knowledge` command. The AI provider only parses text into static semantic concepts or a user-typed `learned_concept` name. After validation, the existing Document Operations resolver joins owner metadata with local knowledge, shows evidence groups and retains explicit Apply/selection. Rules, aliases/catalog, source metadata, ATTRIB, geometry, images and match IDs are never added to requests. No remote Semantic Assist, embeddings or training. [Model and acceptance](SEMANTIC_LEARNING.md).

## Constraint planning and local continuation

See [SPATIAL_AI_CONSTRAINTS.md](SPATIAL_AI_CONSTRAINTS.md) for exact schemas, provenance, routing, conflicts, outcomes and defaults. `create_spatial_point`, `create_route` and rectangle `inside_boundary` constraints express relationships without model-generated coordinates. `constraintGeometry` supplies deterministic inset/perimeter/visibility arithmetic; `constraintResolution` binds local references. `task` retains private projected results, proofs, dependency graph, answers and questions. `ai-answer` refreshes the SAME plan locally; no provider call or editor mutation occurs. All existing creation/query/process pipelines and the atomic execution gate remain shared.

Normal provider bodies retain `{text}`. A semantic provider clarification may add only bounded `{clarificationAnswers:[{questionId,answer}]}` from the user. Original text stays intact; the adapter combines it with user answers for parsing/literal validation. Local entity IDs, geometry and choices remain local. Recoverable orientation/route/entity ambiguity is a structured local question; impossible data is INVALID, actual local capability limits are UNSUPPORTED. Unknown names and invented absolute coordinates remain rejected. Developer diagnostic details are separate from the normal human message.

## Release numeric provenance

Explicit Russian cardinal distances (0–99, including «трёх» and «пять») are checked as numeric literals, including compound tens. This does not infer spatial actions or authorize invented XY. Local constraint resolution still derives all anchored coordinates. [Release acceptance](REAL_WORLD_ACCEPTANCE.md).
