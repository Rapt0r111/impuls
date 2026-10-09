# Проверка: снятие ярлыка «синтетика» (ADR-0029, этап 1) — 09.10.2026

Основание: запрос владельца в сессии 09.10.2026. Схема БД не менялась; Production-схема остаётся на 000035.

## Проверено командами (PostgreSQL 18.6, `127.0.0.1:45432`, `PG_BIN=C:/Program Files/PostgreSQL/18/bin`)

| Команда                                                                           | Результат                                                                                                |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `eslint`, `tsc --noEmit` (4 пакета), `prettier --check` (кроме `hook.cache.json`) | без замечаний                                                                                            |
| `bun run test:unit`                                                               | 164 прошли, 438 пропущены (интеграция без БД)                                                            |
| `bun run build`                                                                   | успешно (приложение и worker)                                                                            |
| `node scripts/verify-task-slice.mjs` (общий набор)                                | выход 0, в том числе `task-management.mjs` (30 сценариев), который 09.10 ранее падал на `localhost:3100` |
| `--access-management-only`, `--rewards-only`, `--profile-only`                    | выход 0                                                                                                  |
| `--audit-only`                                                                    | 13 тестов, 28 browser-сценариев, выход 0                                                                 |
| `--admin-catalog-only`                                                            | 59 тестов, выход 0                                                                                       |
| `--notification-status-only`                                                      | 21 тест, выход 0                                                                                         |
| `--corrections-only`                                                              | 21 тест, 18 browser-сценариев, выход 0                                                                   |
| `--ranking-only`                                                                  | 8 тестов, 14 browser-сценариев, выход 0                                                                  |
| `bun run test:telegram`                                                           | 14 сценариев прошли                                                                                      |
| `bun run test:reflow`                                                             | 150 сценариев, 0 отказов                                                                                 |
| `bun run test:access`, `bun run test:notifications`                               | 19 и 40 тестов прошли (3 и 1 пропущены — HTTP без сервера)                                               |

Первый запуск цепочки срезов был прерван во время `--audit-only`; пять оставшихся срезов перезапущены с нуля, результаты в таблице — из повторного запуска.

## Что изменено

Флаги без префикса `SYNTHETIC_` (таблица — [feature-flags.md](../operations/feature-flags.md)); тексты интерфейса; тексты новых записей журнала («Создание задачи», «Назначение задачи», «Резерв по заявке»); `.env.example`; сообщение об отказе начисления. Тест `task-management.mjs` ищет новую оговорку о тестовых значениях правил версии 1.

## Не проверено / открыто

- Этап 2 (схема БД, литерал `mode: "synthetic"` в контрактах, защита `economy.ts`) не выполнен; на Production у новых записей будет `mode='synthetic'`.
- Тексты, зашитые в 000027 и контракты («Автоматическое истечение синтетического резерва»), не менялись.
- Android/iOS, Linux/PostgreSQL 17.6 CI, P-02/P-04/P-06 открыты.

## Выпуск в Production (09.10.2026)

- В Vercel Production добавлены 16 флагов со значением `true` (`vercel env add`, имена из `vercel env ls production`): `ACCESS_MANAGEMENT`, `MEMBER_MANAGEMENT`, `AUDIT`, `PROFILE`, `TASK_MANAGEMENT`, `ECONOMY`, `LEDGER_CORRECTIONS`, `REWARDS`, `ADMIN_CATALOG`, `CATALOG_CREATION`, `CATALOG_PUBLICATION`, `CATALOG_SCHEDULING`, `CATALOG_CANCELLATION`, `QUOTA_PUBLICATION`, `NOTIFICATION_STATUS`, `RANKING` (все с суффиксом `_ENABLED`) — по запросу владельца, включая рейтинг (P-05 по показу рейтинга реальным участникам не решён). Флаги worker на Vercel не задавались: приложение их не читает.
- Коммит `ef25129`, `git push origin main` (`92e3ff1..ef25129`); GitHub-интеграция выпустила Production `impuls-1v6srtuaw`: Ready, 33 с, алиас `https://impuls-eta.vercel.app`. Сборка идёт после добавления переменных.
- Дымовые проверки без сессии: `GET /` 200; `GET /api/v1/{me,me/profile,leaderboard,tasks,rewards,admin/access,admin/audit,admin/notifications,admin/rewards,task-management/options}` 401; `POST /api/v1/auth/telegram` с неверным `initData` 401. `vercel logs --level error --since 15m` — записей нет.
- Не проверено: что флаги реально открывают экраны (для этого нужна сессия владельца; вход после выдачи прав не проверялся), Android/iOS, работа админ-экранов на Production.
- Откат приложения: `vercel rollback` на `impuls-hk3p1xrhu` (код с прежними именами флагов; переменные с новыми именами при этом перестанут читаться).
