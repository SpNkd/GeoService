# Архитектура GeoService

## Границы модулей

| Модуль | Отвечает за | Зависимости |
| --- | --- | --- |
| `domain/model.ts` | schema v2, реестр вершин, entities, слои, стили и units | Нет geometry, React, DOM или SVG |
| `domain/commands.ts` | единая граница валидированных неизменяемых изменений, batch import | Domain model, pure geometry, runtime schema/size check |
| `persistence/` | Zod schema, semantic validation, version boundary, JSON и storage adapter | Domain types, Zod; IO только в local adapter |
| `import/` | parser, detection, mapping, validation и command plan | Domain types; нет React/DOM |
| `snapping/` | cached candidate provider, screen tolerance и priority | Domain types, pure geometry; нет React |
| `domain/geometryIntent.ts` | anchors/ordered point IDs → add-entity command | Domain types, command types; нет UI |
| `geometry/` | расчёты, bounds и преобразование world/screen | Domain types; не зависит от React |
| `symbols/` | Typed libraries, strict immutable registry, local-to-MODEL transforms/ports/bounds | Domain types, Zod, pure geometry; нет React/DOM |
| `renderer/` | видимые слои, Canvas draw/cache/culling, SVG native/overlays, shared styles и bounds | Domain, geometry; React только composition/UI |
| `store/editor.ts` | документ, history, session viewport, selection и tool | Commands и camera geometry |
| `editor/Canvas.tsx` | pointer/keyboard events, preview создания, drag-транзакции | Renderer, store, geometry |
| `components/`, `App.tsx` | свойства, слои, toolbar и layout | Domain types, commands и store |

Domain не импортирует React или renderer. Geometry не знает о UI. Canvas/SVG получают каноническую геометрию и общий camera state; DOM и Canvas pixels никогда не служат источником геометрии.

## Путь данных

```text
User click / inspector / AI adapter
              ↓
  Geometry intent / pure calculation
              ↓
       DocumentCommand
              ↓
         applyCommand
              ↓
       новый GeoDocument
              ↓
 world points из VertexRegistry
              ↓
 worldToScreen → hybrid Canvas / native SVG / interaction overlays
```

Canvas/inspector dispatch commands через reducer; будущий host adapter может вызвать pure `applyCommand(document, unknown)`. `domain/commandSchema.ts` строго валидирует существующие resolved commands до semantic checks. У неё нет UI-специфического пути изменения модели. Команда проверяет layer lock, ссылки и конечность чисел, возвращает новый document и бросает ошибку до изменения исходного. Reducer перехватывает ошибку, сохраняет прежний document и выводит сообщение в status bar. Ветви `transient` допускают только coordinate update/move и применяют ту же команду без записи промежуточной точки drag в историю.

## Координаты и оси

Каноническая геометрия задаёт MODEL X/Y/Z в метрах. `modelFrame` отдельно определяет local или projected/direct XY. `horizontalReference` выводит SURVEY E/N rigid transform, `verticalReference` независимо выводит H. Reference commands меняют только metadata; vertices остаются прежними. Geometry APIs и policy находятся в `geometry/georeferencing.ts`, domain содержит только типы. Legacy v2 без modelFrame трактуется как projected/direct, без numeric detection. Новые документы local. Полный контракт: [GEOREFERENCING](GEOREFERENCING.md).

Screen Y растёт вниз. World/screen conversion и Canvas device matrix используют одну инверсию Y:

```text
screenX = (worldX - cx) × s + width / 2
screenY = (cy - worldY) × s + height / 2

worldX = cx + (screenX - width / 2) / s
worldY = cy - (screenY - height / 2) / s
```

`cx, cy` — центр камеры в world; `s` — CSS pixels на метр. SVG получает координаты, смещённые относительно центра камеры, а не геодезические значения вроде 6189345.221. Клик создаёт vertex непосредственно из `screenToWorld`; панорамирование и масштаб не записываются в vertices. Числа — JS double; форматирование до трёх знаков отделено от хранимых значений.

