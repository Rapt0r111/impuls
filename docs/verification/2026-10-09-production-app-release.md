# Выпуск приложения в Production после миграций 000032–000035 — 09.10.2026

Основание: запрос владельца «Выпускай»; продолжение [записи миграций и выдачи прав](2026-10-09-production-migrations-32-35-owner-grant.md). Только синтетические данные; P-01…P-06 не утверждены окончательно.

## Что сделано (проверено командами)

- Перед выпуском локально: `eslint`, `tsc --noEmit` (4 пакета) без замечаний; `bun run test:unit` — 164 прошли, 438 пропущены (интеграция без БД); `bun run build` (приложение и worker) успешно. `prettier --check` падает только на сгенерированном `apps/app/.impeccable/hook.cache.json` (исключён локально через `.git/info/exclude`, в репозиторий не входит).
- Интеграция на PostgreSQL 18.6 (`127.0.0.1:45432`): 11 файлов (owner-bootstrap, member-management, access-management, profile-name, profile, task-reminders, telegram-delivery, notification-status, notification-simulations, notification-attempts, audit) — 113 прошли, 14 пропущены (HTTP-сценарии без `TEST_APP_ORIGIN`).
- Коммиты `00d50e4`, `8572c42`; `git push origin main` (`69858c1..8572c42`) по запросу владельца. Каталог `tmp/` (логи) не коммитился.
- GitHub-интеграция Vercel выпустила Production `impuls-aap5w2k8x` (`bunx vercel@latest list`): Ready, сборка 26 с, алиас `https://impuls-eta.vercel.app`. `vercel logs --level error --since 10m` — записей нет.

## Дымовые проверки без сессии

- `GET /` 200; `GET /api/v1/{me,admin/access,admin/audit,me/profile}` 401; `POST /api/v1/auth/telegram` с неверным `initData` 401.
- `GET /api/v1/admin/members` 404: у каталога только вложенные маршруты, прямого `GET` нет (по коду, не по ответу сервера).

## Важно: функции выключены

В Production заданы только `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, `CSRF_SECRET`, `APP_ORIGIN` (имена из `vercel env ls production`). Ни один флаг `SYNTHETIC_*_ENABLED`, `TELEGRAM_DELIVERY_ENABLED`, `TASK_REMINDERS_ENABLED` не задан, поэтому выключены профиль, задачи, награды, рейтинг, «Доступ», «Состав» и прочее. Включение флагов — отдельное решение владельца; не выполнялось.

## Не проверено / открыто

- Сценарии с сессией на Production (в том числе вход владельца после выдачи прав и отзыва сессий).
- Результат GitHub Actions `check` по push; репозиторий приватный.
- Worker не размещён; реальная доставка Telegram не включалась.
- Android/iOS, security scan, P-решения, приёмка R1.
- Откат приложения: `vercel rollback` на `impuls-l5tkqn78u`; схему он не откатывает.
