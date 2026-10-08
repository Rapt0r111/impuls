# F07: проверка документации дизайна создания позиции

Дата: 05.10.2026. Документация завершена для локального наследуемого Operate-расширения. Нового визуального мира или изменения системы нет; DESIGN.md и sidecar этим проходом не изменены. Это не приёмка F07/R1 и не разрешение внешнего выпуска.

## Основание и граница

Прочитаны поставляемый профиль `impeccable_documenter.toml` и `reference/document.md` из Impeccable 4.3.1. Профиль требует выводить правила из построенного интерфейса, сохранять incumbent system при обычном расширении и не исправлять прежний drift без отдельной задачи. Запись этого прохода ограничена настоящим отчётом.

Сверены [план, § 7](../../IMPLEMENTATION_PLAN.md), [PRODUCT.md](../../PRODUCT.md), [DESIGN.md](../../DESIGN.md), [surface contract — identity creation](../../apps/app/.impeccable/surfaces/apps-app-src-features-catalog-admin-catalog-admin-tsx.md), [контракт среза](../implementation/2026-10-05-f07-creation-slice.md), [отчёт исполнителя](2026-10-05-f07-creation.md) и [finish review](2026-10-05-f07-creation-ui-review.md). Последний имеет `disposition: ship`, `material_fixes: Нет`; его вердикт ограничен данным UI-срезом.

`apps/app/.impeccable/design.json` отсутствует. Реальный incumbent sidecar — [корневой `.impeccable/design.json`](../../.impeccable/design.json), schemaVersion 2, generatedAt `2026-09-22T17:50:12.360Z`. Его R0 narrative, primitives, shadow/motion metadata и snippets не заменяются описанием одного R1 экрана. DESIGN.md уже содержит фактическую секцию создания позиции (строка 337 и следующий абзац); отдельное дополнение здесь не требуется.

## Подтверждено кодом

