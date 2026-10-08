# F07: проверка просмотра конфигурации каталога

Дата: 04.10.2026. Основание: F07 § 11, admin.catalog и /admin/rewards § 6, ожидание § 10, критерии § 12 IMPLEMENTATION_PLAN.md. [Контракт](../implementation/2026-10-04-f07-catalog-inspection-slice.md). Это локальный read-only срез, не полный каталог управления.

## Подтверждено кодом

- packages/domain/src/admin/catalog.ts: exact admin.catalog, active user/session, disabled flag; authority/configuration одним statement snapshot. По identity возвращаются последняя действующая и ближайшая будущая immutable версии, включая выключенные, плюс текущая quota. Live keyset по reward_id, cursor actor/scope/purpose/anchor. Ни одной бизнес-записи.
- packages/contracts/src/admin-catalog.ts: strict bounded query/response; сумма capacity=reserved+used+available. В ответе нет пользователей, заявок, балансов или текстов решений.
- apps/app/src/app/api/v1/admin/rewards/route.ts: authenticated no-store GET, duplicate parameters/невалидный cursor 400, соседняя scope/disabled 404, session 401/403, POST 405.
- apps/app/src/features/catalog-admin/catalog-admin.tsx/.css: отдельный рабочий destination по admin.catalog, действующие terms и nearest scheduled disclosure, текущая квота/отсутствие периода/длительности, ручной refresh/next. 503 retained dated response, 401/403/404 clear all protected catalog caches, scope late response abort. Никаких форм изменения или кнопок выдачи.
- .env.example: SYNTHETIC_ADMIN_CATALOG_ENABLED=false. scripts/verify-task-slice.mjs: новая --admin-catalog-only и запуск browser suite в полном CI. Схема 000001–000022, grants 000017, dependencies и bun.lock не менялись; ADR не требуется, архитектура остаётся прежней.

## Проверено командами

Среда: Windows, Node 24.21.0, Bun 1.4.2, PostgreSQL 18.6 на 127.0.0.1:55432, отдельная синтетическая impuls_f03; queries приложения под impuls_app. Не подтверждает удалённый PostgreSQL 17.6.

- `bun install --frozen-lockfile` — exit 0, no changes.
- `bunx vitest run packages/contracts/src/admin-catalog.test.ts tests/integration/admin-catalog.test.ts` с TEST_DATABASE_URL=`postgres://impuls_test@127.0.0.1:55432/impuls_f03` — exit 0, 8 passed/2 skipped (HTTP/browser без origin).
- `bun run typecheck` — exit 0, четыре workspace.
- `bun run lint` — exit 0, весь код.
- `$env:TEST_DATABASE_URL=''; bun run test:unit` — exit 0, 90 passed/275 skipped, 23 suites passed/38 skipped. Пропущенные интеграционные сценарии не названы пройденными.
- `bun run build:app` — exit 0, новый /api/v1/admin/rewards включён в production build.
- `node scripts/verify-task-slice.mjs --admin-catalog-only` с указанной TEST_DATABASE_URL, TEST_SCREENSHOT_DIR=`docs/verification/assets/f07-catalog-inspection` — exit 0, 7 PostgreSQL/HTTP/browser-to-DB tests, 15 browser scenarios.
- `bunx eslint apps/app/src/features/catalog-admin apps/app/src/features/auth/session-context.tsx apps/app/src/features/auth/access-screen.tsx apps/app/src/features/tasks/task-list.tsx apps/app/src/app/api/v1/admin/rewards/route.ts packages/contracts/src/admin-catalog.ts packages/contracts/src/admin-catalog.test.ts packages/domain/src/admin/catalog.ts tests/integration/admin-catalog.test.ts tests/browser/admin-catalog.mjs scripts/verify-task-slice.mjs` — exit 0.
- `bun audit` — exit 1, ConnectionRefused при POST к npm bulk advisories. Аудит зависимостей не выполнен.

Независимые ожидания: current версия 2 выключена/цена 7/срок 3600, nearest scheduled версия 3 на явной UTC дате, версия 4 не показана; future-only item не подменяет current; quota 9=2+3+4. Неавторизованный reward.decide не даёт catalog права, соседняя и пустая scopes различаются, forged actor/scope/anchor отклоняются. Snapshot условий/квот/audit до/после чтения совпадает. HTTP/browser-to-DB идут через настоящее cookie/API/роль БД; Telegram SDK только mock.

Captures: 320/360/390/1280, крупный текст, empty/disabled/denied/unavailable, все рабочие права, retained-503. Проверены overflow, native summary/refresh клавиатурой, minimum 44 px, reduced motion, cursor next/refresh first, 401/403 и clearing после reopening, поздний scope response/Back. Full-page изображения в assets/f07-catalog-inspection/admin-catalog.

## Сбои и исправления

Initial TypeScript выявил недискриминированный union результата и tuple inference в quota rows; варианты разделены, tuple задан as const. Первые integration проверки выявили дату без timezone в fixture, которая означала MSK: данные теперь используют явный UTC, reader сохранил исходный timestamp правильно. Browser test один раз захватил также системный Next route announcer через общий alert; селектор ограничен целевым экраном. Повторные проверки прошли.

## Дизайн и ограничения

Применяются прочитанные в этой сессии frontend-references, impeccable Operate/craft floor, vercel:nextjs/react-best-practices и supabase:supabase; существующие disclosure/rows/navigation/tokens достаточны, новые внешние компоненты не вводились. Основа DB-ролей сверена с [первичной документацией Supabase](https://supabase.com/docs/guides/database/postgres/roles). Detector один раз: advisory для runtime 16/18 px, system не менялся. [Fresh UI reviewer](2026-10-04-f07-catalog-inspection-ui-review.md) — disposition ship только для inspection UI/navigation. [Design documentation](2026-10-04-f07-catalog-inspection-design-documentation.md) фиксирует сравнение с incumbent system.

Не выполнены внешний выпуск, remote PostgreSQL 17.6, EXPLAIN/load на больших данных, physical Telegram Android/iOS, screen reader и backup restore. История всех версий/будущих quotas отсутствует. Создание/изменение условий и квот, audit этих операций и гонки публикации — следующий write срез. P-01…P-06 и полная приёмка F07/F06/R1 остаются открытыми.

## Финальные результаты

После уточнения route copy, добавления revoked-binding assertion и подключения нового browser suite к полному runner повторён `node scripts/verify-task-slice.mjs --admin-catalog-only` с тем же TEST_DATABASE_URL и TEST_SKIP_SCREENSHOTS=true: exit 0, 7 реальных PostgreSQL/HTTP/browser-to-DB tests и 15 browser scenarios. Reviewed screenshots не изменялись, UI после review не правился.

Первый `bun run format:check` указал три Markdown файла (новый surface brief, прежний notification surface brief и reviewer report). Они отформатированы без смысловой правки. Финальный `bun run format:check` — exit 0; финальный scoped `git diff --check` — exit 0 (только предупреждения CRLF). Общие lint/typecheck завершились exit 0. Аудит зависимостей остаётся невыполненным.
