# Axonometric View V1

Один `GeoDocument`, один vertex registry, прежние entity IDs и Symbol-port references. «Вид» в панели настроек выбирает План или аксонометрию СВ/СЗ/ЮВ/ЮЗ. Документ не конвертируется и не копируется. Высота редактируется через MODEL координаты в инспекторе.

## Проекция и камеры

Pure module `src/view/projection.ts` задаёт параллельный линейный базис. Для NE в координатах с Y вверх: X = (√3/2, 1/2), Y = (−√3/2, 1/2), Z = (0, 1). Остальные три варианта поворачивают направление наблюдения вокруг Z на 90°. Screen Y инвертируется ровно один раз в camera transform. Parallel lines remain parallel; MODEL distances are never rewritten into projected values.

До умножения на базис вычитается стабильный XYZ origin, выбранный по видимой модели при первом входе. Затем вычитается центр активной projected camera. Большие MODEL X/Y остаются каноническими, экран получает локальные координаты. Pan/zoom не меняют origin. Смена ориентации выполняет Fit; возврат между видами восстанавливает независимый pan/zoom каждого вида. Global Fit, Fit Layer и Fit результата поиска используют bounds текущей проекции.

`EditorState` хранит mode, projection context и отдельные камеры. `RenderCamera` расширяет viewport только на границе renderer; `GeoDocument.viewport` не меняется. Эти операции не создают history, dirty или autosave revision. View preferences живут в текущей сессии; Open/New/reload начинают с Плана.

Экранная точка определяет луч, а не единственную XYZ координату. `screenToWorld` в аксонометрии возвращает координаты **плоскости проекции**, не MODEL XYZ. Явный `groundPointFromProjection` разрешён только для сетки Z=0.

## Высоты и привязки

`PRESENTATION_DEFAULT_Z = 0` — единственный presentation fallback для отсутствующей высоты. `undefined` не превращается в измеренный ноль. Отсутствие Z остаётся в JSON; инспектор показывает пустое поле. Explicit Z=0 сохраняется как число. MODEL Z не зависит от vertical datum; Absolute H вычисляется только для отображения. Изменение ±0.000 меняет H, не размещение объектов. Горизонтальная привязка по-прежнему даёт SURVEY E/N из MODEL X/Y.

SymbolEntity.position теперь `WorldPoint` с optional z. Команда `set-symbol-position` проверяет конечность, layer lock, no-op и участвует в обычном Undo/Redo. Обычное перемещение XY сохраняет Z. Порт получает преобразованный local XY и Symbol Z; optional local port z поддерживается типом/схемой и масштабируется вместе с определением. Существующие библиотеки имеют плоские порты.

## Геометрия и аннотации

- Points, Line, Polyline и Polygon проецируют каждую вершину с её собственным Z. Noncoplanar polygon остаётся projected path/fill; поверхность не триангулируется.
- Arc/Circle сохраняют XY-плоскость на center.z или fallback. Общий bounded presentation sampler даёт эллиптическое изображение, не экранный круг. SVG использует 0.35 px target sagitta; cap 512 сегментов. Canvas кеширует tessellation при reference density 250 px/MODEL unit с тем же cap: на экстремальном приближении возможны видимые грани.
- Symbols — **controlled plane glyphs** в XY на высоте якоря. Порты и изображение согласованы; экструзий нет. Круглые детали проецируются, а не остаются экранными кругами.
- Native и DXF text остаются screen-facing; буквы не скашиваются ground basis. Label follows target: Point/Symbol exact Z, Line midpoint/interpolated Polyline Z, Polygon mean presentation Z. Label dx/dy по-прежнему MODEL offsets, затем проекция. Это placement policy, не геодезическое определение высоты подписи.
- Dimension проецирует referenced endpoints и offset geometry с высотами концов, сохраняя **плановое** числовое расстояние. При разных Z выводится «плановый размер». 3D dimensions не добавлены.

## Соединения

Same Z: существующий XY route целиком на этой высоте. Orthogonal different Z: XY route на Zstart → vertical riser у последнего XY endpoint → Zend. Direct different Z: прямая между портами XYZ; старые XY waypoints не интерпретируются как 3D waypoints. Это derived presentation, не сохранённая маршрутизация. Canonical waypoints и semantic port refs остаются прежними.

Легенда: «3D-маршрут не задан; вертикальный переход отображается у конечного порта». Она также раскрывает missing-Z fallback. Проверена AI chain Input → Valve → Filter → Regulator → Meter → Output с Z [0, 0, 0.5, 1, 1, 2]. AI intent/provider schemas не расширялись; local workflow сохраняет planar MODEL origin даже при открытом Axon view.

## Renderer, selection и cache

Общий `worldToScreen` применяет projection + camera. Общий presentation walker проходит shared DXF definitions с XY affine transform и отдельными Z offset/scale, включая basePoint, nested INSERT и attributes. Он не материализует новый GeoDocument или flattened canonical block geometry.

