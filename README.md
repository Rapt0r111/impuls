# Импульс

Репозиторий содержит автономный прототип R0 и начатую реализацию Telegram Mini App по `IMPLEMENTATION_PLAN.md`. Архитектурное направление Vercel + Supabase записано в `docs/adr/0001-vercel-supabase.md`. На 28.09.2026 есть каркас R1 и часть F01 (вход и допуск); пилот для реальных участников не утверждён.

## Локальный запуск

Требуются Bun 1.4.2, Node.js 24.21.0 и PostgreSQL 17.6. Скопируйте `.env.example` в `apps/app/.env.local` и задайте секреты только для отдельного тестового контура. `DATABASE_URL` используется приложением, `MIGRATION_DATABASE_URL` — только миграциями. Локально оба URL могут указывать на одну БД; в Supabase приложению нужен transaction pooler, миграциям — прямое соединение.

```text
bun install --frozen-lockfile
bun run db:migrate
bun run dev
```

`APP_ORIGIN` должен точно совпадать с origin приложения. Приложение не создаёт допуск по данным Telegram-профиля: нужна активная запись в `impuls.users`. В Production как минимум одна тестовая запись уже позволила войти через Telegram Web. Пилот, реальные задачи и служебные позиции остаются за решениями P-01…P-06; дальнейшие проверки проводите в отдельном тестовом контуре.

## Vercel и Supabase

В [Vercel Project impuls](https://vercel.com/antons-projects-fd079868/impuls) (Hobby) выбраны Next.js, Root Directory `apps/app`, доступ к файлам вне root и Node.js 24. CLI 60.1.3 связал проект с этой рабочей копией. Production назначен на `main`; текущий деплой [impuls-eta.vercel.app](https://impuls-eta.vercel.app) имеет статус Ready. В Production заданы пять скрытых переменных: `APP_ORIGIN`, `CSRF_SECRET`, `DATABASE_URL`, `SUPABASE_CA_CERT_B64`, `TELEGRAM_BOT_TOKEN`. Git remote `origin` подключён к `github.com/Rapt0r111/impuls`; рабочая ветка отслеживает `origin/main`.

Пользователь подтвердил использование существующего проекта Supabase `Rapt0r111's Project` в организации Codex (Stockholm, `eu-north-1`, PostgreSQL 17.6). Миграции создали закрытые схемы `impuls` и `impuls_meta`; при первоначальной проверке три таблицы приложения были пусты. RLS включён на таблицах `impuls` и журнале миграций. Ограниченная роль `impuls_app` имеет доступ по RLS только к трём таблицам приложения; `anon`, `authenticated`, `service_role` и `impuls_app` не имеют доступа к `impuls_meta.pgmigrations`. Data API остаётся включённым для проекта: экспонируются `public` и `graphql_public`, а `impuls`/`impuls_meta` не выбраны.

SQL-проверка подтвердила права `impuls_app`, закрытый журнал миграций и отсутствие доступа Data API-ролей к таблицам приложения. Через transaction pooler выполнен TLS-запрос ролью `impuls_app` с проверкой Supabase CA; на момент первоначальной проверки таблицы были пусты. Отрицательная REST-проверка с publishable key вернула HTTP 406 `PGRST106`: схема `impuls` не входит в экспонируемые `public`, `graphql_public`. Глобальную настройку Data API общего проекта не меняйте.

В Production запрос `/api/v1/me` с синтетической допустимой по формату, но отсутствующей в БД cookie вернул `401 UNAUTHORIZED`; Vercel Function выполнила запрос к PostgreSQL. Это подтверждает сетевое подключение и чтение через текущую `DATABASE_URL`, но само по себе не подтверждает, что в URL используется ограниченная роль `impuls_app`. После исправления проверки `initData` Telegram Web сначала получил `403 ACCESS_DENIED`, а после добавления тестовой записи — `200` на `POST /api/v1/auth/telegram`; экран показал «Доступ подтверждён». Это проверка одного входа, не всех сценариев F01. Telegram WebView на Android/iOS не проверен. `MIGRATION_DATABASE_URL` не добавляйте в Vercel: миграции выполняются отдельным доверенным шагом через прямое соединение. P-01/P-02 остаются открытыми.

## Подключение Telegram Mini App

В `@BotFather` отправьте `/mybots`, выберите `@NR_PointBOT` и откройте `Bot Settings` → `Configure Mini App` → `Enable Mini App`. Укажите Production URL `https://impuls-eta.vercel.app` и задайте имя «Импульс». Для кнопки в чате отдельно откройте `Bot Settings` → `Menu Button`, задайте подпись «Открыть Импульс» и тот же URL. [Документация Telegram Mini Apps](https://core.telegram.org/bots/webapps) описывает настройку Main Mini App и кнопки меню. Открывайте приложение кнопкой Main Mini App или кнопкой меню бота; обычная ссылка на тот же адрес не передаёт Telegram `initData`.

Приложение отправляет `Telegram.WebApp.initData` серверу для проверки; Telegram Login Widget и команда `/setdomain` для этого потока не используются. После открытия приложение проверяет список допуска и отклоняет аккаунты без активной записи. Ответ бота на `/start` не настроен: текущий сервис содержит запуск Mini App и API входа, но не webhook или обработчик команд. Запуск проверьте в приложении Telegram на Android/iOS; один вход в Telegram Web не заменяет эту проверку.

## Проверки

```text
bun run check
bun run test:integration
bun run demo:test
```

`test:integration` требует `TEST_DATABASE_URL`; без переменной PostgreSQL-сценарии пропускаются. `check` проверяет формат, lint, строгий TypeScript, unit-тесты и сборку. `demo:test` относится только к автономному R0. CI настроен на PostgreSQL 17.6; удалённый результат CI ещё не подтверждён. Локальные результаты и текущую проверку внешних проектов см. в `docs/verification/2026-09-28-vercel-supabase.md`.

Добавлена основа F02: миграция `000004_permissions.js`, чтение действующих прав по действию и точной области, `GET /api/v1/me/permissions` и отображение дополнительных полномочий после входа. Перед использованием нового API в тестовом контуре выполните `bun run db:migrate`. Если миграция ещё не применена, экран входа сохраняет подтверждённый доступ и показывает ошибку загрузки полномочий. Управление назначениями, проверки на реальных объектах и PostgreSQL integration-тесты для F02 ещё не выполнены в этой среде.

Не выполнены полная проверка F01 с синтетической Telegram-авторизацией, pooled-транзакции под конкурентной нагрузкой, Telegram Android/iOS, отдельный worker и завершение F02–F12. F01, F02 и R1 не соответствуют всем критериям приёмки § 12 плана.