`coordinateSystem.kind` принимает `local`, `projected` или `unknown`. Имя системы и EPSG необязательны. `epsg` — только метаданные, не оператор преобразования. Документ с обычной Survey convention X north/Y east перед добавлением в модель нужно явно преобразовать во внешнем адаптере; MODEL axes остаются каноническими, а calibrated SURVEY orientation определяется horizontalReference.

## Реестр геометрических вершин

`GeoDocument.vertices` — объект-реестр со стабильным ID в каждой записи `{id, x, y, z?}`. Entities хранят только ссылки: `point/text.vertexId`, `line/dimension.startVertexId/endVertexId`, `polyline/polygon.vertexIds`. Renderer, bounds и inspector каждый раз разрешают ID через один registry. Параллельной geometry внутри entity нет.

Пара сущностей разделяет geometry только при явном повторном использовании одинакового `vertexId`. Координатная близость, hit target и рисование рядом не объединяют вершины. В текущем sample P1–P4 используют те же IDs, что и четыре угла участка; ГТ-01/02/03 используют IDs начала и конца съёмочной линии и хода. Изменение общего ID сразу сдвигает все consumers и пересчитывает площадь/длины. Объект, который добавлен рядом, получает независимый UUID vertex.

Удаление удаляет entity, собирает множество всех оставшихся ссылок и удаляет только неиспользуемые vertices. Это детерминированно и не удаляет вершину другого объекта. Undo/redo snapshots восстанавливают документ вместе с IDs, данными вершин и ссылками.

Это лёгкая ссылка на canonical coordinates. Endpoint snap явно переиспользует ID. Intersection graph, constraints, edge ownership, vertices в нескольких системах координат и автоматическое объединение топологии не реализованы.

## Команды и история

`domain/commands.ts` реализует `add-entity`, `delete-entity`, `update-vertex`, `move-vertex`, `move-text`, `update-entity`, `update-layer`, `set-entity-layer`, `set-layer-visibility`, `set-layer-lock`, `import-points`. Inspector редактирует vertices и сущности через команды; ручные tools отправляют `add-entity`; drag использует transient command и один commit.

История — ограниченный стек иммутабельных ссылок на документы до/после команды, не event sourcing. Документы и изменяемые части структур shallow-copy перед изменением; тесты проверяют, что snapshots остались прежними. Лимит — 100 действий. Аудит 1k/10k/50k подтвердил structural sharing и KEEP SNAPSHOTS; результаты и memory ограничения — в [ARCHITECTURE_REVIEW](ARCHITECTURE_REVIEW.md).

```text
execute(command)            → push current document, apply, clear redo stack
begin-transaction           → save document before a drag
transient(command) × N      → update live geometry without history entries
commit-transaction          → push the saved document once
cancel-transaction          → restore the saved document
```

Обычная ошибка команды не добавляет историю. Undo/redo и `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`, `Cmd/Ctrl+Y` восстанавливают snapshot. Pan, zoom, grid, tool и selection не попадают в историю. Ввод координаты между focus и blur объединяется в одну транзакцию; жест drag — одно действие. History служит UI и будущим command adapter, без специального обхода модели для AI.

**Layer lock read-only:** объект заблокированного видимого слоя можно выбрать и изучить. Inspector полей и удаление отключены, vertex handle отсутствует, а `applyCommand` отвергает мутацию. Общая вершина редактируема только если editable каждый entity, ссылающийся на неё; поэтому незапертая point не сдвигает неявно boundary locked слоя.

## Renderer и взаимодействие

Imported DXF использует Canvas 2D с cached local Path2D/draw lists, DPR backing store и camera-independent owner bounds для viewport culling. Native editable geometry и symbols остаются SVG. Screen-space strokes и world-height DXF text сохраняют прежнюю семантику. Exact consecutive strata сохраняют layer order; больше восьми Canvas strata вызывает SVG fallback. Панорамирование/масштаб меняют только session camera и coalesced draw, выбор/hover — только overlays. GeoDocument и Fit/world bounds не меняются ради rendering. Canvas/panels и EntityView memoized. Подробный контракт, lifecycle, styles, hit BVHs, cache revisions и ограничения: [RENDERING](RENDERING.md).

