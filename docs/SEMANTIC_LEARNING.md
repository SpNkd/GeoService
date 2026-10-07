# Semantic Learning / Teach GeoService V1

GeoService learns a **local, deterministic document rule**, not an engineering truth. The user supplies the category. No neural training, embeddings, remote classification, pixel recognition or fine-tuning is involved.

## Workflow

Select one or several canonical MODEL owners → **Правка → Научить GeoService** (also **Properties → Смысл → Научить по выбору**) → choose/create a category, aliases and optional parent → **Предложить правило** → inspect required/supporting facts and EXACT / STRONG / WEAK groups → select / highlight / Fit a group or an individual candidate → toggle groups, exclude individual owners / **Это НЕ …** → **Запомнить**.

The compact dialog explicitly says **Только этот документ · локально · без отправки в AI**. Preview, Fit, group inspection and Cancel do not mutate the document, history, fingerprint or autosave. Save validates the whole knowledge payload before dismissing the dialog and dispatches one `set-semantic-knowledge` command with a stale-document guard. Save is one Undo operation.

**Правка → Смысл / категории** manages names/aliases/parents, enabled rules, inspection/refinement, exclusions and deletion. Refinement selects required / supporting / ignored facts; removing a fact does not make it disappear from the current editor's fact catalogue. Properties supports explicit add/remove labels and negative labels. A removed explicit label can still match a rule; the separate **Это НЕ …** action rejects it.

The shared [Dialog system](DIALOG_SYSTEM.md) traps Tab, consumes topmost Escape once and restores focus with `preventScroll` to the opener/visible summary. It uses shared toolbar popup dismissal and shortcut suppression. Space-pan after dismissal remains available; modal text entry is never treated as editor input.

## Canonical data model

Optional `GeoDocument.semantics` contains `SemanticKnowledge {version:1, concepts, annotations, rules}`. Existing schema version **2** is retained, as with optional image metadata; older documents without the field still open. Knowledge never rewrites `entity.source`, `imageSource`, geometry, layer membership or block definitions.

- `SemanticConcept`: stable ID, display name, aliases, optional `parentConceptId`, optional description. A central registry contains the former ten Document Operations concepts and nine new generic concepts: `pipe`, `gas_pipe`, `water_pipe`, `cable`, `electricity`, `fence`, `equipment`, `valve`, `well`. Legacy plural IDs such as `buildings` and `roads` are preserved for compatibility.
- `SemanticAnnotation`: canonical owner ID, concept ID, positive/negative polarity, `user-explicit` or `rule-confirmed` source. Explicit examples are separate from dynamic rule results.
- `SemanticRule`: ID, concept ID, `scope:document`, version, required/supporting categorical conditions, enabled flag, enabled tiers, positive example IDs and exceptions.

No floating confidence percentages. Exact/Strong/Weak are deterministic evidence tiers. User-created concepts and Russian aliases normalize NFKC, case and ё/е. IDs, names and aliases must not ambiguously identify two concepts. Parents must exist and be acyclic. A parent query includes explicitly declared descendants. It does not infer business/engineering properties.

Limits: 200 document concept overrides/custom concepts, 200 rules, 100,000 annotations, 12 required + 12 supporting conditions per rule, 50,000 example/exception IDs. Strict schemas reject unknown fields, invalid references, duplicate annotations/rules/conditions and reserved identifiers.

Scope is **document only**. A new/unrelated import gets no old rules. V1 does not implement a separate reusable local-user knowledge store. Built-in categories remain in the static registry: deleting their document knowledge removes overrides/labels/rules and restores registry defaults. A custom category with children cannot be removed until their parent is changed.

## Feature extraction and reuse

`src/semantics/features.ts` extends the existing `documentQueryIndex` owner/text/block metadata and provenance caches. It does not introduce another text-search backend. Connector relations reuse `connectivityIndex`.

Implemented facts:

