# F07: документация локального UI отмены будущих условий

## Объём и основание

Проход Impeccable document от 6 октября 2026 относится только к расширению существующего Operate-каталога синтетической косметики. Основание — `docs/implementation/2026-10-06-f07-schedule-cancellation-slice.md:7`, последний direction contract в `apps/app/.impeccable/surfaces/apps-app-src-features-catalog-admin-catalog-admin-tsx.md`, F07 и UI-критерии `IMPLEMENTATION_PLAN.md:322`, `:339`. Прочитаны PRODUCT.md, DESIGN.md и установленный Impeccable 4.3.1 `reference/document.md`. PRODUCT.md:40 отдельно сохраняет границы локальной синтетики и непринятой F07/R1.

Владелец задачи уже добавил локальную запись в канонический `## Components` (`DESIGN.md:219`) и поручил сравнить её с кодом без изменения frontmatter или sidecar. Этот проход пишет только данный отчёт. Новый мир, qualitative workshop, повторный выбор палитры и регенерация `.impeccable/design.json` не требуются для такого локального продолжения. Корневой DESIGN.md не заменён.

## Подтверждено кодом и текущей документацией

- Самостоятельное действие отмены появляется после закрытого раскрытия будущей версии только при наличии `scheduled` и `canCancelSchedule`; чтение с ошибкой или в процессе блокирует открытие (`catalog-admin.tsx:234`, `:243`, `:289`). Текущие условия остаются перед ним, текущая квота — после формы (`:229`, `:301`). Независимость от публикации/планирования соответствует direction contract.
- Форма сначала объясняет предел отмены и сохранение прежних условий, квот и существующих заявок, затем повторяет полный неизменный target (`catalog-cancel.tsx:157`, `:158`, `:162`). Общий компонент показывает название, номер, enabled state, цену, условия, дату Europe/Moscow с явным «МСК» и срок резерва (`catalog-terms.tsx:11`, `:31`, `:40`, `:49`, `:57`). Часы клиента не решают допустимость отмены.
- Native textarea с видимой связанной меткой, required и maxLength 2000 принимает только причину. Первый submit строит preview; preview заменяет поле причиной и отдельной кнопкой подтверждения. До первой отправки можно вернуться к причине (`catalog-cancel.tsx:137`, `:143`, `:163`, `:168`, `:192`). После отправки intent сохраняет тело и ключ, поле не возвращается; pending/blocked блокируют confirm (`:57`, `:58`, `:177`).
- Unknown, 429 и прочие неподтверждённые ответы оставляют тот же intent для ручного retry. 400/409/413/422 требуют закрытия и свежего чтения; 401/403 используют общий access handler, 404 закрывает форму и очищает защищённые запросы (`catalog-cancel.tsx:83`, `:87`, `:91`, `:95`, `:124`; `catalog-admin.tsx:267`). Успешный ответ проверяет scope и полный target до уведомления и перечитывания (`catalog-cancel.tsx:103`, `:107`; `catalog-admin.tsx:251`). Это кодовая проверка поведения, не самостоятельное выполнение серверной операции documenter.
- Dirty state, закрытие и Back сохраняют действующий guard; unmount прерывает запрос, alive gate подавляет поздний результат (`catalog-cancel.tsx:44`, `:49`, `:82`, `:106`, `:212`). Ключ формы содержит scope и scheduled ID (`catalog-admin.tsx:246`).
- История называет отмену текстом «Отменённые будущие условия» и передаёт исходные условия в общий компонент (`catalog-history.tsx:47`, `:171`). Аудит показывает исходные отменённые условия и отдельно основание события (`audit-log.tsx:307`, `:313`, `:347`). Эти состояния сопоставлены по коду; отдельные rendered history/audit captures в обязательную восьмифайловую матрицу не входят.

## Извлечённые визуальные значения и согласованность

Наследуется прежняя navy/Manrope/mint/gold система. Runtime `apps/app/src/shared/ui/tokens.css:2` содержит те же bg, panel, line, ink, muted, mint, mint-hover и gold значения, что incumbent DESIGN.md frontmatter. Использованные цвета не переопределяются новым компонентом. Золотая цена остаётся semantically reward value и tabular, условия — ink с сохранением переносов (`catalog-admin.css:30`, `:35`).

Форма использует прежний `catalog-publication`: grid в одну колонку, gap 16 px, max-width 640 px, min-width 0 и overflow-wrap:anywhere (`catalog-admin.css:48`). Заголовки условий/формы имеют 18 px, поле — 16 px, padding 12 px, радиус 8 px, высоту не менее 44 px; textarea растягивается только вертикально (`:11`, `:57`, `:66`, `:80`). Действия сохраняют panel/ink, 9 px radius, padding 8×14 px, 13 px type и min-height 44 px (`globals.css:485`). Общий focus — gold 3 px с offset 3 px (`globals.css:45`). Новых shadow, animation, icon, raster или component dependency этот UI не вводит.

