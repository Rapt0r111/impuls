# Проверка: свободные задачи (ADR-0037), 12.10.2026

Среда: локальный PostgreSQL 16, синтетические данные, Next.js `next start`, Chromium (Playwright). Telegram WebView и Production не проверялись.

| Что                    | Команда                                                                                                                                                     | Результат                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Контракты              | `bun test packages/contracts` (тесты `task-management`, `tasks`)                                                                                            | проходят                            |
| Домен и гонки          | `vitest tests/integration/task-claim.test.ts` (6 тестов: 8 одновременных попыток, область, идемпотентность, отзыв доступа, выключатель, нет UPDATE на флаг) | проходят                            |
| HTTP                   | `vitest tests/integration/task-claim-http.test.ts`                                                                                                          | проходит                            |
| UI                     | `node tests/browser/open-tasks.mjs` (5 сценариев)                                                                                                           | `{"scenarios":5,"result":"passed"}` |
| Соседние экраны        | `task-management`, `task-flow-real`, `task-edit-cancel`, `tasks-smoke`, `task-history`, `task-reviews`, `task-acceptance`, `task-submissions`, `home`       | все проходят                        |
| Перенос на 320/360/390 | `node scripts/verify-workspace-reflow.mjs`                                                                                                                  | `{"scenarios":150,"failures":0}`    |

Известные сбои песочницы, не связанные с изменением: 7 тестов `profile-name.test.ts` (нет сортировки `pg_c_utf8` в PG16, падают и на main); `catalog-publication` иногда нестабилен под нагрузкой.

Дополнение (предел и уведомление, миграция 000044):

| Что                                                                                       | Команда                                                                   | Результат                            |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------ |
| Предел, гонка одного участника, уведомление создателю, повтор с тем же ключом, самовзятие | `vitest tests/integration/task-claim.test.ts`                             | 8 тестов проходят (3 прогона подряд) |
| Настройка предела: контракт и сохранение определения                                      | `vitest packages tests/integration/rules-management.test.ts`              | проходят                             |
| Форма настроек и сообщение о пределе                                                      | `node tests/browser/rules-admin.mjs`, `node tests/browser/open-tasks.mjs` | 5 и 6 сценариев проходят             |
| Перенос на 320/360/390 px                                                                 | `node scripts/verify-workspace-reflow.mjs`                                | `{"scenarios":150,"failures":0}`     |

Не проверено: доставка `task.claimed` в Telegram (в тестах проверены запись в очередь и фиксированный текст), Android и iOS Telegram, Production, миграции 000043 и 000044 на Production (только по слову владельца).
