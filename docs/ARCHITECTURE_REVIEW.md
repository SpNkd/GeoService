# Executive verdict

**READY FOR AI COMMAND LAYER** после исправлений этого аудита. Canonical model, pure geometry и resolved command kernel пригодны для следующего ограниченного AI-среза. Не осталось обнаруженных BLOCKER/HIGH дефектов. Это verdict о границах архитектуры, а не о наличии готового AI: transport, intent validation, resolver, execution gate и budgets ещё предстоит реализовать.

Аудит выполнен 2026-10-04 от `f4a9c81537df2222ed2a14343617bf13ad36be09`, ветка `codex/pre-ai-audit`. Исследованы domain/commands, все reducer actions, Canvas/inspector/layers/import, persistence, snapping, geometry, renderer и существующие тесты. Features, DXF, AI, backend, spatial index и другой renderer не добавлены.

# Current architecture

```text
UI events / table parser → planning (explicit IDs and world coordinates)
                        → resolved DocumentCommand runtime validation
                        → applyCommand(document, command)
                        → immutable GeoDocument v2 → pure geometry → SVG
New/Open/autosave restore → full schema + semantic reference validation
                        → document replacement / session reset
```

`domain/model.ts` — одна canonical representation: vertices содержат XY/Z в метрах; entities содержат только IDs. Point, Line, Polyline, Polygon, Text и Dimension разрешают координаты через один registry. У dimensions хранятся references и signed world offset, а не рассчитанная длина. Bounds, area, perimeter, azimuth, dimension lines и screen coordinates вычисляются. Сохранённый `document.viewport` — начальная camera preference, не источник геометрии; текущая camera находится в EditorState. Stroke/fontSize/lineWeight — presentation; они не меняют координаты.

Selection, ordered point selection, tool, camera, grid/snap/label options — session state в `store/editor.ts`. Draft, hover/cursor, snap/Measure previews — transient component state. Saved fingerprint и dirty flag — persistence/session bookkeeping, не GeoDocument. Domain/model/geometry/import/command validation не импортируют React, DOM или SVG. `store/editor.ts` использует pure `visibleBounds` из `renderer/selectors.ts`; расположение файла не делает его зависимым от React. Exporter может обращаться непосредственно к model/geometry.

## Фактическая карта изменений

| Источник | Разрешение input | Изменение canonical document |
| --- | --- | --- |
| Ручные Point/Line/Polyline/Polygon/Text/Dimension tools | screenToWorld + snapping → anchors → createGeometryCommand | reducer `execute` → `applyCommand(add-entity)` |
| Ordered survey points | PointEntity IDs → vertex IDs в commandFromOrderedPoints | reducer `execute` → тот же `add-entity` |
| Inspector XY/Z | полный world position | begin → `transient(update-vertex)` → commit |
| Drag vertex | captured ID/Z + world transform | тот же coordinate transaction; cancel восстанавливает before |
| Delete / entity layer / доступный update-entity API | explicit entityId/layerId/patch | `execute` → command kernel |
| Visibility / lock | explicit layerId + boolean | `execute` → command kernel |
| Import | parser → mapping → ImportPlan → IDs, vertices, layer | `import-points`, атомарно, один history action |
| JSON Open / reducer load-json | size/version/schema + reference checks | validated owned replacement, history/session reset |
| New | фабрика нового пустого v2 | та же validated replacement |
| Startup restore | validated deserialize или собственная sample factory | initialEditorState; приложение владеет input |
| Undo/Redo / cancel transaction | ссылки на собственные snapshots | reducer восстанавливает document reference |

Компоненты не присваивают поля текущего document. Фабрики/fixtures строят новые объекты до передачи редактору. App выполняет чистый import preflight через `applyCommand` для ошибок внутри открытого диалога, затем reducer применяет команду к live state. Это повторная проверка, но не второй live mutation; сохранена ради существующего error UX. Save/fit/pan/zoom/Measure не меняют canonical geometry.

Reference lifetime: любой entity, включая Dimension, удерживает vertex. Delete собирает все оставшиеся references и удаляет orphan vertices, включая прежние неиспользованные vertices загруженного файла. Удаление Point не удаляет Line/Dimension; удаление Line не удаляет Dimension. Удаление последнего consumer освобождает vertex. Shared lock: изменение vertex запрещено, если хотя бы один consumer находится на locked layer. Новая геометрия может ссылаться на locked reference, не перемещая его. Hidden layers исключаются из render/snap, locked — видимы и участвуют в snap.