Point и line завершаются автоматически и переключают редактор обратно в Select. Polyline/polygon продолжают набирать точки; завершение — Enter либо double-click. В пустой text click открывает встроенное поле ввода. Escape убирает preview и возвращает Select. Primitive Point/Line/Polyline/Polygon/Text/Dimension добавляются в GeoDocument одной `add-entity` командой и сразу выбираются.

Точка перемещается мышью; после выбора line/polyline/polygon можно drag выделенную вершину. Начальное значение vertex фиксируется при pointer down, world coordinate обновляется по текущему экранному трансформу, а завершённый жест кладёт ровно один snapshot. Preview незавершённой полилинии находится только в transient React state и не входит в document/history.

## AI, importer и exporter

```text
User text → AiIntentProvider → strict AiIntent → deterministic local resolver
  → transient AiPlan/ghost preview → explicit Apply → snapshot/transaction gate
  → existing execute/applyCommand → GeoDocument → history/renderer
```

AI union поддерживает boundary, polyline, dimension и read-only measure по явно указанным именам точек. Все mutation tasks используют один execution gate и general execute-batch → applyCommandsAtomically → один history snapshot; measure не создаёт command. Общие имена разрешаются один раз на task, ошибка любой action блокирует весь пакет. LLM не получает GeoDocument, coordinates, IDs или store; возвращает strict task с 1–8 независимыми actions, а локальный resolver разрешает имена, ambiguity, topology и метрики. Никакого отдельного AI mutation command нет. Snapshot guard повторно проверяется при execute/execute-batch; missing/ambiguous/invalid/stale plans не применяются молча.

Application wrapper держит transient AI state отдельно от EditorState/GeoDocument; committed-document autosave остаётся прежним. Mock mode выбирается явно; OpenAI/OpenRouter работают через server-only Vite dev endpoint. Полный контракт: [AI_ARCHITECTURE](AI_ARCHITECTURE.md).

CSV/TXT/TSV importer и JSON serializer используют canonical vertices и references, не читают SVG DOM. Exporter остаётся следующим отдельным направлением.

## Persistence boundary

`raw JSON → migrateToCurrent → documentSchema.safeParse → semantic validation → GeoDocument v2`.

Используется прежнее явное поле `schemaVersion: 2`. Текущих сохранённых legacy v1 fixtures в repository нет, поэтому boundary отклоняет неизвестные версии понятной ошибкой. Framework миграций не добавлен.

Zod валидирует metadata, units, axes/CRS metadata, finite coordinates, viewport zoom range, все entity variants, layers/styles и минимальную длину vertex arrays. Semantic pass проверяет уникальные IDs, соответствие registry key/vertex ID и ссылки entity → vertex/layer/style, layer → style. Неизвестные UI поля удаляются из parsed output. Ничего из файла не исполняется; labels выводятся средствами React/SVG. Paint colours допускают literal named/hex/rgb/hsl значения; URL/CSS variables отклоняются до Open.

`Open` сначала проверяет `File.size` (100 MiB), затем полностью читает и валидирует файл; только успешный результат заменяет документ. Reducer replacement повторно валидирует и приобретает owned parsed copy; прямой non-UI replacement также защищён. Reset очищает selection, history, транзакцию, tool и Canvas draft через documentEpoch. Fit учитывает видимые слои. New использует ту же replacement boundary и валидную фабрику пустого документа.

Session viewport остаётся UI state: Save экспортирует document.viewport как начальный вид, а Open/reload делает fit. Selection, modal/draft и history никогда не сериализуются.

Autosave effect зависит от `transactionBefore ?? document`, поэтому pointermove и preview не меняют committed snapshot; commit, undo и redo сохраняют новый документ через IndexedDB adapter. Startup ждёт async hydration до первого autosave. Пятисотмиллисекундный debounce схлопывает быстрые commit actions; persistence queue/revision sequence skips obsolete queued snapshots. IndexedDB stores canonical JSON, dirty flag, timestamp, size and entity-count metadata. `localStorage` остаётся для editor preferences; legacy document keys удаляются только после успешной IndexedDB migration. Explicit Save/Open/New update the saved baseline; autosave never clears dirty. Reload restores document/dirty state but not undo history or selection. See [PERSISTENCE](PERSISTENCE.md).

