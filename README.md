# Импульс

Репозиторий содержит автономный прототип R0 и начатую реализацию Telegram Mini App по `IMPLEMENTATION_PLAN.md`. Архитектурное направление Vercel + Supabase записано в `docs/adr/0001-vercel-supabase.md`. На 28.09.2026 есть каркас R1 и часть F01 (вход и допуск); приложение не допущено к реальным участникам.

## Локальный запуск

Требуются Bun 1.4.2, Node.js 24.21.0 и PostgreSQL 17.6. Скопируйте `.env.example` в `apps/app/.env.local` и задайте секреты только для отдельного тестового контура. `DATABASE_URL` используется приложением, `MIGRATION_DATABASE_URL` — только миграциями. Локально оба URL могут указывать на одну БД; в Supabase приложению нужен transaction pooler, миграциям — прямое соединение.

```text
bun install --frozen-lockfile
bun run db:migrate
bun run dev
```

`APP_ORIGIN` должен точно совпадать с origin приложения. В `impuls.users` пока нет записей; приложение не создаёт допуск по данным Telegram-профиля. Реальные данные и служебные позиции запрещены до решений P-01…P-06. Для проверки входа используйте синтетические записи в отдельной БД.

## Vercel и Supabase

В [Vercel Project impuls](https://vercel.com/antons-projects-fd079868/impuls) (Hobby) выбраны Next.js, Root Directory `apps/app`, доступ к файлам вне root и Node.js 24. CLI 60.1.3 связал проект с этой рабочей копией. Первый деплой Vercel назначил Production автоматически; владелец попросил оставить его. Последний защищённый [Preview](https://impuls-ihamtttcn-antons-projects-fd079868.vercel.app) готов и подключается к Supabase. Production-переменные пока не заданы; Git remote у репозитория не настроен.

Пользователь подтвердил использование существующего проекта Supabase `Rapt0r111's Project` в организации Codex (Stockholm, `eu-north-1`, PostgreSQL 17.6). Миграции создали закрытые схемы `impuls` и `impuls_meta`; три таблицы приложения пусты. RLS включён на таблицах `impuls` и журнале миграций. Ограниченная роль `impuls_app` имеет доступ по RLS только к трём таблицам приложения; `anon`, `authenticated`, `service_role` и `impuls_app` не имеют доступа к `impuls_meta.pgmigrations`. Data API остаётся включённым для проекта: экспонируются `public` и `graphql_public`, а `impuls`/`impuls_meta` не выбраны.

SQL-проверка подтвердила права `impuls_app`, закрытый журнал миграций и отсутствие доступа Data API-ролей к таблицам приложения. Через transaction pooler выполнен TLS-запрос ролью `impuls_app` с проверкой Supabase CA; все таблицы остались пустыми. Отрицательная REST-проверка с publishable key вернула HTTP 406 `PGRST106`: схема `impuls` не входит в экспонируемые `public`, `graphql_public`. Глобальную настройку Data API общего проекта не меняйте.

В Vercel Preview заданы как чувствительные переменные `DATABASE_URL`, `CSRF_SECRET` и `SUPABASE_CA_CERT_B64`. На последнем Preview запрос `/api/v1/me` с синтетическим несуществующим токеном вернул `401 UNAUTHORIZED` после чтения БД; это проверило Vercel Function → Supabase pooler. `APP_ORIGIN` не задан, а `TELEGRAM_BOT_TOKEN` не предоставлен; поэтому Telegram-вход остаётся недоступным и `/api/v1/auth/telegram` отвечает 503. `MIGRATION_DATABASE_URL` не добавляйте в Vercel: миграции выполняются отдельным доверенным шагом через прямое соединение. P-02 по реальным данным остаётся открытым.

## Проверки

```text
bun run check
bun run test:integration
bun run demo:test
```

`test:integration` требует `TEST_DATABASE_URL`; без переменной PostgreSQL-сценарии пропускаются. `check` проверяет формат, lint, строгий TypeScript, unit-тесты и сборку. `demo:test` относится только к автономному R0. CI настроен на PostgreSQL 17.6; удалённый результат CI ещё не подтверждён. Локальные результаты и текущую проверку внешних проектов см. в `docs/verification/2026-09-28-vercel-supabase.md`.

Не выполнены полная проверка F01 с синтетической Telegram-авторизацией, pooled-транзакции под конкурентной нагрузкой, Telegram Android/iOS, отдельный worker и функции F02–F12. F01 и R1 не соответствуют всем критериям приёмки § 12 плана.
