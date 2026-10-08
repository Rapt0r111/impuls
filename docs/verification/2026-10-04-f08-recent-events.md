# F08/F07: проверка последних событий симуляции

Дата: 04.10.2026. Основание: F08/F07, IMPLEMENTATION_PLAN.md §§ 7–8, 10–12 и [контракт](../implementation/2026-10-04-f08-recent-events-slice.md). Это локальный синтетический срез.

## Подтверждено кодом

- packages/domain/src/notifications/status.ts: последние 20 событий из того же scoped statement snapshot, что и счётчики; сортировка created_at DESC/id DESC. Поля только известный тип либо unsupported, UTC createdAt, сохранённый status и nullable фиксированный errorCode. Сырой kind, ID событий/источников/получателей, тексты и токены не передаются.
- packages/contracts/src/notification-status.ts: обязательный строгий recentEvents, предел 20, запрет посторонних полей/типов/статусов/ошибок. Существующие точные admin.notifications, no-store, флаг false и grants 000022 сохраняются. Схема/зависимости не менялись. API/UI необходимо выпускать совместно.
- apps/app/src/features/notifications/notification-status.tsx/.css: закрытый native details, semantic ordered list, текстовые статусы, причина и time. Счётчики остаются первыми. Датированный ответ целиком сохраняется при 503 и скрывается при изменённом доступе.
- 11 существующих integration fixtures теперь используют fallback URL также при пустом TEST_DATABASE_URL; это устраняет Invalid URL при импорте пропущенных suites в текущем CI. При настоящем URL поведение не меняется.

## Проверено

Среда: Windows, Bun 1.4.2, Node 24.21.0, PostgreSQL 18.6 на 127.0.0.1:55432; отдельная синтетическая impuls_f03, reader под impuls_app. Отдельный migration ACL suite создаёт проверенную disposable БД и удаляет только её.

- `bun install --frozen-lockfile` — exit 0, no changes.
- `bunx vitest run packages/contracts/src/notification-status.test.ts tests/integration/notification-status.test.ts tests/integration/notification-status-migration.test.ts` с TEST_DATABASE_URL=`postgres://impuls_test@127.0.0.1:55432/impuls_f03` — exit 0, 14 passed/2 skipped (HTTP/browser без запущенного origin).
- `bun run typecheck` — exit 0, все четыре workspace.
- `bunx eslint apps/app/src/features/notifications/notification-status.tsx packages/contracts/src/notification-status.ts packages/contracts/src/notification-status.test.ts packages/domain/src/notifications/status.ts tests/browser/notification-status.mjs tests/integration/notification-status.test.ts` — exit 0.
- `bun run build:app` — exit 0.
- `node scripts/verify-task-slice.mjs --notification-status-only` с указанным TEST_DATABASE_URL и TEST_SCREENSHOT_DIR=`docs/verification/assets/f08-recent-events` — exit 0, 12 real HTTP/PostgreSQL tests и 19 browser scenarios. Captures: 320/360/390/1280, большой текст, empty/disabled/denied/unavailable/retained-503; клавиатура, reduced motion, scope switch, поздний ответ и очистка доступа. Browser mocks не доказывают Telegram WebView.
- `$env:TEST_DATABASE_URL=''; bun run test:unit` после исправления fixtures — exit 0, 87 passed/268 skipped, 22 suites passed/37 skipped. Пропущенные integration тесты не объявляются пройденными.
- `git diff --check -- apps/app/src/features/notifications packages/contracts/src/notification-status.ts packages/contracts/src/notification-status.test.ts packages/domain/src/notifications/status.ts tests/browser/notification-status.mjs tests/integration/notification-status.test.ts` — exit 0.
- `bun audit` — не выполнен: ConnectionRefused реестра npm, exit 1.

Независимые ожидания: исходные 10 записей проходят в обратном порядке создания и без соседних/nonpending событий; 24 дополнительные записи с одинаковым временем возвращают ровно 20, первые два состояния определены убывающим UUID, общий счётчик учитывает также исключённые из списка строки. Существующие тесты подтверждают неявные права/отзыв/expiry/disabled и неизменность бизнес-записей при чтении.

Первый новый тест выявил ошибку очистки fixture: receipts надо удалять до outbox. Исправлено; повтор прошёл. Общий unit сначала упал в 11 existing suites на пустом URL из CI; fallback исправлен, повтор прошёл.

## Дизайн и границы

Применены frontend-references (достаточны существующие паттерны), impeccable Operate, vercel:nextjs, vercel:react-best-practices, supabase:supabase. Проверена первичная [документация Supabase о ролях](https://supabase.com/docs/guides/database/postgres/roles); новые SDK, роли или гранты не добавлялись. Detector выполнен один раз: только прежние advisory 16/18 px, описанные в runtime DESIGN.md. Fresh finish reviewer: [ship в границах раскрытия](2026-10-04-f08-recent-events-ui-review.md). Проверка системы: [design documentation](2026-10-04-f08-recent-events-design-documentation.md).

Не проверены удалённый PostgreSQL 17.6, физические Telegram Android/iOS, screen reader, большие объёмы/EXPLAIN, Bot API/неоднозначная доставка, hosting/heartbeat, backup restore и внешний выпуск. Список не имеет пагинации и не является полным журналом попыток. P-01…P-06 и приёмка F08/F07/R1 остаются открытыми.

## Финальное подтверждение

После добавления assertion раскрытия в browser-to-DB повторён `node scripts/verify-task-slice.mjs --notification-status-only` с тем же TEST_DATABASE_URL и TEST_SKIP_SCREENSHOTS=true: exit 0, 12 PostgreSQL/HTTP tests, 19 browser scenarios. Проверяется реальное раскрытие 10 событий и первый сохранённый suppressed статус; финальные снимки первого прогона сохранены.

`bunx eslint` для всех 11 исправленных fixtures — exit 0. `bunx prettier --check` для изменённых исходников, fixtures, контракта и трёх итоговых отчётов — exit 0 после форматирования reviewer report. Финальный `git diff --check` для среза, tests/integration и IMPLEMENTATION_PLAN.md/PRODUCT.md/DESIGN.md — exit 0 после удаления лишних EOF строк. Предупреждение Git о нормализации CRLF в DESIGN.md не является ошибкой проверки.
