# F07: документация дизайна отложенных условий, 5 октября 2026

Это узкий Impeccable Documenter pass для локального расширения Operate: одна будущая версия условий синтетической косметики. Проверены существующая система и её применение; новый визуальный мир не утверждается. Корневой `DESIGN.md` дополнен только фактическим абзацем. Frontmatter и `.impeccable/design.json` сохранены; токены, шрифты, ассеты, motion и компоненты этим проходом не изменены.

## Источники и свидетельства

- Прочитаны shipped `agents/impeccable_documenter.toml` и `reference/document.md` из Impeccable 4.3.1; использован scan/ordinary-extension режим с сохранением incumbent системы.
- `IMPLEMENTATION_PLAN.md`, § 7, 10–12: состояния рабочего UI, синтетический режим до P-решений, F07 (права, версии, журнал), отдельная мобильная и серверная приёмка. `PRODUCT.md` и `DESIGN.md` прочитаны как продуктовый контекст и существующая система, не как доказательство production возможностей.
- Финальный блок «Direction contract — scheduled terms» в `apps/app/.impeccable/surfaces/apps-app-src-features-catalog-admin-catalog-admin-tsx.md`: независимое действие планирования, UTC ввод, МСК preview, сохранение прежних заявок, явно недоступная отмена, один открытый form и dirty/Back guard.
- `catalog-admin.tsx:233` показывает будущие условия в закрытом native disclosure; `:275` отделяет ограничения будущей версии, `:339` — действие `canSchedule`. `catalog-publish.tsx:227`–`:355` содержит пояснение, поля, preview, подтверждение и inline feedback; `:323` подписывает UTC, `:334` объясняет МСК. `catalog-terms.tsx:11` задаёт Europe/Moscow, `:37` выделяет цену, `:47` использует semantic time.
- `catalog-admin.css:14`, `:43`, `:48`–`:92`: 18 px заголовки, 16 px quota heading и поля, одноколоночная форма максимум 640 px, перенос длинного текста, 8 px field radius, минимум 44 px полей и checkbox строки. `apps/app/src/shared/ui/tokens.css` и `apps/app/src/app/globals.css:35`–`:47`, `:485`–`:508` подтверждают существующие палитру, Manrope, body и focus/action стили. `.impeccable/design.json` прочитан как incumbent R0 sidecar (schemaVersion 2), не регенерирован.
- Визуально рассмотрены только авторитетные `assets/f07-scheduling/catalog-scheduling/form-320.png` (320 × 2814) и `preview-1280.png` (1280 × 2002) через `view_image`. Мобильный снимок показывает текущие условия/квоту перед inline формой, UTC поле и gold focus на основании; desktop preview сохраняет узкую рабочую колонку и показывает полные будущие условия с датой МСК, основание и отдельные действия возврата/подтверждения/закрытия. В этих снимках длинные условия переносятся внутри колонки. Это сравнение supplied captures, а не новый browser run или измерение computed styles.

## Система: пять строк

1. Палитра: существующие navy base/panel, pale ink/muted, mint действия и gold цена/focus; Meaningful Accent Rule сохранён.
2. Типографика: Manrope, runtime body 15 px / 1.5, поля 16 px, заголовки условий/формы 18 px; новый ramp не вводится.
3. Композиция: одна inline колонка после текущих условий/квоты; preview заменяет поля, а сохранённая будущая версия остаётся закрытым disclosure.
4. Контролы: native labelled datetime-local/checkbox/textarea, поля 8 px radius, действия минимум 44 px, gold focus-visible 3 px с отступом 3 px.
5. Группировка: плоские строки и тонкие slate dividers по Flat Surface Rule; новые тени, motion и ассеты отсутствуют.

## Границы и несовпадения

Предсуществующие различия не исправлены и не превращены в новые системные токены: корневые frontmatter и sidecar описывают R0 презентацию, в том числе body leading 1.65 и presentation ramp; рабочий R1 уже использует body leading 1.5 и локальный 18 px шаг. Scope scheduling наследует эти фактические значения. Записанный R0 field fill также отличается от runtime `--color-bg`. Ни одно из этих различий не возникло как новая норма этого расширения.

В коде видны immutable intent/date, ручной повтор после неподтверждённого результата, блокировка после конфликта/отклонения и dirty guard; визуальное свидетельство двух снимков не доказывает исполнение этих сценариев. Исправление `onDenied` с отменой catalog/history/quota запросов перед очисткой cache является поведенческим и не меняет дизайн; его проверка принадлежит общему verification/review родительской задачи.

В этом проходе не запускались серверные, browser/e2e, contrast или screen-reader тесты. Физический Telegram Android/iOS, системное масштабирование, клавиатура устройств, remote deployment, реальные данные и P-решения остаются вне этого свидетельства. Два рассмотренных снимка не заменяют приёмку всех ширин и состояний из § 12. Здесь нет утверждения о production readiness либо полной приёмке F07/R1.

Проверка документации: чтение перечисленных файлов (`Get-Content`/`rg`) и визуальный просмотр двух локальных raster (`view_image`). В ходе поиска один PowerShell вызов с brace expansion и один glob CSS вызов `rg` не исполнились; необходимые target TSX/CSS затем прочитаны отдельными путями, эти вызовы не считаются проверками функциональности.