# Findings

| ID / Severity | Evidence | Impact | Resolution |
| --- | --- | --- | --- |
| F1 **HIGH** | `domain/commands.ts`: update-entity spread произвольного JS patch; TS проверял только callers при сборке | Внешний caller мог заменить type, vertexId или layerId, создать dangling reference/обойти lock, вставить unsafe IDs или невалидные scalar values | Исправлено: strict runtime union **существующих resolved editor commands**, общие Zod entity/vertex/layer primitives; whitelist mutable patch; finite values, IDs, strings, layer/entity/path capacities; exhaustive final branch. Unknown fields/types отклоняются до mutation. AI schemas не созданы |
| F2 **HIGH** | `App.tsx`: dirty useMemo depended on live draft document | На 50k каждый drag step делал full stringify (~19.7 ms), dev StrictMode — два раза; autosave уже был commit-only | Исправлено: memoized comparison только committed document; changed draft отмечается dirty по identity. `isDocumentDirty` short-circuits changed transaction. Browser regression: 0 full document serializations на восьми transient шагах, сохранение после commit |
| F3 **HIGH** | reducer `replace-document` принимал caller-owned object без проверки | Non-UI replacement мог установить невалидный document или менять его позже через payload, обходя Open schema boundary | Исправлено: validateDocument + owned parsed clone до reset. Ошибка сохраняет document, history, view, selection и epoch |
| F4 **MEDIUM** | 50k fixture: compact JSON 7,395,695 bytes проходит Open; pretty output превышал исторический лимит 10 MiB (сейчас 100 MiB) | Валидный открытый файл нельзя было Save; import отвергал размер за счёт whitespace | Исправлено: единый encoder предпочитает pretty JSON, при превышении пробует compact. Save и import применяют одинаковый byte budget; compact выше лимита всё ещё отклоняется |
| F5 **MEDIUM** | EntityView/Canvas/panels повторно выполнялись при cursor/draft updates; resize callback зависел от live document | 10k SVG drag × 8: 53.1 s; hover median ~263 ms. Stable keys не предотвращали выполнение component body | Исправлено: memo Canvas/panels, EntityView comparator по entity/layer/style/view/options и referenced vertex identities. Изменения entity/layer consumers инвалидируют comparator для shared locks. ResizeObserver не пересоздаётся на draft и одинаковый size не меняет state |
| F6 **MEDIUM** | `geometry/survey.ts`: все пары рёбер вызывают intersection/onSegment; соседние исключались без overlap check | Convex 5000-vertex boundary ~1.16 s; collinear triangle с backtracking не считался invalid | Исправлено: O(n) edge bounds + дешёвый pair rejection; adjacent retracing/zero XY edges обнаруживаются. Точный segment predicate сохранён. После — ~26.4 ms, worst-case остаётся O(n²) |
| F7 **MEDIUM** | JSON style stroke/fill разрешал любой string; LayersPanel использует stroke в CSS background | Probe с `url(https://audit.invalid/image)` реально вызвал внешний запрос (перехвачен и отменён до сети) | Исправлено: literal paint colour schema: named/hex/rgb/hsl/empty; URL, escaped URL и CSS variables отклоняются до Open. Browser test сохраняет текущую схему и подтверждает отсутствие external requests. Paint servers никогда не были поддерживаемым product feature |
| F8 **MEDIUM** | reducer `transient` принимал любой DocumentCommand | Delete/layer changes внутри coordinate transaction нарушали selection reconciliation и назначение coalescing | Исправлено: transient runtime guard допускает только update-vertex/move-vertex. Остальные mutations — execute. Rejection сохраняет document/redo |
| F9 **LOW** | EntityView switch мог дать undefined shape при добавлении entity variant | Silent empty rendering при будущем расширении модели | Исправлено: exhaustive never branch. Model helpers и geometryIntent уже получают compiler errors при пропущенном variant; records имён/Icon также требуют обновления |
| F10 **MEDIUM**, accepted scale limit | Final SVG profile 50k: 350,033 descendant nodes; drag ×8 ~5.76 s | Большая схема остаётся неудобной для непрерывного редактирования | Локальные rerender дефекты исправлены; Canvas/WebGL/culling redesign исключены из scope. AI не должен выдавать неконтролируемую массу объектов |
| F13 **MEDIUM** | EntityView вызывал canEditVertex (полный consumer scan) для каждой vertex handle | 5000 handles при 50k entities: 4359 ms только на lock checks | Исправлено: pure bulk lockedVertexIds рассчитывается один раз для selected path, затем Set lookup. Те же hidden/shared/missing-layer semantics; mutation guard остаётся независимым. После — 1.40 ms |
| F11 **NOTE** | Snapshot history уже имеет structural sharing | Нет основания внедрять patches/event sourcing | **KEEP SNAPSHOTS**, 100-action cap сохранён. Measurements ниже |
| F12 **NOTE** | `createGeometryCommand`/import factory выделяют UUIDs, выбирают layer defaults и display names выше kernel | Planning не повторится byte-for-byte без сохранённого payload | Resolved command deterministic. Для replay сохранять итоговые IDs/options; builder допускает injected newId. Ни selection, ни viewport, ни random не читаются applyCommand |

