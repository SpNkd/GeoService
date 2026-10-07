# AI technological process schemes V1

User text → real/mock structured semantic task → strict validation → local definition/port/layout/connectivity resolution → ghost preview → explicit Apply → ordinary commands → one history step.

This is a bounded demo drafting workflow, without engineering calculations or normative validation. Existing Spatial AI and Document Operations retain their own resolvers. Mixing process actions with geometry/document actions rejects the entire task.

## Semantic catalog and library identity

`src/process/semantics.ts` owns whitelist, semantic aliases, mapping and internal tag prefixes. Provider prompt vocabulary is derived from it, without library/definition/port IDs or a document catalog. Supported concepts: input, output, shutoff_valve, valve, filter, pressure_regulator, gas_meter, safety_valve, instrument, generic_equipment. Unknown kinds and additional fields fail strict validation. Unknown equipment cannot silently become a generic block.

| Concept | Built-in definition | Internal demo tag |
| --- | --- | --- |
| input / output | equipment-block | ВХ-n / ВЫХ-n |
| shutoff_valve | shutoff-valve | К-n |
| valve | local choice: shutoff-valve / valve / check-valve / safety-valve | К-n |
| filter | filter | Ф-n |
| pressure_regulator | pressure-regulator | РД-n |
| gas_meter | gas-meter | СГ-n |
| safety_valve | safety-valve | ПК-n |
| instrument | instrument-point | КИП-n |
| generic_equipment | equipment-block, explicitly requested only | ОБ-n |

Input/output deliberately reuse the demo equipment block with distinct instance tags; no hidden new definition. Instrument has an instrument port and cannot be placed inline in a process chain. “Расходомер” is not asserted as an alias for the generic demo gas meter. These tags are internal demo conventions, **not ГОСТ**. Name collisions use the next free number locally. Explicit names must occur in user text and cannot overwrite an existing name.

New AI/manual Symbols pin `libraryId + libraryVersion + symbolId` to registered `gas-process-demo@1.0.0`. Known version loads normally; unknown library/version/definition rejects Open or insertion before mutation. Legacy v2 Symbols without libraryVersion mean the current registered version. Registry owns frozen definitions; portable documents do not embed them. No migration/version coexistence/downloading framework is introduced. Missing legacy versions cannot reconstruct historical packs if their meaning was changed outside this contract.

## Strict semantic actions

```json
{
  "actions": [{
    "type": "create_process_chain",
    "items": [
      {"ref":"step-1","symbolKind":"input","name":null},
      {"ref":"step-2","symbolKind":"filter","name":null},
      {"ref":"step-3","symbolKind":"output","name":null}
    ],
    "connections": [
      {"from":"step-1","to":"step-2"},
      {"from":"step-2","to":"step-3"}
    ]
  }]
}
```

`append_process_symbols {reference,items}` references an existing exact named Symbol (or a centralized semantic alias) or `current_selection`. Selection requires exactly one selected Symbol, including no incompatible extras. Exact duplicate names use a local chooser. Semantic alias references resolve only known definition identities; no fuzzy phrase matching.

`insert_symbol_between {from,to,item}` requires two distinct existing Symbols and an explicit existing Connector edge between them. “Direct” means adjacent graph endpoints, not the Direct routing mode: Orthogonal edges also qualify. Multiple edges require a local edge choice. An edge stored with reversed start/end is oriented to the requested from/to without losing its endpoint refs.

Refs identify steps within their action, never document IDs. Unique refs, exact ordered adjacent connections, 50 new Symbols / 80 Connectors per task and no branches are validated locally as well as through the provider schema. Provider does not expose create_symbol/create_connector/delete-entity or exact port IDs. Multiple bounded independent process actions are resolved in a private projection; any failure blocks the whole task.

## Local port and layout policy

Ports have optional inlet/outlet/bidirectional/instrument role metadata. Demo valves/filter/equipment remain bidirectional; regulator and meter use inlet/outlet; instruments use instrument. Roles supplement existing process/instrument compatibility and capacity, never replace it. Prefer matching flow role then the facing direction. Tied best candidates require a local port chooser, with no provider retry. A busy best downstream port blocks append rather than silently reversing flow or deleting its connection. Capacity/compatibility/layer/endpoint validation belongs to the existing Connector model and canonical command boundary.

`PROCESS_LAYOUT_POLICY`: clear symbol gap 3 MODEL units, row gap 6, reserved branch gap 6, Orthogonal default. Positions depend on transformed symbol bounds. New chains are left→right, centered around local visible viewport center. Each independent action receives its own row. No camera/coordinates are sent to LLM. Append starts downstream of the chosen output; following new Symbols remain horizontal. Insert uses the midpoint of original connection endpoints, without moving existing Symbols or obstacle solving.

All new chain/append Symbols and Connectors default to captured CURRENT LAYER; preview dropdown reruns local resolution on another writable visible layer. Insert's new Symbol uses that AI target layer, while both replacement Connectors inherit old routing/style/layer. Old waypoints are not copied to split edges: routes are recomputed from the new endpoint pairs. Preview discloses this policy.

## Preview, execution and persistence

Preview lists counts, target layer, definitions/version, tags, coordinates, connections, role assumptions, routing and replaced edge count. Ghosts use the ordinary SymbolView and canonical ConnectorView against the projected document. The old edge is hidden only in the ready insert preview; cancelling/staling restores its ordinary view. “Вписать preview” explicitly fits the ghost and its endpoint context without changing document/history. Camera does not auto-fit DXF while generating a scheme.

