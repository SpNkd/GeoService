# MODEL → SURVEY и абсолютная высота

## Архитектура координат

Канонические `vertices` всегда находятся в MODEL frame. `modelFrame: "local"` означает локальные оси X/Y; `"projected"` означает прямые E/N, где E=X, N=Y. Новая схема явно local. Старый schemaVersion 2 без `modelFrame` открывается как projected/direct, независимо от величины координат и старого `coordinateSystem.kind`. Поле остаётся отсутствующим при round trip старого файла: ручная миграция не требуется. Legacy `coordinateSystem` описывает происхождение/название; его исторические axis literals не переопределяют повернутую MODEL frame. Автоматического определения системы нет.

Горизонтальная и высотная привязки — независимые optional поля GeoDocument. Renderer, camera, grid, snap, geometry metrics, dimension offsets и `{x}/{y}/{z}` работают с MODEL. Derived E/N и H вычисляются по запросу; не дописываются в vertices и не материализуются в JSON. Apply/Remove меняют reference metadata одной history операцией, сохраняя registry и числовые значения vertices. Undo/Redo восстанавливают принятые reference snapshots.

```text
GeoDocument.modelFrame?: local | projected
horizontalReference?:
  controls: [
    {pointEntityId, vertexId, modelSnapshot: {x,y}, survey: {e,n}},
    {pointEntityId, vertexId, modelSnapshot: {x,y}, survey: {e,n}}
  ]
  transform: {rotation: radians, translation: {e,n}, scale: 1}
verticalReference?: {modelZero: 0, absoluteAtModelZero: metres}
```

## Rigid 2D

Чистые функции `geometry/georeferencing.ts` не зависят от React/store:

- `computeRigidTransform2D(modelA, modelB, surveyA, surveyB)` → status, transform и residual metrics;
- `modelToSurveyXY(point, transform)` / `surveyToModelXY(point, transform)`;
- `modelToAbsoluteZ(z, reference)` / `absoluteToModelZ(h, reference)`;
- `documentSurveyXY(document, point)` выбирает direct/reference/unavailable;
- `surveyNorthDirection(transform)` возвращает MODEL и screen unit vectors;
- `staleControls(document)` проверяет только два snapshot XY.

Для векторов `Bm−Am` и `Bs−As`:

```text
θ = angle(Bs−As) − angle(Bm−Am), normalized to [−π,π]
R = [[cos θ, −sin θ], [sin θ, cos θ]]
t = As − R·Am
Survey = R·Model + t
Model = Rᵀ·(Survey − t)
```

Масштаб всегда 1. A совмещается точно с floating-point precision. При разных длинах баз B сохраняет остаток: `residual = entered Bs − transformed Bm`. Показываются signed ΔE/ΔN, magnitude и `difference = surveyBaseline − modelBaseline`. Ни растяжения, ни скрытого исправления инженерных размеров нет. Геометрия с Z не поворачивается/пересчитывается по вертикали.

Например A=(0,0), B=(10,0), As=(500000,6000000), Bs=(500000,6000010): θ=+90°; MODEL (5,5) → E=499995, N=6000005. Обратное преобразование вычитает большой origin перед вращением. Тесты проверяют translation, 90°, 45°, отрицательные углы, ненулевой MODEL origin и large-coordinate round trips.

## Safety policy

`GEOREFERENCE_POLICY` — централизованные UX guardrails, **не нормативная геодезическая точность**:

| Условие | Результат |
| --- | --- |
| Один PointEntity выбран дважды; отсутствует PointEntity; нечисловые/overflow значения | INVALID, Apply disabled |
| MODEL или SURVEY baseline <0.100 м, включая совпадение точек | INVALID |
| Абсолютная difference ≤0.010 м | OK |
| Difference >0.010 м, но не превышает `max(0.500 м, 5% MODEL baseline)` | WARNING; Apply доступен после просмотра остатка |
| Difference >`max(0.500 м, 5% MODEL baseline)` | INVALID; Apply blocked |

При baseline 30.000/30.013 получается WARNING, residual 0.013 м. При 30/42 — INVALID. Политика оценивает согласованность пары, а не достоверность съёмки: две одинаково ошибочные survey точки могут иметь согласованную базу. Не использовать этот check как гарантию кадастровой/геодезической точности.

## UI и контрольные точки

Слева «Координаты документа» показывает local/unreferenced, local/referenced (или STALE), projected/direct. Selector «Frame геометрии» позволяет явно обозначить local или projected без преобразования исходных X/Y, одной metadata history операцией. Это нужно, например, для старого локального чертежа, у которого frame ещё не был явно задан. При horizontal reference смена frame блокируется до Remove. В local режиме доступны «Привязать координаты», «Изменить привязку», «Удалить привязку».

Диалог выбирает **существующие PointEntity**, показывает их MODEL X/Y и вводит E/N отдельно для A/B. «Выбрать A/B на схеме» временно возвращает canvas; клик принимает только PointEntity, не создаёт новую точку. Диалог загружается отдельным lazy chunk. Picker допускает middle-button pan и zoom без document mutations. Диалог сохраняет draft, подавляет file/history shortcuts, удерживает focus; Esc отменяет или возвращает из picker. Preview не пишет документ/dirty/history. Показываются θ, t, обе базы, difference и residual. До Apply видны два контрольных маркера, их derived координаты и preview north; второй survey grid не рисуется.

AI rectangle содержит polygon vertices, а не PointEntity. Чтобы использовать угол как контроль, создайте PointEntity инструментом «Точка» с включённым Vertex SNAP на углу. Она переиспользует vertex ID; calibration сама не создаёт/не подменяет points. Названия могут повторяться: dropdown дополнительно показывает entity ID, хранится ID, а не имя. Hidden точки доступны в dropdown; canvas picker работает с видимыми точками. Locked точки можно использовать как reference: Apply их не редактирует.