# Performance observations

Reproduce (Node из engines, зависимости уже установлены):

```bash
npm run bench:audit
# В другом терминале: npm run dev -- --port 5173 --strictPort
npm run bench:render
```

Core script создаёт `/private/tmp/geoservice-profile-{1000,10000,50000}.json` и `/private/tmp/geoservice-audit-core-after.json`; browser profile читает эти fixtures и пишет `/private/tmp/geoservice-audit-render-after.json`. `AUDIT_LABEL` выбирает имя отчёта; `AUDIT_SIZES=1000,10000` или `AUDIT_MOUNT_ONLY=1` сокращают browser run. Vite dev включает StrictMode; это не production FPS. Benchmarks исключены из обычного `npm run check` и имеют только технический timeout. Существующий snapping unit test также не использует время как условие успеха.

## History

20 resolved move-vertex actions; Execute измеряет guard/mutation/registry copy **и** snapshot bookkeeping. GC heap delta — приблизительно retained V8 heap после actions, не browser/RSS. Undo/Redo ниже — reducer latency, без SVG и persistence effects.

| Points | Execute median / p95, ms | Доп. retained heap, MiB | Undo median, ms | Redo median, ms |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 0.217 / 3.215 | 0.103 | 0.00096 | 0.00096 |
| 10,000 | 1.590 / 2.158 | 4.805 | 0.00125 | 0.00083 |
| 50,000 | 9.611 / 11.023 | 45.934 | 0.00079 | 0.00079 |

На каждом размере 21 registry object, N+20 unique vertex objects и N unique entity objects — не 21 глубокая копия всей геометрии. Малый heap delta чувствителен к GC/JIT, особенно 1k; не воспринимать как точную стоимость одного объекта. На 50k это приблизительно 2.3 MiB дополнительного registry на действие; 100 таких actions могут требовать порядка 230 MiB сверх исходного document. Большие imports валидируются с полной parsed copy, поэтому их memory pattern отличается от moves.

**KEEP SNAPSHOTS.** Текущий bounded MVP выигрывает от простоты и correctness, Undo/Redo не является bottleneck. Дорогая часть — shallow registry copy, full fingerprint на commit, SVG и storage. Drag/inspector coalesce; imports/layers/dimensions проходят один execute. Failed commands не добавляют history; новая successful mutation очищает redo, no-op vertex move — нет. New/Open сбрасывают history; session state никогда не записывается туда.

## Dirty / autosave

| Points | Fingerprint median, ms | Serialize (validate + encode) median, ms | Changed transient dirty before → after, ms |
| ---: | ---: | ---: | ---: |
| 1,000 | 0.244 | 2.822 | 0.286 → 0.029 |
| 10,000 | 3.180 | 21.392 | 3.111 → 0.002 |
| 50,000 | 17.167 | 143.315 | 19.704 → 0.002 |

50k baseline serializer завершался ошибкой размера; итоговый serializer успешно выдаёт compact JSON. Dirty full comparison остаётся на committed changes / saved baseline, не на pointermove. Активный changed draft provisionally dirty до commit/cancel. Даже если жест вернул те же coordinates, committed fingerprint сравнивается по содержимому, dirty сбрасывается; history coalescing использует identity и может сохранить такой content-equivalent gesture как действие.

At the time of this review, autosave used localStorage and could not hold the reference DXF. It now uses IndexedDB; see [PERSISTENCE](PERSISTENCE.md). The separate 50k-entity synchronous validation/fingerprinting cost (~143 ms in the recorded audit) remains a possible post-commit pause. Save JSON remains the portable copy; baseline and history are not restored after reload, while dirty state is. No per-snapshot fingerprint cache retains a multi-megabyte string for each history action.