Dirty comparison мемоизируется по committed document; changed draft отмечается provisionally dirty без stringify. Full serialize/fingerprint не запускается на transient pointermove. JSON output обычно pretty, около лимита 100 MiB — compact; import/Save используют один byte budget.

Storage access/quota failures дают ненавязчивое сообщение и не останавливают редактор. Автосохранение ограничено квотой конкретного браузера/origin; JSON остаётся переносимым форматом.

## Coordinate import boundary

```text
File.text / textarea (Excel paste)
  → parseTable + delimiter/decimal/header detection
  → ImportTable {rows: [{line, cells}], columnCount, delimiter}
  → explicit column mapping + numeric validation
  → ImportPlan {points, errors, warnings, mappingErrors}
  → createImportCommand (allocate IDs once)
  → import-points command → reducer → one snapshot
```

Parser понимает comma/semicolon/TAB, BOM/CRLF, quoted fields и escaped quotes. Физический source line сохраняется для diagnostics. Размер входа, количество строк/столбцов ограничены. Изолированная строка с лишней колонкой не меняет mapping всей таблицы: ширина определяется по наиболее частому числу колонок первых 100 строк. Detection — подсказка, всегда доступен ручной выбор.

Numeric parser зависит от decimal separator; он не заменяет все запятые в исходном тексте. NaN/Infinity, hex и пустые обязательные coordinates отвергаются. X/Y defaults явно видны и меняются до Import, canonical axes не меняются. Z optional, пустая высота остаётся undefined.

Ошибочные строки требуют explicit valid-only opt-in. Warning duplicate names учитывает вход и текущие PointEntity names. IDs выделяются независимо от point name; совпадения coordinates не объединяют vertices.

Batch command атомарно проверяет слой, уникальные внутренние IDs, coordinates/references, runtime schema и размер итогового JSON. Новый survey-points layer входит в candidate snapshot. Undo возвращает документ до импорта целиком; redo возвращает те же IDs. При ошибке candidate не заменяет current state. SVG grid имеет ограниченное количество итераций и пропускает индексы вне safe integer range, чтобы даже экстремальный finite input не мог повесить цикл сетки.

## Survey interaction boundary

`cursor → findSnapCandidate → GeometryAnchor {position, vertexId?} → createGeometryCommand → applyCommand → registry → renderer`. Snapping pure module возвращает исходный ID только для Vertex; остальные types оставляют ID allocation intent builder. Ordered Shift selection хранит PointEntity IDs в UI, а `commandFromOrderedPoints` строит тот же add-entity payload с registry references. Нет координатных копий или отдельной инженерной модели в React.

Measure вызывает pure `measurePair`, хранит только временные anchors, не dispatch execute. Dimension renderer вызывает pure `alignedDimension`; длина не дублируется в state/entity. Runtime schema включает dimension, generic entityVertexIds подключает lifetime и shared lock checks. Missing dimensions layer создаётся в том же command snapshot.

Provider мемоизируется по committed document, drag использует transactionBefore. Pointermove coalesced rAF, click и pointerup пересчитываются/сбрасываются синхронно. Текущий линейный поиск достаточно быстрый в замере 50k, но SVG rendering и snapshot/fingerprint cost остаются отдельными ограничениями. Polygon crossing validation использует edge bounding rejection, worst-case O(n²); новый contour отклоняется, существующий при drag получает inspector warning. Подробно: [GEOMETRY_TOOLS](GEOMETRY_TOOLS.md).

## Pre-AI audit

Фактическая mutation map, findings/fixes, benchmarks 1k/10k/50k, AI/DXF readiness и следующий ограниченный срез: [ARCHITECTURE_REVIEW](ARCHITECTURE_REVIEW.md).

## Editor UX: selection, annotations, shortcuts

Selection, inspected layer, current creation layer, keyboard buffer and inline-edit draft live in editor/UI state; none are GeoDocument fields. Layer rename uses `update-layer` and ordinary snapshots. Manual geometry intent accepts a selected writable layer; hidden/locked current layers return an error. Dimensions keep their explicit `dimensions` policy, and import retains its explicit target policy.

