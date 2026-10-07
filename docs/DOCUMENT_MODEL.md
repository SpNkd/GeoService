# GeoDocument schema v2

Источник TypeScript типов — `src/domain/model.ts`. Канонические вершины геометрии существуют ровно один раз в `vertices`; Point/Line/Polyline/Polygon/Text/Dimension содержат ссылки на них. Symbol хранит собственную MODEL instance position, а Label — derived anchor и offset. Document runtime boundary — `src/persistence/documentSchema.ts`: Zod schema и отдельная semantic validation ссылок. JSON загрузка выполняется только после обеих проверок.

## Схема документа

```text
GeoDocument
  schemaVersion: 2
  metadata: { id, title, description }
  modelFrame?: "local" | "projected"
  horizontalReference?: { controls: [A, B], transform: { rotation, translation: {e,n}, scale: 1 } }
  verticalReference?: { modelZero: 0, absoluteAtModelZero }
  coordinateSystem: { kind, name?, epsg?, xAxis: "east", yAxis: "north", zAxis: "up" }
  units: { length: "m", area: "m2" }
  vertices: Record<VertexId, Vertex { id, x, y, z? }>
  entities: Entity[]
  layers: Layer[]
  styles: EntityStyle[]
  viewport: { center: { x, y }, pixelsPerUnit }
```

Стабильный `VertexId` — ключ registry и значение `vertex.id`. Дублировать координаты ссылочных vertices в entities запрещено; Symbol.position — самостоятельная позиция экземпляра без shared vertex identity. `VertexRegistry` — обычный JSON object, поэтому файл сохраняет читаемую запись `vertices["v1"].x` без специального сериализатора. Все значения X/Y/Z конечные JS `number`.

## World axes и системы координат

Canonical X/Y/Z — MODEL coordinates в метрах. `modelFrame="local"` задаёт локальную frame; horizontal reference выводит SURVEY E/N. `modelFrame="projected"` задаёт прямые E=X/N=Y. Без `modelFrame` legacy v2 сохраняет projected/direct semantics без миграции и без numeric detection. Новый документ явно local. `coordinateSystem.kind/name/axis literals/epsg` остаются legacy provenance metadata; они не задают orientation после calibration и не выполняют преобразования.

Screen Y вниз, MODEL Y вверх. `Z` остаётся MODEL Z независимо от horizontal frame; абсолютная H известна только с independent vertical reference. Geometry distances/areas/dimensions и snap остаются в MODEL. Подробнее о контрольных snapshots, validation, STALE и round trip: [GEOREFERENCING](GEOREFERENCING.md).

Стандартная внешняя система X north/Y east требует явной перестановки в import mapping. Поле `coordinateSpace` в import command явно выбирает MODEL или SURVEY; frame не определяется из величины значений. Survey import в пустой документ создаёт projected/direct semantics одной операцией.

## Vertex registry и совместное использование

Каждая vertex хранится один раз в документе:

```json
"vertices": {
  "v-p1": { "id": "v-p1", "x": 562341.234, "y": 6189345.221, "z": 152.34 },
  "v-next": { "id": "v-next", "x": 562401.234, "y": 6189345.221 }
}
```

Entity ссылается на ID. Совпадение координат и proximity не связывают вершины. Существует намеренно только одна shared identity, когда создатель двух entities указывает одинаковый ID. Update меняет registry vertex; все ссылочные объекты при повторном render получают новые координаты. Ссылка с отсутствующим vertex ID невалидна.

Удаление entity сохраняет shared vertices, удаляет vertices без оставшихся ссылок. Endpoint snap намеренно связывает IDs; unsharing и автоматический vertex merge отсутствуют. Dimension также удерживает refs. Undo/redo восстанавливают точные IDs и снимок registry до/после операции.

## Entities

Общие поля: `id`, `name`, `type`, `layerId`, необязательный `styleId`.

