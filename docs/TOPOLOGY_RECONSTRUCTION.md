# Explainable topology reconstruction V3

## Workflow

In MODEL Plan, import and explicitly apply reviewed image/PDF geometry and known symbols, or create Line/Polyline and SymbolEntity manually. **Правка → Восстановить связи** opens the shared Dialog. The initial scope is the current selection, including an empty selection; it never analyzes the document automatically. Choose selection, one layer, a learned concept, a complete-owner MODEL rectangle, or an image/PDF import run, then **Анализировать связи**.

Inspect Связи / Узлы / Пересечения / Разрывы / Незавершённые концы. A route lists deterministic evidence, both port choices, its conversion eligibility and ordinary-geometry fallback. Hover/select displays only the relevant path and ports in a lightweight SVG canvas overlay; Fit navigates without document mutation. A compact fitted preview is also available in the Dialog. Confirm, reject or leave each route as geometry. Bulk acceptance covers only eligible STRONG routes; ambiguous port choices, pending crossings, repaired gaps and branches are excluded. Changing scope clears stale analysis/review. Changing a geometric decision reruns local analysis and requires reconfirming routes.

**Применить связи** replaces eligible confirmed paths in one execute-batch command. Cancel/Escape/Worker cancellation leave the canonical document, history, dirty state and autosave unchanged. Viewport Fit is view-only. One Undo restores exactly the document before topology Apply, including source geometry, vertices and semantic annotations. No permanent candidate graph is saved.

## Candidate graph and scope

`src/topology` consumes canonical, planar MODEL Line/Polyline geometry from native drawing, AI, DXF, image reconstruction and vector PDF. Preview candidates can be converted through the existing `candidateCommands` adapter; the editor exposes topology after the prior explicit import Apply. Paper Space, nested DXF primitives, Arc/Circle/Polygon and nonzero-Z paths are not expanded as network routes in V3.

Transient nodes: `line_endpoint`, `symbol_port` (an endpoint carrying transformed canonical port alternatives), `geometric_junction`, `free_endpoint`. Edges: `traced_route` portions referring to source owners; `candidate_connection` for a user-accepted small gap. Route candidates collect source-owner IDs, full ordered points, graph-edge/node references and endpoint alternatives. Original geometry is not copied into a second canonical network.

Selection/layer/area/import scopes filter owners before structured cloning. The Worker receives only necessary canonical types, referenced vertices, semantics, port occupancy and locally registered library definitions; DXF definitions and Paper containers are omitted. Concept scope evaluates the same local `learnedMatches` rules and explicit annotations with EXACT/STRONG tiers; weak-only suggestions are excluded. Explicit conflicting categories suppress endpoint merging, crossings and gap connections. Merely sharing a layer or seeing OCR text does not declare a pipe or medium. OCR does not establish connectivity or rank a port as engineering truth in this version.

## Junctions and crossings

Segment bounds use a BVH; only spatially overlapping pairs are examined. Intersections split source path portions in the transient graph. Exact coincident endpoints cluster through a local point-cell index. Three incident compatible portions propose a STRONG T with “Три сегмента сходятся в одной точке”. A repeated canonical vertex is CONFIRMED adjacency, not a physical tee claim.

Proposed T nodes can be confirmed transiently or rejected. Rejecting a noncanonical true T separates its branch from the straight continuation, preserving the branch owner; a faithful port-to-port continuation may then be converted. Shared canonical adjacency is not edited by this navigation/reconstruction workflow.

Interior X crossings are AMBIGUOUS and disconnected by default. Unshared coincident polyline vertices with four incident portions are also treated as an ambiguous X. **Соединено** merges the transient node; **Просто пересекаются** preserves separate continuations. Source owners touching pending crossings cannot be replaced. Connected branching routes stay Line/Polyline because existing Connector has no permanent junction endpoint. Overlapping collinear paths and explicit incompatible categories are rejected for conversion; no duplicate visible route is generated.

## Tolerances and gaps

Diagnostics expose actual exact/port/gap distances and the 8° collinearity limit. `scale` is median size of nearby library symbols, falling back to median selected segment length. Exact clustering uses max(scale × 1e-7, coordinate magnitude × machine epsilon × 16). Port tolerance uses max(exact, min(scale × .08, max(scale × .005, metric pixel resolution × 6, explicit stroke metric width × 1.5))). The raster allowance covers source pixels plus skeleton endpoint erosion, not arbitrary proximity. New image provenance freezes `modelUnitsPerPixel` from the accepted transform so later underlay resizing/deletion cannot alter topology tolerances; legacy provenance can use original raster dimensions.

