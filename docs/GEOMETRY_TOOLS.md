# Геодезические инструменты

Канонические MODEL X/Y/Z в метрах; SURVEY E/N и абсолютная H — отдельные derived представления. В projected/direct E=X/N=Y, а local может иметь rigid reference. Числа хранятся без округления. `geometry/survey.ts` не зависит от React: distance2D/distance3D, delta, azimuth, signed dimension offset, aligned dimension, segmentIntersection, polygonSelfIntersects. UI передаёт намерение в `domain/geometryIntent.ts`, затем `applyCommand` проверяет изменение.

## Привязки

`createSnapProvider(document)` строит кандидаты для видимых геометрических объектов. `findSnapCandidate(cursorWorld, provider, viewport, options, excludeVertexId?)` возвращает тип, worldPosition, source entity/vertex ID, экранное расстояние и label/key metadata.

| Mode | Кандидат | Топология при создании |
| --- | --- | --- |
| Vertex / Endpoint | Существующая вершина point/line/polyline/polygon/dimension | Переиспользуется точный `sourceVertexId`, включая известную Z |
| Midpoint | Середина каждого line/polyline/polygon segment, включая closing edge | Новая независимая вершина; исходный сегмент не делится; Z не интерполируется |
| Grid | Ближайшая пара world multiples настроенного snap step | Новая независимая вершина без выдуманной Z |

Приоритет **vertex → midpoint → grid**. Внутри типа выбирается минимальное screen distance; при равенстве — лексикографически минимальный стабильный key. Допуск 10 CSS px; world tolerance = 10 / pixelsPerUnit. Кандидат за пределами круга допуска не используется. Snap grid step задаётся в метрах независимо от zoom: presets 0.1/0.25/0.5/1/2/5/10/20 и custom positive value. Узлы кратны этому шагу с origin (0,0). Visual minor step адаптируется к плотности (не менее 8 px), major идёт через 5 делений; это не меняет snap precision. Показ сетки и Grid snap включаются отдельно.

SNAP ON/OFF и Vertex/Midpoint/Grid checkbox находятся в отдельной компактной строке. По умолчанию Vertex/Midpoint включены, Grid выключен. Около курсора видны квадрат/треугольник/круг и читаемая подпись; status bar показывает SNAP. На клике кандидат вычисляется заново, поэтому он не зависит от задержки pointermove.

Hidden layers исключены. Locked geometry разрешена как reference; это не разрешает менять её координаты. Если shared vertex используется хотя бы одной locked entity, любые изменения этой вершины запрещены, в том числе через entity незаблокированного слоя. Ссылки dimension тоже участвуют в lock policy.

Drag сохраняет ID перемещаемой вершины и её прежнюю Z. Он может изменить XY на snapped coordinates, но не объединяет IDs. Собственная вершина и midpoints её incident segments исключаются. У скрытой point shared ID может остаться кандидатом через другой видимый consumer — скрытая entity сама не участвует.

Intersection snap отложен: без индекса пришлось бы искать пары сегментов и создавать зависимые от плотности чертежа квадратичные затраты. Чистый `segmentIntersection` уже используется для диагностики границ и покрыт тестами, но не выставлен как snap mode.

## Построение по survey points

1. New → Import → вставить Excel/CSV/TXT/TSV coordinates → проверить mapping → Import.
2. В Select нажимать Shift + click по point markers в желаемом порядке. Повторный клик удаляет точку; повторное добавление помещает её в конец. Обычный клик начинает новый выбор одной точки.
3. Номера около markers и список в inspector показывают порядок. «Создать полилинию» требует 2 точки, «Создать границу» — 3.
4. Созданный объект использует исходные vertex IDs в этом порядке; polygon замыкается семантически, без дублирования первой вершины. Area/perimeter выводятся в inspector. Один Undo удаляет только фигуру, сохраняя исходные точки.

Обычные Line/Polyline/Polygon tools также переиспользуют endpoints. Polyline/Polygon завершаются Enter или double-click. Намеренный завершающий клик в первый endpoint polygon удаляется из списка ссылок.

Самопересекающаяся новая граница/ручной polygon **отклоняется** с сообщением «Граница самопересекается. Измените порядок точек». История и документ не меняются. При редактировании существующей границы crossing не блокирует drag: inspector показывает warning. Старые v2 документы с crossing по-прежнему открываются. Автоматическая перестановка точек или исправление не выполняются.

## Measure

«Измерение»: первая точка → вторая точка; поддерживаются все включённые snap modes. До второго клика показывается live preview, после — фиксированное измерение. Третий клик начинает новую пару. Esc очищает результат и возвращает Select.

- Horizontal = hypot(ΔX, ΔY).
- ΔX/ΔY ориентированы от первой точки ко второй.
- Azimuth = atan2(ΔX, ΔY), нормализованный в [0, 360), от MODEL +Y по часовой стрелке: +Y=0°, +X=90°, −Y=180°, −X=270°. При horizontal rotation это MODEL azimuth, не survey North azimuth.
- Если обе Z известны: ΔZ и 3D = hypot(ΔX, ΔY, ΔZ). При отсутствующей Z эти строки не показываются. Для coincident XY azimuth отсутствует.