| type | Vertex references | UI/geometry |
| --- | --- | --- |
| `point` | `vertexId` | Marker, name и опциональная Z подпись |
| `line` | `startVertexId`, `endVertexId` | Planar distance |
| `polyline` | `vertexIds`, минимум 2 | Открытая ломаная, planar path length |
| `polygon` | `vertexIds`, минимум 3 | Семантически замкнутый полигон, planar area/perimeter; первую вершину повторно не указывают |
| `dimension` | `startVertexId`, `endVertexId`, signed world `offset` | Derived aligned horizontal dimension; length не хранится |
| `connector` | `start/end: {kind: symbol_port, symbolEntityId, portId}`, `routing`, `waypoints?`; без vertex refs | Точные MODEL endpoints/route derived из Symbol + definition port; `styleId?` как у остальных entities |
| `symbol` | Нет vertex refs; `libraryId`, `symbolId`, `position`, `rotationDeg`, `scale`, `properties?` | Registry definition + MODEL instance transform; `name` обязателен |
| `text` | `vertexId` | Свободная подпись и `fontSize` в CSS px |
| `label` | `targetId`, `template`, `dx`, `dy` | Persistent подпись для point/line/polyline/polygon/symbol; anchor derived, offset world XY |

Vertices polygon/polyline можно изменять drag выбранного vertex handle. Предварительная незаконченная линия/полигон находится в editor state, до команды `add-entity` в документе их нет. Новый самопересекающийся polygon отклоняется командой; старый или изменённый через drag показывает warning в inspector. Holes, дуги и constraint topology не поддерживаются.

## Layers и lock

Layer: `id`, `name`, `visible`, `locked`, `order`, `styleId`. Entities обязаны ссылаться на существующий layer и vertex, кроме сущностей с derived/instance geometry без собственных вершин, включая LabelEntity, SymbolEntity и ConnectorEntity. Visible layers рисуются по возрастанию order, entities внутри слоя — в порядке массива. Locked entity видна, выбирается для read-only инспекции и не содержит drag/vertex handles. Выбранный/current layer относится к UI state.

Vertex, на который указывают несколько entities, изменяем лишь если все их слои unlocked. Иначе сдвиг доступного объекта неожиданно мутировал бы locked entity. Layer visibility и lock можно переключать напрямую из панели слоёв.

## Entities и связанные vertices: пример

```json
{
  "schemaVersion": 2,
  "metadata": { "id": "parcel-01", "title": "Участок", "description": "Ссылочные точки участка" },
  "coordinateSystem": {
    "kind": "projected", "name": "Projected sample coordinates",
    "xAxis": "east", "yAxis": "north", "zAxis": "up"
  },
  "units": { "length": "m", "area": "m2" },
  "vertices": {
    "v-p1": { "id": "v-p1", "x": 562341.234, "y": 6189345.221, "z": 152.34 },
    "v-p2": { "id": "v-p2", "x": 562401.234, "y": 6189345.221 },
    "v-p3": { "id": "v-p3", "x": 562401.234, "y": 6189385.221 },
    "v-p4": { "id": "v-p4", "x": 562341.234, "y": 6189385.221 }
  },
  "entities": [
    {
      "id": "parcel-boundary", "name": "Граница", "type": "polygon", "layerId": "boundary",
      "vertexIds": ["v-p1", "v-p2", "v-p3", "v-p4"]
    },
    {
      "id": "survey-p1", "name": "P1", "type": "point", "layerId": "survey-points", "vertexId": "v-p1"
    },
    {
      "id": "survey-p2", "name": "P2", "type": "point", "layerId": "survey-points", "vertexId": "v-p2"
    },
    {
      "id": "baseline", "name": "Базовая линия", "type": "line", "layerId": "boundary",
      "startVertexId": "v-p1", "endVertexId": "v-p2"
    }
  ],
  "layers": [
    { "id": "boundary", "name": "Граница", "visible": true, "locked": false, "order": 0, "styleId": "survey" },
    { "id": "survey-points", "name": "Точки", "visible": true, "locked": false, "order": 1, "styleId": "survey" }
  ],
  "styles": [
    { "id": "survey", "stroke": "#21836e", "fill": "none", "lineWeight": 1.5 }
  ],
  "viewport": { "center": { "x": 562371.234, "y": 6189365.221 }, "pixelsPerUnit": 10 }
}
```

