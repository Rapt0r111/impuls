# Увеличение текста рабочего UI: проверка 6 октября 2026

Требование: § 7/12 IMPLEMENTATION_PLAN.md. [Контракт](../implementation/2026-10-06-workspace-reflow-slice.md). Проверка устраняет конкретный локальный браузерный overflow из [предыдущего отчёта F07](2026-10-06-f07-schedule-cancellation.md), без объявления F07/R1 принятыми.

## Подтверждено кодом и браузером

Изменены `apps/app/src/app/globals.css`, `features/tasks/task-list.tsx` и `features/task-management/task-management.css`: content-dependent перенос навигации, длинных имён, фонда и соседних значений/действий. Обработчики и полномочия сохранены. Нет `overflow-x: hidden`, ellipsis, скрытия текста или уменьшения авторского шрифта для маскировки дефекта.

Baseline: [before-metrics.json](assets/workspace-reflow/workspace-reflow/before-metrics.json), 120 сочетаний, 48 с дефектами. У catalog на 320 px и 24 px document width = 347 вместо 320; у очереди проверки с длинными именами = 421 при обычном тексте и 822 при uniform24. Range-проверка замечает подпись вне кнопки даже когда document width ещё допустима. Это заранее заданные синтетические значения, не реальные участники.

Финал: [metrics.json](assets/workspace-reflow/workspace-reflow/metrics.json), **138 сочетаний, 0 дефектных**. Основные 120: 10 разделов, 320/360/390/1280 px, normal/uniform24/double. Дополнительные 18: inset отчёт, review-return, cancellation preview, три мобильные ширины, два режима текста, lateral safe areas 24 px. Audit — подтверждённый empty, остальные основные fixtures — populated. Assertions охватывают горизонтальные границы, text ranges кнопок, 44×44 controls, Enter, pageerrors/неожиданные API и сохранение текста при отклонённом уходе. Device scale factor не выдаётся за text resize.

## Команды и результаты

Windows, Node 24.21.0, Bun 1.4.2, установленный Playwright Chromium. `PLAYWRIGHT_BROWSERS_PATH=C:/Users/Aquarius/AppData/Local/ms-playwright`. БД и production APIs для этого среза не вызываются.

| Команда                                                                                                                                                                             | Результат                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$env:TEST_REFLOW_REPORT_ONLY='1'; $env:TEST_SCREENSHOT_DIR='.local/reflow-before'; node tests/browser/workspace-reflow.mjs`                                                        | Diagnostic exit 0: 120 сочетаний, 48 дефектных. Здесь exit 0 означает сбор данных, а не успешные assertions. `.local/reflow-before.log`.                                                                         |
| `bun run build:app`                                                                                                                                                                 | Exit 0 после первой CSS-правки. `.local/reflow-build.log`.                                                                                                                                                       |
| `$env:TEST_SCREENSHOT_DIR='docs/verification/assets/workspace-reflow'; node tests/browser/workspace-reflow.mjs`                                                                     | Exit 0: промежуточные 138/0. `.local/reflow-after.log`. Снимки выявили неудобный разрыв слов и узкую колонку названия; исправлены одним финальным проходом.                                                      |
| `$env:TEST_SCREENSHOT_DIR='docs/verification/assets/workspace-reflow'; bun run test:reflow`                                                                                         | **Exit 0**, финальная Next.js сборка и 138/0 assertions через собственный loopback:3102 сервер. `.local/reflow-final.log`.                                                                                       |
| `node tests/browser/catalog-cancellation.mjs`                                                                                                                                       | Exit 0: 20 существующих сценариев. `.local/reflow-cancellation.log`.                                                                                                                                             |
| `node tests/browser/task-submissions.mjs`                                                                                                                                           | Exit 0: 13 существующих сценариев. `.local/reflow-submissions.log`.                                                                                                                                              |
| `node tests/browser/task-reviews.mjs`                                                                                                                                               | Exit 0: 19 существующих сценариев. `.local/reflow-reviews.log`.                                                                                                                                                  |
| `bun run lint`                                                                                                                                                                      | Exit 0. `.local/reflow-lint-final.log`.                                                                                                                                                                          |
| `bun run typecheck`                                                                                                                                                                 | Exit 0 для app/worker/domain/contracts. `.local/reflow-typecheck.log`.                                                                                                                                           |
| `impeccable.cmd detect --json --scope type,layout apps/app/src/app/globals.css apps/app/src/features/task-management/task-management.css apps/app/src/features/tasks/task-list.tsx` | Exit 0: 0 primary, 15 advisory о прежних runtime размерах 16/17/18/20/22 px и endpoint 30 px относительно R0 ramp. Шрифтовые размеры этим срезом не менялись; advisory не скрыты. `.local/reflow-detector.json`. |

`bun run format:check` — финальный exit 0, все включённые файлы соответствуют Prettier (`.local/reflow-format-final.log`). Первый format check дал exit 1 на новом browser script и скопированном before-metrics.json; после форматирования этих двух файлов повтор прошёл. Scoped `git diff --check -- apps/app/src/app/globals.css apps/app/src/features/tasks/task-list.tsx apps/app/src/features/task-management/task-management.css package.json .github/workflows/check.yml IMPLEMENTATION_PLAN.md PRODUCT.md DESIGN.md README.md` — exit 0. Новые scripts/docs/metrics охвачены format check.

Три существующих browser scripts запускались с `TEST_APP_ORIGIN=http://127.0.0.1:3100`, `TEST_SCREENSHOT_DIR=.local/reflow-regression` и финальной сборкой. Их 52 сценария проверяют UI retry/ошибки/guards на mock API; они не считаются новой PostgreSQL или production проверкой. SQL, доменные операции, миграции и зависимости не менялись; PostgreSQL suites не запускались этим срезом.

