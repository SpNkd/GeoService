# Editor UX / Settings / Orientation

All popovers remain registered through the existing shared pointer/keyboard dismissal and focus boundary. Peer/outside/canvas dismissal and one-layer Escape precedence are retained; no per-menu document listeners were added. Dialogs use the shared stack/trap/restore. Text/numeric/search/AI fields suppress editor shortcuts, and Space remains whitespace there. Pointer-selected nontext controls return to canvas; keyboard selection remains accessible.

Right sidebar: exactly one Properties/Search/AI content surface; mounted drafts survive switching. Properties is the clean default with a compact useful empty state. Last reasonable tab is a browser preference, not drawing history. Cmd/Ctrl+F opens Search and focuses its query; toolbar AI opens AI. Move/Rotate numeric commands show their Properties panel. Existing tool transient state stays separate.

Orientation uses the existing registered popover, styled preset buttons(-90/0/+90/180), shared NumberField with ° suffix and Enter/blur commit, North Up through existing georeference math, and horizontal/vertical two-point actions. Two-point action closes the popup and shows a compact canvas instruction; Escape cancels transient alignment. Plan/Axon/Paper camera semantics remain independent of canonical MODEL geometry.

Nested inspection now highlights/selects the meaningful leaf, with explicit parent selection and readonly ownership. Paper-owned objects are still not editable. [Selection details](SELECTION_PROPERTIES.md). Settings and privacy live in [one center](SETTINGS_PREFERENCES.md); [Dialog invariant](DIALOG_SYSTEM.md). New/updated Chrome tests cover immediate Space-pan, text suppression, numeric orientation, exclusive tabs, shared Dialogs and all nested selection contexts.

---

# Ежедневная работа в редакторе

## Layers и selection

Клик по основной части строки слоя выбирает его, делает current layer и открывает Layer Properties. Eye и lock остаются отдельными actions и не перехватывают selection. Inspector показывает название, число объектов, видимость и lock; кнопка + создаёт новый слой и делает его current/inspected; rename идёт через document command и доступен в Undo/Redo. Double-click строки и Select all objects в слое меняет только editor selection, не документ и не history.

Current layer и inspected selection — разные понятия редактора, оба не сериализуются. Ручные Point/Line/Polyline/Polygon/Text создаются в текущем layer, только когда он visible и unlocked; иначе пользователь видит сообщение и объект не создаётся. Dimension сохраняет dimensions layer policy. Import использует свой explicit destination.

## Свободный Text и связанный Label

`TextEntity` — свободный текст в world coordinates. Новый текст имеет собственную вершину, включая создание поверх snap point, поэтому его перемещение не сдвигает исходную геометрию. Текст выбирается по крупной SVG hit area; drag перемещает его в одной транзакции и Undo entry. Inspector редактирует содержание и X/Y. Double click открывает inline input, Enter сохраняет текст, Escape отменяет draft. Text и Label не используют rich text или HTML.

`LabelEntity` — persistent подпись конкретной Point/Line/Polyline/Polygon. Её документная запись содержит target ID, шаблон и world offsets `dx`/`dy`. Anchor не копируется: он заново выводится из текущей target geometry. Связанная подпись не является свободной TextEntity; при её drag изменяется только offset. Target может быть locked, пока layer самой подписи доступен для редактирования.

Удаление target атомарно удаляет все её labels. Удаление цели отклоняется, если attached label находится на locked layer, чтобы не обходить запрет этого слоя. Undo target deletion возвращает target и подписи. Удаление Label оставляет target. Скрытие target layer скрывает также связанную подпись; visibility label layer применяется независимо.

## Dynamic fields

Template заменяет whitelist placeholders без `eval`, `Function`, HTML или interpreter. Неизвестные braces остаются literal текстом.

| Target | Fields |
| --- | --- |
| Point | `{name}`, `{x}`, `{y}`, `{z}`, `{h_absolute}` |
| Line | `{length}` |
| Polyline | `{length}` |
| Polygon | `{area}`, `{perimeter}` |

`length` для Line и Polyline использует planar XY distance/path; area и perimeter Polygon используют общие geometry helpers. Числа отформатированы централизованными formatters и не меняют precision в canonical document. Суффикс единицы задаёт сам шаблон: например, `L={length} м`.