Free `TextEntity` owns a standalone vertex, has an SVG hit rectangle, and uses `move-text` inside one transient/commit transaction. Linked `LabelEntity` stores only `targetId`, template and XY world offset. Renderer derives anchor and resolved text from current target geometry. Whitelisted format substitution lives in `geometry/labels.ts`; unrecognized placeholders stay literal, with no HTML or code execution. Target deletion cascades labels through one document command; validator rejects dangling references. Target visibility hides labels while target locks do not prevent label offset edits.

`editor/shortcuts.ts` is the shortcut registry and pure sequence resolver. App owns one global keyboard listener and a 900 ms longest-prefix buffer; tooltips and the `?` dialog read the same registry. Inputs, textareas, selects, contenteditable and explicitly suppressed elements bypass editor shortcuts. Canvas receives held Space as a prop; it has no global keyboard listener. Esc emits one transient-cancel event and returns to Select without changing AI task state.

`schemaVersion: 2` remains unchanged. The Zod entity union gained LabelEntity and semantic target validation while documents without labels retain their previous shape. System point labels and line-length display remain renderer presentation; persisted labels are only created on explicit user action.

## Precision и semantic construction

Editor preferences отделены от geometry: configured world snap step (локально сохраняемый), Ortho, Shift modifiers. `geometry/constraints.ts` ограничивает world direction; Canvas применяет vertex snap → constraint → midpoint/grid/free priority. `geometry/grid.ts` определяет только визуальную плотность minor/major; snapping не зависит от неё. Layer create/delete/reorder и dimension offset/textPosition проходят strict domain command boundary. Layer SVG order остаётся canonical.

AI construction сохраняет прежний pipeline и privacy. `ai/construction.ts` строит Point/vertex batch и rectangle Polygon локально; `ai/task.ts` последовательно применяет команды только к private projection. Созданные точки доступны следующим named actions; общий typed `ResolvedPolygonOutput` доступен center-placement и bulk dimensions. Execution gate по-прежнему требует полный ready task и исходную revision, Apply идёт через general atomic batch. Clarification — отдельное состояние без editor mutation, follow-up состоит только из исходного USER TEXT и ответа пользователя.

Локальное начало rectangle (0,0) — открытое предположение preview. Будущая georeferencing итерация сможет преобразовать local model в projected coordinates явным transform; здесь CRS conversion и привязка не добавлены.

## Georeferencing boundary

`set-horizontal-reference` получает две PointEntity ID/survey pairs; command boundary берёт текущие MODEL XY и валидирует централизованную safety policy до принятия snapshots/transform. Remove и independent `set-vertical-reference` сохраняют registry identity. Runtime load schema проверяет reference integrity против committed snapshots, не пересчитывая stale controls. Delete-control guard находится в domain, поэтому работает и для UI, и для atomic batches.

`CoordinateReferencePanel` / `GeoreferenceDialog` управляют draft/preview и существующими control points. `coordinateDisplay` — editor view state: status преобразует одну координату on demand, inspector одновременно показывает MODEL/SURVEY/H; Canvas всегда MODEL. North overlay использует inverse rotation survey+N и один SVG Y inversion. Vertical metadata инвалидирует memoized label rendering для `{h_absolute}`. AI modules/intent/provider/reliability не меняются, document не отправляется provider.

## Move Selection boundary

`selection IDs → resolveSelectionMove(document, IDs) → ResolvedSelectionMove → projectSelectionMove(base, delta)` отделяет React interaction от immutable geometry projection. Resolver возвращает selected entity IDs в document order, deduplicated vertex IDs, candidate Label offsets и affected unselected entities. Text хранит registry vertex, отдельной position-копии нет. Dimension исключён из translation ownership, но учитывается как consumer для lock validation. Derived Label dependencies также блокируют обход locked layers. Hidden state не освобождает от lock policy.

