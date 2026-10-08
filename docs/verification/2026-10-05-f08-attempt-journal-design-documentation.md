# F08/F07: документация дизайна журнала попыток

Дата: 05.10.2026. Роль: Impeccable documenter, scan mode. Основание: `IMPLEMENTATION_PLAN.md` §§ 7, 11–12, существующий `DESIGN.md`, пользовательский выбор закрытого «Журнала попыток» и [контракт среза](../implementation/2026-10-05-f08-attempt-journal-slice.md). Это обычное расширение локальной синтетической поверхности Operate.

## Граница записи

`DESIGN.md` и `.impeccable/design.json` сохранены. Расширение не создаёт новую визуальную идентичность или повторно используемый набор токенов. Правила поверхности и результат finish-проверки записаны в `apps/app/.impeccable/surfaces/res-notifications-notification-status-tsx-20c924af.md` и этом файле. Исходники, продуктовые решения, основной отчёт проверки и архитектурные документы этим проходом не изменялись.

## Подтверждено файлами и кодом

| Обещание поверхности                 | Фактическое свидетельство                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Наследование цвета и шрифта          | `apps/app/src/shared/ui/tokens.css:2` и далее сохраняют navy, panel, line, ink, muted, mint и gold из `DESIGN.md`; `apps/app/src/app/globals.css:30` задаёт Manrope, размер 15 px и line-height 1.5. Journal не вводит цвет, семейство шрифта или декоративный материал.                                                                                       |
| Первый экран и положение журнала     | `apps/app/src/features/notifications/notification-status.tsx` оставляет заголовок симуляции, предупреждение, refresh, exact-scope select, дату и сводку. `NotificationAttempts` следует за `NotificationEvents`, перед recent20.                                                                                                                               |
| Закрытое lazy раскрытие              | `notification-attempts.tsx:65` использует существующий Telegram Back; `:75` включает query только при expanded; `:114` и далее создают native details без исходного open. Summary называется «Журнал попыток».                                                                                                                                                 |
| Иерархия строк                       | `notification-attempts.tsx:160` и далее: flat ordered list, bold тип, текстовый номер/фаза, allowlisted причина, дата записи МСК; идентификатор события находится во вторичном native details. `notification-status.css:77` и далее наследует верхний divider и padding 16 px.                                                                                 |
| Длинное пояснение                    | `notification-status.css:85` и `:88` задают 14 px существующей истории событий и новому журналу. Это локальное наследование читаемого длинного текста, не новая глобальная шкала. UUID переносится через overflow-wrap; его disclosure не меняет основную иерархию.                                                                                            |
| Управление и фокус                   | `globals.css:485` и далее: action с minimum height 44 px, padding 8/14 px, border 1 px, radius 9 px, panel fill и hover panel-hover. `globals.css:45` сохраняет gold focus-visible 3 px с offset 3 px. Summary наследует minimum height 44 px из `notification-status.css:65`.                                                                                 |
| Самостоятельная дата и ручное чтение | `notification-attempts.tsx:105` refresh сбрасывает cursor либо перечитывает первую страницу; дата чтения и следующий cursor принадлежат журналу. Состояния загрузки, пустоты, ошибки и retained dated rows имеют постоянный текст.                                                                                                                             |
| Защищённые состояния                 | `notification-attempts.tsx` скрывает data при 400/401/403/404 и сохраняет прежние строки при recoverable error; next отключён при fetch/error. `notification-cache.ts` отменяет остальные notification queries и очищает status/events/attempts при denial; статус и список используют тот же helper. Это описание кода, не самостоятельная серверная приёмка. |
| Честная граница истории              | Пояснение называет новые переходы после включения журнала, неизвестную раннюю историю, время сохранения/обнаружения истечения и отсутствие доказательства доставки Telegram. Исправленный empty текст в `notification-attempts.tsx:191` говорит об обработке событий симуляции без английского термина worker.                                                 |

Типографика, родные disclosure-маркеры, тонкие линии, мягко квадратные action-кнопки и видимый gold focus используют собственные материалы существующего мира. Не добавлены изображения, plate, glyph icons, тени, motion или зависимости. Историческая светлая читающая поверхность R0 здесь не переносится в рабочий экран.

## Пять строк системы

1. Palette: navy background/panel, pale ink, mist supporting text, mint disclosure/action, gold keyboard focus; counts и фазы остаются текстовыми и нейтральными.
2. Type: Manrope body 15 px / 1.5; action 13 px; длинные journal notes 14 px; event kind выделен весом, дата подчинена; identity code 13 px.
3. Meaningful Accent Rule: mint обозначает действие; фаза и причина читаются по словам, доставка не выводится из цвета или успеха симуляции.
4. Flat Surface Rule: строки разделяются линиями, disclosure группирует информацию без raised cards и новых теней.
5. Local disclosure rule: закрытое lazy чтение следует за «Все события», имеет свою дату/refresh/next; Back сначала закрывает журнал.