Plan сохраняет прежний hybrid renderer и compiled shared Path2D. В Axon DXF остаётся Canvas; ориентационные presentation Path2D кешируются отдельно. Text рисуется после vector paths. Native overlays — SVG; выбранные объекты поверх содержимого. Approximate painter depth определяется направлением nullspace проекции и stable layer/ID ordering. Canvas base находится под native overlay: это ограничение compositor V1, не z-buffer или hidden-line removal.

MODEL XYZ bounds кешируются независимо от камеры/ориентации. Projected owner bounds и BVH зависят от projection context и immutable document revision. Camera bounds вычисляются для текущего pan/zoom, без переиспользования Plan culling. Кривые используют консервативные экстремумы. Screen hit tests проверяют projected strokes, fills/holes и glyph anchors; точка у вершины имеет приоритет над проходящей линией. DXF выбирается как owner, без materialized SVG.

View/Select/Inspect доступны. Numeric coordinates, styles, properties и layers редактируются обычными командами. Свободный drag/create, retarget grips, 3D snapping, marquee и nested editing в Axon V1 отключены. При попытке drag: «Перемещение в аксонометрии пока выполняется через точные координаты X/Y/Z. Для свободного перемещения используйте вид План». Space/middle/right drag и zoom управляют камерой. XYZ gizmo заменяет North arrow. Ground XY grid лежит только на Z=0 и имеет адаптивную плотность.

## Persistence и acceptance

SchemaVersion остаётся 2: optional Symbol Z backward-compatible. Legacy без Z открывается без destructive migration. Save/Open и IndexedDB сохраняют Symbol elevations и прежние Connector references. Projection coordinates/caches/cameras не записываются в документ.

Повторить обычные проверки: `npm run check`. Полный reference acceptance (Chrome):

## Measured performance

См. итоговую таблицу ниже. Значения — наблюдение action → two requestAnimationFrame в headless Chrome 154.0.8037.98, 1440×900, local dev build. Включают browser automation/layout/paint ожидание; это не FPS и не чистое время алгоритма. Layer toggle — Hide + Show, без изменения конечной модели. Initial DXF включает UI import, parsing, conversion, Fit и render; Axon initial — первое переключение и render. Значения одного локального прогона, не статистический SLA.

| Сценарий, мс | DXF Plan | DXF Axon NE | Сеть Plan | Сеть Axon NE |
| --- | ---: | ---: | ---: | ---: |
| Первый render / вход Axon | 2020.3 | 122.4 | 324 | 38.9 |
| Fit | 60.5 | 64.7 | 74.5 | 64.3 |
| Pan | 64.8 | 66.5 | 100.1 | 66.7 |
| Zoom | 80.9 | 85.2 | 66.6 | 100 |
| Selection | 52.3 | 31.3 | 33.3 | 49.8 |
| Hide + Show populated layer | 172.2 | 237.7 | 112 | 129.3 |

Контрольный DXF: 458 owners, 450 shared block definitions, 22515 definition primitives; Fit/pan/zoom видны 446 Canvas owners. DOM drawing SVG: 75 Plan / 103 Axon. Первый Canvas draw: 28.7 / 46.3 мс; последующие обычные camera draws: примерно 6.0–7.7 / 7.7–10.5 мс. Hide/Show включает cache rebuild; Axon draw до 42.1 мс. Сеть: 100 Symbols / 150 Connectors, SVG DOM 1470 / 1367, сохранённые Z чередуются от 0 до 2.

Итоговая verification: **834 unit/integration passed / 75 opt-in skipped**, из них **37 Axon tests**; **165 Chrome E2E passed / 9 opt-in skipped**. Отдельный полный reference прогон: **5 passed**, 0 console/page errors. Typecheck, lint, production build проходят; npm audit: **0 vulnerabilities**.

## Ограничения и следующий slice

Нет perspective/orbit/meshes/extrusions/3D CAD, arbitrary 3D routing, terrain surface, hidden-line removal или AI elevation. Flattened **presentation paths** per visible DXF owner могут расходовать больше памяти, чем shared Plan paths. Projected BVH использует conservative XYZ boxes, поэтому bounds могут быть больше фактического footprint. Exact stroke hit всё равно отделяет пустые области. Высота polygon label — только presentation policy. При дальнейшей оптимизации важно сохранять независимые MODEL/projected/camera caches и единую projection convention.

Следующий один vertical slice: **ручное редактирование planar Connector waypoints** в Плане, с preview и одним Undo/Redo. Он не реализован в этой задаче.

## Paper contexts and image planes

Model retains Plan/Axon and independent cameras. Selecting a DXF paper context enters Plan presentation without document/history changes; Model restores prior projection/camera. The projection selector explains its paper-only restriction. Raster underlays project as an affine XY plane at Z=0; free manipulation remains Plan-only. See [DXF_LAYOUTS](DXF_LAYOUTS.md) and [RASTER_UNDERLAYS](RASTER_UNDERLAYS.md).
