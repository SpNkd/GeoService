# Connector V1

Срез реализует ручное `Symbol port → Connector → Symbol port` в planar MODEL XY. Ручной Connector API теперь также используется локальным resolver AI Process Schemes (см. ниже). Геометрия DXF остаётся на Canvas, Connector — native SVG.

## Canonical model

`ConnectorEntity` содержит `type: "connector"`, stable `id`, обязательные `name`/`layerId`, необязательные `styleId`/`visible`, `start`/`end`, `routing: "orthogonal" | "direct"` и необязательные `waypoints: {x,y}[]` (MODEL, до 100).

Endpoint: `{kind: "symbol_port", symbolEntityId, portId}`. Нет endpoint X/Y, копий Symbol geometry или display-name references. Позиция и направление вычисляются `symbolLocalPortToWorld`: local port → definition defaultSize × instance scale → instance rotation → MODEL position. Направление складывается с rotation.

`resolvePort`, `connectorRoute`, `connectorLength`, `portTargetError`, `validateConnectivity`, `connectivityIndex` — общие локальные APIs без React/DOM/AI. Open/autosave проверяют structure и semantic references. Missing Symbol, definition, port или layer блокируют загрузку, текущий документ сохраняется. Координаты не восстанавливаются по proximity или старому имени.

## Ports and connectivity policy

`process ↔ process`, `instrument ↔ instrument`. Несовместимые kinds и тот же самый порт на обоих концах запрещены. Definition может задать `label` и положительный целочисленный `maxConnections` (до 1000); absent означает 1. Create/retarget/Open применяют одну policy. Occupied порт показывает «Порт уже подключён». При retarget собственная связь исключается из occupancy.

Demo сохраняет 18 stable Symbol definitions и существующие `in`/`out`, `sense`, `branch`. Кран, клапан, регулятор, фильтр, счётчик, предохранительный клапан, переход и generic equipment имеют process ports. КИП — instrument. Названия «левый / правый» у основных demo ports не утверждают направление технологического потока: `directionDeg` означает предпочтительный геометрический выход; `kind` — совместимость, а не flow simulation. Input/Output в acceptance представлены generic equipment с именами экземпляров.

## Tool and retarget

Toolbar «Соединение», shortcut `CO` через Shortcut Registry. Порты видимы во время инструмента и retarget; выбранный Symbol также показывает компактные информационные маркеры. Port hit target — круг радиусом 7 CSS px, независимо от zoom. Vertex/Grid snap не создаёт свободный endpoint.

Первый клик выбирает свободный порт и открывает transient transaction; движение показывает dashed ghost. Второй совместимый свободный порт создаёт одну canonical entity на CURRENT LAYER и возвращает Select. Невалидный target не создаёт связь. Esc отменяет pending gesture без dirty/history/autosave effects; до первого клика просто выходит из инструмента.

У выбранного незаблокированного Connector два endpoint grips. Drag → порт → pointerup меняет ссылку одним действием. Inspector «Выбрать порт» поддерживает тот же workflow кликом. Preview не меняет canonical entity или Symbol; invalid release/click, Escape и собственный прежний endpoint не создают историю. Успех проверяет snapshot ещё раз.

## Routing and associativity

Orthogonal — default. Router детерминированно строит короткие выходы по ближайшим MODEL Manhattan осям port directions, затем ортогональные bends. Exit length зависит от визуального размера символов. При произвольном угле Symbol направление квантуется до ближайшей оси; конечная позиция остаётся точной transformed port position. Direct соединяет точные позиции прямой линией.

Waypoints поддерживаются в canonical schema и route API: direct проходит через них; orthogonal соединяет их Manhattan сегментами. UI добавления/drag waypoints в этом срезе отсутствует. Waypoints остаются абсолютными MODEL anchors при переносе символов.

Move/rotate/scale меняют только Symbol; маршрут пересчитывается при render. Группа из двух endpoints и Connector не переносит связь второй раз. Connector без symbols не перемещает исходную геометрию. Undo/Redo Symbol transformation автоматически возвращает маршрут, без отдельной записи reroute. Новые router coordinates никогда не записываются в JSON.

Router не обходит препятствия: линии могут пересекать другие объекты. Выбор использует stroke tolerance 7 CSS px, Shift и WINDOW/CROSSING. Inspector показывает владельцев/port IDs, routing, слой и derived read-only length.

## Lifetime, layers and locks

Delete Connector оставляет Symbols. Delete подключённого Symbol блокируется с количеством связей; удалите/retarget их сначала. Явный bulk Delete всей выделенной сети удаляет Connector перед Symbol внутри одной atomic transaction. Ошибка любого удаления сохраняет весь документ. Непустой слой нельзя удалить; ссылки Connector не обходят существующую защиту layer lifetime.

Создание в hidden/locked CURRENT LAYER запрещено. Connector layer независим от Symbol layers. Render/selection показывают связь только если её слой и оба Symbol видимы; скрытие слоя endpoint не удаляет топологию. Locked Connector доступен для просмотра, но create/delete/retarget/routing/layer edits блокируются. Перенос незаблокированного Symbol с Connector на locked layer разрешён: это derived reroute, не редактирование связи. Выделенная группа с явно включённым locked Connector блокируется обычной selection lock policy.