`P1`, полигон и линия здесь разделяют точные IDs намеренно. Например, перемещение `v-p1` в один метр на восток одновременно меняет displayed P1, первую boundary corner, line start и вычисленную площадь/длину. Создание отдельной точки рядом выдаёт новый vertex ID.

## Styles и расчёты

EntityStyle содержит `id`, `stroke`, `fill`, `lineWeight` (CSS px), необязательный `dash`. Если entity style нет, используется style слоя. Выделение — renderer state и не меняет document style. Расстояния, area и координаты рассчитываются из registry values без форматирования/округления. `toFixed(3)` применяется при выводе текста; инспектор numeric fields обращается к исходным double values.

## Commands и history

Примеры команд:

```json
{ "type": "update-vertex", "vertexId": "v-p1", "position": { "x": 562342.234, "y": 6189345.221, "z": 152.34 } }
```

```json
{
  "type": "add-entity",
  "entity": { "id": "point-1", "name": "Точка", "type": "point", "layerId": "survey-points", "vertexId": "v-new" },
  "vertices": [{ "id": "v-new", "x": 562342.234, "y": 6189345.221 }]
}
```

`domain/commands.ts` экспортирует `applyCommand(document, command)` — единственную чистую mutation boundary. Добавление проверяет ID, style/layer refs, все vertex refs и finite coordinates. Удаление чистит unreferenced vertices. Update/move учитывает visibility-independent layer locks у всех consumers. Другие команды обновляют entity metadata/layer и visibility/lock слоёв.

`store/editor.ts` хранит до 100 `before/after` snapshot ссылок на иммутабельные документы. Pan, zoom, hover, selection и toolbox в историю не входят. Multi-mousemove drag начинает один transaction snapshot, а завершение фиксирует его один раз. Undo возвращает snapshot, redo — следующий; новая операция очищает redo.

## JSON и version handling

Canonical format остаётся `schemaVersion: 2`; поле не переименовано в `version`, чтобы сохранить модель предыдущей итерации. JSON содержит metadata, units, coordinateSystem, layers/styles, registry, entities и начальный viewport. Сериализация обычно человекочитаемая (2 spaces), около byte limit — compact; finite JS numbers сохраняются без display rounding. Не сериализуются history, selection, modal, preview или session camera.

`deserializeDocument` ограничивает UTF-8 JSON 100 MiB, разбирает синтаксис, вызывает migration boundary и runtime schema. Неизвестные версии отклоняются. Реального сохранённого v1 fixture нет; искусственная миграция не добавлена. Дубликаты layer/entity/style IDs, неверные registry keys, отсутствующие refs, некорректные units/axes и нечисловые/nonfinite coordinates отвергаются. Schema также ограничивает 50 000 entities, 1000 layers/styles и диапазон pixelsPerUnit 0.00001–100000.

Serializer также проверяет schema и размер 100 MiB, поэтому экспортированный файл допустим для Open. Импорт, превысивший итоговый лимит, отклоняется атомарно. Autosave использует IndexedDB; storage failure показывает typed warning без потери current state. См. [PERSISTENCE](PERSISTENCE.md).

## Imported points и batch command

Одна импортированная строка даёт новый Vertex и PointEntity с отдельными безопасными IDs. Исходный Point ID записывается в `entity.name` и рисуется renderer как label. Height не добавляется, если исходная колонка отсутствует или ячейка пустая. Повторное имя сохраняется у обеих точек, после preview warning; внутренние IDs не повторяются.

`import-points` содержит массив `{entity, vertex}` и optional `layer` / explicit `coordinateSpace: model|survey`. Создание слоя входит в тот же snapshot. Command валидирует всю candidate модель прежде, чем вернуть новый GeoDocument. Внутри batch нет отдельных execute на каждую строку.

