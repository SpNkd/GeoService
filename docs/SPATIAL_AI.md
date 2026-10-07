# Spatial AI и рамочное выделение

Актуальный slice: `codex/spatial-ai-selection`, от `c0398e7`. Geometry остаётся в GeoDocument v2, обычных Entity и canonical vertices. Отдельного AI document или naming model нет.

## Window / Crossing

В Select начинайте drag на пустом участке canvas. Слева направо — WINDOW: вся геометрия должна попасть в рамку. Справа налево — CROSSING: достаточно пересечения, включая рамку внутри тела polygon. Различаются цвет, пунктир и подпись. Порог 4 screen px; небольшой жест остаётся кликом. Без modifier выбор заменяется; Shift добавляет; Ctrl/Cmd переключает найденные объекты. Esc, pointercancel и lost capture сохраняют прежний выбор. Space/middle/right drag по-прежнему панорамирует.

Point проверяется по anchor, Line/Polyline по сегментам, Polygon по полной геометрии. Text/Label используют screen bounds; Dimension — bounds опор, размерной линии и текста. Это предсказуемая приближённая область аннотации, не glyph-level hit test. Hidden geometry исключается, locked geometry доступна для выбора и чтения. Ordered point selection сохраняет порядок существующих точек; новые добавляются в порядке обхода видимых entities.

Рамка и выбор не изменяют документ, history, dirty или autosave. Properties показывает число объектов и существующее «Переместить… · M». Drag выбранного тела и числовые ΔX/ΔY выполняют один `move-entities`; topology/locks, Dimension и Label сохраняют прежние semantics. Locked indirectly affected geometry блокирует весь move.

## Ссылки и имена

Canonical human name — существующее обязательное `Entity.name`, отдельное от технического ID. AI rectangle сохраняет его на Polygon, без дополнительного Label. Локальный derived index: `trim().toLowerCase()` → entities. Только точное matching; fuzzy и выбор первого запрещены. Модель приводит русские склонения к canonical названию; resolver не выполняет NLP.

Strict `EntityReference`:

```json
{"kind":"named_entity","name":"Дом"}
{"kind":"current_selection"}
{"kind":"prior_action_result","actionIndex":0}
```

Named references разрешаются в исходном документе, prior — в приватном projected document по typed polygon output. Self/future references и ссылки на неподходящий output блокируются schema. Для внешнего размещения совместимы Point/Line/Polyline/Polygon; для inside/along edge — Polygon. Text/Label/Dimension не выступают spatial target в этом slice.

Missing — локальное сообщение «объект не найден». Дубликаты — chooser с type, layer, bounds, ID. Ключ `entity:<normalized name>` отделён от point-name choices и переиспользуется всеми actions. Выбор не вызывает provider. Нет fuzzy fallback или придуманной замены. Для selection требуется ровно один совместимый entity: 0 unresolved, 2+ invalid. Изменение selection делает соответствующий preview stale; refresh получает актуальный local selection без LLM.

## Направления и размеры

VALID horizontal reference: compass axes SURVEY. Без reference: MODEL (+X east, +Y north). STALE: MODEL с явным предупреждением. Frame вычисляется локально, показывается в preview и не входит в semantic output. Survey translation не нужна для направлений: используются rigid orthonormal axes. Размеры и orientation новых rectangles остаются MODEL, без произвольной rotation.

`relative_to_entity {reference,direction,gapMeters?}` поддерживает 8 compass directions. Gap измеряется между bounding extents в выбранном frame. East/west центрируют perpendicular north/south; north/south — east/west. Диагональ использует одинаковый gap по двум осям и показывает это предположение. Нет gap → централизованная AutoLayout policy: 5% меньшего extent, clamp 0.5–2 м; эскизный, не нормативный отступ.

`inside_entity {reference,anchor}`: center и 8 anchors. Используется существующий `resolvePlacement` с той же AutoLayoutInset policy. Center использует polygon label anchor/centroid. Для SURVEY axis-aligned MODEL rectangle имеет projected footprint; после размещения вся реальная граница rectangle проверяется `rectangleInsidePolygon`, включая concave notches. Не помещается — invalid, без масштабирования или rotation. Legacy centered/anchored prior-action placement сохраняется и использует ту же frame policy.

## Линия вдоль стороны

```json
{"type":"create_line_along_polygon_edge","name":"Газовая труба","reference":{"kind":"named_entity","name":"Участок"},"side":"west","offsetMeters":1.5,"offsetSide":"outside"}
```

Сторона выбирается по outward normal относительно frame; выигрывает наиболее направленная наружу сторона. Последовательные collinear segments могут образовать одну прямую chain. Несколько раздельных или различно направленных равноправных кандидатов — invalid. Offset идёт точно по normal; orientation CW/CCW не меняет inside/outside. Создаётся обычная Polyline с новыми vertices; исходный polygon не меняется.

