# F03: история отчётов и решений — 30.09.2026

Локальный срез по IMPLEMENTATION_PLAN.md §§ 7, 11–12. Контракт до реализации: `../implementation/2026-09-30-f03-report-history-slice.md`. Синтетические данные; P-01…P-06 остаются открытыми.

## Подтверждено кодом

- `packages/domain/src/tasks/history.ts`: чтение всех попыток отчёта и review в одном PostgreSQL statement. Допуск, hash действующей сессии, отзыв и собственное назначение проверяются вместе с данными страницы. Чужая/несуществующая/draft-задача скрыта; автор/причина/время и снимки XP/баллов читаются из существующих таблиц, не вычисляются клиентом. Проверяющий здесь не получает право читать чужую историю по одному праву review.
- `packages/contracts/src/task-history.ts`: строгий query без userId, limit 1–50, канонический целочисленный cursor 1–2147483647. Порядок — attempt_number DESC, не дата/UUID. Cursor эксклюзивный; новая попытка появляется при обновлении, не дублирует старую страницу. Каждая страница имеет свой snapshot/asOf; последовательность страниц не обещает замороженный snapshot всей истории. Имена проверяющих читаются текущие; отдельного снимка имени на момент решения в схеме нет.
- `apps/app/src/app/api/v1/tasks/[id]/history/route.ts`: GET, Node runtime, async params, без SQL в адаптере, повторная серверная авторизация. 401 — отсутствующая/истёкшая сессия; 403 — отозванная сессия/допуск; 404 — недоступный объект; повторные и неизвестные query-параметры — 400. Ответы private/no-store и request ID.
- `apps/app/src/features/tasks/task-history.tsx`: раскрытие по требованию, отдельные попытки, основание/автор/время решения, раздельные фонды приёмки, пагинация и обновление. Несданный текст не сбрасывается; `task-report.tsx` инвалидирует историю после успешной мутации. Ошибка обновления сохраняет подтверждённые записи и timestamp; 401/403 закрывают рабочий UI, 404 скрывает старую историю. Нет localStorage, новых зависимостей, миграции или изменений архитектуры.

## Проверено командами

Windows, Node 24.21.0, Bun 1.4.2, изолированный PostgreSQL 18.6 / `impuls_f03`, runtime `impuls_app`; фикстуры создаёт/удаляет административное тестовое соединение. В браузере Telegram SDK подменён.

- `& 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' -D .local/f03-pg/data -l .local/f03-pg/server.log -o '-h 127.0.0.1 -p 55432' -w start` — exit 0.
- `bun install --frozen-lockfile` — exit 0, 427 installs / 528 packages проверены, зависимостей этого среза не добавлено.
- `bun run check` — exit 0: формат, lint, TypeScript четырёх workspaces, 35 unit/contract tests, production build Next.js 16.3.6 и сборка placeholder worker. 68 integration tests здесь пропущены без TEST_DATABASE_URL.
- `$env:TEST_DATABASE_URL='postgres://impuls_test@127.0.0.1:55432/impuls_f03'; bun run test:task-slice` — последний полный локальный запуск: 11 файлов / **68 integration tests passed**, embedded HTTPS, smoke задач, 11 submission, 17 return, 19 acceptance/ledger и 26 management browser-сценариев прошли; общий exit 1 из-за старого локатора кнопки нового history browser-test. После исправления выполнен узкий повтор ниже; этот исходный запуск не записан как exit 0.
- С тем же TEST_DATABASE_URL, `node .local/verify-history.mjs` — exit 0: **6 history PostgreSQL/HTTP tests и 15 browser-сценариев**. Временный runner — копия постоянного verify-task-slice, оставляющая только history integration/browser файлы; запускает тот же production server, роль и флаги. Последний повтор уточняет снимки viewport. Постоянный `scripts/verify-task-slice.mjs` включает оба новых тестовых файла в общий путь.
- `bun audit --json` — exit 0, `{}`; это advisory-проверка lockfile, не полный security scan.
- `rg -l 'synthetic-task-slice-csrf-test-only|TELEGRAM_BOT_TOKEN|DATABASE_URL|SUPABASE_CA_CERT_B64|SYNTHETIC_TASK_MANAGEMENT_ENABLED' apps/app/.next/static -g '*.js'` — совпадений нет, ограниченная проверка маркеров.
- `git diff --check` — exit 0, предупреждение о нормализации CRLF/LF в существующем .env.example.

