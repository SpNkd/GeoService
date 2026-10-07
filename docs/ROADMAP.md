# Следующие итерации

Завершён precision + AI construction: layer create/delete-empty/reorder/double-click selection, independent world snap step, Shift45/F8 Ortho, dimension textPosition, discoverable label presets; explicit AI point creation, rectangles, centered prior polygon placement, typed polygon bulk dimensions, bounded clarifications, private projected construction и atomic Apply.

Следующий предложенный vertical slice: явная georeferencing привязка локальной модели к двум известным контрольным точкам с reviewable transform/preview и одной Undo-операцией. Не реализована в этой итерации. CRS/EPSG conversion, инженерный layout сетей/грядок, arbitrary constraint solver и autonomous AI остаются вне scope.

## История и scale limits

Завершён editor UX slice [EDITOR_UX](EDITOR_UX.md): selectable/current layers, layer inspector/rename/select-all, полноценный свободный Text editing/drag, linked persistent labels с derived anchors и безопасными динамическими полями, central shortcut registry и focus suppression. GeoDocument schema v2 сохранена; AI architecture не менялась.

Завершён срез: New → paste/file import → ordered Shift selection → shared polyline/boundary → dynamic dimension → Measure → shared drag → Undo/Redo → Save/Open/reload. Есть Vertex/Midpoint/Grid snapping с экранным допуском, North-clockwise azimuth, высотные подписи и reference lifetime для dimensions. Schema v2 сохранена.

Завершено [AI intent expansion](AI_ARCHITECTURE.md): boundary/polyline/dimension/measure, strict union, общий resolver и ambiguity UI, typed mutation/read-only plans, единый execution gate, локальный offset preview, read-only метрики и revision/race guards. Server-only OpenRouter с недорогой открытой Qwen3.5-9B и прежний OpenAI adapter; mock поддерживает четыре операции.

Завершён [AI multi-action](AI_ARCHITECTURE.md): единый actions[] для single/multi, 1–8 независимых actions / 1000 ссылок, shared ambiguity, combined ghosts/offsets, whole-task stale guard, general atomic command batch, один Undo/Redo и transient read-only results после mixed Apply. 249 unit / 44 e2e; пять реальных Qwen3.5-9B smoke прошли.

Завершён [AI dependent actions](AI_ARCHITECTURE.md): strict backward boundary index → typed boundary output → private projection → local all-edge dimensions с наружными world offsets. 8 semantic actions / 1000 named refs / 128 commands / 100 dimensions; atomic Apply и один Undo/Redo. 289 unit / 50 e2e; четыре real Qwen smoke, manual mixed preview/Apply/Save/Open. Snapshot architecture сохранена; general addition runs индексируют документ один раз.

Ранее предложенный срез, отложенный после precision/construction: **детерминированное размещение связанных подписей с учётом перекрытий на плотных чертежах**. Он не реализован; текущий renderer использует прямой derived anchor и не пытается скрывать или раздвигать подписи автоматически.

## Dependent actions

Завершены newly-created boundary/rectangle → all-edge dimensions и points → named geometry. Детали и assessment: [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md).

## Prior-action references

Завершён bounded backward index на polygon-producing action (boundary/rectangle); никакого generic DAG.

## Projected document

Завершена private pure projection без editor/history/dirty/autosave.

## Bulk semantic actions

Одна bulk action локально компилирует все directed edges, включая closure, с world наружными offsets.

## Semantic action vs generated editor commands

Раздельные counts: boundary + bulk + Measure → 3 actions, N+1 commands, один transient result.

## Generated-command budgets

8 actions / 1000 named refs / 128 commands / 100 dimensions. Превышение блокирует весь task.

## Atomic dependent execution

General optimized add runs, atomic batch и один Undo/Redo; snapshot architecture сохранена.

## Current dependency limitations

Existing-boundary target UX — отдельное предложение для последующих AI intent slices. AI Label mode, offset boundary, dependent Measure только оценён; create_points → named geometry реализован в precision construction.

