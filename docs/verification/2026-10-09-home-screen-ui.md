# Главная и обновление визуального слоя (09.10.2026)

## Что изменено (подтверждено файлами)

- `apps/app/src/features/home/home.tsx`, `home.css`: экран «Главная» для участника — уровень, баланс, ближайшая открытая задача из `/api/v1/tasks`, данные профиля из `/api/v1/me/profile`. Ошибки 401/403 передаются в `loseAccess`. Новых API, миграций и зависимостей нет.
- `apps/app/src/features/tasks/task-list.tsx`: корневой вид участника — «Главная», у проверяющего по-прежнему очередь проверки; линейные иконки вкладок, чипы приоритета и статуса в строке задачи.
- `access-screen.tsx`, `globals.css`, стили профиля, рейтинга и поощрений: визуальное выравнивание с `DESIGN.md`.
- `tests/browser/home-fallback.mjs` и браузерные сценарии: запасные ответы для «Главной» и переход к списку задач.

## Проверено командами

- `bun run typecheck` — без ошибок.
- `bunx eslint apps/app/src tests/browser` — без замечаний.
- `bun run test:reflow` — 150 сценариев, 0 сбоев (320/360/390/1280 px, увеличенный текст).
- `bun run test:telegram` — 14 сценариев (SDK и HTTP смоделированы).
- `bunx prettier --check apps tests scripts docs` — замечание только к сгенерированному `apps/app/.impeccable/hook.cache.json`.

## Не проверено

- Браузерные сценарии с PostgreSQL (`test:task-slice` и др.): локальной БД в среде нет (`pg_isready`/`postgres` отсутствуют), `TEST_DATABASE_URL` не задан.
- Физический Telegram на Android/iOS; удалённый CI; P-01…P-06 остаются решениями владельца. Статус R1 и F01–F08 этой записью не меняется.
