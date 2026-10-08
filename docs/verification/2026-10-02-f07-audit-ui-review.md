# F07 и навигация: визуальная проверка, 02.10.2026

Область: локальный синтетический аудит и уточнение существующего workspace в режиме Operate. Основание: `IMPLEMENTATION_PLAN.md` §§ 7, 10–12, F07; замечание пользователя о неровных и нелаконичных кнопках на снимке выключенного журнала; `../implementation/2026-10-02-workspace-navigation-refinement.md`. Контракты поверхности: `../../apps/app/.impeccable/surfaces/apps-app-src-features-audit-audit-log-tsx.md` и `apps-app-src-features-tasks-workspace-navigation.md` в той же папке.

Роли свежего reviewer и documenter выполнены обычными изолированными subagent вместо специализированных named-role harness; инструкции установленного Impeccable прочитаны. Documenter использовал `reference/document.md` полностью и `reference/degraded/documenter.md`. Это ordinary extension: новая визуальная система, seed, comp и QUALITY BAR новой концепции неприменимы.

## Проверенные материалы и система

Documenter сверил `DESIGN.md`, `.impeccable/design.json`, относящийся к F07 текст `PRODUCT.md`, контракты поверхности и реализации `apps/app/src/app/globals.css`, `features/auth/access-screen.tsx`, `features/tasks/task-list.tsx` (TaskWorkspace), `features/audit/audit-log.tsx` и `.css`, `shared/ui/tokens.css`. Далее пути исходников относятся к `apps/app/src`. Код и финальные PNG подтверждают уже записанный локальный контракт `DESIGN.md:279`; обновлять нормативные токены и sidecar не требуется.

Пять строк системы:

1. **Палитра:** incumbent navy/ink/muted; mint выделяет выбранный раздел и disclosure, gold сохраняет видимый keyboard focus. Новых цветов нет (`shared/ui/tokens.css`, `app/globals.css:45`, `:320`).
2. **Типографика:** Manrope; body 15 px, supporting/control 12–13 px, identity/event 18 px, section 20 px, native audit selects 16 px (`app/globals.css:36`, `:164`, `:184`, `:309`, `:379`; `audit-log.css:35`, `:60`). Это наблюдаемые runtime роли, не замена R0 frontmatter.
3. **Layout:** узкая колонка до 460 px; четыре равных личных пункта и один–три равных рабочих, минимум 44 px; native filters и disclosure складываются в одну колонку до 480 px (`app/globals.css:56`, `:280`; `task-list.tsx:383`; `audit-log.css:98`).
4. **The Meaningful Accent Rule:** один выбранный mint пункт имеет `aria-pressed`; видимые короткие подписи входят в полные accessible names; основания, текущее название и сохранённые значения названы текстом (`DESIGN.md:171`, `task-list.tsx:340`, `audit-log.tsx:210`).
5. **The Flat Surface Rule:** тонкие разделители и tonal grouping, без теней на resting rows; native inline evidence сохраняет контекст; reduced motion отключает переходы навигации (`DESIGN.md:205`, `audit-log.css:56`, `app/globals.css:574`).

Compact authorized status, читаемое имя, native details полномочий и тихий выход в шапке соответствуют реализации. Logout и переключение раздела вызывают существующий `confirmLeave` (`access-screen.tsx:295`, `task-list.tsx:374`). Короткое «Обновить» сохраняет accessible name «Обновить журнал» (`audit-log.tsx:163`). Неавторизованные состояния сохраняют объяснение и повторный вход. Значения неизвестного прошлого не придумываются.

## Финальные снимки

Все восемь требуемых PNG открыты свежим reviewer и documenter после последней CSS/capture правки; снимки непустые, начинаются с шапки документа и соответствуют состояниям. Размеры проверены по PNG IHDR. Копии desktop/mobile соответствуют исходным audit-1280/audit-320. Финальные captures сохраняют нативные пиксели; источник и metadata embedding описаны в [основном отчёте](2026-10-02-f07-audit.md).

