# Контейнер worker для размещения (ADR-0032) — проверки

Основание: `IMPLEMENTATION_PLAN.md` § 3, § 8, § 11 (F06, F08); ADR-0001, ADR-0020, ADR-0032; чек-лист R1 § 4 «Разместить worker».

## Что изменено (подтверждено файлами)

- `apps/worker/Dockerfile`, `.dockerignore`: сборка Bun 1.4.2 по `bun.lock`, runtime `node:24.21.0-bookworm-slim`, пользователь `node`, Node — PID 1.
- `ops/railway/notifications.json`, `ops/railway/expiry.json`: два сервиса, restart при сбое (5), draining 25 с, одна реплика в ЕС.
- `docs/operations/synthetic-workers.md` (раздел Railway), ADR-0032, индекс ADR.

## Проверено командами 10.10.2026 (локально, Linux, Docker 29.8.2)

- `docker build -f apps/worker/Dockerfile .` — успех. В песочнице исполнителя TLS-прокси требовал добавить его CA в стадии Bun; для этого собиралась копия Dockerfile с двумя добавленными строками только в стадиях сборки, финальный слой идентичен. Образ 331 MB; `node_modules` содержит только `pg` и его 13 зависимостей; `node --version` → `v24.21.0`; `id` → `uid=1000(node)`.
- Без флага: `--watch` → `{"mode":"simulation","status":"disabled"}`, exit 0.
- Флаг включён, URL не задан: `--expire-watch` → `WORKER_UNAVAILABLE`, exit 1. Удалённый хост без `SUPABASE_CA_CERT_B64`: `--watch` → `WORKER_UNAVAILABLE`, exit 1. Секреты и URL в вывод не попали.
- PostgreSQL 17.6 (`postgres:17.6`), `bun run db:migrate` (000001–000039), затем локально `ALTER ROLE … LOGIN PASSWORD` для обеих ролей worker:
  - `--watch` под `impuls_worker` и `--expire-watch` под `impuls_expiry_worker` (интервал 1000 мс): `watching`, затем `alive`.
  - `docker stop -t 25` (SIGTERM главному процессу): оба вывели `stopped`, exit 0.
  - `--watch` под `impuls_expiry_worker` → `WORKER_UNAVAILABLE`, exit 1 (проверка `current_user`).
  - `--expire-status` → `status: observed`, нулевые счётчики, exit 0.
- `bun run check` — exit 0: format, lint, typecheck, `test:unit` (33 файла и 178 тестов прошли, 55 файлов и 448 тестов пропущены без `TEST_DATABASE_URL`), сборка app и worker. Локально Node v22.22.0, а не 24.21.0 из `engines`; CI использует целевую версию.

## Не проверено

- Сборка и запуск на Railway, применение `ops/railway/*.json`, регион, перезапуски и draining на площадке.
- Соединение через Supabase session pooler под ролями worker; на Production роли пока `NOLOGIN` (`2026-10-08-production-app-release.md`). Чтение атрибутов ролей Production в этой работе не выполнялось.
- Обработка реальных событий в контейнере, Bot API с настоящим токеном, получение на Android/iOS.
- Решения владельца: площадка, регион и условия обработки данных (P-02), бюджет (P-06).
