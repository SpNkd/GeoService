# Symbol Library, Exact Move и Fit Layer

## Канонический контракт

`SymbolEntity` — экземпляр в GeoDocument v2: обычные `id`, обязательный `name` (имя/Tag), `layerId`, optional `styleId`, плюс `libraryId`, `libraryVersion` (optional только для legacy), `symbolId`, MODEL `position: {x,y}`, `rotationDeg`, `scale`, optional `properties`. Position принадлежит экземпляру, не vertex registry; совпадение с vertex при snap не создаёт shared identity. Геометрия определения, порты, preview и camera transform в JSON не копируются.

`SymbolLibrary`: `id`, `name`, `version`, optional `description`, `sourceStandards`, `categories`, `symbols`. `SymbolDefinition`: `id`, `name`, optional `aliases`, `description`, `allowedRotations`, `metadata`, плюс `category`, `geometry`, `defaultSize`, `ports`.

`src/symbols/registry.ts` предоставляет `registerSymbolLibrary`, `getLibrary`, `getSymbol`, `listLibraries`, `requireSymbol`. Registration строго проверяет структуру, уникальность library/symbol/port/category IDs, существование категорий, конечность чисел и допустимые пределы. Она атомарна; registry владеет parsed copy и глубоко замораживает определения. Повторная registration того же library ID запрещена. `getSymbol` возвращает undefined при отсутствии; canonical validation использует `requireSymbol` с понятной ошибкой.

Registry и определения не зависят от React, renderer не знает имя gas library. Добавление code-defined корпоративного pack требует определения и registration, без изменения renderer/selection/commands. Library upload/editor в UI отсутствует.

## Декларативная геометрия

Поддерживаются только `line {start,end}`, `polyline/polygon {points}`, `circle {center,radius}`, `rect {position,width,height}`. Strict runtime schema отвергает raw SVG/path/HTML, неизвестные атрибуты, events, вложенные произвольные объекты и нечисловые координаты. JSX рисует проверенные данные; `innerHTML` отсутствует.

Local origin `(0,0)` — базовая позиция экземпляра. Координаты primitives/ports нормализованы; `defaultSize` означает **метры на local unit при scale=1**, для demo — 2. Полный transform:

```text
local point × defaultSize × instance.scale
  → rotationDeg вокруг origin, положительно против часовой стрелки MODEL
  → + instance.position
  → worldToScreen(camera)
```

`symbolLocalToWorld`, `symbolLocalPortToWorld`, `symbolWorldBounds` — pure helpers. World bounds вычисляются из transformed primitive vertices и точных circle extrema; camera и port markers не влияют. Один результат используется в group bounds, marquee и Fit Layer. Hit rectangle добавляет 7 screen px для удобного клика; marquee использует MODEL AABB без screen padding. Поэтому Crossing может выбирать символ через пустую часть его AABB; pixel-perfect hit testing не реализован.

## Demo pack

ID `gas-process-demo`, version `1.0.0`, название «Газоснабжение / технологическая схема». Demo / базовая библиотека; соответствие ГОСТ/СПДС не подтверждено.

| Категория | Обозначения |
| --- | --- |
| Арматура | Запорный кран, клапан, регулятор давления, обратный клапан, предохранительный клапан |
| Оборудование | Фильтр, счётчик газа, блок оборудования, шкаф, подогреватель газа |
| КИП | Манометр, точка КИП, термометр |
| Трубопровод / вспомогательные | Свеча / vent, направление потока, заглушка, переход, тройник |

Всего 18. Display names и aliases отделены от стабильных IDs. Поиск в палитре локальный: name/aliases/category; есть library/category select и общие vector previews.

## Ports

Port: `id`, `kind: process | instrument`, local `position`, `directionDeg`, optional `label`, `maxConnections` (default 1). `symbolLocalPortToWorld(instance, port, definition?)` возвращает MODEL `{x,y,directionDeg}`; угол складывается с instance rotation, позиция использует тот же size/scale/rotation/translation. Выбранные экземпляры показывают маленькие маркеры; Connector tool/retarget добавляет интерактивные screen-space targets.

Порты не являются vertices или attachments обычных Line. Connector V1 хранит stable instance/port references, kinds/capacity проверяются централизованно; маршрут и connectivity index derived. См. [CONNECTORS](CONNECTORS.md).

## Вставка и свойства

Toolbar «Символы» → выбрать → ghost у курсора → клик. После вставки Select и выбранный новый экземпляр; Esc отменяет ghost без history. `R` вращает ghost на +90°, для restricted definitions переключает разрешённые углы. Ghost и его поворот — session state, не autosave.

Вставка использует **current layer**. Hidden/locked/missing layer блокирует её; отдельный symbols layer не создаётся. Применяется existing Vertex/Midpoint/Grid snap; выбранная позиция копируется в MODEL XY без attachments. Ports не участвуют в общем Vertex/Grid snap; Connector использует отдельную port-only привязку.

Inspector: определение/library, Name/Tag, layer, MODEL X/Y, rotation и uniform scale; SURVEY E/N выводятся при наличии reference/direct frame. Position edits проходят через existing selection move policy, включая locks linked Labels. Rotation нормализуется в `[0,360)`, разрешённые definition angles проверяются и при Open. Scale `0.01…100`, visual only. Blur/Enter фиксирует edit одной операцией; Undo/Redo восстанавливают instance data. Selected single Symbol + R вращается аналогично ghost. General rotate/scale группы отсутствуют.