| Снимок                                                                                     | Размер PNG | Свидетельство                                                                       |
| ------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------- |
| [Desktop](../../.impeccable/review/f07-audit/desktop.png)                                  | 1280×1738  | Узкая колонка, равная навигация, парные filters, открытые saved values              |
| [Mobile](../../.impeccable/review/f07-audit/mobile.png)                                    | 320×2249   | Четыре равных личных пункта, один рабочий; длинное имя и evidence переносятся       |
| [360 px](../../.impeccable/review/f07-audit/audit-360.png)                                 | 360×2171   | Та же иерархия, подписи и открытые значения без clipping                            |
| [390 px](../../.impeccable/review/f07-audit/audit-390.png)                                 | 390×2066   | Та же иерархия, выбранный пункт и переносы                                          |
| [Все рабочие полномочия](../../.impeccable/review/f07-audit/audit-all-permissions-320.png) | 320×1766   | Три равных рабочих пункта; gold focus на native permissions summary                 |
| [Пустой результат](../../.impeccable/review/f07-audit/audit-empty-320.png)                 | 320×884    | Filters и timestamp сохранены, отсутствие записей названо текстом                   |
| [Выключено](../../.impeccable/review/f07-audit/audit-disabled-320.png)                     | 320×850    | Исправлен сценарий пользовательского снимка; спокойная навигация и явное объяснение |
| [503 и подтверждённые строки](../../.impeccable/review/f07-audit/audit-stale-320.png)      | 320×1987   | Предупреждение, прежний timestamp и повторная загрузка перед сохранёнными строками  |

В populated captures 320/360/390 px с закрытыми полномочиями первое событие начинается в первых 850 px. Полное имя автора и основание продолжаются в обычном scroll flow. Это не обещание размещать любую запись целиком в первом viewport. Раскрытые полномочия и длинный текст вправе сдвигать evidence вниз.

## Свежий scoped finish review

**disposition: ship** — в границах локального Operate extension, без внешнего выпуска.

- **persistence: Pass.** PRODUCT, DESIGN, оба surface contracts и восемь финальных captures согласованы; все PNG просмотрены от верхней шапки.
- **fidelity: match.** TYPE/MATERIAL/GROUND сохраняют incumbent world. Навигация адаптирована по прямому замечанию пользователя: equal personal/work targets, concise labels, compact status, читаемое имя, permissions disclosure и guarded header logout. First viewport соответствует уточнённому контракту. Длинные aliases переносятся, empty/disabled/stale имеют честные подписи, saved values раскрываются inline.
- **ceiling: reached.** Достигнут предел установленной области Operate; дополнительные ornament, asset или motion не требуются.
- **material_fixes: none.** Существенных визуальных исправлений не назначено.
- **keep.** Равные цели навигации, concise visible labels, явный synthetic boundary, inline permissions/evidence и guards несданного текста/выхода.

## Проверки и ограничения

Documenter проверял код, материалы и PNG; повторно приложения и тесты не запускал. По результатам root и [основному отчёту](2026-10-02-f07-audit.md), финальный `bun run test:task-slice --audit-only` после reduced-motion/capture правки завершился exit 0: 8 PostgreSQL/HTTP/миграционных тестов и 19 browser-сценариев. Production build прошёл. Предшествующий полный `bun run test:task-slice` завершился exit 0: 157 PostgreSQL/HTTP-тестов и browser suites с окончательными подписями/схемой навигации; последующая правка касалась отключения CSS transition и стабильного capture. `bun run test:telegram` — exit 0, 14 SDK/HTTP-сценариев, до этой последней правки. После передачи documenter root выполнил общий `bun run check` (exit 0, 49 unit/contract tests и остальные проверки) и supplementary access smoke (exit 0, семь сценариев). Точные команды, среда и встреченные сбои записаны в основном отчёте.

Браузерный код `tests/browser/audit.mjs:262` проверяет три равных рабочих пункта, permissions Enter и header logout; `:291` проверяет четыре равных личных пункта, 44 px, единственный active state и reduced-motion `transitionDuration=0s` на 320/360/390/1280 px. Screenshots показывают состояния, а не доказывают server permissions самостоятельно. Для 401/403/404 защищённые строки исключаются в `audit-log.tsx:121`–127; domain/HTTP доказательства относятся к основному отчёту.

**Не канонизировано и не исправлялось:** существующее различие R0 type ramp/frontmatter/sidecar и production runtime 16/18/20 px остаётся scoped extension, а не новым глобальным правилом. Результат typography detector, сравнивающего R1 с R0, не легализует дефект. Существующий текст о Motion как целевом стеке не переопределяется из CSS transition этой навигации. Новые дефекты craft floor для наследования не записаны; нормативные токены, запрещающие правила и `.impeccable/design.json` сохранены, поскольку замена системы не авторизована.

Физические Telegram Android/iOS, screen readers, системное увеличение шрифта/клавиатура/safe areas на устройствах и внешний выпуск не проверены. P-01…P-06 остаются открытыми. Эта проверка не устанавливает завершение F07/R1, полный административный контур или допуск реальных участников.