Final `move-entities { entityIds, delta: { x, y } }` проходит strict runtime command schema и повторно resolves против собственного document. Он не читает текущую React selection и не доверяет UI-составленному списку vertices/locks. Pure projector сохраняет vertex/entity IDs, Z и metadata; finite additions проверяются до публикации результата. Shared vertices не клонируются. Label target+selection следует автоматически; independent Label компенсирует partial anchor shift, чтобы визуально получить ровно delta.

EditorState `selectionMove` содержит captured resolution, delta и previewDocument; canonical `document` остаётся исходным на всех pointer frames. `transactionBefore` удерживает existing mutation gate, AI base и autosave boundary. Preview всегда считается от base snapshot, а не предыдущего frame. Pointerup применяет self-contained command один раз и добавляет один snapshot; Esc/pointercancel/lost capture/Undo/Redo во время preview отменяют его без history/dirty/storage changes. Numeric Move вызывает тот же execute boundary. Геопривязка/STale определяется прежними derived checks, AI semantic contract не расширяется.

View hit targets и dashed selection bounds не сериализуются. Grips → vertex edit / dimension retarget; annotation-specific Dimension interactions остаются; selected movable body → captured group translation. Single Label сохраняет offset drag, single Text — прежний dedicated edit/drag, включая существующий detach shared legacy Text vertex; **group/numeric Move никогда не detach**.

Resolver проходит entity/vertex dependencies при начале drag и commit; shared registry копируется при projection, renderer использует прежнее SVG/memo pipeline. Projection selected Labels и selection bounds пока используют текущие linear lookups; snapshots остаются ограничены 100 entries. Большие selections требуют profiling перед обещаниями 60 FPS. Future dependency index / topology detach / transform ownership не вводятся неявно этим срезом.

## Exact Move, layer camera и Symbol Library

`domain/exactMove.ts` переводит Absolute MODEL target выбранного anchor в delta существующей команды. `geometry/entityBounds.ts` даёт общие MODEL selection/layer bounds с approximate annotations; Symbol bounds вычисляются в `symbols/transforms.ts` из definitions. Fit Layer переиспользует fitToBounds; редактирование document/history/dirty/autosave отсутствует.

`SymbolEntity` хранит instance data без vertex refs и без definition geometry. `symbols/registry.ts` владеет strict parsed/frozen libraries; canonical Open и commands проверяют definition references и allowed rotations. Renderer использует controlled primitives и size×scale→rotation→translation→camera. Symbol ports используют тот же transform и служат stable endpoint targets для Connector V1. `move-entities` переносит Symbol positions вместе с уникальными shared vertices остальных entities; Labels следуют и участвуют в atomic locks.

Provider schema/prompt не менялись. Pack version пока не pinned в document: stable library/symbol IDs требуют immutable meaning; coexistence/migration versioned packs потребует отдельного контракта. SVG и snapshot history остаются scale constraints; основной JS chunk превышает 500 kB. Новые registry/renderer не обещают certified normative rendering. Полный контракт: [SYMBOL_LIBRARY](SYMBOL_LIBRARY.md).

## DXF import boundary

`dxf/encoding/raw/import/supplement/curves` owns browser-local file decoding, source inventory, upstream parser adaptation and deterministic conversion. `dxf/worker.ts` runs validation/size preflight off the UI thread; `DxfDialog` owns cancellation, units/encoding/frame choices and preview. A ready candidate enters the existing `replace-document` reducer once, including current layer. No AI schema/resolver changes.

`vectors/types/geometry/path` defines safe document-local geometry, graph budgets, cached definition bounds and the numeric path encoder shared with Symbols. `renderer/VectorView` prepares block SVG definitions once and uses references for nested/repeated instances. Definitions do not enter SymbolLibrary. `persistence/vectorSchema` plus referential validation rejects malicious/dangling/cyclic graphs. `dxf/provenance` indexes selectable imported entities locally. Details and measurements: [DXF_IMPORT](DXF_IMPORT.md).

## Deep Selection / DXF Hit Stack

`editor/deepSelection.ts`: normal/hover screen→world→owner/primitive BVH→geometric hit → stable owner priority; explicit Alt строит nested stack → `{ownerEntityId, blockPath, primitivePath, sourceType, attribute?}`. Индексы относятся к immutable primitive arrays, без DOM/pixel authority. Nested INSERT transforms, cycle/depth/visibility guards retained. Paths resolve against canonical definitions on inspection/highlight. Canvas editor caches the Alt stack by document, camera and 5 px click region. Editor reducer owns transient deepSelection/status and rejects edits through nested selection; canonical owner IDs remain available. No primitive materialization.