Default templates: Point `{name}`, Line/Polyline `L={length} м`, Polygon `S={area} м² · P={perimeter} м`. Point, Line, Polyline и Polygon anchors детерминированы: vertex, midpoint, midpoint по cumulative path length, area centroid. Для вырожденного polygon centroid заменяется центром bounds.

## Keyboard shortcuts

`src/editor/shortcuts.ts` — единый registry для обработчика, toolbar tooltips и help dialog (`?`). Multi-key последовательности используют longest-prefix ожидание до 900 ms. PO ждёт возможное POL продолжение; DI ждёт DIM. По timeout выполняется точное короткое совпадение (PO → Point, DI → Measure). Невалидный следующий key выполняет уже точное короткое совпадение, если оно есть, и заново рассматривает key как начало следующей sequence. Один key никогда не запускает и короткое, и длинное действие одновременно.

| Действие | Клавиши |
| --- | --- |
| Select | `V`, `Esc` |
| Line | `L` |
| Point | `PO` |
| Polyline | `PL` |
| Polygon | `POL` |
| Text | `T` |
| Move selection / numeric ΔX/ΔY или MODEL X/Y | `M` |
| Symbol rotation (ghost или один выбранный Symbol) | `R` |
| Dimension | `DIM` |
| Measure | `DI` |
| Fit / Zoom Extents | `F`, `ZE` |
| ORTHO ON/OFF | `F8` |
| Pan | `Space + drag` |
| New / Open / Save | `Ctrl/Cmd+N`, `Ctrl/Cmd+O`, `Ctrl/Cmd+S` |
| Undo / Redo | `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y` |
| Delete selection | `Delete`, `Backspace` |
| Shortcut help | `?` |

Централизованная eligibility отключает editor shortcuts, включая Ctrl/Cmd file/history, для текстовых полей, numeric properties, AI prompt и contenteditable. Native текстовый Undo остаётся доступен. Select и прочие non-text controls сохраняют keyboard interaction; завершённое pointer action возвращает фокус в canvas. Escape сначала закрывает popup, затем отменяет transient/transaction и только следующим нажатием выполняет более широкую отмену. В активном MODEL viewport marquee/transaction отменяется до выхода в лист. Inline editor отменяет текст своим обработчиком; AI plan от этого не сбрасывается.

## Проверки

Unit suites проверяют typed targets, derived positions, templates, lifetime/undo, visibility/locks, v2 round-trip и resolver prefixes. Playwright проверяет layer rename/undo/visibility/lock, Text selection/drag/double-click и shortcut focus suppression, Label target workflows, shortcuts и console errors. Запуск: `npm run test`, `npm run test:e2e`, `npm run typecheck`, `npm run lint`, `npm run build`.

## Layer management и precision

+ создаёт «Новый слой» / «Новый слой 2», stable ID, visible/unlocked, следующий order, одним history action. Undo/Redo сохраняют ID. Delete удаляет только пустой слой; для N объектов показывает причину и предлагает сначала переместить/удалить объекты; последний слой удалить нельзя. ↑/↓ меняют order через command и реально меняют SVG z-order. Text/Label идут поверх geometry внутри своего слоя, но не обходят порядок разных слоёв. После удаления/Undo current layer reconciles с существующими слоями.

Properties слоя используют grid с независимыми колонками, select/delete — компактные secondary actions. Double click выбирает всё содержимое без history. Для Point/Line/Polyline/Polygon в Properties есть section «Подписи», preset и «+ Добавить подпись». Point presets: имя, имя+Z, координаты; Line/Polyline: длина, название, название+длина; Polygon: название, площадь, периметр, название+площадь. Presets — обычные безопасные templates; `{name}` доступен всем target types. Persistent labels остаются отдельно от lightweight presentation toggles.

Snap grid step — editor preference в localStorage `geoservice.snap-step`; в GeoDocument не попадает. Настроенный шаг не меняется при zoom. F8 → ORTHO toggle (90°), Shift при рисовании → 45° и временно override Ortho. В Select Shift + click сохраняет ordered point selection и добавляет другие entities в группу. Tool shortcuts подавляются в input/textarea/select/contenteditable. См. [GEOMETRY_TOOLS](GEOMETRY_TOOLS.md) для snap priority и dimension textPosition.

## Coordinate reference UX

