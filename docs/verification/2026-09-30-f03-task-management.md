# F02/F03: создание и назначение — 30.09.2026

Локальный срез по IMPLEMENTATION_PLAN.md §§ 4–7, F02/F03 § 11 и § 12. Контракт перед реализацией: `../implementation/2026-09-30-f03-task-management-slice.md`. Архитектура, runtime и зависимости не менялись. Работа использует синтетические данные; P-01…P-06 не утверждены.

## Подтверждено кодом

- `db/migrations/000010_task_management.js`: явное синтетическое членство в области, RLS и минимальные гранты; runtime читает/блокирует состав, но не вставляет, не удаляет и не меняет его поля доступа. UPDATE только служебного version нужен для PostgreSQL row locks. Runtime может вставлять задачи и одно назначение; существующие фонды, текст и исполнитель обычным UPDATE не изменяются. Аудит/outbox сохраняют прежние review-события и добавляют отдельный task_id с ограничением ровно одного объекта. Assignment outbox уникален по задаче.
- `packages/domain/src/tasks/manage.ts:196–202`: создание draft по task.create, назначение draft→assigned по отдельному task.assign в точной области, активный участник в явном членстве; права родителя/соседа не наследуются. Право, допуск и сессия проверяются перед сохранённым ответом. Блокировки родительской задачи сериализуют назначения; после ожидания повторяются проверки актуальности прав, сессии и членства. Аудит, outbox, изменение состояния и идемпотентный ответ фиксируются одной транзакцией. Начислений при создании/назначении нет.
- Мутации разрешены только при серверном `SYNTHETIC_TASK_MANAGEMENT_ENABLED=true` и effective rule set `mode=synthetic`. По умолчанию флаг выключен; он не утверждает реальный состав или экономику. Версии правил и членство добавляет только администратор тестовой БД; интерфейс F07 отсутствует. Право создания само по себе не даёт права назначения или приёмки.
- `packages/contracts/src/task-management.ts:42`: строгие запросы, UUID ключи/объекты, expectedVersion при назначении; фонды — целые 0–2147483647, технический предел PostgreSQL, а не тариф. UTC datetime, длины текстов, UUID курсор и лимит 1–50. Сервер отдаёт доступные области/правила/исполнителей; произвольный userId в чтении не принимается.
- HTTP: POST `/tasks`, POST `/tasks/:id/assign`, GET `/task-management`, GET `/task-management/options`. Тонкие Route Handlers проверяют Origin/CSRF/контракты/лимит тела; SQL находится в домене. Ответы private/no-store; 404 в чужой области не раскрывает currentVersion. Флаг определяется только сервером.
- `apps/app/src/features/task-management/task-management.tsx:124`: форма черновика, плоские строки задач, отдельное подтверждение исполнителя, критериев, двух фондов и версий перед назначением. 409/422 сохраняют поля, неопределённый ответ сохраняет неизменные тело/ключ для точного повтора; 401/403 закрывают рабочие данные. Навигация и Telegram closing confirmation защищают введённый текст. Видимость действий не заменяет серверные права.

## Проверено командами

Среда: Windows, Node 24.21.0, Bun 1.4.2, изолированный PostgreSQL 18.6 на 127.0.0.1:55432 / impuls_f03. Интеграционные операции выполняются под impuls_app; административные SQL создают и удаляют синтетические фикстуры. Браузерная подмена Telegram SDK проверяет приложение, а не реальный Telegram launch.

- `& 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' -D .local/f03-pg/data -l .local/f03-pg/server.log -o '-h 127.0.0.1 -p 55432' -w start` — exit 0.
- `$env:MIGRATION_DATABASE_URL='postgres://impuls_test@127.0.0.1:55432/impuls_f03'; bun run db:migrate` — exit 0, применена 000010 поверх существующих 000001–000009.
- `bun install --frozen-lockfile` — exit 0, 427 installs / 528 packages проверены, новых зависимостей нет.
- `bun run check` — итоговый exit 0: формат, ESLint, строгий TypeScript всех workspaces, **33 unit/contract теста**, Next production build и сборка placeholder worker. 62 интеграционных теста здесь пропущены без TEST_DATABASE_URL и отдельно исполнены следующим шагом.
- `$env:TEST_DATABASE_URL='postgres://impuls_test@127.0.0.1:55432/impuls_f03'; bun run test:task-slice` — итоговый exit 0: **10 файлов / 62 PostgreSQL/HTTP интеграционных теста**, embedded HTTPS session, smoke задач, **11** сценариев сдачи, **17** возврата, **19** приёмки/журнала и **26** нового управления. Production Next на localhost:3100 работает под impuls_app и завершается самим скриптом. Предупреждение Node MODULE_TYPELESS_PACKAGE_JSON для session-cookie.ts сохраняется; тесты прошли.
- `bun audit --json` — exit 0, `{}`. Это результат advisory для lockfile, не полноценный security scan.
- `rg -l 'synthetic-task-slice-csrf-test-only|TELEGRAM_BOT_TOKEN|DATABASE_URL|SUPABASE_CA_CERT_B64|SYNTHETIC_TASK_MANAGEMENT_ENABLED' apps/app/.next/static -g '*.js'` — совпадений нет. Ограниченная проверка маркеров.
- `git diff --check` — exit 0, только сообщения Git о нормализации CRLF/LF.
- `bun run format:check` после синхронизации документов — exit 0.
- `& 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' -D .local/f03-pg/data -m fast -w stop` — exit 0; локальная тестовая PostgreSQL остановлена после проверок.