Source X/Y обрабатываются explicit mapping: source X может стать mapped Northing, source Y — mapped Easting; выбранный input frame определяет direct XY или inverse horizontal transform для новых vertices. Величина координат не определяет CRS или роль автоматически. Форматы и ограничения описаны в [IMPORT_FORMATS](IMPORT_FORMATS.md).

## Dimension и presentation

`DimensionEntity = EntityBase & {type: "dimension", startVertexId, endVertexId, offset: number}`. Offset — signed perpendicular world distance в метрах, положительный слева от start→end. Длина, extension points и label position вычисляются из canonical vertices, не сериализуются. Dimension refs входят в entityVertexIds, delete orphan cleanup, semantic validation и shared lock policy. New содержит dimensions слой; старому документу первая dimension command добавляет его атомарно. Undo возвращает отсутствие слоя вместе с отсутствием entity.

SchemaVersion остаётся 2, migration не нужна: reader расширен новым entity variant, прежние v2 документы открываются. Старый reader может отвергнуть dimension variant. Новая dimension command требует разные XY positions; после редактирования/загрузки zero baseline может отображаться как 0 без undefined geometry.

Snap options, ordered selection, Measure anchors, point label modes и line label toggle — UI-only. Point source name остаётся `name`, Z — единственный optional height в registry; отсутствующая высота не становится 0. Display precision находится в geometry/format, не округляет JSON. [GEOMETRY_TOOLS](GEOMETRY_TOOLS.md) описывает workflow и topology.

## Persistent linked labels

`LabelEntity` хранит target ID, пользовательский template и world offsets `dx`/`dy`; anchor не копируется в JSON. Semantic validation допускает только существующие Point/Line/Polyline/Polygon targets. Point anchor берётся из vertex; Line — midpoint; Polyline — midpoint по длине пути; Polygon — area centroid с bounds-center fallback для вырожденной площади. Скрытый target layer подавляет и связанную подпись; lock target не ограничивает перемещение label. Lock самого label layer управляет её изменением.

При удалении target команда удаляет его LabelEntity в том же snapshot; если связанная подпись заперта, удаление target отклоняется. Удаление самой подписи не затрагивает target. Undo/Redo восстанавливают документ целиком. Legacy v2 JSON без label variant остаётся валидным; `schemaVersion` по-прежнему 2.

## Audit boundary уточнения

`applyCommand` валидирует unknown input через strict schema существующих resolved commands (`domain/commandSchema.ts`), затем проверяет references/locks. Unknown entity/patch fields запрещены; update-entity изменяет только допустимые для своего типа свойства, `move-text` безопасно обновляет standalone text vertex, `update-layer` меняет name. New/Open reducer replacement приобретает собственную validated copy. Initial editor input должен быть уже validated, owned и immutable; snapshots используют structural sharing, не deep freeze. Literal paint colours разрешены, external URL/CSS variables — нет. Save предпочитает readable pretty JSON и переходит к compact у byte limit; schemaVersion остаётся 2. Подробные measurements и accepted limits — [ARCHITECTURE_REVIEW](ARCHITECTURE_REVIEW.md).

## Precision / AI construction (schemaVersion 2)

DimensionEntity: `textPosition?: number` в диапазоне 0.05–0.95, absent значит 0.5. Это persistent presentation вдоль размерной baseline; label coordinates derived, не источник истины. Update-entity разрешает offset/textPosition только для Dimension. Snap step/Ortho — editor-only.

Layer lifecycle использует strict create-layer/delete-layer/move-layer commands. Delete запрещён при наличии объектов и для последнего слоя; move-layer нормализует order после swap. Current/inspected layer не сериализуются.

AI create_points компилируется в существующий `import-points` command (PointEntity + owned registry vertices), прямоугольник — в обычный PolygonEntity с четырьмя новыми vertices и semantic name. Новых AI-specific domain entities нет. Dimensions нового дома ссылаются на те же vertices. Все commands AI task применяются атомарно и доступны через стандартные Undo/Redo/Save/Open.

## Reference persistence и history