Интеграционные фикстуры независимо задают одинаковое время трёх попыток: ожидается 3/2/1, причины первой и второй попытки, снимок приёмки **19 XP / 7 баллов**. Проверяются пустая история, чужой пользователь/проверяющий, draft, неправильный session hash, отзыв и expiry, новая попытка между страницами. HTTP проверяет no-store, request ID, cursor, дубли query, отказ без данных/версии. Настоящий browser→API→PostgreSQL показывает три seeded попытки и удаляет историю с экрана после отзыва допуска; это проверка чтения, не новая проверка начисления.

## UI и доступность

15 сценариев: 320/360/390/1280 px, Enter/Space, reduced motion, disclosure без раннего запроса, loading, empty, 503/retry, network/retry с подтверждёнными данными, сбой следующей страницы, 401/403/404, обновление с сохранённым черновиком и инвалидирование после сдачи. Stress на 320 px задаёт 20 px CSS-текст и длинные неразрывные отчёт/причину/псевдоним. Проверены отсутствие горизонтального overflow, pageerror и localStorage; это не системное масштабирование устройства.

Снимки: `assets/f03-history-{320,360,390,1280}.png`, `assets/f03-history-long-320.png`. Просмотрены rendered 320/390 px и длинный 320 px: плоские разделённые строки, текстовый статус, различимые отчёт и метаданные, золотые отдельные XP/баллы, переносы и видимый фокус. Контраст цветов из runtime tokens на panel: ink 14.11:1, muted 8.28:1, gold 10.01:1. Это расчёт токенов конкретной секции, не аудит всего приложения.

Применены vercel:nextjs (включая локальную установленную документацию route.md), vercel:react-best-practices, frontend-references и Impeccable context/craft-floor/Operate. Механический `impeccable.cmd detect --json apps/app/src/features/tasks/task-history.tsx` вернул `[]`. Существующие композиция и tokens сохранены; внешние визуальные компоненты, motion и зависимости не использовались. Стратегия секции — в surface brief. Предыдущие screenshots других срезов сохранены и восстановлены после общего browser run.

## Сбои и границы

Начальные typecheck выявили generic input в Zod pipe, несуженный result union и node:crypto в contracts test без Node types; исправлены без зависимостей. Один полный интеграционный запуск остановился на ECONNREFUSED локальной БД; после запуска PostgreSQL проверки исполнены. HTTP-тест первоначально ожидал 401 после отзыва сессии, хотя F01 возвращает 403: ожидание и доменный отказ согласованы с F01, expiry остаётся 401. History browser-test первоначально искал прежнее имя кнопки после раскрытия; стабильный локатор исправлен и 15 сценариев повторно прошли.

Не закрыты полная история жизненного цикла, просмотр проверяющим, редактирование/отмена, mutation rate limit, компенсации F04, F05–F08 и критерии R1. Read-only history не имеет пользовательской формы валидации или mutating 409: они здесь не применимы; malformed query проверяется на HTTP. Telegram Android/iOS, настоящие клавиатура/safe areas/масштабирование, p75/p95 и восстановление остаются непроверенными. Внешний выпуск по последующему запросу владельца фиксируется отдельно в `2026-09-30-f03-extended-release.md`; этот локальный отчёт сам по себе не доказывает Supabase/Production или PostgreSQL 17 CI.
