# F06: документирование расширения интерфейса решений

Дата: 03.10.2026. Объект: `apps/app/src/features/rewards/reward-decisions.tsx`, `rewards.css`, интеграция в `reward-catalog.tsx`. Режим **Operate**; пользователь подтвердил: «Сохранить текущий компактный список и встроенную форму».

## Основание и граница

`PRODUCT.md:36` фиксирует локальный синтетический срез. Рабочий UI-контракт — `IMPLEMENTATION_PLAN.md:193–228`, строка F06 — `:275`, критерии проверки — `:283–293`. Direction contract: `apps/app/.impeccable/surfaces/apps-app-src-features-rewards-reward-decisions-tsx.md:3–11`; доменный контракт: `docs/implementation/2026-10-03-f06-decisions-slice.md:3–13`, ADR-0009.

Прочитаны impeccable `SKILL.md`, `reference/document.md` и применимые положения `reference/new-work.md`. New-work `:29–31`, `:145` предписывает обычному расширению наследовать мир и композицию, сравнить итог с существующей системой, сохранить её файлы и сообщить прежние расхождения. Этот проход записывает только данный отчёт. DESIGN.md, sidecar, код, токены и чужие отчёты сохранены; context/detector/tests повторно не запускались. Новая визуальная система и approved comp не входят в выбранный code-led контракт.

## Подтверждено кодом и изображениями

| Требование                                                             | Соответствие и конкретные источники                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navy/Manrope, mint действие, gold награда; осмысленный цвет с текстом. | `DESIGN.md:138–171`, план `:195–199`; совпадающие цвета в `apps/app/src/shared/ui/tokens.css:2–12`. Body наследует Manrope, 15 px/1.5 (`apps/app/src/app/globals.css:30–47`); резерв — gold и tabular numerals (`rewards.css:36–39`). List/form captures сохраняют эти роли.                                                                                                                                                        |
| Плоские строки и одна встроенная форма.                                | `DESIGN.md:203–211`, `:232`; `reward-decisions.tsx:223–224`, `:358–387`, `globals.css:426–434`, `:518–523`: divided list и выбранная tonal panel. Новых теней, изображений, шрифтов или authored motion в feature нет.                                                                                                                                                                                                              |
| Получатель, сохранённые условия и последствия до подтверждения.        | `reward-decisions.tsx:228–281`: получатель, title/conditions, первоначальный резерв, версии/период, последствия approve/reject, причина, checkbox, одна операция. `:142–145`, `:200–203` отделяют approval от issuance. Личная история сохраняет смысл и пометку «текущее имя» (`reward-catalog.tsx:571–592`).                                                                                                                      |
| Читаемость на 320/360/390/1280 и крупный текст.                        | `rewards.css:1–27`, `:107–118`: overflow-wrap, 65ch, 1.6 leading и mobile stacking. Native select — 16 px/44 px, textarea — 16 px/120 px (`:57–90`). Gold focus, 48 px primary, 44 px return и радиусы 8/9/12 наследуются (`globals.css:45–47`, `:333–344`, `:485–495`, `:518–523`). Captures показывают перенос без горизонтального обрезания и полный action group; это не утверждение о размещении всей формы в первом viewport. |
| Актуальные данные, ошибки и ручное восстановление.                     | `reward-decisions.tsx:63–110`, `:155–180`, `:215–221`, `:247–300`, `:314–355`, `:373`, `:393`: loading, revocation, stale gating, конфликт с новым подтверждением, неизменный intent и заблокированное редактирование/уход при unknown, Retry-After. `:70–90` реализует guarded departure и приоритет формы в Telegram Back.                                                                                                        |
| Вход через существующий каталог и точную область.                      | `reward-catalog.tsx:52–55`, `:257–258`, `:289–297`; области приходят с сервера (`reward-decisions.tsx:45–60`, `:331–350`). Видимость кнопки не доказывает серверные полномочия; отрицательные HTTP/DB свидетельства приведены основным verification report.                                                                                                                                                                         |

## Последние исправления и проверенный пакет

Независимый `docs/verification/2026-10-03-f06-decisions-ui-review.md:11–23` вернул **ship**; F06-UI-01…03 — **resolved**. Это оценка трёх исправлений, не повторный полный аудит.

- F06-UI-01: `rewards.css:92–99` задаёт feature-scoped grid, gap 12 px и full-width primary. Form/large-text/conflict/unknown/rate изображения показывают отделённые контролы.
- F06-UI-02: `rewards.css:100–105` задаёт disabled opacity .5, not-allowed и неизменный фон при disabled:hover. Conflict показывает приглушённое решение; unknown/rate сохраняют яркий manual replay. Hover-поведение доказано предоставленным browser result, статичный снимок сам его не измеряет.
- F06-UI-03: `reward-decisions.tsx:180`, `:348` используют «данные решения сохранены» и «Нет области для решений по заявкам». Lost/no-scope изображения подтверждают пользовательские сообщения.

