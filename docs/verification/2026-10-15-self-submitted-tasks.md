# Проверка: свои выполненные задачи (ADR-0040)

Дата: 15.10.2026. Среда: локальный PostgreSQL 16 (без `pg_c_utf8` и без ролей Supabase), Bun, Node. Production не трогали.

## Команды и результат

- Миграция вверх: `MIGRATION_DATABASE_URL=postgres://impuls_test@127.0.0.1:55432/impuls_f03 node scripts/migrate.mjs` — применена `000046`.
- Откат и повтор: `node node_modules/node-pg-migrate/bin/node-pg-migrate.js down 1` и `up` с теми же `--migrations-dir db/migrations --migrations-schema impuls_meta` — оба прошли, колонки и `task_verifiers` восстанавливаются.
- Тесты отчётов: `TEST_DATABASE_URL=… bunx vitest run tests/integration/self-tasks.test.ts` — 15 из 15.
- Профиль и отчёты вместе: `bunx vitest run tests/integration/self-tasks.test.ts tests/integration/profile.test.ts` — 24 пройдено, 1 пропущен.
- Полный набор: `bunx vitest run tests/integration` — 438 пройдено, 53 пропущено, 10 не проходят.
  - 6 в `profile-name`, `catalog-creation`, `member-management`, `automatic-expiry`, `ledger-corrections`: `collation "pg_c_utf8" does not exist` (нужен PostgreSQL 17 из CI);
  - 2 в `member-management` и `catalog-creation`: `role "anon" does not exist` (роль Supabase);
  - 1 в `automatic-expiry`: нет Chromium для Playwright;
  - 1 в `ledger-corrections`: нужен `bun run test:task-slice`.
- Ошибка `task_events_rule_set_id_fkey` в `profile.test.ts`: по трассе причина в событии `proposed` нашего теста, которое сохраняло правило, действовавшее при вставке (вставка берёт текущее правило, а тест переназначал только задачу). Тест теперь переписывает и `task_events.rule_set_id`. Повтор полного набора: этой ошибки нет.
- `bun run typecheck`, `eslint` и `prettier --check` на изменённых файлах — без ошибок.

## Не проверено

- Интерфейс в браузере и на телефоне (Android/iOS в Telegram).
- Уведомления проверяющим и командиру: не реализованы.
- CI на PostgreSQL 17 (GitHub Actions исчерпаны, сброс около 01.11.2026). Локальный `bun run ci:local` с `--db-url` до запуска не проверял целиком.
