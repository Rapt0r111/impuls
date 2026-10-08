# F07: проверка истории условий каталога

Дата: 04.10.2026. Требования: версии и admin.catalog § 5–6, F07 § 11, ожидание § 10, критерии § 12 IMPLEMENTATION_PLAN.md. [Контракт](../implementation/2026-10-04-f07-catalog-history-slice.md). Пользователь выбрал раскрываемую историю под позицией. Это локальное продолжение конфигурации, не полная приёмка F07/R1.

## Подтверждено кодом

- `packages/contracts/src/admin-catalog.ts:75`: purpose-bound cursor, required scope, bounded limits, strict path/query/response и шесть дробных знаков даты. Существующая схема версии повторно используется без смены контракта текущего каталога.
- `packages/domain/src/admin/catalog-history.ts:25`: один SQL statement snapshot проверяет пользователя, сессию, точное admin.catalog, доступную synthetic cosmetic identity и anchor; сравнение effective_from/version/id выполняется в PostgreSQL. Все будущие и заменённые версии возвращаются с собственными сохранёнными условиями/ценой/сроком; disabled current не подменяется старой включённой версией.
- `apps/app/src/app/api/v1/admin/rewards/[id]/versions/route.ts:13`: authenticated GET, awaited params установленного Next.js, strict query без повторов, прежний SYNTHETIC_ADMIN_CATALOG_ENABLED, private no-store, 400/401/403/404/503; POST 405. Секреты и сырые ошибки БД не возвращаются.
- `apps/app/src/features/catalog-admin/catalog-history.tsx:48`: закрытое native disclosure, query только по открытию, отдельные refresh/next и timestamp, current/future/superseded в тексте. 503 оставляет ранее подтверждённую страницу, 400 скрывает её до refresh, 401/403/404 очищают history caches. Параллельные history запросы отменяются при denial, поздний scope response отменяется через AbortSignal. Back приоритет 20 закрывает disclosure.
- `apps/app/src/features/catalog-admin/catalog-admin.tsx:53`: denial родительского каталога отменяет history запросы и очищает их cache; identity/scope key перемонтирует disclosure. Общий CatalogTerms сохраняет прежние current/nearest-future строки, history использует h4.
- Схема 000001–000022, grants, runtime, зависимости и bun.lock не менялись этим срезом; новые права/экономические значения/БД-записи не создаются. ADR не требуется.

## Проверено командами

Среда: Windows, Node 24.21.0, Bun 1.4.2, отдельная локальная PostgreSQL 18.6 на 127.0.0.1:55432, impuls_f03. Предметные чтения выполняются под impuls_app, fixture/cleanup — собственные синтетические записи под тестовой ролью.

- `$env:TEST_DATABASE_URL='postgres://impuls_test@127.0.0.1:55432/impuls_f03'; bunx vitest run packages/contracts/src/admin-catalog.test.ts tests/integration/admin-catalog.test.ts` — exit 0: 13 passed, 2 skipped (HTTP/browser-to-DB без TEST_APP_ORIGIN).
- `bun run typecheck` — exit 0, все четыре workspace.
- `bun run lint` — exit 0. После последних правок Back/тестов повторён, exit 0.
- `bun run build:app` — exit 0, `/api/v1/admin/rewards/[id]/versions` включён в production build. После Back повторная сборка exit 0.
- `$env:TEST_DATABASE_URL='postgres://impuls_test@127.0.0.1:55432/impuls_f03'; $env:TEST_SCREENSHOT_DIR='docs/verification/assets/f07-catalog-history'; node scripts/verify-task-slice.mjs --admin-catalog-only` — exit 0: 10 PostgreSQL/HTTP/browser-to-DB tests и 27 browser scenarios. Runner использует локальный production server на 3100 и останавливает его после проверки.
- После Back и explicit revoked-session assertion: `$env:TEST_DATABASE_URL='postgres://impuls_test@127.0.0.1:55432/impuls_f03'; $env:TEST_SKIP_SCREENSHOTS='true'; node scripts/verify-task-slice.mjs --admin-catalog-only` — exit 0, те же 10 реальных tests и 27 browser scenarios. Невизуальная правка не меняла ранее просмотренные captures.
- `$env:TEST_DATABASE_URL=''; bun run test:unit` — exit 0: 92 passed, 278 skipped; 23 suites passed, 38 skipped. Пропущенные интеграционные tests не являются пройденными.
- `bun run format:check` — exit 0 после кода и контракта; финальный повтор после обоих design handoffs также exit 0. `git diff --check -- DESIGN.md IMPLEMENTATION_PLAN.md PRODUCT.md README.md packages/contracts/src/index.ts packages/domain/src/index.ts` — exit 0 (только предупреждения CRLF). Новые файлы отдельно охвачены Prettier/lint/typecheck.