## Block Inspection / Imported Semantic Text / Semantic Index

Controlled optional semanticContent входит в ImportedGraphic schema, сохраняется Save/Open/IndexedDB и не принимает raw DXF fields. Native standalone TEXT/MTEXT не меняют ownership. ATTDEF text/tag — safe text primitive extension. Provenance index owns lazy derived definition metadata by library revision, instance text/ATTRIB projection, and NFKC/Russian case-insensitive structured search. Returned arrays/metadata are owned copies. Counts derived once per definition graph; no geometry sent to a model and no AI intent changes.

Block ownership contract: fixed TEXT and ATTDEF templates remain in the shared definition and are read-only in deep selection. An INSERT's visible ATTRIB primitives and existing tag/value map live on that BlockInstanceEntity; optional `attributeCoordinateSpace: "block-local"` distinguishes normalized new imports from legacy v2 insert-relative offsets. The affine block transform is reused for Canvas/SVG drawing, bounds and hit tests. `update-block-attribute` checks active deep-selection owner/path/tag/handle, layer locks and source identity, then replaces only the selected attribute and owner record. Drag uses the inverse linear transform to convert MODEL pointer deltas into local deltas and commits one history action. Definition arrays retain identity, so their compiled Path2D stays cached. A semantic index is derived from the current immutable document revision and reflects new instance values. The optional field is backward-compatible; first edit lazily converts legacy placement while preserving its drawn world point. No definition-wide edit command exists in this slice.

## Performance Architecture

`vectors/geometry` uses library-array identity + definition-object identity as immutable revisions. Local primitive/definition AABBs memoized; child bounds identity invalidates ancestors after replacement. Instance world bounds keyed by instance reference and dependent local bounds revisions. Generic document/layer edits reuse geometric caches. Shared local preparation and Canvas Path2D/draw lists are camera-independent. World owner/primitive BVHs provide candidates for normal/hover/Alt without scanning the whole definition. Canvas culls top-level owners against each new world viewport, selection changes only SVG overlays. Full cache/composition/invalidation contract: [RENDERING](RENDERING.md).

Cursor UI props are stable; sidebar counts computed once per entity array; layer list isolated from camera/transaction changes. Cursor overlays avoid inherited SVG cursor-style invalidation on every click. Immutable component JSON strings form an exact fingerprint without re-encoding the shared 10 MB block library on every layer edit; assembled full fingerprints are not retained per history snapshot.

`persistence/autosavePreparation` uses a module Worker for schema validation, size checks, encoding and canonicalization. Main-thread store still owns serialized write queue/revision checks; preparation results of superseded revisions are discarded before IndexedDB commit. Worker structured-clone transfer and IDB put still cost main-thread work. Store caches committed metadata to avoid re-reading the entire 10 MB document solely for status. Node/Worker-unavailable fallback retains synchronous validation. Save/Open and atomic command preflights remain explicit synchronous boundaries. [Measured limitations](DXF_UX_PERFORMANCE.md).

## DXF render hardening

Canonical MODEL geometry → immutable world definition bounds → instance world bounds → current-camera screen projection remain distinct. The SVG fallback filters logical owners by entity/layer visibility; the hybrid Canvas path also culls owners against the current viewport. Derived `renderer/vectorPreparation` caches local-origin primitive sets by immutable block-library/primitive-array revisions. It rebases SVG definitions/proxies, composes child origins with base-point/nested/parent transforms, and projects top-level anchors only after obtaining world coordinates. Deep highlight uses the same normalization. This avoids enormous cancelling SVG translations at projected coordinates without changing canonical geometry or `<defs>/<use>` ownership. Camera is absent from preparation/world caches; screen transforms always use the current viewport. Replacement child libraries invalidate preparation, while instance movement reuses definition geometry.