## Selection и Move

Click, Shift, WINDOW/CROSSING, group body drag, relative Δ и Absolute работают для Symbol. `move-entities` расширен только списком самостоятельных Symbol positions; registry definition неизменна, shared vertices остальных entities сдвигаются один раз. Linked Labels включаются в affected/lock policy. Выбранные target+Label следуют без двойного переноса; Label alone меняет offset даже у locked target. Удаление target атомарно удаляет его Labels, прежняя locked-label защита сохраняется.

Label поддерживает Symbol target, default `{name}`, anchor `Symbol.position + label.dx/dy`. Rotation/scale не меняют canonical label anchor. Все остальные templates и dimension lifetime сохраняются.

## Exact Move

`M`/Move… открывает или повторно фокусирует ту же Properties panel. Relative «Δ Смещение» сохраняет прежние ΔX/ΔY. Absolute «X/Y Абсолютно» явно вводит **MODEL X/Y**, даже в SURVEY display. Базовые точки: центр (default), нижний левый/правый, верхний левый/правый.

`selectionModelAnchor` вычисляет MODEL bounds выбранных entities. Single Point/Text используют vertex position при любом preset, single Symbol — canonical position. Groups используют общий MODEL AABB; Label/Dimension учитывают derived geometry. Annotation extents approximate, при saved document reference zoom; текущая camera не меняет численную anchor semantics.

`absoluteMoveCommand` сначала вызывает тот же `resolveSelectionMove` (locks/shared topology), затем вычисляет `requested - currentAnchor` и возвращает **existing move-entities**, без нового translation command. Finite input, canonical precision без rounding; zero delta возвращает исходный документ, без history. Один Undo/Redo. Размер отдельно не перемещает свои source vertices — прежняя semantics сохранена. В mixed selection с Dimension и только частью его опор размер деформируется по прежним правилам; его derived bbox может не перенестись целиком на delta. Для точного group bbox anchor включайте обе опоры/исходную геометрию.

## Fit Layer

Выбранный слой → Properties → «Вписать слой», tooltip «Центрировать и масштабировать вид по содержимому слоя». `layerBounds` учитывает все entities точного layer ID, независимо от visibility/lock/order, включая transformed Symbols, Text/Label/Dimension approximation. `fit-layer` использует существующий `fitToBounds`, padding 85 px, и меняет только session camera.

Document identity, history/future, dirty/saved fingerprint, autosave остаются прежними. Hidden layer не включается. Empty/missing layer безопасен; UI button disabled без bounds. F/ZE вписывает весь видимый документ, double-click слоя по-прежнему выбирает его объекты. Выбор слоя закрывает numeric Move, Properties прокручиваются одним контейнером без перекрытия footer.

## Save/Open и расширение

SchemaVersion остаётся 2; предыдущие v2 документы загружаются. Сохраняются только instance fields и безопасные properties: максимум 100 scalar key/value пар (string/finite number/bool/null). Unknown library/symbol вызывает semantic Open error **до** замены текущего document; renderer не подставляет placeholder.

Новые instances адресуют `libraryId + libraryVersion + symbolId`; legacy instances без версии используют текущую registered version. Неизвестная версия отклоняется до Open/insertion. Один library ID означает одну зарегистрированную версию. Изменять meaning существующего ID без migration нельзя. Для future version coexistence потребуется manifest/version pinning либо новый versioned library ID; автоматическое downloading/migration пакетов пока не реализовано. Verified normative packs требуют отдельно подтверждённых источников.

AI Process Schemes добавляет отдельный bounded semantic whitelist → local definitions/ports/layout resolver. Новые registered libraries не означают новую AI vocabulary. См. [AI_PROCESS_SCHEMES](AI_PROCESS_SCHEMES.md).

## Verification

Финальная регрессия: **582 unit passed + 6 opt-in skipped; 117 E2E passed + 1 opt-in skipped**.

Финальные проверки: `npm run typecheck`, `npm run check` (lint/unit/build/all E2E), `npm audit --registry=https://registry.npmjs.org`. Новые suites: `exact-move-layer.test.ts`, `symbol-library.test.ts`, `symbol-library.spec.ts`. Они покрывают все anchors, precision/locks/SURVEY/history/no-op, hidden/locked/empty layer fit, безопасный immutable registry, 0/45/90° и scale transforms/ports, placement/Esc/R/snap, click/marquee/Move, label lifetime, rotation/scale и Save/Open/unknown definitions.

Ручной браузер: три обозначения в current layer, ghost R, Fit Layer, Absolute group lower-left `(100,200)`, Undo/Redo и повторный M в чистой вкладке. Console errors 0; opt-in paid AI smoke не запускался.

Connector V1 реализован следующим срезом: refs, Direct/Orthogonal, retarget, capacity, safe lifetime и persistence. Не включены пользовательский import/editor, DWG/dynamic blocks, certified packs, axonometry, general Rotate/Scale Selection, mirror/copy, collision solving. Ручной port-to-port Connector завершён; дальнейшие ограничения и единственный предложенный следующий срез описаны в [CONNECTORS](CONNECTORS.md).

## Process metadata hardening

Optional port roles inlet/outlet/bidirectional/instrument are validated in the frozen registry. Valves/filter/equipment remain bidirectional; regulator/meter have semantic in/out; instrument ports remain instrument-only. Central process aliases supplement library search without asserting a generic gas meter as a verified расходомер. New manual and AI Symbols pin version 1.0.0; full definitions remain registry-owned.
