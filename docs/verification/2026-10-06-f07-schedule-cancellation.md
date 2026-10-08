# F07: проверка отмены будущих условий

Дата: 06.10.2026. Основание: IMPLEMENTATION_PLAN.md §§ 5–7, 10–12, F02/F06/F07; [контракт](../implementation/2026-10-06-f07-schedule-cancellation-slice.md), [ADR-0022](../adr/0022-synthetic-schedule-cancellation.md). Это локальный синтетический срез; F07/R1 и решения P-01…P-06 не приняты.

## Подтверждено кодом

- `db/migrations/000030_catalog_cancellations.js`: отдельное действие `admin.catalog.schedule.cancel` без выдачи полномочий; unique FK на опубликованную версию, append-only cancellation, RLS и SELECT/INSERT только runtime. Trigger с фиксированным search_path и отозванным PUBLIC EXECUTE берёт общий identity/quota barrier, проверяет future серверным временем и записывает фактический created_at. UPDATE/DELETE запрещены. Guard публикации допускает пропуски только для сохранённых отменённых промежуточных версий и сохраняет последовательность всех занятых номеров.
- `packages/domain/src/admin/cancel-schedule.ts`: exact read/cancel authority, session/active user до операции, после ожидания и перед commit; default-false enable из адаптера. Версия/отмена/replay проверяются сервером, `catalog.cancel` имеет самостоятельный namespace/hash. Evidence и ответ атомарны; после наступления даты replay возвращает прежнее подтверждение, доступ проверяется повторно. Неподходящий target не раскрывается. Никаких балансов/квот/заявок операция не меняет.
- `admin/catalog.ts`, `catalog-history.ts`, `publish.ts`, `rewards/read.ts`, `write.ts`: отменённые условия исключены из effective selection, включая cursor anchor и reserve после quota wait. История сохраняет исходные условия со state=cancelled; новый номер max(saved version)+1, previousVersion — действующая версия. Отменённые номера не переиспользуются.
- `packages/contracts/src/catalog-cancellation.ts`, `audit.ts`, `index.ts`: strict body/evidence, самостоятельная capability, permission allowlist и `catalog.cancel` в scoped audit. Отмена показывает исходный target и причину; публикационный evidence допускает скачок номера. `shared/server/catalog-cancellation.ts` и новый Route Handler сохраняют Node adapter/no-store, Origin/CSRF/session, bounded JSON/headers/query и actor limiter.
- `catalog-cancel.tsx` и `catalog-admin.tsx`: отдельная закрытая inline форма, полный target и дата МСК, обязательная причина, preview/confirm, one-intent retry для unknown/429/503, blocked 400/409/413/422, denial cleanup, guard для закрытия/Back/scope/refresh и abort/alive для позднего ответа. Preview публикации не придумывает следующий номер. Существующие токены/CSS/компоненты сохраняются.

## Проверено командами

Windows, Node 24.21.0, Bun 1.4.2, loopback PostgreSQL 18.6, отдельная `impuls_cancellation` на 127.0.0.1:55434. `.local/setup-cancellation.mjs` использует штатный node-pg-migrate; временная копия 000003 пропускает provisioned cluster role, сохраняя schema/ACL, как прежний restore runner. TEST_DATABASE_URL задан явно; TEMP/TMP внутри `.local/creation-vitest-tmp`. Нет чтения production данных или внешнего выпуска.