Левая панель прокручивается и содержит «Координаты документа»: local/unreferenced, local/referenced, STALE или projected/direct. Геопривязка выбирает две existing PointEntity, показывает MODEL XY, принимает E/N и preview rotation/translation/baselines/signed residual. Pick on canvas принимает только существующие точки; preview/cancel не меняют document/history/dirty. File/history shortcuts подавляются в dialog/picker; Esc возвращает из picker или отменяет dialog, Tab удерживает focus в modal. Apply — одна metadata history операция.

Переключатель Model/Survey — session view preference; status меняет X/Y на E/N, renderer/grid/camera остаются MODEL. Inspector показывает оба набора, SURVEY только read-only; без reference показывает «—». North arrow использует survey+N, unreferenced local показывает +Y. STALE предупреждение сохраняет committed transform и предлагает явный пересчёт с новым preview/Apply. Domain блокирует delete control и показывает actionable message. Vertical form независимо задаёт ±0.000, absolute H unavailable при missing Z; label preset «Абсолютная высота» обновляется сразу. Подробности и thresholds: [GEOREFERENCING](GEOREFERENCING.md).

## Move Selection

В Select обычный клик по Polygon interior/outline или Line/Polyline stroke выбирает объект; drag за тело перемещает его целиком. Shift + click добавляет/удаляет любой тип entity, сохраняя ordered selection точек. Для selected тела Shift-click без движения снимает выбор, а Shift-drag удерживает ближайшую X/Y ось. В группе drag выбранного Point/Text/Label или geometry body переносит всю selection. Явный vertex grip имеет приоритет и редактирует только вершину; Dimension endpoint grip сохраняет retarget. Dimension line/text сохраняют offset/textPosition interactions даже внутри группы.

Multi-selection получает тонкую dashed рамку и «Выбрано: N объектов». Move preview показывает ΔX/ΔY и число связанных невыбранных объектов. `M`, Move… в toolbar или «Переместить…» в Properties открывает numeric form: ΔX и ΔY в MODEL метрах, «Применить перемещение». Это один Undo action с точными введёнными значениями, без snap/rounding. Zero/empty/nonfinite inputs и locked dependencies отключают Apply. Esc внутри формы закрывает её. Shortcut M подавляется в текстовых/numeric inputs.

Shared vertices не отделяются: unselected connected geometry меняется вместе с ними. Entire group blocked при любом selected locked объекте или locked indirect geometry/Dimension/Label; hidden unlocked connections допустимы. Нет modal на каждый drag. Group movement свободный; Shift ограничивает delta горизонтально/вертикально и не включает drawing Shift45 или persistent Ortho.

Label alone сохраняет offset drag. Target + Label: offset неизменен, anchor следует за target. Label без выбранного target в группе переносится визуально на один delta; offset компенсирует частичное движение target через shared vertices. Dimension follows source, сохраняет reference IDs, offset, textPosition и значения при rigid translation обеих опор. Если двигается лишь одна опора через topology, длина закономерно изменяется.

Move preview существует отдельно от canonical document: до pointerup нет autosave/dirty/history. Esc/pointercancel/lost capture отменяют весь жест и сохраняют выбор. Undo/Redo всей группы — одно действие. MODEL/SURVEY display не меняет delta; control XY делает reference STALE. Срез не содержит snapping group anchor, transform handles, rotation/scale, copy/detach или AI Move.

## Window/Crossing и Spatial AI

Рамка начинается только на пустом canvas в Select; threshold 4 px. WINDOW слева направо выбирает полностью попавшие entities, CROSSING справа налево — пересекающие. Цвет/пунктир/подпись различаются. Shift add, Ctrl/Cmd toggle; Esc/pointercancel сохраняют прежний выбор. Hidden исключается; locked выбирается для inspection, но group Move блокируется прежней atomic lock policy.

Properties показывает «Выбрано: N объектов» и существующий Move…/M; числовой и mouse workflows используют один move-entities. Рамка/выбор не создают history/dirty. AI preview предлагает слой новых объектов, transient reference highlight и spatial assumptions; ambiguity chooser локальный. [Подробности](SPATIAL_AI.md).

## Exact Move и layer navigation