## Snapping

100 warmup + 1000 запросов на разных vertices, Vertex/Midpoint defaults; размер point fixture не содержит segments.

| Points | Provider build, ms | Query median / p95, ms |
| ---: | ---: | ---: |
| 1,000 | 0.582 | 0.00512 / 0.00554 |
| 10,000 | 4.063 | 0.04425 / 0.04779 |
| 50,000 | 13.447 | 0.20413 / 0.21162 |

Canvas useMemo строит provider по **committed document identity**. Во время drag используется before snapshot; moving vertex и его incident midpoints исключаются из query. Pointermove, hover, preview, selection, camera/zoom не rebuild provider. Commit, import, Undo/Redo, New/Open дают новое значение. Не-геометрические committed commands тоже rebuild; это лишняя, но редкая работа, не per-frame ошибка. Build занимает примерно 13–22 ms в разных прогонах; spatial index сейчас не нужен.

Практический trigger для индекса: query p95 устойчиво >2 ms на целевых устройствах (значимая доля frame budget), provider rebuild >16 ms в реально частом workflow или segment-heavy документы с существенно худшим профилем. Это будущий измеряемый критерий, не гарантированный порог количества points. Сначала отделить rebuild invalidation от unrelated commands; индекс скрыть за существующим provider interface.

## Rendering

Каждая point с Name + Z даёт group/title/hit circle/path/marker/two text nodes — около семи SVG descendants. Hidden layers не входят в renderItems, stable entity/vertex keys сохраняются. Off-screen entities **всё ещё render**; label overlap/hit overlap возможны в dense fixture. Pan/zoom меняют координаты всех shapes; одной parent SVG transform matrix сейчас нет.

| Points | SVG descendants | Open/mount before → after, ms | Hover median before → after, ms | 8 drag steps before → after, ms |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 7,028 | 131.5 → 155.5 | 50.0 → 49.9 | 718.6 → 515.3 |
| 10,000 | 70,029 | 802.8 → 907.1 | 263.2 → 50.5 | 53,118.5 → 763.8 |
| 50,000 | 350,033 | 3,968.7 → 4,244.2 | полный baseline не завершён → 74.3 | исходный run прерван → 5,758.6 |

Mount включает file Open/parse/schema/fit/DOM, не только React commit. Hover/drag timings — host wall time вокруг mouse event + двух requestAnimationFrame, включая Playwright transport/Chrome paint; **не FPS и не чистое React render duration**. 50 ms в маленьком hover — floor этого driver, не время component body. Для 50k original полный run прерван после нескольких минут активности renderer; mount отдельно завершён, недостающие значения не выдуманы. Итоговый run завершил все sizes без page errors.

Baseline dev drag давал 16 полных document stringify calls на 8 moves; итог — **0** на всех sizes. После mouseup итоговый dev count 3 (50k: 4 из-за pretty→compact fallback): два memo evaluations в StrictMode и autosave encode. Memo EntityView пропускает unchanged vertices; shared consumers и dynamic dimensions обновляются. Максимальный SVG остаётся пределом текущего MVP, не promise 60 FPS. Отдельный профиль selected path: 5000 handles на 50k entities ранее сканировали consumers повторно (4359 ms), теперь bulk lockedVertexIds + 5000 membership queries занимают 1.40 ms. Это pure lock work, не полный render. Raw locks-before/after reports сохранены; обычный scalar guard для одного drag/inspector остаётся, mutation authorization не использует UI cache.

## Polygon validation

Simple convex ring в реальных координатах, без crossing: algorithm не может early-return true. Три samples; p95 у такой выборки фактически max, поэтому сравниваем medians.

| Vertices | Before median, ms | After median, ms |
| ---: | ---: | ---: |
| 100 | 0.586 | 0.169 |
| 1,000 | 46.220 | 1.295 |
| 5,000 | 1158.236 | 26.429 |

Verdict: **сделанная локальная bounding-box optimization достаточна до ограниченного AI-среза**; сложный computational geometry framework не нужен. Алгоритм всё ещё перебирает O(n²) пар. Adversarial bounding boxes/очень длинный contour могут занимать секунды; file-byte limit не является geometry CPU budget. Будущий intent resolver должен ограничивать число vertices/операций до вызова kernel. Existing polygon при drag может стать crossing; command creation отвергает invalid новый contour, Open принимает reference-valid старый, inspector показывает warning — существующая policy сохранена.

