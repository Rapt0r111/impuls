# R1: проверка локального восстановления PostgreSQL

Дата: 05.10.2026. Основание: IMPLEMENTATION_PLAN.md §§ 8, 10, 12; [контракт до реализации](../implementation/2026-10-05-database-restore-slice.md). Это локальное синтетическое свидетельство эксплуатационного критерия, не полная приёмка F01–F08/R1.

## Подтверждено кодом

- `scripts/verify-database-restore.mjs`, `scripts/database-restore-safety.mjs`, `package.json`: `bun run test:restore` требует явно выбранный loopback TEST_DATABASE_URL без options; не загружает .env.local. Бинарные аргументы не содержат URL/пароля, libpq получает минимальное окружение; raw ошибки утилит заменены нейтральным сообщением. PG_BIN либо PATH задаёт существующий клиент, зависимости не добавлены.
- `tests/integration/database-restore.test.ts`: две пустые БД с UUID-именами, всё содержимое созданной source через custom pg_dump, восстановление только в созданную target через single-transaction/exit-on-error/no-owner с сохранёнными ACL. До действий сравниваются digest/count всех 27 прикладных/migration таблиц, sequence values/is_called, columns/defaults, RLS, constraints/indexes, functions, triggers, policies, schema/table/column/function ACL. NULL ACL разворачивается через acldefault: явные default права и неявные эквивалентны; реальные лишние права отрицательный контроль замечает.
- Все 23 миграции проходят реальный node-pg-migrate и сохраняются в impuls_meta; повтор runner на target не находит pending migrations. Только временная копия 000003 пропускает повторное создание общей impuls_app, остальные SQL/ACL оригинальны. Обе runtime роли проверены как NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOBYPASSRLS; роли не изменяются.
- Синтетические приёмка/резерв выполнены под impuls_app. Независимый результат после restore: XP=17, available=60, reserved=30; quota=1/reserved=1/used=0. Повтор исходного тела/ключа возвращает сохранённый response/status без изменения любого table digest; изменённое тело конфликтует. Новый участник не занимает последнее место. История неизменяема; worker не читает имена пользователей и не удаляет receipts.
- Завершённый receipt не повторяется; восстановленный действующий lease не захватывается. Искусственное истечение только disposable lease даёт новый token/attempt; старый token lost, новый simulated. Журнал продолжает started → lease_expired → started → simulated; исходный outbox остаётся pending. Отзыв пользователя отзывает восстановленную сессию и запрещает повторы. Source snapshot остаётся исходным.
- Negative control внутри откатываемой транзакции меняет один балл, добавляет worker SELECT users и отключает ledger trigger: сравнение обнаруживает все три нарушения; rollback возвращает baseline.
- Cleanup закрывает пулы, удаляет только имена созданных текущим запуском source/target, проверяет абсолютный временный каталог перед recursive rm. Ошибка cleanup проваливает suite; архив с синтетическими session hashes не сохраняется.
- `.github/workflows/check.yml`: отдельная установка клиента PostgreSQL 17 через официальный PGDG helper и `bun run test:restore` против service PostgreSQL 17.6. Версия по умолчанию Ubuntu runner — 16, поэтому она не используется для dump сервера 17. Удалённый CI этим заданием не запускался и не подтверждён.

## Проверено командой

Клиенты `pg_dump --version` и `pg_restore --version`: PostgreSQL 18.6. В успешном прогоне сервер сообщает 18.6, 23 migrations, 27 tables.

Локальный PostgreSQL запускался скрытым процессом в одном разрешённом PowerShell вызове с тестом и штатной остановкой:

```powershell
$taskRestoreServer = Start-Process -FilePath 'C:/Program Files/PostgreSQL/18/bin/postgres.exe' -ArgumentList @('-D','.local/f03-pg/data','-h','127.0.0.1','-p','55432') -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -RedirectStandardOutput '.local/restore-pg.stdout.log' -RedirectStandardError '.local/restore-pg.stderr.log' -PassThru
try {
  Start-Sleep -Seconds 2
  if ($taskRestoreServer.HasExited) { Get-Content .local/restore-pg.stderr.log; throw 'Local restore test server did not start' }
  $env:TEST_DATABASE_URL='postgres://impuls_test@127.0.0.1:55432/impuls_f03'
  $env:PG_BIN='C:/Program Files/PostgreSQL/18/bin'
  bun run test:restore
  $taskRestoreExit = $LASTEXITCODE
} finally {
  if (-not $taskRestoreServer.HasExited) { & 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' -D .local/f03-pg/data -m fast -w stop }
}
exit $taskRestoreExit
```

Окончательный прогон: exit 0, **7 passed**, 3,84 с Vitest; сервер остановлен (`server stopped`). Это длительность малого синтетического suite, не RTO production.

`bunx vitest run tests/database-restore-safety.test.ts`: exit 0, **4 passed**. Отрицательные connections/names не доходят до PostgreSQL, credentials остаются в libpq environment.