Последняя строка описывает эту поверхность и не становится общим запретом или новым токеном `DESIGN.md`.

## Проверенная и переданная evidence

Documenter прочитал исходники status/attempts/events/cache/CSS, shared tokens и выбранные правила globals, `PRODUCT.md`, `DESIGN.md`, sidecar schemaVersion 2, direction contract, контракт среза, [отчёт проверки](2026-10-05-f08-attempt-journal.md) и [независимый UI review с verdict](2026-10-05-f08-attempt-journal-ui-review.md). Самостоятельно открыт populated [320 px](assets/f08-attempt-journal/notification-status/attempts-320.png) и исправленный [empty 320 px](assets/f08-attempt-journal/notification-status/attempts-empty-320.png): материалы/иерархия совпадают с исходниками, новый русский empty текст виден и переносится в колонке. Это визуальное чтение, без измерения пикселей или контраста.

`bunx prettier --write docs/verification/2026-10-05-f08-attempt-journal-design-documentation.md apps/app/.impeccable/surfaces/res-notifications-notification-status-tsx-20c924af.md` — exit 0. Проверка той же пары через `bunx prettier --check` — exit 0, оба файла соответствуют стилю. `Get-FileHash -LiteralPath 'DESIGN.md','.impeccable/design.json' -Algorithm SHA256` до и после документации дал одинаковые hashes: `FD3515BDE239F11864574652E17C221B34AD211532CC21E24464B5594B41568B` и `71BBDAC9A4A746FCF1B873CD6305056933A3D0FFFFB513E699E6D7177080AA65` соответственно. Исходники не менялись; функциональные тесты этим документационным проходом не повторялись.

UI reviewer повторно открыл все семь required same-path captures: `attempts-320.png`, `attempts-360.png`, `attempts-390.png`, `attempts-1280.png`, `attempts-empty-320.png`, `attempts-large-text-320.png`, `attempts-retained-503-320.png` в `docs/verification/assets/f08-attempt-journal/notification-status/`. Verdict resolved / remaining clear / disposition ship относится только к scored empty-copy fix; он не означает приёмку всего F08/F07/R1.

Из основного прохода переданы результаты: 21 реальный DB/HTTP test и 49 browser scenarios после copy fix; общий integration suite — 295 passed / 1 POSIX skip. Documenter их не запускал и не объявляет собственной проверкой. При финальном handoff владелец основного прохода сообщил: `node scripts/verify-task-slice.mjs` — exit 0, 39 integration suites / 295 passed / 1 Windows POSIX skip и все 18 browser scripts прошли; notifications 49, admin catalog 40, timeline 15. Documenter не повторял эти команды; точные условия и итог фиксирует владелец основного отчёта. Передан provenance scan: 25 raster / 0 missing; metadata не заменяет проверку состояний или устройств. Detector запускался один раз и дал только два advisory по прежним 16 px select / 18 px counts; второй detector этим проходом не запускался.

## Drift без ремонта и канонизации

`DESIGN.md` frontmatter и sidecar остаются записью R0: body line-height 1.65 и code 12 px; действующий app baseline имеет 1.5, а ранее существовавший identity code в notification CSS — 13 px. Рабочий 1.5 попадает в контракт плана § 7; эти наблюдения не доказывают новый дефект журнала. Sidecar по-прежнему содержит исходные R0 компоненты, motion и breakpoints, а не полный каталог production-срезов. Новое расширение не даёт основания автоматически перезаписать этот исторический материал или легитимизировать advisory как новые правила. Различия задокументированы и не исправлялись в согласованной границе.

Не канонизированы: прежние advisory размеров и различия R0/app, поскольку текущая задача не меняет систему. Новых floor refusal после исправления empty-copy в scoped journal evidence не отмечено независимым reviewer.

## Finish handoff и неизвестное

Направление persist, независимый review и scoped verdict существуют; actual consistency и границы design-документации записаны здесь. У основной задачи остаётся запись итоговых команд после copy fix, provenance результата и финального broader regression в её основном отчёте. Этот handoff не является разрешением на remote rollout.

Physical Telegram Android/iOS, screen readers, measured contrast, whole-browser/system zoom, целевые Supabase/pooler/TLS/load, CI PostgreSQL 17.6, backup restore и целевой POSIX shutdown не проверены этим проходом. P-01…P-06, внешний transport/hosting, retention/performance policy и полная приёмка F08/F07/R1 остаются вне локального documenter результата. Утверждения о сервере и эксплуатационных границах следует проверять по основному отчёту, контракту и ADR-0015.
