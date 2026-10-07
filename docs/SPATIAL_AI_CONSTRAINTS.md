# Constraint-based spatial AI and resumable planning

The model extracts dimensions, relationships and typed references. It never calculates final MODEL coordinates. The local resolver produces a private projected document, reviewed assumptions, explanations and coordinate proofs. Explicit Apply commits the entire plan as one history step. Cancel, clarification and changing an assumption never alter the canonical document, its dirty state or autosave.

## Permanent reported regression

```
нарисуй участок (20 на 30 метров), на нём на северо-западе дом
(5 на 6 метров), на юго востоке - газовый кран, от него труба
по границе участка до дома. Все сооружения должны быть отдалены
от границ участка на 3 метра. Проставь размеры на доме
```

Semantic dependency graph: plot → house; plot → valve; plot + house + valve → route; house → four dimensions. Five actions compile to eight canonical commands: two Polygons, one named Point, one Polyline and four Dimensions. No engineering Connector or equipment identity is invented.

The chosen sketch orientation is width along MODEL X, height along MODEL Y, north +Y and east +X. Plot corners are (0,0), (20,0), (20,30), (0,30). House external extents are X=3…8, Y=21…27. The valve is X=17, Y=3: **17 = plot.maxX 20 − east inset 3**, **3 = plot.minY 0 + south inset 3**. The provider supplies neither coordinate. Both are RESOLVER_DERIVED. Four house dimensions are 5, 6, 5 and 6 m.

The route starts at the valve, projects to the plot boundary, chooses the shorter perimeter direction, then leaves the boundary to the nearest house-contour point. Equal-distance projections use source-edge order; equal-length perimeter paths use forward order. In this fixture the route is (17,3) → (17,0) → (0,0) → (0,21) → (8,21). Pipe boundary following includes the boundary itself and stays inside it. The general 3 m clearance applies to house and valve; this explicit sketch assumption is visible before Apply. No clarification is required by the documented defaults.

## Exact semantic schemas

Schemas are strict Zod objects in `src/ai/constraintSchema.ts` and `src/ai/intent.ts`; unknown fields, coordinates on semantic point actions, arbitrary IDs, expressions and commands are rejected.

`ConstraintReference`:

```ts
{kind:'action', actionIndex:0..7, result:'point'|'object'|'boundary'}
| {kind:'named_entity', name:string}
| {kind:'current_selection'}
```

An action reference must precede its consumer. `point` means exactly one point output; `boundary` means a Polygon output. A house is an `object`, never a fake point named Дом. Between-point placement requires point references, containment and route boundaries require boundary references. A local result registry and cached document-name indexes resolve identity. The exposed dependency graph includes legacy polygon and bulk-dimension references too; backward ordering prevents cycles.

`create_rectangle` retains all previous placement variants, sizes, sizeSource and behavior, and adds:

```ts
orientation?: 'MODEL' | 'SWAPPED' | 'ASK'
placement: {
  type:'inside_boundary', reference:ConstraintReference,
  anchor:'center'|'north'|'south'|'east'|'west'|
         'north_east'|'north_west'|'south_east'|'south_west',
  inset:{north:number,south:number,east:number,west:number},
  minimumClearance:number, offsetAlongSide:number|null
}
constraints?: (
  {type:'anchor',value:Anchor} |
  {type:'fixed_side_distance',side:CardinalDirection,distance:number} |
  {type:'containment',value:'inside'|'outside'} |
  {type:'alignment',relation:'parallel'|'perpendicular',reference:ConstraintReference}
)[]
```

Inset/clearance values are finite, nonnegative and literal distances from the request. `inset` and `minimumClearance` impose minimum extents clearance; `fixed_side_distance` imposes exact equality and cannot silently override a minimum. `offsetAlongSide` is measured eastward from the inset west edge on N/S sides, northward from the inset south edge on E/W sides. Null centers along the free axis. `SWAPPED` exchanges the two axis dimensions, giving a 90° rectangle orientation. Parallel/perpendicular alignment resolves locally against an axis-aligned reference edge. Multiple incompatible exact/containment/direction constraints remain explicit and fail with a readable explanation.

```ts
{type:'create_spatial_point',name,placement:
  InsideBoundaryPlacement |
  {type:'between',from:ConstraintReference,to:ConstraintReference} |
  {type:'relative_to',reference:ConstraintReference,
   direction:'north'|'south'|'east'|'west',distance:number}}

{type:'create_route',name,source:ConstraintReference,target:ConstraintReference,
 boundary:ConstraintReference|null,
 mode:'DIRECT'|'FOLLOW_BOUNDARY'|'ORTHOGONAL'|'SHORTEST_INSIDE'|'ASK',
 boundaryOffset:number}
```

Relative point gap uses the reference's outer bounds, with centering on the other axis. Between uses the arithmetic midpoint of two point outputs. Existing rectangle relative placements, inside/center anchors, arrays, side-parallel lines, current selection, named-point boundary/polyline/dimension/measure and bulk dimensions retain their existing resolvers. Newly derived points can feed those legacy named-point actions.

## Coordinate provenance and validation

