# F08: доставка через Telegram Bot API — проверки (09.10.2026)

Основание: IMPLEMENTATION_PLAN.md §§ 8, 11 (F08), 12; ADR-0025; контракт `../implementation/2026-10-09-f08-telegram-delivery-slice.md`.

## Что изменено (подтверждено файлами)

- `db/migrations/000032_telegram_delivery.js`: состояние `delivered`, коды `rate_limited` и `recipient_unreachable`, обновлённые guard и триггер журнала, функция `lock_notification_recipient_chat` (EXECUTE только у `impuls_worker`).
- `packages/domain/src/notifications/simulation.ts`: режим `delivery`, классы `NotificationTransportError` и `NotificationTransportFatal`, учёт `retry_after`.
- `apps/worker/src/telegram.ts`, `apps/worker/src/index.ts`: адаптер Bot API и второй флаг `TELEGRAM_DELIVERY_ENABLED`.
- Читатели и контракты (`status.ts`, `notification-status.ts`, `notification-attempts.ts`), подписи UI (`notification-format.ts`, `notification-attempts.tsx`).

## Проверено командами (PostgreSQL 18.6, `127.0.0.1:45432`, миграции 000001–000032)

| Команда                                                      | Результат                                                                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run typecheck`                                          | без ошибок                                                                                                                                           |
| `bun run lint`                                               | без замечаний                                                                                                                                        |
| `npx prettier --check apps packages db docs tests scripts`   | замечание только к сгенерированному `apps/app/.impeccable/hook.cache.json`                                                                           |
| `TEST_DATABASE_URL="" npx vitest run` (без БД)               | 33 файла, 139 тестов прошли; интеграционные пропущены                                                                                                |
| `npx vitest run tests/integration/telegram-delivery.test.ts` | 17 сценариев (в т.ч. сводка и попытки, собранный worker против HTTP-двойника)                                                                        |
| `node scripts/verify-task-slice.mjs`                         | код 0; Vitest 48 файлов, 395 прошли, 4 пропущены; все браузерные наборы прошли (notification-status 49, reward-decisions 30, audit 28, home 5 и др.) |
| `bun run test:reflow`                                        | 150 сценариев, 0 сбоев                                                                                                                               |
| `bun run test:restore`                                       | 9 тестов прошли                                                                                                                                      |
| `bun run test:worker-ops`                                    | 19 прошли, 3 пропущены                                                                                                                               |
| `bun run test:notifications`                                 | 40 прошли, 1 пропущен                                                                                                                                |

Пошаговая история: первый полный прогон упал в `notification-status.test.ts` (ожидаемые объекты без новых ключей) — исправлено; второй — из-за устаревшей сборки приложения для HTTP-проверки (пересобрано) и фикстур браузерных тестов со строгой схемой — исправлено; третий — единичный сбой `catalog-publication.test.ts` (гонка резервирования), не воспроизведённый при трёх отдельных запусках файла (16 прошли, 2 пропущены) и в четвёртом полном прогоне. Причина нестабильности не исследовалась.

## Ранее падавший `test:telegram` (исправлено)

- Симптом: `bun run test:telegram` падал по таймауту ожидания заголовка «Доступ подтверждён» (`tests/browser/telegram-bridge.mjs`); воспроизведено на чистом HEAD (`git stash`, пересборка), то есть срез F08 ни при чём.
- Причина (по скриншоту и тексту страницы): экран «Главная» с коммита `fe8beea` запрашивает `/api/v1/leaderboard?limit=1`, а замыкающий мок теста отвечал на неизвестные пути `403 ACCESS_REVOKED`; приложение по `apps/app/src/features/home/home.tsx` верно трактует 403 как потерю доступа (сервер отдаёт 403 только при отозванном доступе, 404 — при выключенном рейтинге: `apps/app/src/app/api/v1/leaderboard/route.ts`). Дефект фикстуры теста, не приложения.
- Правка: `tests/browser/telegram-bridge.mjs` передаёт этот путь запасному `mockHomeFallback` через `route.fallback()`.
- Результат: `bun run test:telegram` — 14 сценариев прошли (SDK и HTTP смоделированы, физические устройства не проверены). `bun run lint` и `prettier --check` чистые, кроме сгенерированного `hook.cache.json`.

## Не проверено

- Реальный Bot API и токен; получение сообщения на Android/iOS; лимиты Telegram под нагрузкой; пользователи, не запускавшие бота.
- Hosting и перезапуск worker с токеном; PostgreSQL 17.6 как в CI; удалённый CI; Supabase/Production (миграция 000032 туда не применялась).
- Классификация кодов Bot API не сверялась с первоисточником в этом срезе (ADR-0025).
- P-01…P-06. Статус F08 и R1 этой записью не меняется: нет напоминаний о сроках, админ-просмотра неотправленных за пределами текущих списков не расширено, ручная проверка в Telegram не проведена.
