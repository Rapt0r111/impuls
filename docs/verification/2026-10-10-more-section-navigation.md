# Раздел «Ещё» и нижняя панель по макету (10.10.2026)

Основание: запрос владельца «возьми интерфейс из Артефактов и прорабатываем все экраны, формы и меню»; макет — артефакт «Импульс — редизайн мини-приложения» (экран «6 · Ещё», `project/More.dc.html`). Расхождение было зафиксировано в `DESIGN.md` 9 октября как сознательное отступление и теперь снято.

## Что изменено (подтверждено файлами)

- `apps/app/src/features/more/more-menu.tsx`, `more.css` — новый экран «Ещё»: карточка профиля (имя, уровень), строка «Баланс и журнал», группа «Для командира» со служебными разделами. Состав списка берётся из прав сессии (`useAuthorizedSession`), как и прежняя лента чипов: раздела без права в списке нет.
- `apps/app/src/features/tasks/task-list.tsx` — нижняя панель стала пятью разделами макета (Главная, Задачи, Рейтинг, Поощрения, Ещё); `.workspace-nav-operations` удалена. Вкладка «Ещё» подсвечена, пока открыт любой её раздел; над содержимым раздела — кнопка возврата «Ещё». Аппаратная кнопка «Назад» (`useTelegramBack`, приоритет 10) из раздела ведёт в список «Ещё», из списка — на стартовый экран.
- `apps/app/src/app/globals.css` — удалены правила ленты служебных чипов; имя и приветствие показываются только на «Главной» (`html[data-view="home"]`), кнопка «Полномочия» остаётся на каждом экране и прижата к правому краю.
- `tests/browser/nav.mjs` — помощник `openSection(page, name)`: открывает «Ещё» и возвращает кнопку раздела. Подключён в 31 браузерном и интеграционном сценарии вместо прямого клика по чипу.
- `DESIGN.md` — правка 10 октября заменяет правило о ленте с горизонтальной прокруткой.

Серверных изменений нет: API, миграции, права и зависимости не затрагивались.

## Проверено командами (PostgreSQL не требуется, фикстуры API)

- `bun run typecheck` — без ошибок.
- `bunx eslint apps tests` — без замечаний.
- `npx prettier --check` на изменённых файлах — без замечаний.
- `bun run test:reflow` (`PLAYWRIGHT_BROWSERS_PATH` на предустановленный Chromium 1194) — `{"scenarios":150,"failures":0}` при 320/360/390/1280 px и увеличенном тексте; в наборе появился шаг открытия «Ещё» для всех служебных разделов.
- Браузерные сценарии на production-сборке, `TEST_APP_ORIGIN=http://127.0.0.1:3100`: access-management, admin-catalog, audit, catalog-cancellation, catalog-creation, catalog-publication, catalog-scheduling, home, leaderboard, ledger-corrections, notification-status, profile, quota-publication, reward-decisions, reward-fulfillment, rewards, task-acceptance, task-edit-cancel, task-history, task-management, task-reviews, task-submissions, task-timeline, tasks-smoke, telegram-bridge — все прошли.
- Снимки экранов при 390 px просмотрены вручную (`test-results/workspace-reflow/view-*.png`, `more-*.png`).

## Не проверено и осталось открытым

- `tests/browser/embedded-access.mjs` в этой среде падает на `Network.setCookieControls: Invalid parameters` — ограничение установленного Chromium, к этой правке отношения не имеет: файл не изменялся.
- Сценарии с реальной PostgreSQL (`test:task-slice`, `tests/integration/*`) не запускались: в контейнере нет сервера PostgreSQL (`pg_ctl`/`initdb` отсутствуют, есть только клиент `psql`). Интеграционные файлы изменены тем же помощником `openSection`, что и прошедшие браузерные, но прогон не выполнялся.
- Реальный Telegram на Android и iOS, жест «назад» на устройстве, производительность размытия на слабых телефонах.
- Экраны «Задача и отчёт», «Задачи», «Рейтинг», «Поощрения» к макету ещё не приводились: это следующий срез той же работы. Статус R1 и F01–F08 эта запись не меняет.