Gap tolerance is max(port tolerance, min(scale × .1, max(scale × .035, pixel resolution × 3, stroke metric width × 2))). Only facing, nearly collinear free endpoints with compatible categories produce AMBIGUOUS gap candidates. Evidence includes MODEL distance and angle. A gap is never bridged automatically: accept the gap, then confirm the resulting route separately. Large/non-collinear gaps remain free endpoints. Nearby ports outside tolerance produce inspect/Fit information, never an attachment.

## Ports and route fidelity

Canonical library position/rotation/defaultSize/instance scale transform each port to MODEL. Indexed endpoint matching lists nearby alternatives, approach orientation and distance. Existing `portCapacity`, `portTargetError`, kind compatibility and connectivity index are reused. Occupied or process/instrument-incompatible pairs are rejected. Multiple plausible ports or independent ends competing for one port require individual review. `directionDeg` is approach orientation; no flow is inferred from bidirectional/passive roles.

The route tracer walks actual path portions between known port alternatives, deduplicates reverse paths and retains branch/gap evidence. It creates one proposal for a multi-owner path, not one Connector per line fragment. Both reviewed endpoints must resolve to different confirmed SymbolEntity owners and available compatible canonical ports.

Conversion compares the simplified traced path against actual `connectorRoute` for existing **direct** and **orthogonal** routing. Ordered corners and endpoint displacement must agree within the displayed source-aware tolerance. Complex shapes, partial owners, loops/branches, shared external vertices, attached labels, mixed layers, differing styles and locked layers stay ordinary geometry. V3 does not author new waypoints; it does not silently straighten complex imported paths.

## Source geometry and canonical Apply

Chosen policy: atomically replace only the complete, faithful, unbranched source owners with one ordinary ConnectorEntity. All graph portions of each owner must belong to that route. The visible unlocked layer and common explicit style are retained. No hidden source duplicates are introduced. Unsupported/unconfirmed owners remain exactly as before. Conflicting accepted routes competing for a port/source abort the whole Apply with a human message.

Connector `topologySource` stores `source:'topology-reconstruction'`, bounded sourceGeometryIds, optional single sourceImageRunId and `resolution:'user-confirmed'`. IDs describe creation provenance; they are historical after replacement, not live geometry links or a fidelity guarantee after manual editing. Properties uses the existing collapsed Source section, showing origin/count/confirmation rather than graph arrays. Common explicit positive source annotations transfer atomically; unsupported assumptions and weak rules do not become engineering facts.

After Apply, normal connectivity indexes, Search, Teach, local AI document queries, manual retarget, symbol movement/rotation/scale, deletion protection, JSON and IndexedDB operate on the same Connector/Symbol model as manual tools and AI Process Schemes.

## Image and native PDF integration

Compact disconnected internal strokes inside a symbol contour are combined before signature ranking. Equally plausible library matches are surfaced as unknown/reviewable regions, never silently assigned. The deterministic Filter fixture ties with Gas Meter under the existing permissive signature comparison, so the test explicitly selects Filter before confirmation.

Native PDF **Распознать символы из векторов** groups native candidate bounds and compares normalized vector signatures locally; it does not rasterize page content for recognition. It uses the same explicit symbol review, fit and accepted-contained-geometry replacement policy. Re-recognition restores replaced choices and clears confirmation. PDF rendering remains only the existing visual preview; no RasterUnderlay is created for native conversion unless explicitly requested.

## Privacy, performance and limits

No topology code calls an AI/provider/fetch endpoint. Geometry, IDs, ports, symbols, OCR, semantics and graphs remain browser/Worker-local. Raster/PDF topology interception records zero external requests; raster also records zero AI intent requests. No new dependency, provider configuration or remote Vision adapter was added.

BVH segment/endpoint/port indexes avoid whole-document all-pairs comparison. Limits: 2000 scoped owners, 6000 segments, 100000 overlapping pair checks, 2000 crossing/overlap findings, 100000 route traversal steps, 500 edges per traced route, 1000 route candidates, 30-second Worker watchdog. Human messages ask for a narrower scope when limits are reached. The Dialog caps individual groups at 100 rows; bulk only accepts eligible STRONG routes. Heavy analysis/cancellation runs in a disposable Worker. Apply reuses the existing synchronous canonical command pipeline; huge bulk edits are not promised zero main-thread cost.

No persistent JunctionEntity, junction/viewport editing, waypoint editor, 3D slopes/risers, inferred obstacles, medium, diameter, pressure, safety class, equipment function, flow, standards or engineering correctness. Arbitrary mixed layers/styles and complex path conversion remain deliberate limitations. The next suggested slice is explicit route fidelity/2D routing design plus richer anonymous diagram evaluation; it is not started here.

## Reproduce verification

`npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm audit --registry=https://registry.npmjs.org --json`.