The cursor overlay stays mounted with inactive pointer-events=none. Ordinary click no longer structurally adds/removes a full-canvas SVG rect; the measured selection layout cost falls without a new overlay renderer. Portable Open performs File.size preflight before read/parse at 100 MiB, then structure and semantic validation. `validateDocumentSemantics` is an extracted pass for phase profiling; production boundaries still call the combined validator. Existing geometry complexity and Worker/IndexedDB revision policies remain enforced. [Evidence and limits](DXF_UX_PERFORMANCE.md#rendering-hardening-2026-10-05).

## Connector V1

`connectors/` — pure domain policy/port resolver/router/derived connectivity index, без UI или AI зависимостей. Canonical entity хранит semantic refs; commands создают/retarget/routing/delete через общий mutation boundary. Store держит transient gesture отдельно от document/history. Native SVG route/port/grip overlay потребляет derived geometry; EntityView invalidation учитывает endpoint Symbol identities. CanvasStratum сравнивает собственные DXF owners/vertices/layers/styles/blocks и camera: native Connector/Symbol изменения не перерисовывают DXF.

Политика lifetime, visibility, multiplicity и persistence: [CONNECTORS](CONNECTORS.md). Индекс — будущая основа network traversal/AI adapters/Z-aware схем, не process simulator. Registry/version manifest остаётся внешним ограничением portability.

## Axonometric presentation

One immutable GeoDocument feeds Plan or Axonometric RenderCamera. Pure parallel math lives in view/projection; view/geometry supplies shared XYZ presentation traversal, MODEL bounds, orientation bounds/BVH and Connector risers. Editor cameras/presets are outside document/history/autosave. Plan compiled Canvas paths remain independent from orientation presentation caches. See [Axonometric contract](AXONOMETRIC_VIEW.md).

## Viewing UX / assets

Presentation context sits above the canonical MODEL registry: DXF layout metadata is validated import provenance; viewport freeze maps and isolation produce immutable derived views. Canvas selection contours reuse the visible primitive walker without invalidating base display lists. Raster assets have an independent IndexedDB registry and reference-counted decoded cache, while entity transforms use canonical commands/history. See [DXF_LAYOUTS](DXF_LAYOUTS.md) and [RASTER_UNDERLAYS](RASTER_UNDERLAYS.md).

## Transform, style and navigation polish

SelectionTransform projects immutable MODEL snapshots for translation/rotation; commit owns topology/lock validation. Sparse layer/entity style intent resolves over the legacy/DXF baseline without persisting caches. Toolbar packing and DXF view navigation are editor presentation state. See [TRANSFORMS](TRANSFORMS.md) / [STYLES](STYLES.md).

## Editor view hardening boundary

Working Plan rotation is a `RenderCamera` property; persisted Viewport/document schema is unchanged. `geometry` owns forward/inverse camera transforms, rotated Fit and pan/zoom. DXF viewport camera derivation lives in `layouts/camera`; `layouts/selection` resolves local view scopes, source clips, readonly Paper owners and paper Fit bounds. `EditorState.viewportEditing` selects the existing Canvas tool pipeline rather than a second geometry editor. Canonical commands/history remain the single edit boundary; mixed readonly Paper selection blocks mutations before preflight.

Paper viewport surfaces cache presentation during outer-camera motion. Weak immutable geometry caches are shared by Canvas services; visibility/freeze layers remain separate per window. Commit/Undo invalidate document-dependent views; transient active-window editing leaves other windows committed. Strong zoom uses bounded vector redraw. `tables/detect` builds a bounded derived readonly candidate index, with source evidence and no persisted table classifier. `editor/focus` owns global overlay dismissal, interaction modality, editor focus return and shortcut eligibility.

Mixed Paper selections guard entity mutations before batch execution. Layer presentation commands are explicitly permitted; a batch containing any entity mutation remains blocked as a whole. Paper selection reconciles against the new document's layer presentation on commit/Undo/Redo. Explicit owner/layer selection replaces the prior scope. The shared focus boundary captures popup ownership, then completes dismissal/focus at document bubbling after React actions (once-only task fallback if propagation was stopped), preventing both action-before-dismissal races and stale-button Space handling.