Move UI переключает «Δ Смещение» / «X/Y Абсолютно». Absolute вводит MODEL X/Y независимо от display mode; default «Центр выбора» и четыре угла MODEL bounds. Single Point/Text/Symbol использует canonical position для любого preset. Apply = тот же move-entities и locks, один Undo/Redo; zero delta без history. M фокусирует первый input повторно, recognized shortcut предотвращает default text insertion.

Properties выбранного слоя: «Вписать слой» с padding, включая hidden/locked содержимое без изменения видимости, document, history, dirty или autosave. Empty disabled, F/ZE и double-click select-all сохранены. Выбор слоя закрывает Move form; длинные Properties прокручиваются без перекрытия footer.

## Symbols

Toolbar «Символы» открывает компактную палитру с local name/alias/category search и vector previews. Choose→ghost→click вставляет в current visible/unlocked layer; R +90° и Esc cancel. Existing Vertex/Midpoint/Grid snap задаёт independent MODEL position без attachment. Click/Shift/Window/Crossing и все Move modes включают Symbol; bounds зависят от definition transform.

Inspector: Name/Tag, layer, rotation, visual scale 0.01–100, MODEL position и derived Survey при наличии reference. Rotation нормализуется; restricted definition angles соблюдаются. Blur/Enter создаёт Undo action. Label preset {name} следует за position, deletion target+Label атомарна. Пунктирные port markers явно пассивные. [Полный contract и demo symbols](SYMBOL_LIBRARY.md).

## Open DXF

Separate **DXF** toolbar dialog → local file picker → worker progress → preview/report. Select source units when unknown, confirm encoding fallback and choose Local/Projected frame. Cancel/Escape terminates processing; Apply opens a new document with dirty-document confirmation and automatic Fit. The current source layer is set atomically.

Imported curves, block instances and proxies support selection, conservative WINDOW/CROSSING marquee, Move Selection/Undo, exact placement, layer reassignment, visibility/locks and deletion. Blocks show source name/handle/layer, insertion, rotation/scales and attributes; no explode or specialized block/arc/hatch editor. Save/Open JSON preserves shared definitions/provenance. Large DXF documents may exceed browser autosave quota; an explicit notice directs users to Save JSON. [Workflow, fidelity limits and real smoke](DXF_IMPORT.md).

## Deep Selection / DXF Hit Stack

Alt на Windows/Linux, Option на macOS + click: owner → depth-first nested INSERT → primitives в обратном paint order → следующий overlapping owner. Повторный клик в пределах 5 screen px циклически перебирает тот же stack; изменение document/camera начинает новый stack. Status показывает «Выбор i/n». Обычный клик теперь выбирает конкретный visual primitive; Ctrl/Cmd+click и видимая кнопка «Выбрать блок» выбирают canonical parent. Deep selection не создаёт entities, history, dirty или autosave.

Inspector показывает owner, source block path + primitive indices, source type/layer/handle, plain text и MODEL coordinates (с учётом вложенных transforms). Amber overlay содержит только выбранную geometry. Nested primitives и proxy subgeometry read-only; M/Move/Delete показывают «Элемент является частью блока. Для перемещения выберите экземпляр блока.» Ctrl/Cmd+click или кнопка owner возвращает Move целого экземпляра. Double-click не раскрывает/не редактирует definition.

Ownership distinguishes shared definition geometry from per-insert attributes. Definition `TEXT` and `ATTDEF` are read-only and explain that editing the shared block definition is unsupported. A visible `ATTRIB` belongs to its `BlockInstanceEntity`: the inspector labels it “Атрибут блока” and shows owner, tag, value, MODEL position, rotation, height, source layer and handle. Value applies through a typed command as one history action; dragging writes local placement through one transaction. Undo/Redo, save/open and autosave retain the edit. Neither operation changes the owner insertion point, sibling attributes, sibling instances or the definition.

Foreground geometry имеет приоритет перед HATCH fill. Hatch остаётся доступен через Alt stack и на собственной видимой границе/области без foreground. Оба renderer используют screen→world→owner/primitive BVH→geometric narrow phase; event target нужен только для явных native UI handles. Selected owner bounds сохраняют существующий геометрический Move-body fallback, когда под ними нет другого geometric owner; индивидуальные рамки вокруг сложных owners больше не рисуются. Canvas pixels и скрытые bulk SVG rectangles не участвуют в выборе.

## Block Inspection / Imported Semantic Text