DXF остаётся отдельным последующим срезом: чистый exporter → CAD проверка; до него определить version/units, plot scale и mapping text/dimensions.

Intersection snap, spatial index и renderer оптимизации стоит добавлять по конкретным измерениям и рабочим схемам. В текущем pure snap benchmark 50k points индекс не нужен; массовый SVG rendering и commit-only serialization остаются scale limits. Аудит подтвердил KEEP SNAPSHOTS, устранил transient fingerprint и unnecessary entity rerender, ускорил polygon crossing с bounding rejection. Production backend, cloud, CRS transform, полноценный ГОСТ dimension/print layout не добавлены.

## Завершено: georeferencing slice

Явные local/projected MODEL semantics и legacy v2 direct compatibility; metadata-only rigid2D scale1 по двум existing PointEntity; preview/residual policy; Model/Survey view; survey North; derived STALE с explicit recalculation/delete guard; independent ±0.000→absolute H; `{h_absolute}`; persistence validation и on-demand CPU audit1k/10k/50k. AI architecture/reliability не менялись. Подробный контракт: [GEOREFERENCING](GEOREFERENCING.md).

Следующая возможная итерация: согласовать экспортный coordinate contract — MODEL/SURVEY и MODEL Z/absolute H независимо, absent/stale policy и explicit input datum. DXF/GIS/EPSG/geoid/scale/least-squares в текущем slice не реализованы.

## Spatial Placement

Завершён ограниченный spatial slice: восемь cardinal/corner anchors к предыдущему polygon, существующий center сохранён. LLM извлекает размеры/relation/backward index (в том числе размеры словами), local pure policy вычисляет MODEL corners и `AUTO LAYOUT INSET`; typed assumptions видны в Preview. Нет уточнений о точной эскизной позиции при известных размерах и anchor, но инженерные данные/координаты/размеры не придумываются. Fit блокирует весь task; site+house+dimensions применяются одним batch/Undo/Redo. Исправлен общий clarification envelope, неизвестные поля остаются ошибкой.

Эскизный отступ не является нормативным setback. Геопривязка и dimension endpoint-retarget сохранены. Нет generic DSL/optimizer, коллизий, north_of/offset_from/between, сетей/грядок, CRS changes, model document access или автоматического Apply. Real A–F audit запускается отдельно от CI; неопределённость ответа provider видна в диагностике, Preview остаётся обязательным.

Возможный следующий шаг: отдельный UX выбора существующего polygon для относительного размещения с ambiguity/revision guards. Не реализован в этой итерации; collision solving и нормативные отступы остаются отдельными задачами.

## Завершено: Move Selection

Whole Polygon interior/outline и Line/Polyline stroke move; Shift multi-selection любых entities, group body drag, dashed bounds/count, M и exact numeric ΔX/ΔY. Pure MODEL command/resolver сохраняют форму/IDs/Z, shared vertices сдвигаются один раз без detach; affected unselected consumers видны в status/panel. Selected/indirect locked geometry, dimensions и derived labels блокируют весь move, включая hidden layers.

Отдельный previewDocument не меняет committed document/history/dirty/autosave до pointerup; отмена Esc/pointercancel/lost capture, один Undo/Redo всей группы. Label target+selection без double translation, independent group Label через compensated offset; Dimension follows sources и сохраняет отдельные edits/retarget. Move Shift X/Y контекстно отделён от drawing Shift45/F8. Геопривязка сохраняет MODEL/SURVEY boundary и stale control policy; AI Move intent не добавлен.

Отложены: anchor snap для группы, arrow nudge, explicit topology detach/duplicate-on-move, rotation/scale/mirror/copy/array, transform gizmo и paper-space movement. Они требуют собственных UX/command policies; следующая итерация этим изменением не начата.

## Завершено: Spatial AI Selection

Window/Crossing + modifiers/Esc; discoverable existing group move; canonical named/current-selection/prior references; deterministic MODEL/SURVEY relative/inside placement; straight-side Polyline offset; arrays 1–50; captured AI target layer with local preview switch; atomic Apply/Undo. [Contract/verification](SPATIAL_AI.md).

