# ADR-0024: смена владельца функций в миграциях на управляемом PostgreSQL

- Статус: принято (технический контракт миграций; P-решений не затрагивает)
- Дата: 08.10.2026
- Авторы и утверждающие: исполнитель задачи; выпуск на Supabase одобрен владельцем в сессии 08.10.2026

## Контекст и причина

Миграции 000027 и 000028 делают `ALTER FUNCTION … OWNER TO impuls_expiry_executor`, чтобы SECURITY DEFINER-функции выполнялись с минимальными правами. PostgreSQL требует права `SET` на новую роль-владельца. В CI (суперпользователь) это работает, в Supabase роль `postgres` не суперпользователь: при выпуске 08.10.2026 `apply_migration` вернул `42501 must be able to SET ROLE "impuls_expiry_executor"` (`docs/verification/2026-10-08-production-migrations-11-31.md`). `bun run db:migrate` падал бы там же. Воспроизведено локально: прогон 000001–000031 на PostgreSQL 18.6 от роли `CREATEROLE` без суперпользователя останавливался на 000027 (`check_can_set_role`).

## Решение

Перед `ALTER … OWNER` миграции выдают исполняющей роли временное членство `GRANT impuls_expiry_executor TO CURRENT_USER WITH SET TRUE` и отзывают его `REVOKE impuls_expiry_executor FROM CURRENT_USER` сразу после временного `CREATE` на схему. Синтаксис `WITH SET` требует PostgreSQL 16+; целевая версия 17.6. Файлы 000027 и 000028 изменены задним числом, потому что уже применённый на Production SQL содержит ровно эти строки; иначе файл и фактическая схема расходились бы. node-pg-migrate сверяет только имена и порядок, не контрольные суммы.

## Последствия

Итоговые права не меняются: владелец функций — `impuls_expiry_executor`; у выполняющей миграции роли остаётся только `ADMIN` от создания роли (без `SET`), у исполнителя нет `CREATE` на схему. F08/F06 (автоистечение, статус) не затронуты по поведению. Это не расширение права приложения: `impuls_app` и worker в членстве не участвуют.

## Миграция и откат

Для уже мигрированных БД (Production на 000031) действий не нужно. Откат изменения: убрать две строки из каждого файла; на чистой БД под несуперпользователем миграция снова упадёт.

## Проверки

- `node scripts/migrate.mjs` с нуля на PostgreSQL 18.6: от роли `CREATEROLE` без суперпользователя до правки — остановка на 000027; после правки — 31 миграция, exit 0. От суперпользователя — 31 миграция, exit 0.
- После обоих прогонов: владелец `expire_one_synthetic_reservation` и `read_synthetic_expiry_status` — `impuls_expiry_executor`; `SET` у исполняющей роли нет; `has_schema_privilege(executor, impuls, CREATE)` = false.
- `TEST_DATABASE_URL=… vitest run tests/integration/automatic-expiry.test.ts` на мигрированной БД: 15 passed.
- Не проверено: PostgreSQL 17.6 локально (использована 18.6; CI указывает 17.6), повторный прогон на Supabase.