Команда `git diff -- apps/app/src/shared/ui/tokens.css apps/app/src/features/catalog-admin/catalog-admin.css .impeccable/design.json` вернула пустой вывод; повторная `git diff --numstat -- apps/app/src/features/catalog-admin/catalog-admin.css apps/app/src/shared/ui/tokens.css .impeccable/design.json` также без вывода, обе exit 0. Это подтверждает отсутствие текущей Git-разницы этих incumbent файлов, а не историческую неизменность всего репозитория.

Предсуществующие различия сохранены и не являются изменением отмены:

- R0 body token имеет lineHeight 1.65 (`DESIGN.md:48`), R1 body — 1.5 (`globals.css:37`). Runtime поля имеют 16 px/12 px padding/bg/line, тогда как R0 report-field описывает screen/10 px padding (`DESIGN.md:110`, `:113`); root sidecar textarea snippet дополнительно остаётся 12 px (`.impeccable/design.json:376`).
- R0 кнопки описывают 12×18 px padding и disabled 0.5/not-allowed (`DESIGN.md:92`, `:223`), используемые R1 actions — 8×14 px и disabled 0.6/wait (`globals.css:488`, `:508`). R0 sidecar button snippet содержит 180 ms transition; у используемого action нет такой новой анимации. Документация не переносит эти R0 параметры на отмену.
- Dated scheduling direction и `DESIGN.md:347` записывают недоступную отмену в срезе 5 октября. Последняя запись `DESIGN.md:219` и direction от 6 октября явно вводят независимую отмену. Это историческая последовательность; старый текст не заменяет текущий контракт.
- Sidecar имеет schemaVersion 2 и прежние R0 component snippets (`.impeccable/design.json:2`, `:352`, `:376`). Он не объявлен точным каталогом новых R1 форм. Примитивы/frontmatter, ramps, snippets и prose не переписаны ради этого локального среза.

Материального расхождения новой записи `## Components` с реализацией отмены не обнаружено. Формулировка о 409/422 в ней краткая; фактический UI также блокирует 400/413. Runtime типографические и control отличия от R0 существовали до расширения и явно отделены выше.

## Проверенные captures и происхождение

Самостоятельно открыты через `view_image` все восемь переданных full-page PNG. Заголовок, область/время чтения, текущие условия, закрытая будущая версия, target формы, поля или preview, квота и две истории присутствуют. Длинная неразрывная строка переносится, кнопки читаемы; при 1280 px сохраняется узкая рабочая колонка. Чёрных/пустых кадров и видимого обрезания не обнаружено. Исходные размеры дополнительно прочитаны из PNG IHDR через PowerShell `[System.IO.File]::ReadAllBytes`:

| Ширина | Form, px  | Preview, px |
| ------ | --------- | ----------- |
| 320    | 320×2309  | 320×2281    |
| 360    | 360×2216  | 360×2188    |
| 390    | 390×2210  | 390×2182    |
| 1280   | 1280×2096 | 1280×2050   |

Пути: `.impeccable/review/cancellation/form-{320,360,390,1280}.png` и `preview-{320,360,390,1280}.png`. Это локальные UI-доказательства, не продуктовые растровые ассеты. Их генератор `tests/browser/catalog-cancellation.mjs:213` проверяет document overflow и pageerrors, возвращает страницу наверх и снимает fullPage; `:228` задаёт четыре ширины, `:31` — reducedMotion. Данные синтетические. Источник генерации прочитан; documenter не запускал этот suite и не приписывает себе его execution result. PNG review — подтверждение видимого состояния, не автоматическое доказательство всех interaction/negative путей.

`text-scale-320.png` не включён в самостоятельную оценку: поручение определило восемь обязательных кадров, а scoped reviewer отдельно отметил пересъёмку увеличения текста (`2026-10-06-f07-cancellation-ui-review.md:9`, `:34`). Текущая финальная валидность этого дополнительного кадра documenter не устанавливал.

## Вывод и неизвестное

Documentation disposition: соответствует локальному продолжению; обязательная матрица формы/preview подтверждена. Независимый finish review в `docs/verification/2026-10-06-f07-cancellation-ui-review.md:40` возвращает **ship** только для локального синтетического UI и перечисленных кодовых путей. Этот document pass поддерживает такую ограниченную область вывода и не заменяет finish reviewer.

Самостоятельные запуски browser/backend/tests, пиксельное измерение всех контрастных пар, screen reader, OS scaling, физические Telegram Android/iOS, safe areas/клавиатура/тема/сеть, target CI и внешний выпуск не выполнялись. Contrast ratios в finish review — переданное вычисление по исходным токенам, не собственный browser measurement. Неподтверждённые P-01…P-06, реальные полномочия/экономика и полная приёмка F07/R1 остаются открытыми. Для дополнительных UI критериев нужен актуальный enlarged-text/keyboard прогон автора и отдельный ручной Telegram проход по §12 плана.