| Class | Facts |
| --- | --- |
| Identity/provenance | Entity kind, current GeoService layer name, original top-level DXF layer/type, native/DXF/image origin |
| Geometry | Length/area/size classes, vertex-count class, open/closed state, aspect ratio; block/symbol scale class |
| Effective style | Color, line type/dash, width, fill, opacity, color source (ByLayer/explicit/source), text size |
| Own text | Bounded normalized TEXT/MTEXT/ATTRIB/static definition tokens through the existing index; no arbitrary nearby-label association |
| Blocks | Stable definition ID, source name, cached direct-definition composition signature, current ATTRIB key schema |
| Symbols | Stable library ID, symbol ID, bounded explicit symbol properties; no traversal of rendered symbol primitives |
| Real topology | Shared canonical line/polyline endpoint IDs, Connector endpoints / Symbol ports, incident relation count and connected owner/symbol kinds |
| Image-derived geometry | `image-vectorization` origin and candidate type; raster asset/run IDs are not matching conditions |

Continuous classes use powers of two, after six-significant-digit normalization; effective width uses three significant digits and opacity two decimals. Tiny numeric noise is tolerated within a class. Class boundaries remain a V1 limitation. Area uses local-origin arithmetic. **No absolute X/Y/Z, camera, zoom, projection or screen coordinates become semantic identity.** Geometry measurements are plan XY, not engineering/3D lengths. Symbol/block scale class is scale rather than expanded geometric extents.

Block signatures count direct primitive categories / path closure & vertex class / ATTRIB keys / nested definition references. They are supporting evidence, not a proof of geometric equivalence or a portable standard. No recursive primitive expansion per match/keystroke.

Topology never uses proximity. Relation counts are endpoint/port incidences, not deduplicated neighboring owners: two shared ends are two relations. It does not infer flow, pressure, network suitability, material or compliance.

## Rule induction

Take the intersection of facts across the selected examples. Contrast each fact against all canonical owners in this document. A fact occurring on at least 80% of owners is broad; layers named `0` / `default` are explicitly broad. Find a discriminative anchor in priority order: block definition, symbol ID, source layer, current layer, image candidate, ATTRIB schema, line type, color, width. Include shared entity kind when available, and at most three useful supporting facts.

Source and current layer names retain the actual spelling. Conditions never learn an exact owner ID, source handle, asset/run ID or position. Example IDs are references for annotation/explanation/history, not matching features. Different example lengths do not enter the shared intersection. A single length bucket can be supporting evidence; it does not prevent a core-compatible object of another length from being STRONG.

If no distinctive anchor exists, warn the user. Kind-only rules produce WEAK hints; the user can still explicitly label the chosen examples. Mixed examples with a genuinely shared discriminative source layer can form a layer rule without a common kind. User refinements are explicit; they are not hidden scoring changes.

## Exact / Strong / Weak

A candidate is obtained from the union of inverted fact postings. It needs at least one required fact to match.

- **EXACT rule**: all required facts match, there is a required fact more specific than kind/text-token/import-kind, and all supporting facts match. Empty supporting facts count as fully matched.
- **STRONG rule**: all required facts match with that specificity, but one or more supporting facts differ. The explanation lists both matching and differing supporting facts.
- **WEAK**: some required facts differ, or the rule only has broad kind/text/origin requirements. Disabled by default.
- **Explicit positive**: separate EXACT evidence stating the user assigned/confirmed the category; it is not presented as a rule certainty.

Source, matching required/supporting facts, missing facts and current positive example count are shown. A known block definition is displayed by source name. No inferred percentage is displayed.

Group switches determine which tiers the saved rule supplies. The original examples remain explicit labels even if their group is switched off. If the user explicitly accepts WEAK, those accepted owners get separate `rule-confirmed` positive annotations. Turning off/deleting a rule preserves explicit labels. Changing to another subtype does not silently add a new ontology relation.

## Negative examples