| Команда                                                                                                                                                                                                                                                  | Результат                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node .local/setup-cancellation.mjs`                                                                                                                                                                                                                     | Exit 0, applied: 30, отдельная синтетическая БД.                                                                                                                                                                      |
| `bun run build`                                                                                                                                                                                                                                          | Exit 0: Next.js и worker; новый scheduled-versions/cancel Route Handler присутствует. Финальная сборка: `.local/cancellation-build-final.log`.                                                                        |
| `bun run lint`; `bun run typecheck`                                                                                                                                                                                                                      | Exit 0; финальный ESLint без warnings.                                                                                                                                                                                |
| `node node_modules/typescript/bin/tsc --noEmit --moduleResolution bundler --module esnext --target es2022 --esModuleInterop --strict --skipLibCheck --allowJs tests/integration/catalog-cancellation.test.ts tests/integration/database-restore.test.ts` | Exit 0, отдельные integration suites вне workspace tsconfig.                                                                                                                                                          |
| `node scripts/verify-task-slice.mjs --catalog-cancellation-only` с TEST_DATABASE_URL                                                                                                                                                                     | Финальный exit 0: 11 tests / 2 suites (9 PostgreSQL/HTTP/browser-to-DB, 2 contract), 20 browser scenarios. `.local/cancellation-check-final.log`.                                                                     |
| `node scripts/verify-task-slice.mjs --admin-catalog-only` с TEST_DATABASE_URL                                                                                                                                                                            | Финальный exit 0: 59 passed / 5 suites и 136 browser scenarios (40 catalog, 17 immediate publication, 20 scheduling, 20 cancellation, 20 creation, 19 quota publication). `.local/cancellation-regression-final.log`. |
| `PG_BIN='C:/Program Files/PostgreSQL/18/bin' node scripts/verify-database-restore.mjs` с TEST_DATABASE_URL                                                                                                                                               | Exit 0: 9 passed, полный набор 30 миграций, table data/sequences/owners/ACL/protective objects, cancellation/replay и сохранённые ресурсы. `.local/cancellation-restore.log`.                                         |
| `TEST_DATABASE_URL='' bun run test:unit` с TEMP/TMP в workspace                                                                                                                                                                                          | Финальный exit 0: 120 passed / 373 skipped, 30 passed suites / 46 skipped. `.local/cancellation-unit-final.log`; skipped DB tests не считаются успешными.                                                             |
| `impeccable.cmd detect --json` на catalog-admin/cancel/terms и audit-log                                                                                                                                                                                 | Один проход, exit 0: `[]`. Detector не заменяет UX/функциональную проверку.                                                                                                                                           |

`bun run format:check` — exit 0, все включённые файлы соответствуют Prettier (`.local/cancellation-format-final.log`). `git diff --check -- .env.example DESIGN.md IMPLEMENTATION_PLAN.md PRODUCT.md README.md docs/adr/README.md apps/app/src/features/auth/access-screen.tsx packages/contracts/src/index.ts packages/domain/src/index.ts packages/domain/src/permissions/service.ts scripts/verify-task-slice.mjs` — exit 0 для затронутых tracked файлов; новые файлы охвачены format check. Полный diff имеет отдельный предсуществующий сбой ниже.

## Независимые ожидания

Исходные version=1/price=30 и будущие version=2/price=19 сохраняются в БД. После отмены current=1, scheduled=null; история содержит [[2,cancelled],[1,current]], audit хранит отменённые version=2/price=19 и исходную причину. Резерв, quota row и balance row сравниваются до/после: без изменений. Отменённая версия не появляется у участника после её даты и не принимается для reserve; старая версия остаётся допустимой. Следующая публикация — version=3 с previousVersion=1; оба прежних publication replay сохраняются.

Два concurrent cancel с разными ключами дают ровно ok/conflict и одну запись. Изменение причины под прежним ключом даёт idempotency_conflict. Отсутствие отдельного cancel права (включая scheduling-only actor), чужая область/target, выключенный flag, stale version отклоняются. Quota lock удерживается до наступления даты/истечения permission; операция повторно проверяет время/authority и откатывает intent. Поздний прямой INSERT отклоняет DB trigger. Несоответствие CHECK при INSERT откатывает cancellation и idempotency вместе; оно не маскируется как deadline error. UPDATE runtime запрещён ACL, DELETE owner — immutable trigger; worker не получает INSERT. Replay при отозванной сессии отказывается.

Реальные HTTP отрицательные Origin/CSRF/strict body и browser-to-DB отмена выполнены через Next.js и impuls_app. В реальном браузерном пути подменяется только внешний Telegram bridge script, не API/БД. Отдельные API mocks проверяют UI успех/ошибки, retry с одинаковым ключом/телом, pending, read-only capability, dirty Back, required input/Enter и поздний ответ после смены области. Это разные виды свидетельств.

## UI и документация

Full-page captures от document top: form/preview на 320/360/390/1280 px; scoped увеличение текста формы до 24 px/line-height 1.6 на 320 px. Проверены отсутствие document horizontal overflow и pageerrors. Все девять файлов просмотрены; формы/preview читаемы, target/date и последствия отделены от подтверждения. [Мобильный preview](assets/f07-cancellation/catalog-cancellation/preview-320.png), [desktop form](assets/f07-cancellation/catalog-cancellation/form-1280.png), [увеличенный текст формы](assets/f07-cancellation/catalog-cancellation/text-scale-320.png).

Независимый Impeccable reviewer: **ship** только для проверенного локального UI-среза; [review](2026-10-06-f07-cancellation-ui-review.md) включает отдельное ограниченное дополнение по scoped text scale. [Design documentation](2026-10-06-f07-cancellation-design-documentation.md) сравнивает расширение с incumbent без замены tokens/sidecar. План, PRODUCT, DESIGN, README и ADR индекс обновлены в пределах среза. Предыдущие dated записи сохраняют исторические ограничения.

## Сбои и пределы

Sandbox запретил loopback connect и Next.js canonicalize; первая automatic approval проверка завершилась по тайм-ауту, разрешённый повтор запустил локальные команды. Первый pg_ctl без явного порта не смог открыть default socket; повтор использует 127.0.0.1:55434. Процесс, запущенный внутри sandbox, завершился до следующего подключения; cluster запущен вне sandbox для тестов. Неуспехи EACCES/ECONNREFUSED/сборки не объявляются успешными.

Первый Vitest запуск без workspace TEMP/TMP дал ENOENT трансформаций; повтор с явным temp прошёл. Первый DB suite отказал только в assertion по выдуманному имени worker role; заменено на фактическое `impuls_worker`, остальные сценарии были проверены повтором. Промежуточный admin browser runner прошёл 40 admin catalog/17 immediate/20 scheduling scenarios, затем остановился на новом blanket `*24px` stress fixture: глобальный workspace получил overflow. Fixture сужен до новой cancellation формы; scoped повтор прошёл. Это не доказывает global OS/workspace scaling, которое остаётся непроверенным и требует отдельного исследования. Первый focus runner ошибочно запускал дополнительный legacy timeline smoke; guards исправлены, финальный focus не включает его.

Полный `git diff --check` показал trailing whitespace в уже изменённых до задачи R0 `work/presentation.html` и `outputs/impuls-presentation.html`; эти файлы не менялись этим срезом. Scoped diff и format проверяются отдельно, без скрытия общего результата.

После финального полного прогона `pg_ctl -D .local/creation-pg/data -m fast -w stop` завершился с exit 0: локальный cluster остановлен. Тестовые данные и логи сохранены для воспроизведения.

Новые зависимости не добавлены, runtime/transport/архитектура сохранены. Проверены первичные [PostgreSQL 17 locking docs](https://www.postgresql.org/docs/17/explicit-locking.html) и [Supabase roles](https://supabase.com/docs/guides/database/postgres/roles); changelog.md не прочитан web tool из-за unsupported content-type. Новых Supabase SDK/CLI APIs нет. PostgreSQL 17.6 remote CI, Supabase/Vercel миграции/выпуск, физические Telegram Android/iOS, screen reader/OS scaling/нагрузка/full security scan этим срезом не проверены. Quota edits, реальные полномочия/экономика, Bot API/hosting и P-01…P-06 остаются отдельными шагами.

000030, API и UI выпускаются совместно. Flags false по умолчанию; отключение новых отмен не восстанавливает уже отменённую версию. История сохраняется, down запрещён. Внешний выпуск не выполнялся.

## Воспроизведение

```powershell
# Отдельная synthetic loopback БД с миграциями 000001–000030:
$env:TEST_DATABASE_URL='postgres://impuls_test@127.0.0.1:55434/impuls_cancellation'
$env:TEMP=Join-Path (Get-Location) '.local/creation-vitest-tmp'
$env:TMP=$env:TEMP
$env:TEST_SCREENSHOT_DIR=Join-Path (Get-Location) 'docs/verification/assets/f07-cancellation'
bun run build
node scripts/verify-task-slice.mjs --catalog-cancellation-only
node scripts/verify-task-slice.mjs --admin-catalog-only
$env:PG_BIN='C:/Program Files/PostgreSQL/18/bin'
node scripts/verify-database-restore.mjs
```

## Последующее браузерное исследование 06.10.2026

Записанный выше общий overflow при увеличении текста исследован отдельным UI-срезом: [workspace reflow](2026-10-06-workspace-reflow.md). До правки 48/120 сочетаний имели дефекты, финальные 138/138 проходят; прежние 20 cancellation UI сценариев также повторены. Это устраняет конкретный общий CSS/browser сбой, но не подтверждает настоящий OS scaling, физический Telegram или полную приёмку F07/R1. Исходные результаты и неуспехи этого отчёта сохранены как исторические.