# AI readiness

Есть независимый `applyCommand(document, unknown)` с runtime guard и semantic checks, pure reducer для history и planners без React. Один resolved payload на одном валидном document даёт тот же result; kernel не выделяет IDs и не читает current selection/tool/hover/viewport. Geometry не рассчитывает LLM. Метаданные/модель не содержат DOM или скрытой альтернативной геометрии.

Безопасный следующий путь:

```text
Natural language → LLM structured intent → strict intent validation
 → deterministic name/ID resolution + units/coordinate checks + bounded planning
 → explicit resolved command (allocate IDs once; pin document revision)
 → host execution gate / preview → existing execute reducer / applyCommand
 → canonical model → deterministic geometry → renderer
```

В этой итерации runtime schema добавлена только для уже существующего resolved DocumentCommand API. Ни AI intents, ни LLM integration не реализованы. AI должен передавать сериализуемый intent host adapter; не иметь EditorState/dispatch/hooks, writable GeoDocument references, SVG, DOM, browser storage или arbitrary JS patch. Duplicate survey names разрешены в продукте: resolver обязан отклонять неоднозначность, не выбирать первую точку. Применение должно подтвердить актуальность document revision и отсутствие активной UI transaction: current reducer execute во время transaction игнорируется, это не acknowledgement успеха для будущего adapter.

Immutability — ownership contract: canonical input валиден и считается immutable; initialEditorState принимает уже owned validated document. Commands копируют вставляемые payloads и изменяемые части, replacements приобретают собственную parsed copy. Snapshots не deep-frozen; доверенный host не должен мутировать их напрямую или отдавать mutable references LLM. В будущем transport expose только ограниченную snapshot projection.

# DXF readiness

