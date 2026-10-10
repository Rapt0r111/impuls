# ADR-0032: бесплатное размещение worker в Supabase Edge Functions по расписанию pg_cron

- Статус: предложено (владелец потребовал бесплатное решение 10.10.2026; выпуск на Production — после его явного разрешения)
- Дата: 10.10.2026
- Авторы и утверждающие: исполнитель задачи; утверждает владелец

## Контекст и причина

ADR-0001 оставил worker F08 вне Vercel Functions. ADR-0020 и [runbook](../operations/synthetic-workers.md) описали два процесса Node.js `--watch`/`--expire-watch` под отдельными ролями БД (`impuls_worker`, `impuls_expiry_worker`) под внешним супервизором, но площадку не выбирали. На 10.10.2026 worker не размещён (`docs/verification/2026-10-08-production-app-release.md`), поэтому в Production не работают уведомления и автоистечение резервов — блокер пилота R1 (чек-лист § 4).

Владелец 10.10.2026 потребовал бесплатное решение. Проверенные варианты:

- **Railway, Render, Fly.io** — постоянный процесс доступен только на платных тарифах. Первая версия этого ADR предлагала Railway; отклонено владельцем.
- **GitHub Actions по расписанию** — репозиторий приватный, бесплатно 2000 минут в месяц, а один прогон `check` уже занимает 14–18 минут и запускается дважды на push (история прогонов 46–55). Минута на каждый вызов worker съела бы квоту; cron GitHub к тому же неточен.
- **Vercel Cron** — на Hobby не чаще раза в сутки.
- **Свой VPS / Oracle Always Free** — бесплатно, но нужна карта и администрирование сервера.
- **Supabase Edge Functions + pg_cron + pg_net** — входят в текущий бесплатный проект Supabase, новых аккаунтов не нужно. Лимиты Free: 150 с wall clock, 2 с CPU на запрос (ожидание I/O не считается), 256 MB.

## Решение

1. **Исполнение по тику.** Вместо постоянного цикла каждую минуту выполняется один ограниченный проход, равный `--once`/`--expire-once`: до 20 шагов, затем выход. Модуль `apps/worker/src/edge.ts` использует те же доменные операции (`@impuls/domain`), `runSimulationLoop`/`runExpiryLoop`, адаптер Telegram и проверку TLS-URL, что и Node-процесс. Пул открывается на запрос (`max: 1`) и закрывается в конце.
2. **Runtime.** Edge Functions исполняются в Deno (Supabase Edge Runtime). Bun собирает бандл (`bun run build:edge`, `scripts/build-edge-worker.mjs`), `pg` остаётся внешним и закрепляется как `npm:pg@8.23.0` по `packages/domain/package.json`. Node-вход `apps/worker/src/index.ts` и Docker-образ `apps/worker/Dockerfile` не удаляются: это проверенный запасной путь для VPS.
3. **Две функции**: `impuls-notifications` (роль `impuls_worker`, `NOTIFICATION_WORKER_DATABASE_URL`) и `impuls-expiry` (роль `impuls_expiry_worker`, `EXPIRY_WORKER_DATABASE_URL`). Роль проверяется через `current_user`, как в Node.
4. **Расписание.** `pg_cron` раз в минуту вызывает обе функции через `pg_net` (`ops/supabase/worker-schedule.sql`). Это не миграция: в локальной БД и CI нет pg_cron, pg_net и Vault.
5. **Аутентификация вызова.** `verify_jwt=false`, вместо JWT — заголовок `Authorization: Bearer <WORKER_TRIGGER_SECRET>` (не короче 32 символов, сравнение за постоянное время). Тот же токен лежит в Vault (`impuls_worker_trigger`), откуда его берёт pg_cron. Без секрета функция отвечает 401 и ничего не делает.
6. **Флаги и ответы** те же, что у Node: `SYNTHETIC_NOTIFICATIONS_ENABLED`, `TELEGRAM_DELIVERY_ENABLED` + `TELEGRAM_BOT_TOKEN`, `TASK_REMINDERS_ENABLED`, `RESERVATION_EXPIRY_ENABLED`. Выключено — 200 `disabled` без обращения к БД. Любая ошибка — 503 `WORKER_UNAVAILABLE` без исключения, URL или токена в ответе и журнале.
7. **БД и TLS.** Supabase session pooler (`:5432`, логин `<роль>.<project-ref>`), проверка сертификата по CA из секрета `WORKER_CA_CERT_B64` (имена секретов Edge Functions не могут начинаться с `SUPABASE_`), без `ssl*` параметров в URL. Пароли ролей задаёт владелец (`ALTER ROLE … LOGIN PASSWORD`), в репозиторий и чат они не попадают.

## Последствия

- Задержка доставки и истечения — до минуты плюс время прохода, вместо 5 с опроса. Лимиты сроков и SLA не утверждены (P-06), для пилота до 10 человек этого достаточно.
- Нет сигналов и drain: проход длится не дольше 20 шагов × 5 с таймаута Telegram, то есть меньше 150 с. Обрыв посреди прохода оставляет lease до 30 с (уведомления) или откатывает транзакцию (истечение), как при сбое Node-процесса.
- **Слабее изоляция секретов**: секреты Edge Functions общие на проект, поэтому обе функции видят оба URL. Кроме того, каждая функция Supabase и так получает `SUPABASE_DB_URL` и сервисный ключ. Наименьшие права сохраняются на уровне кода: каждая функция подключается под своей ролью и проверяет её.
- Ответ Bot API 401/404 в Node завершал процесс. Здесь каждый вызов вернёт 503, и pg_cron будет повторять раз в минуту, сжигая по одной попытке события. Оператор снимает `TELEGRAM_DELIVERY_ENABLED` (runbook).
- Журнал — Edge Function logs в панели Supabase (строки `{"mode","results"}`); heartbeat `alive` не нужен: каждая минута даёт строку или ошибку.
- Около 86 400 вызовов в месяц на обе функции. Бесплатную квоту вызовов сверить в Usage проекта (здесь не проверялась).
- Обработчик данных не меняется: Telegram ID и токен остаются у Supabase (P-02 уже включает Supabase).

## Миграция и откат

Миграций БД нет. Включение — по runbook, раздел «Supabase Edge Functions». Откат: `cron.unschedule` обоих заданий или снятие флагов (ответ `disabled`), затем `ALTER ROLE … NOLOGIN`. Переход на VPS — тот же код через `apps/worker/Dockerfile`.

## Проверки

`docs/verification/2026-10-10-worker-container.md`: unit-тесты `apps/worker/src/edge.test.ts`; бандл под Deno 2.9.6 против PostgreSQL 17.6 с TLS по собственному CA — реальное событие `task.assigned` обработано (`simulated: 1`), повторный вызов пуст, чужой CA → 503, без секрета → 401, истечение под своей ролью. Не проверено: Supabase Edge Runtime в облаке, pooler Production под ролями worker, pg_cron/pg_net на Production, реальный Bot API.
