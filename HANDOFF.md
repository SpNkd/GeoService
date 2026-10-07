# GeoService — public Pages release

Основа: текущий verified topology V3. Публикация добавляет MIT, русское руководство с синтетическими примерами и локальную сборку для Pages. Новые product workflows не разрабатываются.

Production — только статические файлы. Browser AI обращается прямо к OpenRouter с ключом пользователя; DEV сохраняет локальный API adapter. Prompt/schema, semantic validation и local resolution общие. Ключ по умолчанию в памяти, Remember явно сохраняет localStorage. Без ключа редактор работает, AI предлагает «Настроить».

`npm run build`; `npm run preview:static` проверяет `/GeoService/` без API. `npm run deploy:pages -- origin gitverse` отправляет готовый dist в gh-pages без force-push. Custom workflows не используются. Встроенная публикация Pages разрешена пользователем.

Публичная история очищена отдельно от исходной локальной истории: старые docs/audit-results и документы с reference geometry/text не публикуются. История кода сохраняется с изменёнными commit IDs; обе площадки получают одинаковую очищенную историю. Не отправлять private local branches через push --all/--mirror.

Safe demo: `public/examples/process-scheme.json`; скриншоты в `docs/screenshots/`. Последние проверенные результаты публикации: [PAGES_DEPLOYMENT](docs/PAGES_DEPLOYMENT.md).