Независимые ожидания: все исходные версии [4 future, 3 future, 2 current disabled, 1 superseded]; future-only позиция не получает current. Для отдельного набора effective_from с разницей в одну микросекунду, точным равенством и version/date без монотонности — страницы [3, 2, 1, 5, 4], states [future, future, future, current, superseded]. Snapshot terms/quota/audit до/после чтения совпадает. Actor/scope/reward/version forgery, чужой anchor, unknown identity, соседняя область, reward.decide без admin.catalog, expired/revoked binding/session и inactive actor отвергнуты.

Настоящий HTTP проверяет no-store, строгие query/дубли, nextCursor, 401, revoked session 403, hidden scope/identity 404 и POST 405. Browser-to-DB читает все четыре версии через настоящее cookie/API/runtime role; только Telegram SDK подменён. Browser mocks проверяют lazy loading, keyboard/native summary и refresh, next/reset, reduced motion, 44 px summary, 503 retention, 404 cache clearing при reopening и после parent denial, 400 recovery, initial unavailable, empty, 401/403 cleanup, late scope response и Back.

## Визуальные свидетельства и навыки

Captures в `assets/f07-catalog-history/admin-catalog`: история на 320/360/390/1280 px, large-text 320, retained-503 320, empty 320; также сохранены прежние состояния текущей конфигурации. Все семь history captures просмотрены; overflow assertions пройдены. Существующий navy/Manrope/mint/gold, flat rows, native details и focus достаточны; новые компоненты из внешних каталогов, иллюстрации, motion и зависимости не добавлены.

Прочитаны и применены frontend-references, impeccable context/Operate/craft floor, vercel:nextjs (включая установленную локальную документацию Route Handlers), vercel:react-best-practices и supabase:supabase. Detector запущен один раз, только прежние advisories 16/18 px против R0 ramp; runtime ступени уже документированы, baseline system не переписывался. [Fresh UI review](2026-10-04-f07-catalog-history-ui-review.md) дал disposition ship без material fixes только для блока истории. [Design documentation](2026-10-04-f07-catalog-history-design-documentation.md) имеет отдельный узкий scope.

Граница отдельной роли сверена с первичной [Supabase Postgres Roles](https://supabase.com/docs/guides/database/postgres/roles). Changelog.md запрос через web не выполнен: Unsupported content-type text/markdown. Срез не вводит новых Supabase SDK/API/конфигурации, использует прежний pg/GRANT; содержимое недоступного changelog не предполагается.

## Не проверено / требует решения

Внешнего выпуска нет. Remote PostgreSQL 17.6, большие наборы/EXPLAIN/load, physical Telegram Android/iOS, screen reader, backup restore и deployment API/UI не проверялись этим срезом. История условий — live list, не единый снимок на все страницы и не история квот. Создание/публикация версий и квот, audit публикации и соответствующие гонки остаются следующим write срезом. P-01…P-06 и полная приёмка F07/F06/R1 открыты. Аудит зависимостей/полный security scan этим срезом не запускались; зависимости не менялись, закрытый пилот не начинается.