Primary heading — source block name; subtitle — DXF блок. Instance name/tag, provenance, transform, attributes и counts остаются доступными. MULTILEADER heading — primaryText, subtitle — «Мультивыноска». DXF DIMENSION — anonymous-block proxy с displayed text и доступными source type/measurement; full CAD editors отсутствуют. Native TEXT/MTEXT: select, Move, inspector/inline double-click edit, layer, Save/Open; DXF report явно отмечает упрощённые formatting/font/justification.

## Performance Architecture / Semantic Index

Pointermove rAF обновляет cursor/readout/preview и local geometric hover; обычный click и explicit Alt используют nested stack с разным ranking. Canvas draw имеет отдельный coalesced rAF, cached geometry и world culling. Выбор не перерисовывает базовый Canvas; owner bounds/grips и выбранный deep leaf — лёгкие SVG overlays над AI preview. Native symbols/geometry сохраняют SVG editing. Dev-only DXF renderer позволяет A/B одного документа без reimport; inactive bulk tree удаляется. Bounds cache используется Fit/marquee/Move. Local deterministic semantic APIs описаны в [DXF_UX_PERFORMANCE](DXF_UX_PERFORMANCE.md); отдельного AI search/editor нет. [Rendering contract](RENDERING.md).

## Search and AI document operations

«Поиск в документе» searches local metadata/text/ATTRIB with debounce; owner rows show current and DXF layers plus paths, with select and Fit. AI select/find/show requests first produce a preview with source reasons, deterministic confidence tiers and include checkboxes; weak groups default off. Preview highlight does not change selection. Changes to document/relevant selection require Refresh and then explicit Apply. Create-layer+move uses one Undo; selection/fit use none. «Покажи только…» creates a temporary owner filter and a visible exit banner, preserving all canonical visibility exactly. [Semantics and limitations](AI_DOCUMENT_OPERATIONS.md).

## Соединения Symbol ports

Toolbar «Соединение» / `CO`: первый свободный порт → transient ghost → второй совместимый порт → одна связь на CURRENT LAYER. Compact port markers и 14 px hit target независимы от zoom. Esc отменяет. Selected Connector имеет endpoint grips; drag или inspector «Выбрать порт» retarget без переноса Symbol. Direct/Orthogonal переключаются в inspector. Occupied/incompatible targets дают краткую причину. Connector следует move/rotate/scale/group автоматически; Delete подключённого Symbol блокируется. Полный UX/layer/history контракт: [CONNECTORS](CONNECTORS.md).

## View selector and Axon inspection

Compact «Вид» select in settings chooses Plan/NE/NW/SE/SW. Separate cameras restore pan/zoom; orientation performs projected Fit. Numeric MODEL X/Y/Z, properties/layers, Save and Undo/Redo remain available. Pointer drag/create/grips/marquee/nested editing are disabled in Axon; concise guidance directs free moves to Plan. Camera pan/zoom stay available. XYZ gizmo and adaptive ground grid replace Plan orientation/grid. Cursor XYZ is unavailable because inverse projection is not unique. Symbol inspector distinguishes blank Z from measured zero and displays derived Absolute H. [Acceptance](AXONOMETRIC_VIEW.md).

## Selection, layers and underlays

Complex selected owners now show actual visible contours/text halos; HATCH selection strokes edges without repainting fills. One combined group bounds remains a Move affordance. Deep selection stays primitive-only. Multi-selection summary groups types/current and source layers and offers Show Layers, selected-layer isolation, Fit and clear. Layer filters/search/hide-empty affect only the panel; counts mean top-level canonical MODEL objects. Global eye, VP Freeze and isolation dimming are separate reasons. Show/hide all is one document history batch; selected-layer isolation exits without changing prior global visibility. Find is transient with optional Fit; Select after Apply is ordinary editor selection. See [layout policy](DXF_LAYOUTS.md) and [underlay controls](RASTER_UNDERLAYS.md).

Paper presentation has its own pan/zoom/Fit camera. Toolbar zoom and wheel address paper, middle-button drag pans paper, and returning to MODEL restores the previous projection/camera. Bounds shown for group Move remain one combined box; normal complex owner selection uses visible contour/glyph halos.

## Transform, style and navigation polish

