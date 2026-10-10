# Ежедневная копия Production и проверка восстановления — 10.10.2026

Основание: P-06 (решение владельца 10.10.2026: копия раз в сутки, RPO 24 ч, RTO 1 день), § 8 и § 12 плана, чек-лист приёмки R1 раздел 8. Решение — [ADR-0034](../adr/0034-daily-backup-github-actions.md), регламент — [database-backup.md](../operations/database-backup.md).

## Подтверждено первоисточником или Production (только чтение)

- Документация Supabase «Database Backups»: ежедневные копии — у Pro, Team и Enterprise; бесплатным проектам рекомендовано выгружать данные самим.
- Документация Supabase «Dedicated IPv4 Address for Ingress»: прямое подключение — IPv6; GitHub Actions назван среди платформ только с IPv4; Supavisor session (5432) работает по IPv4.
- Supabase MCP `get_project`: `enicnfevahcuiqvwmhgp`, PostgreSQL `17.6.1.166`, `eu-north-1`.
- Запросы только на чтение к Production (`execute_sql`): 39 записей `impuls_meta.pgmigrations`, последняя `000039_rules_v2_pilot_bonus` (имена без `.js`, как ожидает проверка); `ledger_entries` пуст, расхождений баланса и журнала 0; размер БД 13 MB.

## Проверено командой (контейнер, PostgreSQL 17.6 `mirror.gcr.io/library/postgres:17.6`, клиент `pg_dump (PostgreSQL) 17.6`)

- `PG_BIN=/opt/pg17/bin TEST_DATABASE_URL=… bun run test:backup` — exit 0, 2 файла, 5 тестов: согласованная копия принимается и временная БД удаляется; отставание истории миграций допустимо, лишняя миграция — ошибка; баланс без журнала — ошибка «1 account balances disagree with the ledger journal»; отсутствующий архив — исключение `pg_restore failed`.
- Репетиция шагов workflow: `pg_dump` тех же флагов из БД с 39 миграциями → `node scripts/verify-backup.mjs` против **пустого** кластера PostgreSQL 17.6 (порт 5433) — exit 0, `problems: []`, созданы роли `impuls_worker`, `impuls_expiry_executor`, `impuls_app`, `impuls_expiry_worker`, 39 миграций, 34 таблицы → `age --recipient` → удаление открытого файла → `age -d` → повторная проверка — `problems: []`.
- `bun run check` — exit 0: format, lint, typecheck, unit (34 файла, 179 тестов; интеграционные пропущены без `TEST_DATABASE_URL`), сборка app и worker.

## Не проверено

- Прогон workflow на GitHub (секреты не заданы; scheduled workflow работает только из ветки по умолчанию).
- Подключение `pg_dump` к Supabase через Supavisor session и выгрузка реальной схемы Production (у исполнителя нет пароля БД).
- Восстановление в отдельный Supabase-проект (роли, `--no-owner` под ролью `postgres` Supabase) и фактический RTO.
- Срок хранения 14 дней и хранение шифротекста в GitHub не утверждены владельцем (§ 8, P-02).