Measure, draft, selection и snap preferences находятся только в UI; они не создают entity, dirty changes или history. Это planar geodetic azimuth, без meridian convergence, геодезического inverse problem или CRS transformation.

## Dimension

«Размер»: первая точка → вторая точка → положение размерной линии. Первые два endpoints поддерживают snap; третья позиция задаёт signed perpendicular world offset. Положительный offset — слева от направления первой точки ко второй в XY (для линии вдоль MODEL +X это MODEL +Y).

```json
{
  "id": "dim-1", "name": "Размер 1", "type": "dimension", "layerId": "dimensions",
  "startVertexId": "v1", "endVertexId": "v2", "offset": 3.5
}
```

В entity нет сохранённой длины. `alignedDimension` вычисляет extension endpoints, label position и horizontal length из registry. Renderer показывает extension lines, dimension line, ticks и значение. Перемещение shared point сразу обновляет dimension и boundary, Undo/Redo восстанавливают их вместе без UpdateDimension command. Fit включает offset endpoints.

New содержит layers boundary/buildings/survey-points/dimensions/annotations. Если dimensions отсутствует в старом документе, первая dimension command атомарно создаёт слой с annotation style (или первым доступным style), order после существующих. Undo убирает и размер, и добавленный слой. Locked dimensions target вызывает отказ. Новый размер с нулевой XY baseline отклоняется; если последующее редактирование сводит endpoints вместе, размер безопасно выводит 0 и azimuth —.

Dimension references удерживают vertices при удалении исходных points/lines. Удаление последнего dimension consumer освобождает orphan vertices. Создание/удаление/Undo/Redo и JSON round-trip используют общую reference lifetime policy.

## Подписи и форматирование

Point name хранится в `entity.name`, при импорте это source Point ID. Режимы: Имя / Имя + Z / Только Z. Известная высота рисуется с маленьким △ marker; отсутствующая Z не заменяется нулём. «Длины линий» включает derived LineEntity labels; polyline segment labels автоматически не создаются. Для выбранных расстояний используйте dimensions.

Связанную подпись добавляют явно из Properties выбранной point/line/polyline/polygon. Point anchor — её координата; Line — середина сегмента; Polyline — середина по суммарной длине; Polygon — area centroid с безопасным fallback к центру bounds. `dx`/`dy` хранят world-space смещение, поэтому перемещение цели пересчитывает anchor, а ручная правка/drag подписи сохраняет offset. Hidden target layer скрывает подпись; lock цели не запрещает редактировать сам label. Удаление цели атомарно удаляет labels и Undo восстанавливает их. См. [EDITOR_UX](EDITOR_UX.md).

`geometry/format.ts` содержит центральный DISPLAY_PRECISION: distance/height/azimuth = 3. Formatter decimal azimuth можно позже заменить DMS без изменения geometry. Domain values не округляются, inspector numeric inputs сохраняют полную точность. Настройки не входят в JSON, history или autosave; New/Open/reload возвращают defaults.

Label placeholders используют тот же distance precision и geometry functions, что системные показатели. `{name}`, `{x}`, `{y}`, `{z}`, `{h_absolute}` применимы к Point; `{length}` к Line/Polyline; `{area}`/`{perimeter}` к Polygon. Template — literal text с whitelist replacement; unknown `{field}` остаётся буквальным текстом. Значения JSON не округляются.

Вручную создаваемые объекты используют текущий видимый незаблокированный layer. Выбор слоя/объектов — только editor state, rename слоя — history command. Dimension сохраняет специальный `dimensions` default, а Import сохраняет выбранную цель. Полный keyboard workflow: [EDITOR_UX](EDITOR_UX.md).

## Производительность и границы

Provider кэшируется по committed document; во время drag используется snapshot до транзакции. Pointermove coalesced через requestAnimationFrame; на pointerdown/up очередь синхронно сбрасывается. Snap search сейчас O(vertices + segments), с дешёвым bounding rejection перед hypot. `SnapProvider.query(cursor, toleranceWorld)` позволяет вернуть локальные кандидаты из индекса, не меняя GeoDocument.

Воспроизводимый замер: `npm test -- src/tests/snapping-performance.test.ts`. 50 000 points, 100 warmup, 1000 разных запросов; отчёт `test-results/snapping-benchmark.json`. На Apple M4 / Node 20.20.1: build provider ≈20–32 мс, median ≈0,21–0,24 мс, p95 ≈0,23–0,25 мс. Spatial index по этому замеру не понадобился. Это оценка **чистого поиска**, не всей интерактивности: SVG с 50 000 labels, JSON fingerprint, snapshots и storage могут быть существенно дороже. Здесь нет гарантии 60 FPS для всего редактора. Проверка самопересечений использует edge bounding rejection и adjacent overlap checks; worst-case O(n²). Аудит simple 5000-vertex ring: ~1158 → 26 ms. Ограничения больших/adversarial contours и SVG 50k — в [ARCHITECTURE_REVIEW](ARCHITECTURE_REVIEW.md).