Plan selection has a shared rotation grip, Shift 15° snap, RO numeric delta and 90°/180° actions. MA/Copy Style captures visual intent for Apply to current selection. Current Drawing Style is shared between compatible tools. Responsive toolbar packs primary commands first, compacts secondary icons below 1600px, and moves remaining commands into keyboard-accessible «Ещё», indicating active overflow tools. Secondary options wrap; toolbar commands are never silently clipped. Layer menus retain one reversible isolation action, removing the duplicate «Показать только этот слой».

## Editor / DXF view hardening (current behavior)

The toolbar is organized as File/Data, Edit, Drawing and Engineering, with Undo/Redo in History. Line/Polyline share an active-child menu. Symbols and Connector are directly visible through ordinary laptop widths. Generic «Ещё» is reserved for the constrained-width help overflow. Fit, Zoom and MODEL Grid live in the canvas corner; the readonly sheet disables Grid until MODEL viewport editing is active. Renderer selector и developer counters находятся в Settings → Diagnostics в отдельном разделе; AI diagnostic viewer доступен только в development mode при явно включённой диагностике.

Search uses styled controls, result count, local notice, All/Text/Blocks/Tables and document/Model/current view/current sheet/active viewport scopes. The DXF modal has a styled file picker/drop target, compact content summary, collapsed technical report and sticky action footer.

DXF Views exposes Model, exact source Paper names and their MODEL viewport children. A single missing-name notice explains source Paper block names. Node actions select scoped content, Fit or enter MODEL editing. Mixed Paper/MODEL selection shows readonly versus MODEL counts and blocks edits atomically. The summary lists types/layers and offers Fit, Show Layers and Isolate Layers.

A green active viewport frame and «Редактирование модели» banner identify MODEL editing through the sheet. It reuses the normal Canvas tools and canonical commands; exiting retains the sheet camera. [Scope/pointer details](DXF_LAYOUTS.md), [working orientation](VIEW_ORIENTATION.md), [readonly tables](DXF_TABLES.md).

### Shared popover and focus boundary

`editor/focus.ts` owns one popup dismissal boundary. Marked popup details and established editor popup classes close on outside pointer interaction, action selection, Escape and a new peer popup. Content and declared nested popup ownership count as inside; actions execute before closing. Collapsible document sections are not popup overlays. Escape consumes one popup layer before tool/transaction cancellation.

Pointer selection in non-text controls restores canvas focus with `preventScroll`, allowing immediate Space-drag. Keyboard-only select navigation retains native focus/accessibility. Input, numeric input, search, textarea and contenteditable retain text focus and suppress shortcuts. Canvas pointer interaction establishes the editor context. Space pan works for Model, rotated Plan, Axon, Paper and active MODEL viewport. A single shortcut eligibility function replaces the App's inline target/tag checks.

Active MODEL viewport Space-pan and anchored zoom use temporary MODEL center/scale, preserve the sheet camera and imported viewport metadata, and reset on exit. Scope/hit/snap follow the temporary window. Fit resets this temporary navigation; source twist and VP Freeze remain intact. Controlled floating palettes register with the shared popup boundary; keyboard-focused controls keep native keyboard interaction.

Pointer button actions finish at the shared document bubble boundary, after React action handlers, so the next Space key already reaches the editor. A once-only task fallback handles actions that stop bubbling; it cannot run the item twice. Popup ancestry/declared portal ownership is captured before an action unmounts the panel. Text forms sit above corner view controls and stay within the canvas width.

A mixed MODEL/Paper readonly selection blocks entity mutation atomically. Global layer visibility/lock/style commands remain available and preserve imported VP Freeze. Hidden Paper selection is reconciled after a layer change; explicitly selecting a MODEL owner or layer clears the readonly Paper scope.

Canvas installs its transient Escape handler in the layout-effect phase, so rapid subsequent keys observe the cancellation state associated with the committed DOM. Shared shortcut eligibility runs before file/history dispatch, retaining native text Undo in search and AI fields. Three repeated Chrome runs cover popup → draft → tool and active viewport marquee → exit ordering.

Text creation/inline editing forms clamp to the visible active MODEL viewport clip (or full canvas in Model), including their actual width. Pointer Cancel/Submit therefore remain reachable at viewport edges. The text geometry still uses canonical MODEL coordinates and the source clip; this changes only form placement.