- USER_EXPLICIT: coordinates literally entered by the user, including a structured user clarification answer. `Создай точку Кран X=17 Y=3` remains accepted.
- RESOLVER_DERIVED: local arithmetic applied to validated dimensions, semantic relationships, object extents and typed producer outputs. The temporary plan retains constraint, dependencies and resulting coordinates. Dimension endpoints inherit the house's derived vertex references.
- LLM_INVENTED: absolute model coordinates lacking exact user evidence are rejected before resolution, as before. The developer diagnostic labels coordinate rejection; no semantic action admits x/y fields. Numerical distances cannot be fabricated from unavailable values either.

There is no phrase-matching production fallback. Mock fixtures are explicitly test-only. The prompt contains general examples using different dimensions, asks for relationships rather than coordinates and preserves conflicting constraints. Canonical Russian noun endings for new object names (e.g. трубу → Труба) are a lexical evidence check, not a command parser or a coordinate derivation.

## Routing

DIRECT connects source and target contour endpoints. ORTHOGONAL tries the two L paths in stable order and selects one contained by the boundary, if supplied. FOLLOW_BOUNDARY compares two projected perimeter traversals, including access/exit segments. SHORTEST_INSIDE uses a deterministic visibility graph on a simple polygon; it has no inferred obstacles. All output is an ordinary Polyline; positive boundaryOffset is supported for axis-aligned rectangle boundaries only. Invalid offsets, coincident ends, impossible inside paths and out-of-bound segments block Apply. Boundaries above 128 vertices return a capability explanation rather than attempting an unbounded graph.

## Outcomes and clarification

`ResolvedAiTaskPlan.resolutionStatus` is RESOLVED, NEEDS_CLARIFICATION, UNSUPPORTED or INVALID. Recoverable local questions use `questionId`, prompt, kind, options and context. Current structured local kinds are single_choice and entity_choice. Missing semantic dimensions still use the existing provider free-text clarification. Invalid/impossible known geometry takes precedence over asking orientation or route questions.

An explicitly strict/unspecified orientation yields MODEL/SWAPPED options. Explicitly requested route choice yields four route options. Two equally named roads yield a local entity choice. Center placement, specific north/side/corner inset, midpoint and an unambiguous directional gap do not ask for calculated coordinates. Unknown existing object names remain actionable missing-reference messages.

A continuation retains the same plan ID, original request, typed task, resolved action entries, unresolved questions, local answer map, choices and assumptions. Answering a local question refreshes private projection through the same deterministic resolver. It makes **zero additional provider calls**. Already parsed semantics remain unchanged. Stale plans must be refreshed before Apply; local question controls are disabled while stale or editing a transaction. Current selection dependencies participate in the existing stale-selection gate.

When new semantic information really requires a provider parse, the HTTP body is exactly:

```json
{"text":"original user request","clarificationAnswers":[{"questionId":"provider-clarification","answer":"user-typed answer"}]}
```

No document geometry, object IDs, point registry, layers, learned rules, DXF/PDF/image/OCR content or selection context is added. The adapter presents the original text and those user answers to the provider together with the static prompt/schema. Local entity-choice IDs never enter this body. Explicit coordinates typed by the user remain legitimate text. The optional answers array and each answer are bounded and strictly validated.

## Preview and errors

The existing AI panel presents relationships, extents clearance, routing and assumptions. Constraint coordinates/references are collapsed. Users can change rectangle orientation or route choice locally, accept with Apply, or Cancel. Default local origin, MODEL orientation, inward boundary-following convention, nearest target contour and the generic valve Point convention are explicit. This sketch is not a normative gas design.

Human errors wrap and expand without fixed height/clipping. Only verbose technical details scroll. Specific errors retain useful names/distances; generic provenance failures explain that unsupported data was proposed. Trace IDs, LOCAL_VALIDATION_ERROR and raw intent stay under Подробнее/Diagnostics. Conflict examples include north AND south, inside AND outside, two incompatible fixed side distances, insufficient clearance, and a 25×35 house on a 20×30 plot with 3 m clearance. Invalid known geometry does not trigger a clarification loop.

## Diagnostics, performance and reproduction

Provider diagnostics separate schema and literal semantic validation; local diagnostics report constraint resolution, clarification count, derived proof count, dependency graph, local answers and solve/dependency/route timings. They are ephemeral, redacted and not saved in the document or sent to the provider. The existing same-origin development resolver report contains only trace/status/action count.

The REAL test uses the existing ignored .env.local, records actual model/provider intent and four cases (original, genuine strict orientation with local resume, explicit coordinates, equivalent semantic route). It never prints a key or substitutes mock on the running server.

## Limits and suggested next slice

Exact side insets currently require an axis-aligned rectangular MODEL boundary. Relative legacy SURVEY placement remains unchanged; new explicit-inset semantics are MODEL only. Arbitrary rotated-boundary insets and non-axis alignment need a future oriented geometry solver. No inferred obstacles, obstacle avoidance, normative engineering clearance, Symbol ports, generic nonlinear constraints or equipment type assignment are implemented. The gas valve remains a named sketch Point; the existing process shutoff-valve library belongs to a separate explicit process workflow and is not silently inserted into a spatial plan. Local numeric/distance/multichoice editors and spatial-category entity selection can be added later if needed; V1 offers structured orientation/route/entity choices plus legacy free text for missing semantic data.

Recommended next slice: evaluate equivalent Russian spatial requests on a fixed open-weight model corpus, then extend the local solver to oriented boundaries. Do not begin automatically.