Schema остаётся v2; старые валидные v2 читаются. Новый dimension variant — расширение reader, без миграции. Старые версии приложения могут отвергнуть файлы с dimensions.

## Precision drawing и dimension editing

При Line/Polyline/Polygon Shift ограничивает следующий segment ближайшим направлением через 45°, F8 переключает persistent ORTHO (90°). Shift временно перекрывает Ortho. Расчёт идёт в world coordinates, длина cursor vector сохраняется. Explicit vertex snap в 10 px имеет приоритет; затем angle constraint; без constraint остаётся vertex → midpoint → configured grid/free cursor. Grid/midpoint не портят точный constrained angle. Preview и click пользуются одним anchor resolver.

В Select размер можно перетаскивать за широкую размерную или выносную линию: изменяется signed offset, опорные vertices не двигаются. Число имеет отдельный hit target: его drag меняет `textPosition` вдоль baseline с clamp 0.05–0.95, без изменения offset. Каждый drag — одна транзакция; Escape отменяет draft. Числовое поле «Отступ размера» commits на blur/Enter одним command. Старые размеры без `textPosition` показываются по центру (0.5); schemaVersion остаётся 2. Active geometry handles имеют приоритет над широкими hit areas аннотаций, чтобы дом можно было редактировать после постановки размеров.

## MODEL / SURVEY

Grid, drawing, snapping, dimensions и lengths остаются MODEL-space при любом display mode. Rigid reference scale1 не переписывает vertices и не меняет инженерные размеры. Survey North отражает calibrated +Northing в MODEL с SVG Y inversion; unreferenced local показывает +Y. Model/Survey preference меняет только status X/Y→E/N, не camera/history/dirty. Point inspector одновременно показывает editable MODEL и readonly E/N/H. Измеряемый азимут существующего Measure/inspector по-прежнему относительно MODEL +Y; не трактовать его как survey azimuth после поворота reference.

AI polygons не содержат PointEntity на каждом углу. Инструмент «Точка» с Vertex SNAP создаёт PointEntity, разделяющую угол, после чего она доступна для двух контрольных пар. Изменение shared control XY делает привязку STALE без automatic recalibration. Reference и independent absolute-height datum описаны в [GEOREFERENCING](GEOREFERENCING.md). Import selector задаёт frame явно; Height→MODEL Z сохраняет прежний mapping. `{z}` остаётся MODEL Z, `{h_absolute}` получает derived H либо «—».

## Перенос выбранной геометрии

`move-entities { entityIds, delta: { x, y } }` — normal deterministic command в MODEL метрах. Resolver собирает уникальные vertices Point, Line endpoints, Polyline/Polygon paths и Text position vertex. Z и IDs остаются прежними, вся выбранная геометрия получает одинаковый world delta. Viewport влияет только на screen↔world conversion: currentWorld−startWorld. Numeric M задаёт delta непосредственно; формулы SURVEY остаются derived.

Body drag работает для Polygon outline/interior через view-level transparent hit area и для Line/Polyline stroke (14 CSS px). Это не domain fill/style mutation. Vertex grips приоритетнее body move, dimension endpoint grips — retarget. Shift Move: |dx|>|dy| → dy=0, иначе dx=0; drawing Shift45/F8 не меняются. Group grid/vertex snap в этом срезе отсутствует.

Topology canonical: shared IDs сдвигаются один раз, unselected consumers следуют без detach/duplicate. Resolver сообщает affected unselected IDs и блокирует всю операцию, если выбранный объект или любой affected geometry/Dimension/Label находится на locked layer, включая hidden. Hidden unlocked topology обновляется.

Label follows выбранную или полностью перемещённую shared target geometry без дополнительного delta. Independently selected Label получает visual delta через offset; частичный indirect anchor shift компенсируется. Label alone сохраняет старый offset drag. Dimension не добавляет свои references в moving vertices: source move выводит новое положение; dimension settings/IDs не меняются. Dimension alone сохраняет offset/textPosition/retarget.

Pure projected drag хранится в EditorState отдельно от canonical document. Pointerup выполняет normal command и создаёт один history snapshot. Cancel полностью отбрасывает preview; storage/AI stale guard видят только committed изменения. Ordinary geometry сохраняет horizontal reference, а moved control XY даёт STALE без recalibration. Future detach, anchor snapping и transforms требуют отдельных явных policies.

## Spatial placement primitives

relative_to_entity: gap между bounding extents в выбранном compass frame, perpendicular centering; diagonals same gap on both axes. inside_entity переиспользует AutoPlacement + полную containment реального контура. Valid horizontal reference → SURVEY, absent/stale → MODEL (stale warning); rectangle orientation остаётся MODEL.

Along-edge: уникальная outward-facing прямая side/collinear chain → обычная Polyline с точным parallel normal offset. Неоднозначные стороны invalid. Array: 1–50 MODEL rectangles, count/size/itemGap explicit; layout/clear gaps в compass frame, группа центрируется. Общего polygon offset, routing и collision solver нет. [SPATIAL_AI](SPATIAL_AI.md).