Предложенный ранее, пока не начатый vertical slice: локальный overlap warning в spatial preview без автоматического перемещения и без collision solver. Пока не реализован.

## Завершено: Exact Move, Fit Layer и Symbol Library

Relative/Absolute MODEL move через existing move-entities, центр/четыре угла и single canonical anchors; layer-specific camera fit без document effects. Symbol instance + immutable extensible registry + 18 demo gas process symbols, declarative geometry, passive transformed ports. Palette/current layer/snap/Esc/R, marquee/group Move, rotation/visual scale, linked Label, v2 persistence и semantic unknown definition guard. AI vocabulary не расширена. [Контракт](SYMBOL_LIBRARY.md).

Предложенный тогда port-to-port Connector завершён последующим срезом ниже. Upload/edit библиотек, manifest/version pinning, verified normative packs и general transforms остаются отдельными будущими задачами.

## DXF Open slice completed

Next suggested slice: local semantic selection by original DXF layer/block name, using exact indexed entity IDs and preview, without transmitting the imported tree to a provider. Not implemented here. DWG, binary DXF, DXF export, XREF/raster/font loading, block editing/explode and full CAD fidelity remain out of scope.

## Completed: DXF UX / performance / semantics

Deep Selection + deterministic DXF Hit Stack, read-only nested inspection/highlight, source-name Block Inspection, Imported Semantic Text for MULTILEADER/DIMENSION, editable native TEXT/MTEXT audit, deterministic Semantic Index and cache/Worker Performance Architecture. No explode/block editor/DXF export/DWG/AI document operations added.

Next single vertical slice: local document search panel using structured semantic hits → owner selection/inspection → Fit selected. Keep it local and explicit; assess UX before extending AI operations. Further renderer/culling work requires another measured profile, not an FPS promise.

## Completed: DXF rendering / portable JSON hardening

Projected SVG coordinates are prepared around immutable local origins; camera projection no longer causes incorrect block/proxy disappearance. Nested transforms, deep highlight, world bounds/Fit/marquee and exact wheel factors have regression coverage. Portable JSON ceiling is 100 MiB with early byte preflight and unchanged complexity budgets. Real edited reference exceeds the old ceiling and survives Save/New/Open. Keeping the cursor overlay mounted reduces measured selection layout; SVG layout/paint, synchronous portable Open/Save and structured clone remain constraints.

The then-proposed local document search/owner inspection/Fit slice and AI Document Operations were subsequently completed below. The intervening renderer slice is recorded next.

## Completed: hybrid Canvas/SVG renderer

