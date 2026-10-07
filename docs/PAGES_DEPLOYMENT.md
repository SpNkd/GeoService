# Статическая публикация GeoService

GitVerse SSH: `ssh://git@gitverse.ru/spnkd/GeoService.git` (existing credential; no embedded tokens).

Source: `main` одинаков на GitHub и GitVerse. Статика: `gh-pages`, корень `/`.

- GitHub: https://github.com/SpNkd/GeoService — https://spnkd.github.io/GeoService/
- GitVerse: https://gitverse.ru/spnkd/GeoService — https://spnkd.gitverse.site/GeoService/

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

OpenRouter — единственный ожидаемый внешний app request при явно запущенной AI-команде. Без ключа CAD работает; ввод ключа находится в Settings → AI, Remember OFF по умолчанию. REAL smoke только opt-in `PAGES_REAL_AI=1` из локального `.env.local`; в public CI ключи не используются. Report/screenshot не содержат credential.

## Публичная история и fixtures

Перед первым push отдельная копия истории очищена от старых docs/audit-results, reference-цитат в документах и тестов с точными координатами частного чертежа. Безопасная документация и синтетические тесты восстановлены в release commit. История приложения сохранена, commit IDs изменены. Исходная история осталась только в локальных private ветках; **не использовать `push --all` / `--mirror`**.

Публичные DXF/PDF fixtures созданы для тестов. `public/examples/process-scheme.json` — синтетические Input/Valve/Filter/Regulator/Output; README screenshots содержат только demo geometry. Исходный частный DXF, DWG, scan и их извлечённые geometry/text не распространяются.

## Проверки

Предварительно: typecheck/lint/build PASS; unit 1208 passed / 82 skipped; npm audit 0 vulnerabilities. Относящиеся к публикации Chrome E2E: 47 passed / 3 opt-in skipped; после PDF preview fix повторно 13 passed. Production static smoke и результаты обоих публичных доменов сохраняются в `docs/audit-results/pages-*.json`.

Верификация фактических deployments выполняется после публикации независимо на обоих доменах. Наличие репозитория или успешного встроенного deploy не заменяет browser smoke.
