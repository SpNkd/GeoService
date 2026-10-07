# Статическая публикация GeoService

GitVerse SSH: `ssh://git@gitverse.ru/spnkd/GeoService.git` (existing credential; no embedded tokens).

Source: `main` одинаков на GitHub и GitVerse. Статика: `gh-pages`, корень `/`.

- GitHub: https://github.com/SpNkd/GeoService — https://spnkd.github.io/GeoService/
- GitVerse: https://gitverse.ru/spnkd/GeoService — https://spnkd.gitverse.site/geoservice/

## Обновление

Из публичного clone, после проверок и commit:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run preview:static
PRODUCTION_URL=http://127.0.0.1:5180/GeoService/ node scripts/smoke-pages.mjs
# Source remotes: origin → GitHub HTTPS, gitverse → GitVerse SSH
git push origin HEAD:main
git push gitverse HEAD:main
npm run deploy:pages -- origin gitverse
```

Скрипт выполняет Vite build локально, добавляет LICENSE/notices и `release.json`, затем отправляет готовые файлы в `gh-pages`. История deploy сохраняется, force-push не используется. На площадках настроена встроенная публикация из этой ветки; custom workflows отсутствуют. GitVerse использует встроенный Jekyll publication step; Node/npm/application build на площадках не запускаются.

Для отката выберите предыдущий **проверенный публичный** source commit, повторите проверки и локальную сборку, опубликуйте новый descendant deploy commit. Не возвращайте приватную историю.

## Runtime

Backend/proxy/serverless отсутствуют. Vite `base: './'`, Worker imports и ленивые PDF/OCR URLs разрешаются относительно страницы. Смена подпапки не требует ключа или backend. Единственный app route — корень сайта; прямое открытие и reload поддерживаются.

PDF.js Worker, fonts/CMaps/WASM, image/topology Workers и Tesseract RU/EN входят в dist. PDF/OCR загружаются по действию пользователя. Service Worker кэширует allow-list статических assets; не API, исходные документы или изображения. Production sourcemaps не создаются. Известное предупреждение build: основной JS chunk превышает 500 kB.

Browser transport сохраняет provider compatibility exclusions действующего проверенного профиля (`siliconflow`, `atlas-cloud`, `alibaba`) и не посылает неразрешённый CORS trace header. Prompt/schema совпадают с локальным server adapter.

OpenRouter — единственный ожидаемый внешний app request при явно запущенной AI-команде. Без ключа CAD работает; ввод ключа находится в Settings → AI, Remember OFF по умолчанию. REAL smoke только opt-in `PAGES_REAL_AI=1` из локального `.env.local`; в public CI ключи не используются. Report/screenshot не содержат credential.

## Публичная история и fixtures

Перед первым push отдельная копия истории очищена от старых docs/audit-results, reference-цитат в документах и тестов с точными координатами частного чертежа. Безопасная документация и синтетические тесты восстановлены в release commit. История приложения сохранена, commit IDs изменены. Исходная история осталась только в локальных private ветках; **не использовать `push --all` / `--mirror`**.

Публичные DXF/PDF fixtures созданы для тестов. `public/examples/process-scheme.json` — синтетические Input/Valve/Filter/Regulator/Output; README screenshots содержат только demo geometry. Исходный частный DXF, DWG, scan и их извлечённые geometry/text не распространяются.

## Проверки

Предварительно: typecheck/lint/build PASS; unit 1208 passed / 82 skipped; npm audit 0 vulnerabilities. Относящиеся к публикации Chrome E2E: 47 passed / 3 opt-in skipped; после PDF preview fix повторно 13 passed. Production static smoke и результаты обоих публичных доменов сохраняются в `docs/audit-results/pages-*.json`.

Верификация фактических deployments выполняется после публикации независимо на обоих доменах. Наличие репозитория или успешного встроенного deploy не заменяет browser smoke.

### Проверенная публикация 2026-10-07

Runtime source commit: `2be40f31ac20100f585a90f8ce6e50ae79801d6d`. Последующий commit с этими отчётами меняет только документацию; повторная сборка runtime не требуется.

| Площадка | REAL production smoke | Отчёт |
| --- | --- | --- |
| GitHub Pages | PASS, 14 проверок | [GitHub](audit-results/pages-github-production.json) |
| GitVerse Pages | PASS, 14 проверок | [GitVerse](audit-results/pages-gitverse-production.json) |

На обоих доменах проверены no-key UI, реальный Test connection, структурированный план прямоугольника 2×3 м (`qwen/qwen3.5-27b`), Remember OFF/ON/отключение, Preferences, Point/Line/Move/Undo/Redo, IndexedDB/autosave/reload, синтетический DXF, native и scanned PDF/вторая страница, image geometry, OCR RU/EN и topology Apply. Неожиданные console/page errors, runtime 404, backend calls и внешние запросы: 0. AI отправлен напрямую только в OpenRouter.

Fresh public GitHub clone без `.env.local`: `npm ci`, production build и static startup/IndexedDB/no-key UI — PASS. README отрендерен на обеих площадках; три синтетических PNG доступны, на GitVerse проверена фактическая загрузка всех изображений.

Публичная история проверена на реальный локальный ключ, шаблоны credentials и исходные приватные reference-координаты: 1137 исторических blobs и 893 source/build files, совпадений нет. Эти числа относятся к runtime release до добавления итоговых отчётов.

В обычном пользовательском профиле Chrome при открытии GitVerse Pages наблюдался `ERR_BLOCKED_BY_CLIENT`. Изолированный Chrome на том же публичном URL прошёл полный smoke; ограничения/расширения пользовательского профиля не менялись.
