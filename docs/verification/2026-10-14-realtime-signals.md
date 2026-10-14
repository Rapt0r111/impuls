# Проверка: мгновенные сигналы об изменениях (ADR-0038)

Дата: 14.10.2026. Ветка `claude/project-thread-wpmke5` (PR #20). **К Production не применено.**

## Что сделано

- Миграция `db/migrations/000045_realtime_signals.js`: секрет в `impuls.realtime_secret`, `impuls.realtime_topic(uuid)` (доступна рабочей роли), `impuls.realtime_signal`, `impuls.realtime_on_change` и триггеры на `tasks`, `ledger_entries`, `account_balances`, `redemptions`, `reward_versions`.
- Контракт `packages/contracts/src/realtime.ts`, маршрут `apps/app/src/app/api/v1/me/realtime/route.ts` (отвечает `{enabled:false}`, пока нет флага, адреса, ключа или миграции).
- Клиент `apps/app/src/features/realtime/live-signals.ts` и подключение в `task-list.tsx`: при живой подписке опрос раз в минуту заменяется страховочным раз в пять минут.
- Зависимость `@supabase/realtime-js` 2.117.3 (MIT, выпущена 07.10.2026; зависимости `tslib`, `@supabase/phoenix`). `bun audit --prod`: уязвимостей нет. Отдельный фрагмент 57 КБ (16,5 КБ gzip) грузится только при включённой функции.
- ADR-0038, `.env.example`, `docs/operations/feature-flags.md`, абзац в `IMPLEMENTATION_PLAN.md`.

## Проверено командами

- `bun run check` (format, lint, typecheck, unit, build app и worker) — код возврата 0; unit 197 пройдено, 484 пропущено (интеграционные ждут БД).
- Локальный PostgreSQL 16.15 (в CI будет 17.6): все 45 миграций применяются; `tests/integration/realtime-signals.test.ts` — 7 из 7:
  - тема стабильна, различна у участников и не равна хешу их id;
  - без расширения Realtime запись проходит без сигналов;
  - рабочая роль получает тему, но не читает секрет и не вызывает отправку;
  - запись баланса сигналит только владельцу, на публичную тему (`private=false`), без данных;
  - задача сигналит всем активным и никому из неактивных;
  - откат транзакции не оставляет сигналов;
  - сбой `realtime.send` не отменяет запись.
  - Проверка на ошибках: при отключённом триггере `tasks_realtime` тест про задачи падает.
- Полный `vitest run` на PostgreSQL 16 с `TEST_DATABASE_URL`: 623 пройдено, 7 упало. Падения не связаны с изменением: `profile-name` (6) требует коллацию `pg_c_utf8` из PostgreSQL 17, `ledger-corrections` (1) требует запущенный `test:task-slice`. В CI (PostgreSQL 17.6) они идут штатно.
- `tests/browser/realtime-signals.mjs` на собранном приложении (Chromium, поддельный сервер Realtime по протоколу Phoenix v2): 5 сценариев — подключение к теме `realtime:<тема>` с ключом в адресе; новая свободная задача появляется за секунды без перезагрузки; пачка из пяти сигналов даёт одно перечитывание; «выключено», ответ 503 и ответ против контракта не открывают соединение, экран работает.
- `tests/integration/realtime-http.test.ts` против собранного приложения (порт 3106) и PostgreSQL 16 под ролью `impuls_app`: 2 из 2 — без входа 401; участнику приходит его собственная тема из БД, адрес и публикуемый ключ, у другого участника тема другая, `Cache-Control: private, no-store`. В CI тест идёт в `test:task-slice` (в `scripts/verify-task-slice.mjs` добавлены три переменные `REALTIME_*` с тестовыми значениями). Ветка «выключено» и «миграции нет» на сервере отдельным тестом не покрыта (браузерный тест проверяет, что клиент при таком ответе остаётся на опросе).
- Весь набор браузерных тестов на синтетических ответах (без `*-real`, `embedded-access`, `layout-audit`, `access-smoke`, `speed-insights`), `verify-telegram-bridge.mjs` (14 сценариев), `verify-workspace-reflow.mjs` (150 сценариев, 0 ошибок; в фикстуру добавлен `/api/v1/me/realtime`) — прошли на сборке с этим изменением.

## Не проверено

- **Настоящий Supabase Realtime.** Протокол проверен только на поддельном сервере, повторяющем формат кадров библиотеки. Что `realtime.send` доступна роли миграций и что публичные каналы разрешены в настройках проекта, прочитать с Production не удалось (чтение заблокировано режимом безопасности); надо проверить при выкладке.
- Нагрузка и лимиты бесплатного тарифа (одновременные соединения, события в секунду); значения брать из Realtime Settings проекта.
- Telegram на Android и iOS (WebSocket в WebView).
- Реальная задержка от записи до экрана.

## Порядок выкладки (после слов владельца «применяй»)

1. Миграция 000045 на Production.
2. Realtime Settings: разрешить публичные каналы.
3. Переменные Vercel `REALTIME_ENABLED=true`, `REALTIME_URL`, `REALTIME_PUBLISHABLE_KEY`, новый деплой.
4. Проверка на двух устройствах: новая задача появляется у второго без перезагрузки.
   Откат: убрать `REALTIME_ENABLED` — приложение возвращается к опросу.
