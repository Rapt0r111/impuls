# ADR-0001: Vercel для приложения, Supabase для PostgreSQL

- Статус: принято как техническое направление по явной инструкции пользователя 28.09.2026; использование существующего Supabase-проекта только для тестовой схемы подтверждено отдельно. P-02 о допустимости реальных данных остаётся открытым.
- Дата: 28.09.2026.
- Авторы: проектная команда; выбор платформ — владелец задачи в текущем диалоге.

## Контекст и причина

`IMPLEMENTATION_PLAN.md` § 3 предполагал Caddy, постоянный Node.js-сервер и PostgreSQL 18.6. Пользователь выбрал Vercel и Supabase. Для тестового контура пользователь подтвердил существующий общий проект `Rapt0r111's Project` в организации Codex (ref `enicnfevahcuiqvwmhgp`, регион `eu-north-1`). Фактическая версия PostgreSQL — 17.6. Проект не выделен только под «Импульс», поэтому его общие настройки Data API не меняются.

Исходная реализация имела пул `pg` с `max: 10`, лимитер входа в памяти процесса и таблицы первой миграции в `public`. Это требовало изменить границы таблиц и лимитера для Vercel Functions и Supabase Data API. Источники: [Vercel monorepos](https://vercel.com/docs/monorepos), [Supabase Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase Data API security](https://supabase.com/docs/guides/api/securing-your-api), [Vercel request headers](https://vercel.com/docs/headers/request-headers).

## Решение

- Next.js App Router и `/api/v1` работают на Vercel Functions в Node.js runtime. Bun остаётся менеджером пакетов и исполнителем локальных/CI-скриптов. Vercel Project `impuls` настроен на Next.js, Root Directory `apps/app`, доступ к файлам за root включён, Node.js 24. Caddy, standalone-выпуск и ручное сжатие исключаются.
- Supabase используется как управляемая PostgreSQL. Telegram `initData`, cookie-сессии, права, экономика и транзакции остаются на сервере в `packages/domain` и Route Handlers. Браузер не получает SQL-учётные данные, `service_role` или прямой Data API.
- Data API остаётся включённым для общего проекта; панель показывает экспонируемые схемы `public` и `graphql_public`. Схемы приложения `impuls` и журнала `impuls_meta` не выбраны. Глобальную конфигурацию Data API не менять. В миграции закрыты schema/table/sequence/function privileges для `PUBLIC` и стандартных ролей Data API. SQL-запрос подтвердил отсутствие `USAGE` на `impuls` и `SELECT` на `impuls.users` у `anon`, `authenticated` и `service_role`. Отрицательный REST-запрос с publishable key и `Accept-Profile: impuls` вернул `406 PGRST106`; секретный `service_role` key не использовался.
- Таблицы приложения не используют Supabase Auth и обслуживаются серверным SQL-клиентом. RLS включён на `impuls.users`, `impuls.sessions`, `impuls.auth_rate_limits` и `impuls_meta.pgmigrations`. Ограниченная роль `impuls_app` имеет CRUD-права и отдельную политику на три таблицы приложения; у роли нет доступа к журналу. `anon`, `authenticated` и `service_role` не имеют schema/table/function-доступа к `impuls`.
- Для Vercel runtime выбран Supabase transaction pooler, `DATABASE_URL`, один `pg` client на тёплый экземпляр и TLS с проверкой корневого CA Supabase. Тестовый запрос ролью `impuls_app` к pooler подтвердил PostgreSQL 17.6, проверку TLS и нулевое количество строк. В коде CA передаётся через `SUPABASE_CA_CERT_B64`; параметры SSL из строки подключения удаляются, чтобы `pg` применял явные CA-настройки. Именованные prepared statements не используются. Миграции выполняются отдельным доверенным шагом через прямое соединение `MIGRATION_DATABASE_URL`, до выпуска приложения.
- Журнал `node-pg-migrate` хранится в закрытой схеме `impuls_meta`, а не в `public`. Применены миграции `000001_auth`, `000002_auth_trigger_search_path` и `000003_runtime_role_rls`; пароль `impuls_app` задаётся отдельно для каждого окружения и не хранится в репозитории. MCP миграционный журнал Supabase содержит `impuls_auth_schema`, `impuls_auth_trigger_search_path` и `impuls_runtime_role_rls`; последующие миграции приложения ведутся файлами репозитория и `impuls_meta.pgmigrations`.
- Лимит входа хранится в PostgreSQL и действует между экземплярами функций. IP берётся только из заголовка, установленного Vercel; в БД записывается HMAC ключа, а не IP. Ошибка БД возвращает 503, превышение — 429.
- Worker для F08 и последующих фоновых операций размещается отдельно от Vercel Functions либо заменяется на проверяемый механизм по отдельному ADR. До этого F08 недоступна. Резервное копирование и тест восстановления согласуются по P-02/P-06.
- Локальная и CI версия PostgreSQL — 17.6, совпадает с проверенной базой. Это версия только технического тестового контура.

## Последствия

Контракт API, Telegram-вход, доменные границы и инварианты F01–F12 сохраняются. Общий Supabase-проект требует изоляции в собственных закрытых схемах и запрета доступа Data API; таблицы `impuls` пока пусты. Существующий проект имеет другие схемы, поэтому его Data API, секреты и другие ресурсы «Импульса» не меняют.

Пул процесса не хранит авторизацию, лимиты или результаты начислений. Требуется проверить Preview Deployment, HTTP-контракты, pooled-транзакции и одновременные запросы, общий лимит входа, заголовки, холодный старт и время ответа. Vercel Preview содержит чувствительные `DATABASE_URL`, `CSRF_SECRET` и `SUPABASE_CA_CERT_B64`; Production-переменные не добавлены. P-02 запрещает считать этот тестовый контур допустимым для реальных участников автоматически.

## Миграция и откат

1. Изменить код, конфигурацию и документацию; применять только синтетические данные.
2. В выбранный Supabase-проект применены три миграции; созданы `impuls.users`, `impuls.sessions`, `impuls.auth_rate_limits` и изолированный журнал миграций. Таблицы приложения пусты; роль `impuls_app` и политики RLS включены.
3. Vercel Project `impuls` настроен и локально связан через CLI 60.1.3. Первый CLI deploy стал Production по поведению Vercel для первого деплоя; владелец попросил его оставить. Созданы защищённые Preview. В Preview заданы `DATABASE_URL`, `CSRF_SECRET`, `SUPABASE_CA_CERT_B64`; Production-переменные не заданы. Git remote репозитория не подключён.
4. Последний Preview Function `https://impuls-ihamtttcn-antons-projects-fd079868.vercel.app` проверен запросом `/api/v1/me` с синтетическим токеном допустимого формата, отсутствующим в таблицах: ответ 401 подтверждает успешный запрос к БД. После выбора стабильного URL настроить `APP_ORIGIN`. `TELEGRAM_BOT_TOKEN` добавлять только после выбора/создания бота. `MIGRATION_DATABASE_URL` не добавлять в Vercel.
5. Проверить F01 на test preview, включая 401/403/429, отзыв, гонки и отрицательный доступ к Data API. Реальные данные запрещены до решения P-02.

До использования других таблиц можно удалить схему `impuls` согласованной down migration, но потребуется также отдельно удалить журнал `impuls_meta`. Это общий проект, поэтому сначала следует проверить владельца и содержимое схем. После появления тестовых или реальных данных откат БД требует совместимой миграции или проверенного восстановления; автоматический откат не предполагается.

## Проверки

Локальные `bun run check` и браузерный smoke test прошли ранее (результаты в `docs/verification/2026-09-28-vercel-supabase.md`). Через Supabase MCP проверены PostgreSQL 17.6, три записи в миграционном журнале, три пустые таблицы, RLS, политики и права ролей. Прямой запрос через transaction pooler с Supabase CA прошёл под `impuls_app`. Vercel Preview build прошёл; актуальный `/api/v1/me` вернул 401 для несуществующей сессии после запроса к БД, `/api/v1/auth/telegram` вернул ожидаемый 503 без BotFather-токена. Production остался защищённым и без Production-переменных. Конкуренция и WebView Android/iOS требуют дальнейшей проверки.