`tests/integration/task-management.test.ts`: отдельные права create-only/assign-only и чужая область, одна задача при конкурентном повторе создания, одно назначение при гонке разных исполнителей, несовпадение тела/ключа, stale version, неактивность и истёкшее/отозванное членство, выключенный флаг, production/future rules. Ошибка UUID на вставке аудита откатывает создание или назначение, outbox и idempotency. Реальные ожидания PostgreSQL наблюдаются через pg_stat_activity; сессия/право/членство, потерявшие действие во время ожидания, не дают записать назначение. Независимые ожидаемые состояния: draft v1 без назначения либо assigned v2 с одним назначением; ноль ledger entries, один assignment outbox, ровно два события create/assign.

`tests/integration/task-management-http.test.ts`: Origin, CSRF, UUID ключ, запрет подмены автора/области, личное чтение назначенной задачи, replay и конфликт, нераскрытие версии чужого объекта, no-store, недопустимые/повторяющиеся query-параметры и исполнитель без членства.

## Сбои и исправления

Первый общий check выявил форматирование новых тестов и существующего незакоммиченного speed-insights test, а также чтение ref при React render. Форматирование исправлено; состояние отображаемого действия перенесено в React state. Старое read-only ACL-ожидание `INSERT=false` обновлено после 000010; теперь отдельно проверяет запрет DELETE и UPDATE фондов/названия.

Embedded HTTPS дважды остановился до загрузки приложения с ERR_CONNECTION_CLOSED, затем таймаутом. Минимальный `.local/tls-probe.mjs` показал: IP работает, виртуальные `.test`-имена не доходят до HTTPS listener; Chromium netlog показал системный proxy при сохранённом --no-proxy-server. Context-level proxy bypass для `.test` исправил соединение; `node .local/verify-embedded.mjs` прошёл предыдущую Lax и текущую partitioned cookie-политику. В постоянном тесте обход ограничен фикстурными доменами; настройки ОС и production-auth не менялись. Временная диагностика удалена из теста.

Первый новый browser run выявил неоднозначные implicit labels для select, а проверка 422 — для textarea после обновления значения. Явные aria-labelledby исправляют доступные имена всех полей. Это проверено повторными сценариями; исходные сбои не объявлены пройденными.

## Проверка схемы и внешние источники

`tests/browser/task-management.mjs` прошёл 26 сценариев: форма/назначение на 320/360/390/1280 px; неизменные тело и ключ после network/503, pending, 409/422 с сохранением полей, 401/403 с закрытием данных, загрузка/ошибка/пустота/пагинация/выключенные действия и unsaved guard. На 390 px создание активируется Enter, назначение — Space; Tab проверяет последовательность полей. Дополнительный 320 px stress принудительно задаёт 20 px текст и длинные неразрывные строки через DOM/CSS фикстуру; это не проверка системного масштабирования устройства. Реальный browser→API→PostgreSQL проверяет два события аудита, один outbox, отсутствие журнала начислений и личное назначение в UI второго пользователя. Telegram SDK подменён; API и сессия этого потока настоящие.

Снимки: `assets/f03-management-{320,360,390,1280}.png` и `assets/f03-management-large-text-320.png`. Основной исполнитель просмотрел rendered 320/390 px: плоские строки, один бирюзовый главный submit, 16 px поля, видимый золотой фокус, читаемый номер выбранных правил и отсутствие горизонтальной прокрутки. Отдельная scoped заметка: `2026-09-30-f03-task-management-ui-review.md`. Ранее существующие captures восстановлены из копии перед запуском; новые management-снимки сохранены отдельно.

Для review применены vercel:nextjs (также установленная документация Next route.ts), vercel:react-best-practices, frontend-references, design-taste-frontend, supabase:supabase и diagnosing-bugs. Простые контракты/формы/фикстуры/синхронизация документов поручены агентам Luna; миграция, доменные блокировки, HTTP и общий review проверены основным исполнителем. UI сохраняет существующую систему; внешние компоненты, motion и зависимости не добавлялись.

Проверены [Supabase Data API security](https://supabase.com/docs/guides/api/securing-your-api) и [changelog PostgreSQL minor upgrade](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes). Grants и RLS проверяются отдельно; новая таблица создаётся в приватной схеме impuls. Экспозиция внешнего Supabase Data API в этой работе не проверялась. Перечисленные в changelog ltree, legacy pgcrypto PGP, btree_gist float и custom selectivity operators в новой миграции не используются. Это review новой схемы, не проверка текущей версии или всего внешнего Supabase-проекта. Markdown changelog прочитан через Invoke-RestMethod; web open markdown вернул Unsupported content-type, HTML docs открылись.

## Выпуск и неизвестное

000008–000010 и новые локальные review/ledger/management изменения **не выпущены в Supabase/Vercel**. Перед выпуском миграции должны предшествовать приложению; нужны фактическая версия выбранного Supabase, CI PostgreSQL 17, ACL/Data API и deployed API. Down 000010 намеренно отказывает при сохранённой management-истории: откатывать приложение без удаления аудита/outbox. Down в этой работе не исполнен.

Не проверены физические Telegram Android/iOS, системный увеличенный шрифт/виртуальная клавиатура/safe areas на устройствах, performance p75/p95, восстановление и доставка уведомлений. Не реализованы полный task history, редактирование/отмена, mutation rate limit, компенсации F04 и следующие F05–F08. P-01…P-06 и критерии F02/F03/R1 остаются открытыми; новый синтетический срез не означает завершения функций или допуска пилота.
