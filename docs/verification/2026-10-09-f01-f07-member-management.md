# Проверка: допуск и отзыв участников (synthetic)

Контракт: [срез](../implementation/2026-10-09-f01-f07-member-management-slice.md), ADR-0026, миграция 000033. Статус F01/F02/F07 и R1 этой записью не меняется.

## Проверено командами (PostgreSQL 18.6, `127.0.0.1:45432`, БД `impuls_f03`, `PG_BIN=C:/Program Files/PostgreSQL/18/bin`)

| Команда                                                                                                                    | Результат                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vitest run tests/integration/member-management.test.ts tests/integration/access-management.test.ts` без `TEST_APP_ORIGIN` | 18 прошли, 3 пропущены (HTTP-сценарии требуют сервер)                                                                                                                                                                                                                                |
| `node scripts/verify-task-slice.mjs --access-management-only`                                                              | интеграция 23 теста прошли (включая HTTP-сценарий допуска/отзыва с Origin, CSRF, ключом идемпотентности, 401/403/404); browser: управление доступом 19 сценариев, access-real 3, task-flow-real 4, task-negative-real 3, task-return-real 2, rewards-real 3, reward-decisions-real 5 |
| `bun run test:restore`                                                                                                     | 9 тестов прошли                                                                                                                                                                                                                                                                      |
| `bun run lint`, `bun run typecheck`, `bun run test:unit`, `bun run build`                                                  | без ошибок; unit: 139 прошли, 411 пропущены (интеграция без БД)                                                                                                                                                                                                                      |
| `prettier --check` по `apps packages db docs tests scripts package.json`                                                   | чисто, кроме сгенерированного `apps/app/.impeccable/hook.cache.json`                                                                                                                                                                                                                 |

## Аудит `member.*` (добавлено позже в тот же день)

- Домен: `packages/domain/src/admin/audit.ts` (ветка `member_changes`), контракт `packages/contracts/src/audit.ts` (`memberAuditEvidenceSchema`, взаимоисключение с остальными доказательствами), UI `apps/app/src/features/audit/audit-log.tsx`.
- Проверено: `vitest run tests/integration/member-management.test.ts tests/integration/access-management.test.ts` и `packages/contracts/src/audit.test.ts` — прошли (новые: чтение допуска и отзыва в точной области, фильтр по действию, отказ без `admin.audit`, отсутствие Telegram ID; контрактные отказы для чужих действий, лишних полей, отрицательного числа прав).
- `node scripts/verify-task-slice.mjs --access-management-only` после `bun run build:app`: 24 интеграционных теста, access-real теперь ждёт в журнале «Допущен новый участник…» и «Отозван допуск участника…»; остальные наборы без изменений.
- `node scripts/verify-task-slice.mjs --audit-only`: 3 файла тестов, 28 browser-сценариев аудита прошли.
- `bun run test:unit` без БД: 140 прошли, 412 пропущены. `bun run lint`, `typecheck` без ошибок. Раннер использует собранное приложение: без `bun run build:app` UI-проверка видит старый код.

## Исправления по ходу проверки

- `tests/integration/member-management.test.ts`: HTTP-сценарий сравнивал общее число строк `users`; параллельные файлы тестов в той же БД создают пользователей, и сравнение падало (`u: 310` против `309`). Подсчёт сужен до пользователя с проверяемым `telegram_id` и журнала `member_changes` своей области. Дефект теста, не приложения.
- Без `PG_BIN` `database-restore.test.ts` падает (`pg_dump failed`): `pg_dump` нет в PATH Windows. Это условие окружения.

## Не проверено

- Полный `node scripts/verify-task-slice.mjs` в моём запуске интеграцию прошёл (49 файлов, 407 прошли, 4 пропущены), затем `tests/browser/task-management.mjs` упал `ERR_CONNECTION_REFUSED` на `http://localhost:3100/` при том, что сервер слушает `127.0.0.1:3100`. Файл в этом срезе не менялся; причина (вероятно, разрешение `localhost` в IPv6) не выяснялась, поэтому последующие шаги раннера в этом прогоне не выполнялись.
- Telegram Android/iOS, Supabase/Production (миграция 000033 туда не применялась), PostgreSQL 17.6 и удалённый CI, P-01…P-06.
- UI «Состав области» на настоящей БД проходит `tests/browser/access-real.mjs` (допуск, отзыв, журнал) в одном из трёх прогонов по ширине; остальные ширины — только моки `access-management.mjs`.