Нет inside/outside в тексте → provider возвращает outside; preview явно объясняет эскизное предположение. Без числа инженерного offset требуется уточнение. Не выполняются corner joins, curved boundary tracing, full polygon offsets, routing или gas norms. Отступ inside проверяет полную containment линии существующим общим алгоритмом, включая concave notches; выход за контур invalid. Это не проверка нормативного/безопасного коридора.

## Массивы

`create_rectangle_array {nameBase,count,width,height,sizeSource?,reference,direction,gapFromReference?,itemGap}`: 1–50 элементов, только четыре cardinal directions. North/south раскладываются east–west; east/west — north–south. Вся группа центрируется относительно target по perpendicular axis. `itemGap` точный между projected bounding extents; отсутствующий gapFromReference — AutoLayout gap с assumption. Количество, размеры и itemGap не придумываются. Имена: «Грядка 1», «Грядка 2», …; отдельные IDs.

Одна action разворачивается в N обычных polygon commands и N ghosts. Общий task budget 128 generated commands; превышение блокирует Apply. Collision detection/rearrangement не добавлены.

## Слой, preview, Apply

На request start workflow локально фиксирует currentLayerId и selectedEntityIds. Layer не определяется названием дома или типом аннотации. Все AI-created Point/Polygon/Polyline/Dimension используют один targetLayerId; размеры от prior polygons также. Manual Dimension, standalone low-level resolver и import сохраняют прежние policies.

Preview «Слой новых объектов» содержит только visible/unlocked layers. Изменение dropdown пересчитывает весь task локально с сохранением action IDs, choices, selected reference и offsets. Никаких LLM calls, document/history/dirty изменений. Captured hidden/locked/missing layer блокирует Apply до явного выбора доступного слоя. Источники сохраняют свои layers.

Preview показывает target name, direction frame, явный/Auto gap, alignment, offset side и assumptions. Existing reference подсвечивается transient без смены selection; новые объекты — существующий ghost renderer. Array и bulk dimensions композиционно переиспользуют обычные previews.

Проекция команд проверяется целиком. Apply → один atomic batch → один history snapshot. Undo отменяет всю группу; source geometry не переписывается. Изменённый документ/selection требует refresh и подтверждение обновлённого плана. Не добавлены AI Move/Delete, layer management или general spatial DSL.

## Privacy и provider

HTTP request содержит только `{text}`. Provider получает текст, prompt и strict output schema. GeoDocument, registry, catalog, layers, selected IDs, bounds, candidates и history не отправляются. API key остаётся в ignored `.env.local`, не имеет VITE prefix и не входит в build/commit.

OpenRouter primary `qwen/qwen3.5-27b`, fallback `qwen/qwen3-30b-a3b-instruct-2507`. Сохранены bounded transport, timeout, failover, at-most-one HTTP retry и diagnostics. Новые semantic types/reference variants включены в provider JSON schema. Дробный itemGap описан как number с явным сохранением decimal; nonnegative/finite constraint дополнительно проверяет локальная Zod schema. Provider output не корректируется под фразу.

Реальные A–F проверяются opt-in (платные запросы):

```bash
AI_SPATIAL_REAL_SMOKE=1 npx vitest run src/tests/spatial-real-smoke.test.ts
```

Тест читает `.env.local` через Vite, не печатает ключ. Проверяет exact semantics, local resolution на fixture, model/provider/schema/latency; отчёт `/private/tmp/geoservice-spatial-real-smoke.json`. Unsupported F не создаёт geometry. Обычный check пропускает эти paid cases. Результаты текущего прогона приведены ниже.

## Реальная проверка 2026-10-05

Все 6 final cases прошли, schema и local validation valid; primary qwen/qwen3.5-27b во всех случаях. F ожидаемо unsupported. Source fixture не изменяется: проверяется только semantic plan и локальная projected geometry.

| Case | Семантика | Provider | Latency, мс |
|---|---|---|---:|
| A | Сарай 3×5, east gap 2 к Дому | DeepInfra | 2590 |
| B | Дом 6×5 внутри Участка, north | DeepInfra | 1443 |
| C | West edge Polyline, outside 1.5 | Phala | 7973 |
| D | 4 грядки 1×4, south, itemGap 0.8 | DeepInfra | 2274 |
| E | 4×3 east от current_selection, Auto gap | Phala | 3157 |
| F | Сложная нормативная сеть → unsupported | DeepInfra | 864 |

## Verification

527 unit passed; 6 paid unit cases skipped в ordinary check, отдельно 6 real smoke passed. 108 E2E passed; 1 paid browser case skipped. Typecheck/lint/production build passed; HTTPS npm audit: 0 vulnerabilities. Новые E2E проверяют console/page errors = 0. Manual Chrome: WINDOW group selection, M numeric workflow, real current_selection rectangle preview, target-layer switch без Apply; console errors = 0. Снимок /private/tmp/geoservice-spatial-preview.png. REAL dev-server оставлен на http://127.0.0.1:5173/.