An unchecked candidate / **Это НЕ …** stores a negative annotation and document rule exception. Negatives override dynamic rules and former intrinsic/alias evidence for that queried category. A rejected example is removed from the rule's positive example references. Geometry is retained. Clearing a reviewed exception removes the corresponding negative and restores matching. Unrelated negative labels are preserved.

V1 uses owner-level exceptions; it does not synthesize a negative feature classifier. Rejecting an example does not silently re-induce every condition. The user can explicitly refine the conditions. Negative labels on a parent suppress inherited child matches for that parent query.

## Search and AI

Existing Search recognizes category names/aliases and declared parent categories. Results show explicit/rule evidence and tier under **Почему найдено**. Weak hints have a separate off-by-default checkbox. Select, Fit and temporary isolation use existing editor actions and do not create document history. UI renders at most 100 rows; bulk result actions use **all** matching IDs, not merely those first rows. Existing scope filters apply. Canonical knowledge is resolved against MODEL owners, even when plaintext search also includes derived Paper-owned rows.

AI's static strict schema accepts `semantic_concept {concepts:[pipe]}` and `learned_concept {name:"трубы продувки"}`. The custom name must occur in user text, then resolve to a known category/alias locally. Unknown categories fail with a teach-first explanation. No guessed metadata predicate is generated. Existing preview grouping excludes WEAK by default.

REAL examples, checked through the existing OpenRouter configuration (`qwen/qwen3.5-27b`, DeepInfra on this run):

```json
{"type":"select_entities","query":{"scope":"document","kind":"semantic_concept","concepts":["pipe"]}}
```

```json
{"type":"select_entities","query":{"scope":"document","kind":"learned_concept","name":"трубы продувки"}}
```

Each resolves locally to `pipe-1`, `pipe-2`, `pipe-3` in the synthetic acceptance document, excluding `pipe-4`. The provider only receives user text + static instructions/schema. It does not receive rules, aliases/catalog, layers, ATTRIB, text fragments, IDs, match groups, geometry, coordinates, raster bytes or document contents. Browser calls use the existing strict `{text}` body. User text itself may of course include a name the user typed.

## History, persistence and view independence

`set-semantic-knowledge` structurally validates and owns its payload, checks references, and changes only optional knowledge. Equal knowledge is a no-op. Add/remove explicit label, teach save, rename/aliases/parent, rule refinement/toggle/delete and category deletion are document mutations with ordinary Undo/Redo. Preview, Fit, Search, selection, isolation and view navigation are not.

JSON Save/Open, IndexedDB autosave, the persistence worker and document fingerprint include knowledge. Reload restores knowledge; transient view/modal/search state and Undo history follow existing persistence policy and are not reloaded. Entity deletion prunes its annotations/example/exception references; Undo restores them. A categorical rule can remain after the last original example is deleted.

MODEL entities keep one ID in Plan, rotated Plan, axonometry and active Paper MODEL viewport. Highlight reuses the renderer's owner-bound overlay, including sheet viewports and the active viewport Canvas. Paper-owned entities / nested definition primitives are not teachable in V1; select their canonical MODEL owner instead. Source layer visibility and VP Freeze remain rendering concerns and are not semantic identity.

## Performance and invalidation

Feature indexes cache immutable owner arrays with their vertex/layer/style/block dependencies. Per-owner caches reuse summaries whose entity, layer, style registry, block registry and referenced vertices are unchanged. Metadata-only knowledge and view changes reuse the feature index. A single geometry/style/ATTRIB/symbol-property edit recomputes its affected owner's facts; unrelated owners reuse summaries. A style/block/layer registry revision invalidates dependent facts. Canonical endpoint relations are rebuilt linearly; cached Connector topology is reused. No repeated expensive nested geometry scan on movement/keystrokes.

The query resolver keeps existing bounds (10,000 results / 2,000 explanation groups / 20 evidence records per owner). Rule candidate postings and negative indexes avoid per-candidate annotation scans. Search retains its existing 180 ms debounce. New dialog code loads lazily.