`bunx eslint scripts/database-restore-safety.mjs scripts/verify-database-restore.mjs tests/database-restore-safety.test.ts tests/integration/database-restore.test.ts`: exit 0. `bun run typecheck`: exit 0 во всех четырёх workspaces.

Окончательные `bun run lint`, `bun run format:check` — exit 0. `bunx tsc --noEmit --allowJs --moduleResolution bundler --module esnext --target es2022 --esModuleInterop --strict --skipLibCheck tests/database-restore-safety.test.ts tests/integration/database-restore.test.ts` — exit 0: новые tests/helpers дополнительно проверены строгим TypeScript. `bun run build` с разрешённым доступом — exit 0, Next.js и Node worker собраны. `node scripts/verify-system-report.mjs` — PASS, 72 criteria/12 functions/38 points; историческая рубрика отчёта не менялась.

`git diff --check` обнаружил прежние trailing whitespace в `outputs/impuls-presentation.html` и `work/presentation.html`; эти автономные R0 файлы в этом срезе не редактировались. `git diff --check -- package.json .github/workflows/check.yml IMPLEMENTATION_PLAN.md PRODUCT.md README.md docs/implementation/2026-09-29-r1-next-steps.md` — exit 0. Окончательный `bunx prettier --check .github/workflows/check.yml docs/verification/2026-10-05-database-restore.md` — exit 0.

Общий unit прогон с явно пустым TEST_DATABASE_URL и доступным workspace TEMP/TMP:

```powershell
$taskUnitTmp = Join-Path (Get-Location).Path '.local/restore-vitest-tmp'
New-Item -ItemType Directory -Path $taskUnitTmp -Force | Out-Null
$env:TEMP = $taskUnitTmp
$env:TMP = $taskUnitTmp
$env:TEST_DATABASE_URL = ''
bun run test:unit --maxWorkers=2
```

Exit 0: **102 passed, 303 skipped**, 25 suites passed/40 skipped. Пропущенные integration suites не считаются успешно проверенными.

## Первые сбои и исправления

- Раздельный sandbox запуск получил EACCES, затем ETIMEDOUT на loopback; все 6 тогдашних тестов skipped вследствие beforeAll failure. Проверка реально исполнилась после запуска hidden PostgreSQL и теста в одном разрешённом процессе; automatic approval review действий не отклонял.
- Первый рабочий fixture создал сессии до выдачи role binding; штатный revoke trigger сделал acceptance unauthorized. Исправлен только fixture: сессии после полномочий; auth logic сохраняется.
- Первое restore comparison выявило явный owner-only ACL против NULL default ACL и ошибочное ожидание replay status=200. Нормализация учитывает эффективные default права, ожидается сохранённый исходный status; отрицательный контроль не допускает сокрытия лишнего grant. Итоговые 7 tests passed.
- Первый общий `bun run test:unit` в sandbox: 44 suites failed из-за ENOENT временных SSR-файлов Vitest, 37 tests passed/69 skipped; проверки не объявлены прошедшими. Повтор с доступным workspace TEMP/TMP и двумя workers прошёл, как указано выше.
- Первый `bun run format:check` выявил форматирование существующего `docs/verification/2026-10-05-system-progress-report.md`; исправлен только формат Markdown, содержание сохраняется. Окончательный общий format:check прошёл.
- Первый `bun run build` в sandbox — exit 1, SWC не мог canonicalize app directory (Windows access denied). Тот же build с разрешённым доступом прошёл; Next.js/worker код для этого не менялся.

## Неизвестное и решения владельца

Прочитан `supabase:supabase`. [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html), [acldefault](https://www.postgresql.org/docs/17/functions-info.html) и [Supabase backups](https://supabase.com/docs/guides/platform/backups) сверены с первичными документами. Changelog markdown tool отклонил как unsupported content type; Supabase API здесь не менялся. Новых миграций/зависимостей/архитектурных решений нет, ADR не требуется; DESIGN.md/UI согласованы с отсутствием визуальных изменений.

Подготовка CI сверена с [PostgreSQL Ubuntu installation](https://www.postgresql.org/download/linux/ubuntu/), кодом [PGDG helper](https://raw.githubusercontent.com/credativ/postgresql-common/master/pgdg/apt.postgresql.org.sh) и [составом Ubuntu runner](https://raw.githubusercontent.com/actions/runner-images/main/images/ubuntu/Ubuntu2404-Readme.md). Это проверка конфигурации по источникам, не исполнение CI.

Не проверены новый Supabase project restore, перенос global roles/login/password/CA, PITR, Storage/Auth, боевой объём/нагрузка, daily backup scheduling/retention/encryption, производственные RPO/RTO, оператор/hosting/supervisor, PostgreSQL 17.6 CI и устройства Telegram. P-02/P-06 задают контур копий и ответственную процедуру; P-01…P-06 и полная приёмка R1 остаются открытыми. Catalog publication, автоматическое истечение F06 и Bot API сохраняются в незавершённом объёме плана. Внешний выпуск не выполнялся.