| Canonical entity | Возможный DXF concept | Что уже есть / решение будущего exporter |
| --- | --- | --- |
| Point | POINT, при необходимости marker BLOCK + TEXT | World XYZ, name и layer; marker/label policy отдельно |
| Line | LINE | Две registry positions, optional Z |
| Polyline | [LWPOLYLINE](https://help.autodesk.com/cloudhelp/2015/ENU/AutoCAD-DXF/files/GUID-748FC305-F3F2-4F74-825A-61F04D757A50.htm) (плоская) / [3D POLYLINE](https://help.autodesk.com/cloudhelp/2020/ENU/AutoCAD-DXF/files/GUID-ABF6B778-BE20-4B49-9B58-A94E64CEFFF3.htm) | Ordered references; выбрать elevation/3D policy |
| Polygon | Closed polyline; optional HATCH | Implicit closure, XY boundary; holes сейчас нет |
| Text | [TEXT](https://help.autodesk.com/cloudhelp/2016/ENU/AutoCAD-DXF/files/GUID-62E5383D-8A14-47B4-BFC4-35824CAE8363.htm) / MTEXT | World anchor/content; fontSize в px требует явного print/world scale |
| Dimension | [aligned DIMENSION](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-7A123D5D-AC98-4A9A-A8CF-1A7EF5030418.htm) или deterministic primitives | Endpoints + signed world offset + derived horizontal distance; native style/block/version policy ещё нужна |
| Layers/styles | [LAYER](https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-DXF/files/GUID-D94802B0-8BE8-4AC9-8054-17197688AFDB.htm) flags, colours/lineweights/linetypes | Visibility/lock/order независимы от React; CSS colours/px веса требуют явного conversion |

Mapping выше — архитектурная оценка по canonical fields и официальному Autodesk DXF reference, а не подтверждение CAD round-trip. Blocking coupling не найден. SVG inversion и display rounding не входят в registry; exporter не должен читать SVG или React. Shared coordinates можно разрешить без UI, Z сохраняется, dimension geometry достаточна для plan-aligned export. CRS/EPSG пока metadata only; exporter обязан честно сохранять исходные метры, не обещать transform. Native dimension formatting, plot scale, DXF version и layer style mapping — будущие product decisions. DXF не реализован.

# Accepted limitations

- SVG 50k с labels тяжёлый; нет off-screen culling, label decluttering или Canvas/WebGL. Polygon worst-case O(n²); parse/render даже reference-valid большого файла может блокировать main thread.
- Snapshot cap 100; full registry copies при moves, full parsed copies при import; commit-only synchronous fingerprint/autosave могут давать паузу. Import preflight и Open/replacement повторяют validation ради error UX/ownership; application-result API сейчас не расширяли.
- JS double достаточен на Easting≈500k/Northing≈6M: translated shoelace, delta/hypot, midpoint, offset и world/screen round-trips проверены. Arbitrary finite 1e308 не обещает finite derived geometry; unsupported engineering ranges надо ограничивать в будущих external intents. Grid имеет iteration/safe-index guards.
- Новый dimension требует nonzero XY baseline; дальнейший shared drag может сделать его нулевым (renderer handles it), polygon может пересечься (warning). Нет constraints/holes/arcs/CRS transform/intersection snap.
- Unknown document UI fields strip; unknown command fields reject. Schema v2 сохранена. Реальных v1 fixtures/миграции нет; unsupported version rejected. Числа сохраняются без display rounding.
- Text/CSV/JSON labels выводятся как React text; innerHTML/eval/script insertion отсутствуют. IDs исключают prototype names/padding. Table 5 MiB/50k rows/100 columns, JSON 100 MiB/50k entities/1000 layers/styles. Нужен отдельный smaller AI planning budget: эти file limits не определяют комфортный workload.
- TypeScript strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes включены; production explicit any не найден. Narrowed tuple casts после minimum length, parsed command/document casts из-за exact-optional Zod/TS representation и guarded version casts остаются локальными, не принимают unchecked AI data. Entity switch/records имеют compiler help; schemas и model должны обновляться вместе при новом variant.
- App/Canvas крупные, но geometry/commands/validation независимы; сейчас размер component не мешает следующему adapter. Косметический split не сделан.
- Два Rollup INVALID_ANNOTATION warning происходят из комментариев Zod `core/util.js:400`, `core/regexes.js:74`: удаляются только неправильно расположенные annotations, runtime validation остаётся. Dependency не патчилась, warnings не скрывались.

## Verification и test audit

`npm run typecheck` passed. `npm run check` passed: lint, **127 unit tests**, production build, **25 Playwright e2e tests**. `npm audit --registry=https://registry.npmjs.org --cache /private/tmp/geoservice-npm-cache`: **0 vulnerabilities**. HTTPS override понадобился из-за HTTP default registry, dependencies/lockfile не менялись. Core/browser audit benchmarks завершены отдельно от check.

Baseline: 99 unit / 22 e2e. Добавлены 28 unit cases и 3 e2e: parsed payload/getter ownership, preserved benign v2 colour syntax, path budgets, runtime malformed patches/IDs/types/scalars, capacity, non-UI determinism and payload ownership, all mutation routes under dimension/shared locks, direct replacement integrity, Point+Line+Dimension deletion/undo/redo/JSON lifetime, transient mutation restrictions/zero stringify, adjacent overlaps, compact-readable large-document Save и external paint URL rejection/escaped labels и shared handle availability после lock/unlock другого consumer. Existing suite покрывает import Undo/Redo, redo branching, axes/precision, invalid Open references/version, storage quota/corruption, dimensions Save/Open/reload, snapping priority/tolerance/hidden/locked и Measure outside history.

Browser page/console error tests прошли. Ручной Chrome scenario на сохранённой survey-схеме: P2 inspector X +1 m изменил shared boundary/derived dimension 28.436→29.435 m; Undo восстановил 28.436 m и чистый saved state. `dev.logs(error)` пуст; screenshot `test-results/audit-review.jpg`. Current schema не изменена этой проверкой; исходные координаты восстановлены. User-visible failures находятся в import dialog/status bar/Open alert/quota notice, console не является основным error channel.

# Next-step constraints

Один следующий вертикальный срез: **«создать границу по указанным именам survey points» → validated intent → deterministic resolver → preview → одна существующая add-entity command → Undo/Redo**. Здесь только рекомендация; срез не начат.

При реализации: строгий intent allowlist; reject missing/ambiguous names и unsupported units; no silent selection/viewport dependencies; explicit IDs/layer/world coordinates; IDs выделяются один раз после resolution; document revision и transaction gate проверяются до apply; ограничить intent/plan size и polygon complexity до geometry; выполнить существующие layer/reference checks; failed plan не меняет document/history; результат проходит существующую persistence boundary. Не открывать LLM writable model/store/DOM, не возвращать computed measurements как source of truth, не обходить undo/autosave и не внедрять новый renderer/history framework ради AI.