Reproduce reference measurements:

REAL smoke remains opt-in, uses the existing ignored configuration, sends two short text requests and writes sanitized results to `/private/tmp/geoservice-semantic-real-smoke.json`. No key is logged or exported.

## Reference acceptance

**33 EXACT / 29 STRONG / 40 WEAK**; default Search/selection returns **62**. For example, STRONG owner `dxf-entity-362` has the same definition and AREA/VOLUME key schema, but differs in source/current layer from K_VOLUME. Other block definitions only sharing entity kind are WEAK. No claim that VOLUME denotes a pipe/well/building.

## Verification and limitations

42 new deterministic unit cases cover contrast, mixed lengths/kinds, normalized noise, actual endpoints/ports, symbols, blocks/ATTRIB, image-derived geometry without raster resources, incremental edits, aliases/hierarchy, negatives, query privacy, limits, immutable cache snapshots, history and persistence. Seven Chrome E2Es cover teach/review/cancel/Space focus, management/Properties, local AI boundary, JSON/reload, image geometry, broad layer, blocks and reference MODEL viewport identity. Two opt-in REAL tests check pipe/custom-category parsing and local resolution.

Final validation: typecheck/lint/build pass; 1103 unit passed / 77 opt-in skipped; 233 full reference E2E passed / 3 skipped; 14 final affected E2E passed; two REAL cases passed; audit zero vulnerabilities. Additional final reference timing and category-deletion checks passed.

Reference measurements on this host: cold features 42.39 ms, proposal 0.36 ms, evaluation 1.15 ms, cold Search 9.90 ms, warm Search median 0.88 ms, selection 42.01 ms, Fit 1.08 ms. Browser stage wall times include UI/debounce/two frames: proposal 665 ms, Fit 82 ms, confirmation/autosave 1530 ms, Search 303 ms, selection 108 ms. App-stage main-thread long tasks were 54 ms during proposal, 111/66 ms during confirmation/autosave; none >50 ms during Fit/Search/selection. The raw observer also saw 658–688 ms full-document DevTools transport probes; those are recorded separately, not attributed to semantic evaluation.

Known limits: document-only knowledge; owner-level negatives; bucket boundaries; no arbitrary nearby labels; no Paper/nested primitive teaching; no cross-document portability, fine-tuning, OCR, CV V2, flow/compliance inference or automatic ontology. Weak candidate lists can be broad. UI caps individual review at 100 rows while group toggles and bulk Search apply to all results. Knowledge-only changes still cause the existing canonical persistence/selection reconciliation work. Existing bundle-size warning remains; no dependency was added.

Recommended next slice: evaluate richer multi-example contrast/refinement on anonymized heterogeneous CAD standards, especially false-positive/false-negative review. Do not start remote Semantic Assist or reusable cross-document rules without a separate applicability/confirmation design.

## Image Understanding V2 integration

The [image review](IMAGE_UNDERSTANDING_V2.md) may suggest a category when its own OCR text/confirmed symbol name exactly matches an existing local concept/alias. User confirmation writes normal positive annotations in the same knowledge payload, atomically with native Apply. Nearby raster labels never prove line-network meaning. Applied Text/Symbol/geometry owners use existing features, Teach, Search and local AI resolution; OCR confidence does not become a semantic tier. No image semantic database or automatic provider payload is introduced.

## Topology reconstruction V3

[Topology scopes](TOPOLOGY_RECONSTRUCTION.md) use existing explicit/EXACT/STRONG learned matches; weak-only similarity and nearby OCR text do not establish a network. Conflicting explicit categories prevent geometric merging. Common positive explicit source annotations transfer to a faithfully reconstructed Connector in the same atomic batch. Reconstructed connectors use existing features, Teach, Search and local AI document query resolution, with no new semantic or network store and no provider payload.
