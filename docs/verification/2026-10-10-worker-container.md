# Размещение worker (ADR-0032) — проверки

Основание: `IMPLEMENTATION_PLAN.md` § 3, § 8, § 11 (F06, F08); ADR-0001, ADR-0020, ADR-0032; чек-лист R1 § 4 «Разместить worker»; требование владельца 10.10.2026 — бесплатное решение.

## Что изменено (подтверждено файлами)

- `apps/worker/src/edge.ts`, `apps/worker/src/edge.test.ts`: один проход по HTTP-вызову, токен вызова, флаги, проверка роли, нейтральные ответы.
- `supabase/functions/impuls-notifications/index.ts`, `supabase/functions/impuls-expiry/index.ts`: входы Deno.
- `scripts/build-edge-worker.mjs`, `bun run build:edge`: бандл с `npm:pg@8.23.0`; результат в `.gitignore`.
- `ops/supabase/worker-schedule.sql`: pg_cron + pg_net раз в минуту.
- `apps/worker/Dockerfile`, `.dockerignore`: запасной путь — образ Node 24 для VPS.
- `docs/operations/synthetic-workers.md` (раздел Supabase Edge Functions), ADR-0032, индекс ADR, § 1 плана.

## Проверено командами 10.10.2026 (локально, Linux)

- `vitest run apps/worker/src/edge.test.ts` — 3 теста прошли: 405 на GET; 401 без секрета, с неверным, коротким и пустым; `disabled` без URL; 503 `WORKER_UNAVAILABLE` без URL, без CA, с `?sslmode`, с неверным токеном бота, без утечки пароля, хоста и токена в ответе и журнале.
- `bun run build:edge` — бандл 15,8 KB, единственный внешний импорт `npm:pg@8.23.0`.
- PostgreSQL 17.6 (`postgres:17.6`) с `ssl=on` и сертификатом собственного тестового CA на имени `pgtls.test`; `bun run db:migrate` (000001–000039); локально `ALTER ROLE … LOGIN PASSWORD` для обеих ролей. Deno 2.9.6, `deno run --allow-net --allow-env --allow-read --allow-sys`:
  - `impuls-notifications`, CA теста: пустая очередь → `{"mode":"simulation","results":{}}`; после вставки события `task.assigned` → `{"results":{"simulated":1}}`, в `notification_simulations` статус `simulated`, попытка 1; повтор → пусто.
  - без заголовка → 401 `UNAUTHORIZED`.
  - CA Supabase Root 2021 вместо тестового → 503 `WORKER_UNAVAILABLE` (сертификат сервера отвергнут).
  - `impuls-expiry` под `impuls_expiry_worker` → `{"mode":"reservation_expiry","results":{}}`.
- Образ `apps/worker/Dockerfile` (Docker 29.8.2): сборка; Node v24.21.0 под `uid=1000(node)`; в `node_modules` только `pg` и зависимости; на PostgreSQL 17.6 `--watch`/`--expire-watch` → `watching`, `alive`, `docker stop` → `stopped`, exit 0; неверная роль, нет CA, выключенный флаг — ожидаемые отказы. В песочнице для `bun install` в стадиях сборки добавлялся CA прокси исполнителя; финальный слой не менялся.
- `bun run check` — exit 0: format, lint, typecheck, `test:unit` (34 файла и 181 тест прошли, 55 файлов и 448 тестов пропущены без `TEST_DATABASE_URL`), сборка app и worker. Локально Node v22.22.0, а не 24.21.0 из `engines`; CI использует целевую версию.

## Выпуск на Production 10.10.2026 (с разрешения владельца в треде, 15:27 UTC)

- Supabase MCP `deploy_edge_function`: `impuls-notifications` и `impuls-expiry`, версия 1, `ACTIVE`, `verify_jwt=false`; загружены `index.ts` и бандл `bun run build:edge` из коммита `672c82e`.
- `execute_sql`: `create extension pg_cron`, `pg_net`; `cron.schedule` по `ops/supabase/worker-schedule.sql` → задания `impuls-notifications` (1) и `impuls-expiry` (2), `* * * * *`, active.
- Первый запуск 15:30:00 UTC: оба задания `succeeded`; `net._http_response` — обе функции ответили 401 `{"error":"UNAUTHORIZED"}`. Ручной вызов без заголовка — тоже 401. Это ожидаемо: секретов и токена в Vault ещё нет, роли worker пока `rolcanlogin=false`. Значит, функции загружаются в Edge Runtime и расписание вызывает их.
- 17:30 UTC: панель Supabase не принимает имена секретов с префиксом `SUPABASE_`, поэтому CA для функций читается из `WORKER_CA_CERT_B64` (коммит 83e505e); обе функции переопубликованы, версия 8, `verify_jwt=false`. Приложение в Vercel по-прежнему использует `SUPABASE_CA_CERT_B64`.
- Ещё не проверено: проход под ролями worker через pooler (после шагов владельца), реальный Bot API.

## Не проверено

- Полный проход в облаке: подключение через pooler Production под ролями worker и обработка событий. На Production роли пока `NOLOGIN` (`2026-10-08-production-app-release.md`); атрибуты ролей Production в этой работе не читались.
- Реальный Bot API с настоящим токеном, получение на Android/iOS.
- Квота бесплатных вызовов Edge Functions не сверялась с панелью Usage.