Imported DXF bulk uses direct vector Canvas with cached blocks/Path2D, DPR, world culling and rAF draw. Native editable SVG/symbols and selected/deep/grip overlays remain. Owner/primitive BVHs make normal/Alt/hover interaction independent of SVG; marquee, Move, georeferencing, Worker autosave, IndexedDB, Spatial AI and JSON schema/budgets remain unchanged. Bounded exact strata retain mixed layer order; unusually interleaved documents fall back to SVG. Reference A/B and Canvas acceptance are recorded in [RENDERING](RENDERING.md) / [DXF_UX_PERFORMANCE](DXF_UX_PERFORMANCE.md#hybrid-canvas-renderer).

The proposed local document search/owner inspection/Fit slice was subsequently completed with AI Document Operations below. Massive mixed Move preview remains a measured performance constraint; WebGL/WebGPU, tiles, export, block editing and AI document operations remain separate work.

## Completed: DXF instance ATTRIB editing

ATTDEF and fixed definition TEXT remain definition-owned/read-only. Per-INSERT ATTRIB value and placement are editable on their owning BlockInstance, with local-coordinate transforms, one-action Undo/Redo, Save/Open/IndexedDB persistence, current-revision semantic search and instance-only renderer invalidation. Legacy v2 files keep rendering and lazily migrate attribute placement on first edit. Real reference acceptance and focused checks are recorded in [DXF_IMPORT](DXF_IMPORT.md). No Block Editor, explode, export or AI Document Operations were added.

## Completed: AI Document Operations

Strict provider intent → local exact/semantic queries → evidence/ambiguity preview → explicit owner selection/fit or atomic create-layer/move/visibility. Debounced manual search, current editable ATTRIB index, stale guards, transient isolation/exit and lightweight highlights are implemented. Existing Spatial AI and hybrid renderer remain independent. [Acceptance and scope](AI_DOCUMENT_OPERATIONS.md). AI text/ATTRIB mutation remains a separate possible future slice; not started here.

The previously suggested nested TEXT/ATTRIB Fit remains an unimplemented independent slice; the following user-requested slice implements Connectors.

## Completed: Connector V1

Canonical semantic port refs, centralized kind/multiplicity policy, derived connectivity index, native port-to-port tool/CO/ghost/Escape, Direct/Orthogonal, associative Symbol move/rotate/scale/group, grip/inspector retarget, safe deletion, independent layers/locks, atomic history, JSON/IndexedDB and manual gas-chain/DXF coexistence. This manual slice did not add AI connector intents or simulation; bounded process intents are added in the following slice. [Contract and verification](CONNECTORS.md).

Next suggested single vertical slice: **manual Connector waypoint editing** with transient grips/preview and one-action Undo/Redo. Not started.

## Completed: AI technological process schemes V1

Strict create_process_chain / append_process_symbols / insert_symbol_between → local semantic definition/port resolver → deterministic horizontal layout → exact ghost preview/target layer/chooser → canonical atomic batch. Stable libraryVersion, role metadata, tags, revision/selection stale guards, real OpenRouter smoke, browser 6+5/insert/free append/Move/Rotate/Save/Open/IndexedDB and real DXF Canvas coexistence. [Scope/evidence](AI_PROCESS_SCHEMES.md). Arbitrary branches/junctions/simulation remain excluded.

## Completed: Axonometric View V1

One GeoDocument, pure parallel XYZ projection with four presets/rebasing, separate cameras and Fit, independent vertex/Symbol elevations, projected geometry/ports/Connector risers, readable annotations, Canvas DXF, projected owner selection and safe numeric inspection, grid/axes, JSON/IndexedDB and datum independence. [Contract, measurements and verification](AXONOMETRIC_VIEW.md). No free 3D editing, real 3D routing or AI elevation.

## Completed: DXF viewing & UX polish

Geometry selection halos, clear AI Find/Select behavior, selection summary, CAD layer filters/bulk visibility/temporary layer isolation, DXF Paper Space provenance and multiple viewport presentation, and local raster underlays with IndexedDB assets. Explicit limits remain around unsupported paper clipping/perspective, CAD plot fidelity and portable asset packaging. Connector waypoint editing was not started. A potential next vertical slice is a portable project package with referenced image assets; it is not implemented here.

## Transform, style and navigation polish

Transform + Style + Responsive Toolbar Polish adds shared rotation, sparse ByLayer style intent, multi-style/Match Properties, controlled overflow and hierarchical DXF Views. Portable .geoservice assets remain the next single vertical slice; no packaging, custom pivot, general scale/mirror, plot-style editor or AI style schema was introduced.

Completed: editor/DXF view hardening—semantic groups, shared popup/focus/Space policy, working Plan orientation, context scopes, canonical MODEL editing through source Paper viewports, measured sheet-presentation reuse and local readonly exploded-table audit/search. Native Paper/viewport editing, source VP Freeze mutation, general UCS, 3D orbit, printing, spreadsheet editing and AI table classification remain outside this slice. The next suggested vertical slice is improved CAD text/font metrics and fallback fidelity; it has not been started.

Measured reference Paper289 result for this slice: Canvas draws 659 → 195, total draw work 432.700 → 78.100 ms, p95 5.600 → 0.600 ms, and long tasks 1 → 0 in the paired local trace. React/paint remain a limitation. Full details and reproducible drivers are in DXF_UX_PERFORMANCE.