Самостоятельно прочитаны PRODUCT.md, DESIGN.md, sidecar, surface brief, затронутые TSX/CSS, разделы плана и verification reports. `rg --files docs/verification/assets/f06-decisions/reward-decisions` подтвердил пакет 34 PNG. Через `view_image` просмотрены 17 representative files: `target-list-{320,360,390,1280}.png`, `target-form-{320,360,390}.png`, `form-1280.png`, `conflict-320.png`, `target-{large-text,unknown,lost,rate,empty,error,disabled,no-scope}-320.png`. Они показывают названные состояния и полные применимые действия. Large-text preview уменьшен viewer; исходник сохранён. Просмотр всех 17 document-top full-page originals независимым reviewer отражён в `ui-review.md:5–7`; данный documenter не заявляет личный просмотр всех 34 дублей/crops.

Предоставленные результаты команд из `docs/verification/2026-10-03-f06-decisions.md:23–25`, `:35–43`, без повторного исполнения documenter:

| Команда                                                                                                                                                                  | Записанный результат                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check`                                                                                                                                                          | Exit 0; 53 unit/contract passed, 191 PostgreSQL/HTTP skipped в этом запуске, app+worker build passed.                                                            |
| `$env:TEST_DATABASE_URL='postgres://impuls_test@127.0.0.1:55432/impuls_f03'; $env:TEST_SCREENSHOT_DIR='docs/verification/assets/f06-decisions'; bun run test:task-slice` | Exit 0; 191 PostgreSQL/HTTP passed, 28 suites без skips; browser suites прошли.                                                                                  |
| `bun run build:app` после TSX/CSS исправлений                                                                                                                            | Passed.                                                                                                                                                          |
| `node tests/browser/reward-decisions.mjs`; `node tests/browser/rewards.mjs` после исправлений                                                                            | 22 и 21 passed; gap 10–13 px на четырёх ширинах, disabled forced-hover и regression общего CSS. Synthetic HTTP fixtures; real HTTP/DB — отдельный полный runner. |
| `bun run format:check`; `bun run lint`; `git diff --check` после последней правки кода                                                                                   | Exit 0; format/lint без warnings, Git отдельно сообщил о прежних CRLF.                                                                                           |

Keyboard/reduced-motion и сценарное восстановление — предоставленные browser evidence. Token contrast 16.70:1 ink/base, 9.79:1 muted/base, 8.28:1 muted/panel, 10.01:1 gold/panel и 11.67:1 base/mint взят из расчётов reviewer (`ui-review.md:39`), не измерен documenter на физическом экране. Detector ранее один раз вернул `[]`; его результат не заменяет визуальную проверку.

## Прежние различия источников — без ремонта

`DESIGN.md:140`, `:285` прямо ограничивает frontmatter наблюдениями R0. R0 body 1.65, labels 11 px и buttons 13 px (`:44–63`) отличаются от существующего рабочего body 15 px/1.5 и fields 16 px. Рабочую шкалу задаёт план § 7; старые размеры не перенесены на F06.

Sidecar `.impeccable/design.json:3` имеет generatedAt 22.09.2026; breakpoints 1050/780/420 (`:330–342`), snippets (`:345–415`) и narrative (`:417–450`) сохраняют автономную презентацию. Он не описывает весь текущий R1 с `--color-*` и другой оболочкой; это прежнее ограничение coverage. Существующие расширения уже отмечены в `DESIGN.md:277–309`. Sidecar не регенерирован.

Общие `.tasks-action:disabled` остаются .6/wait (`globals.css:508–510`), хотя R0 buttons описаны .5/not-allowed (`DESIGN.md:217`); общий `.tasks-state` остаётся muted (`globals.css:415–419`), тогда как R0 field validation описан coral (`DESIGN.md:250`). Эти существующие варианты не унифицировались и не стали новым списком правок после scoped verdict.

SHA-256 DESIGN.md и sidecar проверен до/после записи отчёта: `F1FCF793899C15C86405260380615AFE31F3D7D4CF7024D6DB3C6E8032B369F1` и `71BBDAC9A4A746FCF1B873CD6305056933A3D0FFFFB513E699E6D7177080AA65` соответственно.

## Границы доказательств

Локальный synthetic слой не доказывает завершение F06/R1, реальную выдачу или разрешение служебных поощрений. Fulfillment/entitlements, истечение, отмена после согласования, полный admin/catalog/audit, доставка outbox остаются вне среза (`PRODUCT.md:36`, основной verification report `:49`; план `:275`, `:291`).

Физический Telegram Android/iOS, экранная клавиатура, safe areas, системное увеличение текста и assistive technologies на устройствах не проверены; synthetic large text этого не заменяет. P-01…P-06, реальные условия/контур, пилот, PostgreSQL 17 CI, restore drill и security scan перед пилотом открыты согласно основному report. Внешний release не выполнялся этим проходом.

Проверка самого документа: `bun node_modules/prettier/bin/prettier.cjs --check docs/verification/2026-10-03-f06-decisions-design-documentation.md` — exit 0, All matched files use Prettier code style. Сверка SHA-256 сохранённых DESIGN.md/sidecar — значения совпали.