Horizontal reference сохраняет два PointEntity/vertex ID, MODEL XY snapshots, entered survey E/N и committed scale1 transform. Vertical reference сохраняет только абсолютную отметку MODEL нуля. Apply/Remove не меняют vertices; history хранит document snapshots. STALE вычисляется по двум текущим XY и не сохраняется отдельным flag. View preference Model/Survey не входит в document. Schema проверяет существование PointEntity/vertex и согласованность transform с committed snapshots, допуская текущие stale controls. `{z}` — MODEL Z; `{h_absolute}` — derived H либо «—».

## Symbol instances и точные MODEL anchors

[SYMBOL_LIBRARY](SYMBOL_LIBRARY.md) фиксирует безопасные primitives, passive ports, registry registration и version policy. Symbol instances не копируют definitions; scale visual 0.01–100, rotation [0,360), Unknown definition блокирует Open до document swap. Linked Label anchor — Symbol.position, target deletion удаляет подписи атомарно.

Absolute Move вычисляет MODEL anchor и existing move-entities delta, не заменяет canonical positions всех vertices абсолютным значением. Fit Layer меняет только session viewport и не сериализуется как geometry/history change. Старые v2 документы совместимы.

## Additive v2 DXF model

GeoDocument may contain `sources[]` and `blocks[]`. Layers, entities and vector primitives optionally carry generic `SourceProvenance`, retaining source document, type, original layer/handle and block identity. Sources store basename/version/actual encoding/INSUNITS/applied metre factor; no local paths or raw file.

New entity types: `arc` (MODEL center/radius/start/end radians CCW), `circle`, `block_instance` (shared definition + XYZ position/degree rotation/nonuniform scale/attributes), `imported_graphic` (safe bounded declarative primitives + translation). They have no fake vertex IDs; Move owns their independent center/position. Text optionally has MODEL `height` and rotation, while legacy fontSize remains px. Existing v2 JSON stays compatible. Definition primitives can reference nested definitions; source XYZ remains canonical and the editor renders 2D. Strict schema/reference/depth/cost validation and the 100 MiB Save/Open budget remain in force. Full contract: [DXF_IMPORT](DXF_IMPORT.md).

## Connector V1

Stable port refs, централизованные kind/capacity checks и derived connectivity index. Orthogonal default / Direct, associative move/rotate/scale/group. Semantic validation запрещает dangling refs и перегрузку ports. Delete подключённого Symbol блокируется. Видимость требует visible Connector layer и обоих Symbol owners. Canonical route coordinates не дублируются; JSON/IndexedDB сохраняют refs и route settings. Подробный контракт: [CONNECTORS](CONNECTORS.md).

## Optional Symbol elevation

SymbolEntity.position is WorldPoint {x,y,z?}, backward-compatible in schemaVersion 2. Missing Z remains unavailable; explicit zero remains a number. set-symbol-position is an ordinary finite/locked/no-op checked document command with Undo/Redo. XY moves preserve Z; ports inherit Symbol height (optional scaled local port Z is supported). Projected coordinates and presentation Connector risers are never canonical or persisted. [Details](AXONOMETRIC_VIEW.md).

## Optional viewing and raster fields

Schema v2 accepts optional dxfLayouts (source/name/owner/paper/primitives/multiple viewports), with referential and aggregate geometry budget validation. These fields are import presentation metadata, separate from canonical MODEL entities. RasterUnderlayEntity is canonical: assetId, center XY, positive width/height, rotationDeg, opacity 0–1, locked, optional nonpixel asset metadata. Missing assetId storage is legal and yields a placeholder. JSON carries no Blob/base64. See [RASTER_UNDERLAYS](RASTER_UNDERLAYS.md).

## Transform, style and navigation polish

Optional Layer.style stores intentional visual defaults; Entity.style stores sparse override values, with null meaning explicit ByLayer. Legacy styleId and DXF provenance remain unchanged. Rotation commits MODEL XY and intrinsic angles, preserving Z/shared references. Raster pixels and resolved styles remain outside JSON.