| Проверенный источник                                                                                    | Сопоставление с incumbent system                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/app/src/shared/ui/tokens.css:1`, `apps/app/src/app/globals.css:29`                                | Navy/ink/mint/gold, Manrope и общий золотой focus-visible сохранены. В создание не добавлены новые цвета, шрифты или motion.                                                                                                                                       |
| `apps/app/src/features/catalog-admin/catalog-admin.css:48`                                              | Повторно используется одноколоночная `catalog-publication`: gap 16 px, max-width 640 px, минимум поля 44 px, radius 8 px, incumbent 16 px текст. `overflow-wrap: anywhere` защищает preview также вне list item; это локальная адаптация переноса, не новый токен. |
| `apps/app/src/app/globals.css:485`                                                                      | `tasks-action` повторно использует панель, линию, ink, radius 9 px, 13 px текст и минимум 44 px. Подтверждение создания сохраняет этот существующий вариант действия.                                                                                              |
| `apps/app/src/features/catalog-admin/catalog-create.tsx:163`                                            | Видимые native labels/inputs/textarea; объяснение выключенного состояния и отсутствия квоты до полей; preview через существующий CatalogTerms и отдельное подтверждение. Никаких новых декоративных контейнеров, raster assets или эффектов.                       |
| `apps/app/src/features/catalog-admin/catalog-admin.tsx:174`                                             | Закрытая creation action / одна inline форма находится над списком, включая пустую область. Scope/read time и текущий каталог сохраняют порядок. Подтверждённый success закрывает форму и перечитывает каталог/audit.                                              |
| `apps/app/src/features/catalog-admin/catalog-create.tsx:36`                                             | Один body/key намерения, ручной идентичный retry, блокировка conflict/rejected intent, dirty guard, abort и alive guard подтверждены исходником. Denial cleanup интегрирован в catalog-admin. Runtime проверки этих путей взяты из отчёта исполнителя.             |
| `apps/app/src/features/catalog-admin/catalog-terms.tsx:21`, `apps/app/src/features/audit/audit-log.tsx` | Название/условия/золотая табличная цена повторно используют один компонент. Audit явно называет первоначальные выключенные условия version 1 без квоты, не представляет их текущими условиями или текущими счётчиками.                                             |

Прежние R0 frontmatter и правила **The Meaningful Accent Rule** / **The Flat Surface Rule** согласуются с этим расширением: смысловые акценты сопровождаются текстом, строки и формы остаются плоскими. Рабочая шкала R1 описана отдельно в § 7 плана и Production Mini App extension DESIGN.md; её не подменяет презентационная R0 шкала.

## Проверено непосредственно этим проходом

Через `view_image` непосредственно открыты четыре существующих captures: [form-320](assets/f07-creation/catalog-creation/form-320.png), [preview-1280](assets/f07-creation/catalog-creation/preview-1280.png), [success-390](assets/f07-creation/catalog-creation/success-390.png), [audit-320](assets/f07-creation/catalog-creation/audit-320.png). Сверены начало документа, navy/Manrope/mint/gold, плоская вертикальная последовательность, перенос длинных условий, видимый золотой фокус формы, разделённые preview/confirmation и текст «выключена, без квоты» в соответствующих состояниях. У 320 px формы и 390 px success просмотрщик уменьшил высокие изображения; точные CSS размеры подтверждаются исходником, не измерением уменьшенного preview.

Команда `Get-ChildItem docs/verification/assets/f07-creation/catalog-creation -File | Select-Object Name` подтвердила наличие всех 20 PNG. Остальные 16 этим проходом непосредственно не открывались: все 20 просмотрены независимым finish reviewer, их исходные размеры и состояния перечислены в его отчёте. Результаты Playwright 320/360/390/1280 px, keyboard, CSS text scaling, retry/conflict/empty/dirty/Back/denial/late response и browser-to-DB относятся к [отчёту исполнителя](2026-10-05-f07-creation.md). Документер не повторял runtime-команды, браузер, рендер или detector.

Команды чтения `Get-Content` и `rg -n` сверили перечисленные system/source/evidence файлы. `Get-FileHash DESIGN.md,.impeccable/design.json` зафиксировал SHA256 до записи отчёта:

- DESIGN.md: `1D90EF19A86428DD1C7C5B8E89916F5EC28CEC599D59A7FCFA51EC0C85D7FE96`.
- `.impeccable/design.json`: `71BBDAC9A4A746FCF1B873CD6305056933A3D0FFFFB513E699E6D7177080AA65`.

После записи отчёта эти же hashes проверены повторно и сохранены. Documenter не редактировал реализацию, PRODUCT, DESIGN или sidecar.

## Пять строк системы

1. Палитра: incumbent navy/ink, mint для управления, gold для цены/focus; состояния имеют текст.
2. Типографика: Manrope; R1 использует прежние 12/13/15/16/18 px роли, R0 frontmatter не расширяется ради этого среза.
3. Композиция: плоский список и одна inline форма над ним; native labels, preview и отдельное подтверждение.
4. **The Meaningful Accent Rule**: смысловые цвета сохраняют своё назначение и сопровождаются текстом.
5. **The Flat Surface Rule**: тон/линии задают группировку; новых теней, материалов, assets и motion нет.

## Drift и ограничения

Прочитан сохранённый [detector.json](assets/f07-creation/detector.json): четыре advisory о прежних 16/18 px в `catalog-admin.css:14,43,59,78` относительно R0 frontmatter. Этот machine-readable/documentation drift отмечен, не канонизирован новым frontmatter и не исправлен: расширение сохраняет incumbent R1 систему, замена её шкалы не входит в задачу. В новом фрагменте не обнаружены kicker, glyph-icon система, hard offset shadow или другие декоративные нарушения craft floor; это вывод по проверенным исходникам и четырём captures, не универсальный аудит репозитория.

Новые renders/detector не запускались. Синтетический Chromium и CSS text scaling не доказывают физические Telegram Android/iOS, системный zoom, screen reader, клавиатуру/safe areas на устройстве или измеренный контраст. R1/F07, реальные права/экономика, P-01…P-06, внешний выпуск и целевой Linux/PostgreSQL 17.6 CI остаются открытыми. Этот проход документирует сохранение визуальной системы; backend-приёмку и неизвестные решения владельца он не заменяет.