Local chooser resolves ambiguous definitions, named anchors, edges or ports. Diagnostics show semantic actions, resolved definitions/ports/positions/connections, validation and command count. The server receives only trace ID/status/action count for resolution diagnostics, never the local plan or document.

Preflight runs `applyCommandsAtomically` and existing connectivity validation on a temporary document. Apply checks current document identity (immutable revision), selection fingerprint where needed and absence of a transaction. Stale plans require explicit Refresh and another Apply; they never auto-commit. Commands are one ordinary execute-batch. Insert deletes only its resolved old edge before adding one Symbol and two valid edges. Any error rolls back the batch; one Undo restores the exact previous network and Redo preserves IDs/refs. Move/Rotate/Scale afterwards follow ordinary associative Connector semantics. Save/Open and IndexedDB persist canonical instances and refs.

## Real OpenRouter evidence — 2026-10-06

| Case | Expected | Success | latency min / median / max, ms |
| --- | --- | --- | --- |
| A: вход, кран, фильтр, регулятор давления, счётчик, выход | chain six + five | 5/5 | 3610 / 3985 / 8448 |
| B: вход → фильтр → регулятор → выход | chain four + three | 5/5 | 2630 / 2842 / 3012 |
| C: после выбранного фильтра регулятор и счётчик | selection append | 5/5 | 1676 / 2267 / 7286 |
| D: между клапаном К-1 и регулятором РД-1 фильтр | named insert | 5/5 | 1653 / 1716 / 1812 |
| E: две параллельные линии после крана | unsupported | 5/5 | 827 / 851 / 1127 |

Real browser integration additionally selected a private local filter, submitted C with **only text** in HTTP body, displayed two Symbol/two Connector ghosts, Applied and validated connectivity. No external document/catalog dependency. Paid tests are explicit opt-in, not normal CI:

```sh
AI_PROCESS_REAL_SMOKE=1 npx vitest run src/tests/process-real.test.ts src/tests/process-real-variants.test.ts
AI_PROCESS_REAL_BROWSER=1 npx playwright test e2e/process-schemes.spec.ts -g 'REAL provider' --workers=1
```

## Browser acceptance and DXF

Chrome mock acceptance: six + five full chain ghosts; target-layer override; Apply; exact single Undo/Redo; insert another filter between valve/filter with one removed/two added edges; Undo restores original. Append after meter in the complete chain correctly blocks because meter→output already occupies its capacity-1 outlet. The successful append acceptance **manually deletes that edge and disconnected Output first**, then generates/applies shutoff valve downstream; no AI network deletion is performed. Move and 90° rotation of that new valve preserve valid associative endpoints. JSON Save/New/Open and IndexedDB reload retain the network.

Additional Chrome tests: selection stale/refresh, valve chooser, chains 10/30/50 with explicit preview Fit and one Undo/Redo. Page/console errors asserted zero.

## Performance

| Symbols / Connectors | Resolver + preflight ms | Ghost SVG ms | Atomic Apply ms | Routes ms | Entity SVG render ms |
| --- | --- | --- | --- | --- | --- |
| 10 / 9 | 0.65 | 1.48 | 0.26 | 0.015 | 2.20 |
| 30 / 29 | 2.54 | 0.90 | 0.80 | 0.034 | 1.20 |
| 50 / 49 | 4.52 | 1.45 | 1.84 | 0.060 | 1.94 |

JIT warmup/order explains non-monotonic small SVG numbers. No claim of these timings on large DXF: canonical preflight still validates/serializes the whole projected document, and local projection/index rebuilding scales with the base document.

```sh
node --expose-gc node_modules/vitest/vitest.mjs run --config benchmarks/vitest.config.ts benchmarks/process.audit.ts
```

## Limits and architecture concerns

No free/junction endpoints, connector-to-connector tee, arbitrary branches, splitter semantic definition, obstacle/collision solver, hydraulic/gas calculations, normative validation, AI general deletion/rotation or full P&ID ontology. Demo tee has three passive ports but is not treated as an engineered splitter. No invisible generic fallback. Insert/append can overlap unrelated equipment; positions are disclosed for manual adjustment. Missing local anchors block; exact aliases are supported, not a general morphology/fuzzy search engine.

Library identity is minimally pinned, without historical pack migration. Definition choice and layout policy remain independent from LLM. Geometry/document/process preview discriminators keep boundaries explicit, but future capabilities may warrant extracting workflow handlers to avoid growing a central reducer. Canonical preflight cost on large DXF remains an architectural constraint. Suggested next single vertical slice: **manual Connector waypoint editing** with transient preview/grips and atomic Undo/Redo; not started.

## Final verification

Typecheck, lint, unit suite, production build and full Chrome E2E passed. E2E: **160 passed / 9 opt-in skipped**, plus separately enabled real-provider Chrome and real-reference DXF checks passed. npm audit with HTTPS registry: **0 vulnerabilities**. Focused process unit suite: **33 passed**. Console/page error collectors remain zero. Full unit suite: **797 passed / 75 opt-in skipped**. Dev-server remains REAL OpenRouter; no environment secrets or dependency changes are committed.