## Просмотр UI

Просмотрены финальные [увеличенная навигация](assets/workspace-reflow/workspace-reflow/navigation-double-320.png), [список задач](assets/workspace-reflow/workspace-reflow/tasks-double-320.png), [форма проверки](assets/workspace-reflow/workspace-reflow/review-detail-double-320.png), [отчёт](assets/workspace-reflow/workspace-reflow/task-detail-double-320.png), [preview отмены](assets/workspace-reflow/workspace-reflow/cancel-preview-double-320.png), [рейтинг](assets/workspace-reflow/workspace-reflow/ranking-double-320.png) и [desktop каталог](assets/workspace-reflow/workspace-reflow/catalog-normal-1280.png). Крупная навигация и фонд занимают дополнительные строки, сохраняя действия и данные. Это собственный ограниченный review исполнителя, не независимая приёмка или полный accessibility audit. Палитра, typography, focus и incumbent sidecar сохранены. Вертикальная прокрутка стресс-fixtures ожидаема.

## Сбои и непроверенное

Первый sandbox Next.js старт отказал в Windows canonicalize; разрешённая escalation прошла. Первый sandbox browser lookup искал Chromium в sandbox AppData; после явного browser path появился loopback network отказ. Разрешённый локальный запуск прошёл, без загрузки Chromium или новых пакетов. Начальный ledger fixture содержал неверный enum `task_accepted`, поэтому ready wait дал timeout; исправлен на фактический `task_acceptance`, матрица повторена. Эти неуспехи не объявляются успешными тестами.

Настоящий системный текст Android/iOS Telegram, OS/browser zoom, screen reader, virtual keyboard и устройства не проверены. CSS увеличение не заменяет эти свидетельства. Длинная выбранная строка native select может оставаться компактно показанной, как в incumbent; открытый OS picker здесь не проверяется. Контраст и все состояния всех форм не составляют предмет полного аудита этого среза.

CI шаг добавлен после установки Chromium, но удалённый запуск не подтверждён. Runner остановил собственный сервер; отдельно запущенные локальные серверы для baseline/regression тоже остановлены. Внешний выпуск не выполнялся. P-01…P-06, реальные правила/полномочия, quota edits, Bot API/hosting, полный security scan и критерии R1 сохраняют прежний статус. Следующее применимое свидетельство этого UI-требования — ручная проверка системного текста/клавиатуры в Telegram Android/iOS.

Методика опирается на первичные [W3C Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [W3C Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) и [MDN overflow-wrap](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow-wrap). Требование 320 CSS px и увеличение текста использованы как ориентиры; полного соответствия этим стандартам срез не заявляет.

## Воспроизведение

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/Aquarius/AppData/Local/ms-playwright'
$env:TEST_SCREENSHOT_DIR='test-results'
bun run test:reflow
```

На машине без Chromium сначала используется существующий CI шаг `bunx playwright install chromium --with-deps`. Команда сама собирает app и запускает/останавливает сервер. БД не требуется; report-only через неё включить нельзя.