View preference «Координаты → Model · X/Y / Survey · E/N» находится вне документа; не меняет dirty/history/autosave/camera. Status bar меняет numeric representation X/Y→E/N. В local/unreferenced Survey недоступен и показывает «—», не притворяясь identity. Point inspector одновременно показывает editable MODEL X/Y/Z, readonly E/N и, при vertical reference, H. При STALE derived E/N продолжают использовать committed transform.

## Север и SVG

Настоящий survey +Northing в MODEL имеет vector `(sin θ, cos θ)`. В screen это `(sin θ, −cos θ)`: SVG Y инвертируется один раз. Стрелка вращается относительно screen up на θ. При +90° север смотрит вправо. Для projected/direct θ=0; для unreferenced local показывается `+Y` с указанием отсутствия Survey, а не ложное утверждение географического севера. Вращение viewport не реализуется.

## STALE и жизненный цикл

Reference хранит committed MODEL snapshots и transform. Изменение XY контрольной вершины (в том числе через другую entity, разделяющую vertex ID) выводит STALE и предупреждение «Контрольная точка P1 изменилась после привязки». Z или неконтрольная вершина не меняют горизонтальное состояние. Transform остаётся прежним. STALE вычисляется из текущих XY и snapshot, не является persistent flag; возврат точно к snapshot снимает STALE.

«Пересчитать привязку» открывает preview с текущими MODEL XY и сохранёнными survey inputs. Только новый Apply принимает transform и snapshots. Undo возвращает прежний committed transform и производное STALE. Save/Open сохраняет оба состояния корректно.

Удаление участвующего PointEntity запрещено командной границей, включая atomic multi-delete: «Точка P1 используется для привязки координат. Сначала измените или удалите привязку.» Rename/слой не разрывают reference; Remove освобождает контроль для удаления. Отдельное удаление другой entity с общей вершиной безопасно: PointEntity удерживает vertex.

## Высотная привязка и labels

`±0.000 = 153.420 м` означает `H = MODEL Z + 153.420`. Z=0 →153.420; Z=2.500 →155.920; Z=−1.200 →152.220. Обратная функция вычитает reference. Apply/Remove высотной привязки — отдельные metadata commands/history; горизонтальная привязка не требуется.

Точка без Z имеет unavailable H, а не reference+0. `{z}` остаётся MODEL Z. Новый `{h_absolute}` и preset «Абсолютная высота» используют vertical reference; без reference или Z выводят «—». Memoized renderer инвалидирует LabelEntity при изменении vertical reference, поэтому label обновляется сразу без подмены vertices. Формат до трёх знаков относится только к отображению.

## Импорт и AI

Mapping входной таблицы остаётся прежним: Easting→X, Northing→Y, Height→Z; перестановка исходных национальных X/Y выполняется явным mapping. Новый selector **входной** frame:

- MODEL: импортирует XY/Z как есть в текущую model frame, не определяет frame по числам;
- SURVEY в пустой схеме: записывает projected/direct frame и XY без преобразования, одним import/history шагом;
- SURVEY в nonempty local/referenced: inverse transform применяется **только к новым импортируемым XY** с committed calibration;
- SURVEY в nonempty local/unreferenced: блокируется с предложением выбрать MODEL или новый документ.

Height→Z по-прежнему является прямым mapping MODEL Z. Даже при vertical reference импортёр не угадывает datum и не преобразует высоту автоматически: для абсолютного H нужен отдельный будущий явный import mapping. Horizontal projected semantics не означают известный vertical datum.

AI intent/provider/reliability не изменены; никаких georeference intents. Point/rectangle/house/bulk dimensions проходят прежний deterministic resolver. Новая local схема получает локальные vertices, reference затем добавляет derived E/N. По сети по-прежнему уходит только user text, не документ/vertices. E2E A использует контролируемый mock semantic response через существующий HTTP boundary; real LLM не нужен для проверки математики привязки.

## Persistence и performance

SchemaVersion остаётся 2. Структура и ссылки проверяются runtime schema. Scale кроме1 отклоняется, transform проверяется против committed snapshots и survey inputs; текущие stale XY не подменяют snapshots при загрузке. Строгое reference payload не принимает лишние поля. Legacy v2 без расширений открывается direct; derived vertex fields и display preferences не сохраняются.

## Ограничения и будущий экспорт

Нет EPSG conversion, geographic coordinates, maps, geoid, scale adjustment, 3+ control least squares, survey inverse editing, GIS и DXF. Legacy `epsg` field лишь сохраняется ради совместимости, новая функциональность его не использует. Политика residual не измеряет общую погрешность съёмки.

Будущий DXF exporter должен явно выбрать MODEL или SURVEY XY и независимо MODEL Z или absolute H, обработать absent/stale reference и преобразовывать экспортную копию on demand. Нельзя предварительно переписывать document vertices для экспорта. Следующий шаг — согласование export coordinate contract; в этой итерации экспорт не реализуется.

## Проверка завершённого slice

2026-10-05: `npm run typecheck`, `npm run check` (lint,419 unit,production build,75 E2E), `npm audit --registry=https://registry.npmjs.org` — успешно,0 vulnerabilities. Прежние370 unit/68 E2E сохранены; добавлены49 unit/7 E2E. Один существующий paid real-provider smoke остаётся opt-in/skipped. Все новые browser scenarios проверяют0 console/page errors. CPU audit прошёл отдельно. Production bundle разделён на main≈497kB и georeference dialog≈6.2kB; остаются только прежние Zod annotation warnings. AI modules не изменены. Dev-server оставлен на127.0.0.1:5173 в real OpenRouter mode; E2E используют mock HTTP responses без внешних AI calls.
