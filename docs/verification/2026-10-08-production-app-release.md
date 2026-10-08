# Выпуск приложения в Production после миграций 000011–000031 — 08.10.2026

Основание: запрос владельца; продолжение `2026-10-08-production-migrations-11-31.md`. Только синтетические данные; P-01…P-06 не утверждены.

## Что сделано (проверено командами)

- Перед выпуском локально: `prettier --check`, `eslint`, `tsc --noEmit` (4 пакета) без замечаний; `vitest run` без `TEST_DATABASE_URL` — 124 passed, 382 skipped (интеграционные не исполнялись); `bun run build` (приложение и worker) успешно.
- `git fetch` → `18 0`; `git push origin main` (`ab311ad..eb8f591`, 18 коммитов) по подтверждению владельца.
- GitHub-интеграция Vercel выпустила Production `impuls-4xckatb1a` (`bunx vercel@latest list`): Ready, сборка 53 с. `vercel logs --level error` — записей нет. MCP Vercel вернул 403 по scope, использована CLI.

## Дымовые проверки без сессии

- `POST /api/v1/auth/telegram` с неверным `initData`: 401 `AUTH_INVALID` (БД и проверка подписи работают).
- `GET /api/v1/{me,tasks,rewards,leaderboard,me/permissions,redemptions/review,admin/access,admin/audit,admin/notifications,admin/rewards}` без сессии: 401. `GET /`: 200.

## Проверено владельцем

- Вход через Telegram на новом деплое выполнен (сообщение владельца). Платформа, возврат, safe areas, клавиатура, тема и сетевая ошибка не проверялись и не фиксировались.

## Не проверено / открыто

- Результат GitHub Actions `check` (PostgreSQL 17.6, restore, Playwright) по этому push: репозиторий приватный, статус без авторизации недоступен. Проверить во вкладке Actions.
- Сценарии с сессией на новой схеме Production (задачи, резервы, админка): не выполнялись; новый код проверялся только на локальной PG 18.6.
- `bun run db:migrate` на Supabase падает на 000027/000028 (`ALTER … OWNER`, см. миграционный отчёт) — CI использует обычный PostgreSQL, где это работает.
- Worker не размещён: симуляция уведомлений и автоистечение резервов в Production не работают. Роли worker — NOLOGIN, вход не настроен.
- Защита от приостановки бесплатного проекта Supabase не настроена.
- Откат приложения: `vercel rollback` на `impuls-m6ji0ftfa`; схему он не откатывает.
- Android/iOS, Bot API, security scan, P-01…P-06, приёмка R1 открыты.
