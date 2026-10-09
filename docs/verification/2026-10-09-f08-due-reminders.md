# F08: напоминание о приближении срока задачи — проверки (09.10.2026)

Основание: IMPLEMENTATION_PLAN.md §§ 8, 11 (F08), 12; ADR-0027; контракт `../implementation/2026-10-09-f08-due-reminders-slice.md`.

## Что изменено (подтверждено файлами)

- `db/migrations/000034_task_due_reminders.js`: вид `task.due_soon`, уникальный индекс на задачу, функция `impuls.enqueue_task_due_reminders()` (EXECUTE только у `impuls_worker`).
- `packages/domain/src/notifications/simulation.ts` (текст и `enqueueTaskDueReminders`), `status.ts`, `events.ts`, `attempts.ts` (список видов), `packages/contracts/src/notification-status.ts`, `apps/app/src/features/notifications/notification-format.ts`.
- `apps/worker/src/index.ts`: флаг `TASK_REMINDERS_ENABLED`.

## Проверено командами (PostgreSQL 18.6, `127.0.0.1:45432`, БД `impuls_f03`, миграции 000001–000035, `PG_BIN=C:/Program Files/PostgreSQL/18/bin`)

| Команда                                                      | Результат                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `npx vitest run tests/integration/task-reminders.test.ts`    | 9 тестов прошли (8 доменных и 1 с собранным worker `--once` с флагом и без него)         |
| то же с временно убранным `NOT EXISTS` в миграции            | тест «не голодает» падает (`expected +0 to be 5`); миграция восстановлена, 9 из 9 прошли |
| `node scripts/verify-task-slice.mjs` (после `bun run build`) | код 0; Vitest 51 файл, 427 прошли, 4 пропущены; все браузерные наборы прошли             |
| `bun run test:restore`                                       | 9 тестов прошли                                                                          |
| `bun run test:worker-ops`                                    | 19 прошли, 3 пропущены                                                                   |
| `bun run test:notifications`                                 | 40 прошли, 1 пропущен                                                                    |
| `bun run test:reflow`                                        | 150 сценариев, 0 сбоев                                                                   |
| `bun run typecheck`, `bun run lint`, `bun run build`         | без ошибок                                                                               |
| `bun run test:unit` (без БД)                                 | 164 прошли, 431 пропущено (интеграция без БД)                                            |
| `npx prettier --check apps packages db docs tests scripts`   | замечание только к сгенерированному `apps/app/.impeccable/hook.cache.json`               |

Первый запуск `tests/integration/task-reminders.test.ts` дал 8 из 8 с первого раза; поэтому тест на «голодание» проверен мутацией, как указано выше.

## Не проверено

- Реальный Telegram и устройства; поведение под нагрузкой и при тысячах задач в окне (в окне не более 50 за шаг).
- Расписание вне процесса и hosting worker: постановка происходит только в цикле уведомлений.
- Граница перехода на летнее/зимнее время отдельно не проверялась (сравнение `timestamptz` от неё не зависит).
- Окно 24 часа — технический параметр, не согласованное правило (P-04). Статус F08 и R1 этой записью не меняется.
- Раннер использует один общий экземпляр БД; параллельные файлы тестов не разделяют схему, поэтому команды запускались последовательно.