Transient document isolation сохраняет скрытые Symbol dependencies для безопасного разрешения refs; Connector следует общей policy видимости обоих owners.

Style берётся из существующего `styleId` или слоя: stroke, lineWeight, dash. Нового styling subsystem, arrows или diameter нет.

## History and persistence

Create, Delete, retarget, routing — по одной history action. No-op/cancel/invalid — ноль. `schemaVersion: 2` расширена новым discriminator; старые v2 документы продолжают открываться. Старый клиент без Connector support новый discriminator не прочитает. Save/Open JSON и IndexedDB хранят refs/routing/waypoints/style; derived route, occupancy/index и transient UI state не сохраняются.

Symbol libraries остаются внешним immutable registry, определения не встраиваются в документ. При Open нужная библиотека должна быть зарегистрирована. Version pinning/manifest остаются будущей отдельной задачей.

## Derived connectivity index

WeakMap cache по immutable document snapshot содержит entity lookup и:

- `symbolEntityId → connector IDs`;
- `[symbolEntityId, portId] → connector IDs` (collision-safe key);
- `connectorId → endpoints`.

Результат не сериализуется и не передаётся провайдеру. Новый canonical snapshot получает новый индекс. AI Process Schemes теперь использует эти APIs для insert-between и semantic intent adapters; общий network traversal остаётся отдельным возможным срезом.

## Acceptance and verification

`src/tests/connectors.test.ts`: reference validation, transforms/directions, kinds/capacity, create/delete, move/rotate/scale/group, direct/orthogonal/waypoints, retarget/cancel/no-op/history, locks/visibility, screen hit/marquee, connectivity, JSON/IndexedDB.

`e2e/connectors.spec.ts`: tool/CO/ghost/Escape/occupied/incompatible, move/rotate/scale/group, both retarget modes, lifetime/layers/locks, Save/Open/reload, gas chain and DXF coexistence. Gas acceptance inserts Input → Valve → Filter → Regulator → Meter → Output through the actual palette/tool, moves Filter, rotates Regulator, moves three Symbols, Undo/Redo and Save/Open.

Измеренный Chrome 154.0.8037.98: загрузка/первый render всей сети — 289 мс. Медианы UI samples: pan 57,80 мс, selection 33,45 мс, move одного Symbol 61,50 мс, move группы 57,84 мс. Pure reroute всех 150 — 0,20 мс (p95 0,30 мс). Index build ниже разрешения browser timer в медиане; p95 0,10 мс. Это измерения конкретного headless прогона, не гарантированный FPS.

Final verification: `npm run typecheck`, `npm run check` (lint, **764 unit passed / 46 opt-in skipped**, production build, **154 E2E passed / 8 opt-in skipped**) — success. Connector unit suite contributes 51 tests. Dedicated Chrome benchmark and full reference Connector acceptance also passed separately. `npm audit --registry=https://registry.npmjs.org` — **0 vulnerabilities**. New browser suites assert zero console/page errors. AI, survey/georeferencing, dimensions/retarget, symbols, DXF/ATTRIB, renderer and persistence regression suites passed; `server/`, `src/ai/` and `src/documentOperations/` were not modified.

## Scope and next slice

Not implemented: obstacle solver, free endpoints, connector junctions/tee graph, flow/pressure/diameter simulation, AI connectors, DXF-to-Symbol mapping, 3D/Z routing, risers, axonometry or normative P&ID certification. Existing Spatial AI and AI Document Operations continue independently.

Next suggested single vertical slice: **manual Connector waypoint editing**, with transient segment/waypoint grips and one-action Undo/Redo while preserving endpoint references. Not started.

## AI process schemes

Bounded semantic process actions now reuse ordinary Connector refs/routing/validation/index/atomic commands. Chain creates N Symbols and N−1 Connectors; append requires a free downstream port; insert-between deletes one locally resolved edge and creates two replacements in the same batch. Replacement edges inherit original style/routing/layer, with new endpoint routes rather than copied waypoints. New Symbol uses AI target layer. Full ghost/chooser/stale/Undo/persistence contract: [AI_PROCESS_SCHEMES](AI_PROCESS_SCHEMES.md). No junction or general AI deletion is exposed.

## Axonometric elevation presentation

Ports inherit Symbol position.z; missing Z uses the explicit presentation plane only. Same-Z uses existing XY route at that height. Orthogonal differing-Z projects XY route on start Z with a vertical transition at the final port. Direct differing-Z uses a straight XYZ segment. No 3D waypoints are persisted and no engineering routing is implied. Plan routing/connectivity remain unchanged. Legend discloses the final-port riser. [Contract/tests](AXONOMETRIC_VIEW.md).

## Topology reconstruction V3

[Local topology review](TOPOLOGY_RECONSTRUCTION.md) can create these same canonical connectors from complete, faithful, unbranched Line/Polyline paths with two confirmed compatible ports. Apply atomically replaces eligible source owners; unsafe routes remain ordinary geometry. No JunctionEntity or waypoint authoring is added. Optional strict topologySource holds historical source IDs/run/confirmation; existing collapsed Source shows only origin/count/confirmation. Retarget and subsequent manual edits use normal connector behavior, with provenance describing creation rather than current route fidelity.
