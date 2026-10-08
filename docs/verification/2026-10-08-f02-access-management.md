# F02/F07: проверка управления синтетическим доступом

Дата: 08.10.2026. Основание: [контракт](../implementation/2026-10-08-f02-access-management-slice.md), [ADR-0023](../adr/0023-synthetic-access-management.md). Локальный синтетический срез; F02/F07/R1 и P-01…P-06 не приняты.

## Среда

Windows, Node 24.21.0, Bun 1.4.2, loopback PostgreSQL 18.6 (`127.0.0.1:55434`, база `impuls_cancellation`, миграция 000031 применена вручную через `up()`). Целевой Linux/PostgreSQL 17.6 не проверялся.

## Результаты

| Команда                                                                        | Результат                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run test:access` с TEST_DATABASE_URL                                      | 6 passed: выдача/replay/смена тела, отзыв сессий получателя, скрытие без двух прав/флага/области/сессии, самовыдача, `admin.access*`, не участник, прошлый срок, гонка двух выдач, отзыв с версией, immutable/forged evidence |
| `vitest run packages/contracts/src/access-management.test.ts`                  | 2 passed                                                                                                                                                                                                                      |
| `node scripts/verify-database-restore.mjs` (PG_BIN PostgreSQL 18) после 000031 | exit 0                                                                                                                                                                                                                        |
| `bun run check`                                                                | exit 0 (format, lint, typecheck, unit 120 passed / 379 skipped, build)                                                                                                                                                        |

## Не проверено

HTTP-адаптер (`apps/app/src/shared/server/access-management.ts`) и маршруты проверены только typecheck/build, без реальных HTTP-сценариев Origin/CSRF/лимита. UI нет. Чтение `access_changes` в scoped audit нет. P-01…P-06, Linux 17.6 CI, устройства, внешний выпуск и приёмка R1 открыты.
