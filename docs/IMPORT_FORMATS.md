# Импорт координат и документы

## Внутренние координаты

GeoService всегда использует **X = Easting, Y = Northing, Z = Height**, в метрах. Z необязателен. Внешние геодезические файлы часто называют X северную координату и Y восточную. Import не меняет оси модели: источник переводится в canonical convention через mapping.

Перед Import каждому столбцу назначается Point ID, Easting, Northing, Height или Ignore. Easting и Northing обязательны и назначаются ровно одному столбцу. Point ID и Height необязательны. Без Point ID генерируются P1, P2…; для числовых source IDs назначьте Point ID вручную. X/Y defaults показываются согласно GeoService convention и требуют проверки. Для `Name | X | Y | H` можно выбрать `Name → Point ID`, `X → Northing`, `Y → Easting`, `H → Height`.

## CSV / TXT: точка с запятой

Без заголовка:

```text
P1;562341.234;6189345.221;152.340
P2;562358.188;6189349.113;152.410
P3;562361.982;6189321.551;152.270
```

С десятичной запятой:

```text
Name;E;N;H
P1;562341,234;6189345,221;152,340
P2;562358,188;6189349,113;
```

Пустой H не превращается в нулевую высоту. Если decimal comma и delimiter comma одновременно нужны, числовые поля должны быть quoted; надёжнее использовать semicolon/TAB.

## CSV: запятая

```csv
id,x,y,z
P1,562341.234,6189345.221,152.340
P2,562358.188,6189349.113,152.410
```

Поддерживаются quoted fields, двойные escaped quotes, BOM, CRLF и UTF-8. Пример с comma в point name: `"P1, контроль",562341.234,6189345.221`. Не выполняется замена всех запятых в raw input. Decimal separator применяется только после разделения ячеек и зависит от выбранного варианта. Тысячные разделители, mixed decimal signs и другие единицы автоматически не нормализуются.

## TSV / Excel clipboard

В Excel выделите диапазон, Copy, откройте Import и Paste в textarea. Между столбцами должны быть TAB, между строками — newline:

```text
Name	Easting	Northing	Height
P1	562341.234	6189345.221	152.340
P2	562358.188	6189349.113	152.410
```

Файл `.tsv` и вставка используют тот же parser, mapping и import plan. Прямого XLSX parser нет. Произвольное количество пробелов не является delimiter.

## Preview и политика ошибок

Автоматически предлагаются comma/semicolon/TAB, dot/comma decimal separator и наличие header. Detection является подсказкой: все варианты меняются вручную до импорта. Если delimiter неоднозначен или decimals смешаны, показывается сообщение. Header checkbox пересчитывает default mapping, после чего mapping снова можно поправить.

Preview показывает первые 15 строк исходных cells, editable column mapping, число всех/валидных/ошибочных строк и первые 5 ошибок с физическим номером строки. Ошибки включают missing/invalid Easting/Northing/Height, пустой mapped Point ID, разную ширину строк. До явного checkbox «Импортировать только валидные строки» частичный импорт запрещён. Cancel не меняет документ.

Повторные point names во входе или среди существующих points дают warning. Обе точки импортируются с разными internal IDs и сохраняют одинаковый domain name. Координатные совпадения не создают shared vertices автоматически.

Целевой слой выбирается пользователем. Default survey-points создаётся при отсутствии. Locked targets недоступны. Hidden target допускается с предупреждением; включите его видимость для просмотра и fit. Import создаёт одну command/history action, включая новый слой. Undo удаляет весь импорт, Redo возвращает те же IDs и значения. После Import выполняется fit видимых entities, без изменения canonical координат или artificial origin.

## JSON Save / Open / New

Save экспортирует GeoDocument v2 в читаемый `.json` с полем `schemaVersion: 2`. Числа не проходят display rounding. Entities, vertices, layers/styles, metadata, units, CRS metadata и initial viewport сохраняются; selection/history/modal/draft не входят в файл. Полная схема и пример: [DOCUMENT_MODEL](DOCUMENT_MODEL.md).

Open: parse → detect version → migration boundary → Zod schema → reference validation → replace. Unsupported versions и broken references дают понятную ошибку, current drawing остаётся прежней. Поддерживается только v2, реальных legacy v1 fixtures в repository нет. Успешный Open очищает selection/history и делает fit. New создаёт пустую v2 схему с базовыми слоями; New/Open предупреждают о текущих dirty changes.

Changed coordinate draft отмечается `*` без полного stringify; сравнение содержимого и autosave выполняются по committed document. `*` у имени отражает изменения после последнего явного Save/Open/New. Autosave его не сбрасывает. Undo до сохранённого содержания убирает dirty, Redo снова учитывает baseline. При reload dirty flag сохраняется, но undo history и baseline snapshot не восстанавливаются: чтобы сбросить восстановленный dirty, сохраните файл.

## Local autosave и ограничения

Committed GeoDocument сохраняется в IndexedDB после commit через debounce; во время drag/ввода координат сохраняется предыдущее committed состояние, окончательное — после commit. Startup проверяет и восстанавливает документ до включения autosave. Старые localStorage autosaves валидируются и удаляются только после успешной миграции. При повреждении или запрете доступа открывается sample с диагностическим уведомлением. При storage error используйте файловый Save. См. [PERSISTENCE](PERSISTENCE.md).

Лимиты: таблица 5 МБ UTF-8, до 50 000 data rows, до 100 columns; JSON 100 MiB, до 50 000 entities. Итоговый JSON импортируемой схемы проверяется до mutation: большой import может упереться в этот лимит раньше лимита строк. JSON output также ограничен 100 MiB; Save/import предпочитают pretty JSON, при превышении из-за whitespace используют compact. Paint styles не допускают URL/CSS variables. SVG renderer рассчитан на небольшие/средние схемы; работа 50 000 видимых labels не гарантируется.

Неподдерживаемые форматы табличного importer: XLSX, DXF/DWG, GeoJSON/Shapefile, PDF и proprietary equipment files. ASCII DXF открывается отдельно через toolbar DXF; см. [DXF_IMPORT](DXF_IMPORT.md). CRS metadata сохраняются, но трансформации EPSG не выполняются. Входные coordinates считаются метрами, перевод единиц нужно выполнить до импорта. Labels безопасно выводятся React/SVG без innerHTML; загруженные данные не исполняются.

## От импортированных points к границе и размерам

После Import выберите точки Shift + click в нужном порядке. Номера markers и ordered inspector list показывают последовательность. «Создать полилинию» (2+) и «Создать границу» (3+) используют исходные vertex IDs без копирования coordinates. Один Undo удаляет фигуру, сохраняя imported points; crossing boundary отклоняется с предложением изменить порядок.

Line/Polyline/Polygon/Dimension также используют Endpoint snap к импортированным points. Изменение shared point обновляет геометрию и derived dimensions. Measure измеряет snapped пару временно, включая ΔZ/3D только при обеих известных высотах. Name + Z / Z only не показывают fake heights. Эти действия не меняют parser/mapping или атомарность import. JSON v2 теперь включает dimensions со ссылками и offset; см. [GEOMETRY_TOOLS](GEOMETRY_TOOLS.md).
