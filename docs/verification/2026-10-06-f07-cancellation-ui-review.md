# F07: независимый finish review формы отмены

## 1. Scope / evidence validity

Проверен только локальный Operate-срез отмены будущих синтетических условий по `docs/implementation/2026-10-06-f07-schedule-cancellation-slice.md` и последнему direction contract в `apps/app/.impeccable/surfaces/apps-app-src-features-catalog-admin-catalog-admin-tsx.md`. Прочитаны PRODUCT.md, DESIGN.md, относящиеся требования IMPLEMENTATION_PLAN.md §§ 7, 10–12, craft-floor.md и operate.md установленного Impeccable 4.3.1. Это расширение существующей поверхности: comp, QUALITY BAR, новые assets и замена визуального мира не применяются.

Открыты все восемь обязательных PNG в `.impeccable/review/cancellation/`: `form-320/360/390/1280.png`, `preview-320/360/390/1280.png`. Каждый показывает соответствующую форму или preview, весь документ с верхней шапки до историй, без пустых/чёрных областей и видимого обрезания. Длинная строка переносится. Код создания доказательств `tests/browser/catalog-cancellation.mjs:213` проверяет document overflow/pageerrors, возвращает документ наверх и снимает fullPage; fixture задаёт reduced motion (`:28`). Данные синтетические. Переданный результат единственного detector: `[]`; reviewer detector не повторял.

Переданный старый `text-scale-320.png` исключён из оценки: автор отдельно переснимает эффективное увеличение текста. Обязательная восьмифайловая матрица пригодна для этого review.

## 2. Findings / severity / source

Материальных замечаний P0–P2 в проверенном объёме не обнаружено. Блокирующих визуальных или кодовых нарушений direction contract нет.

Подтверждено прочитанным кодом:

- Текущие условия и квота сохраняются вокруг формы; действие зависит от отдельного `canCancelSchedule`, наличия будущей версии и допустимого состояния чтения (`catalog-admin.tsx:229`, `:243`, `:289`, `:301`). Отмена не связана с `canPublish`/`canSchedule`.
- Форма повторяет полный target и его дату МСК перед причиной; preview показывает неизменный target, основание и отдельное подтверждение (`catalog-cancel.tsx:157`, `:162`, `:163`; `catalog-terms.tsx:11`, `:49`). Сохранение старых заявок и квот объяснено до ввода (`catalog-cancel.tsx:159`).
- Pending блокирует повторный confirm, intent хранит одно тело/ключ, unknown/429/503 позволяют одинаковый retry; 400/409/413/422 блокируют повтор и указывают закрыть форму/перечитать (`catalog-cancel.tsx:56`, `:91`, `:95`, `:124`, `:177`). После отправки причина не редактируется.
- 401/403 передаются общему session-loss/revocation механизму, 404 закрывает форму и очищает защищённые catalog/history/quota queries (`catalog-cancel.tsx:83`, `:87`; `catalog-admin.tsx:267`).
- Dirty, закрытие, refresh, смена области и Telegram Back используют действующий guard; unmount отменяет запрос, alive gate подавляет поздние ответы до и после чтения JSON. Ключ компонента включает scope и version ID (`catalog-cancel.tsx:44`, `:49`, `:82`, `:106`, `:212`; `catalog-admin.tsx:51`, `:101`, `:154`, `:246`).
- История и аудит именуют отмену текстом и сохраняют исходный target (`catalog-history.tsx:47`; `audit-log.tsx:35`, `:307`).

## 3. Direction / craft assessment

Срез соблюдает incumbent navy/Manrope/mint/gold, плоские строки и inline раскрытие. Повтор target полезен именно для подтверждения отмены; он отделён от текущих условий заголовком и подписью версии. На 320/360/390 px действия остаются читаемыми и занимают ширину формы; на 1280 px узкая рабочая колонка сохраняет установленную композицию. Новых декоративных карточек, иллюстраций или движения нет.

Native label/textarea, required/maxLength, именованный form, aria-busy, status/alert и native buttons поддерживают действующий доступный паттерн (`catalog-cancel.tsx:137`, `:192`, `:208`). Общие controls имеют min-height 44 px и gold focus ring (`globals.css:45`, `:485`); форма наследует 16 px поля и перенос (`catalog-admin.css:47`, `:65`). Проверка стандартной WCAG luminance формулой по исходным токенам дала ink/bg 16.70:1, muted/bg 9.79:1, muted/panel 8.28:1, ink/panel 14.11:1, mint/bg 11.67:1. Это подтверждает выбранные пары токенов, а не измерение каждого пикселя браузера.

## 4. Remaining verification limits

Reviewer не запускал браузер, тесты, backend или устройство. Исходник browser suite содержит сценарии success/retry/conflict/denial/independent permission/dirty Back/pending/keyboard/late response; наличие исходника само по себе не означает их успешный запуск. Восемь PNG подтверждают композицию формы/preview, но не выполнение серверной операции или отрицательных сценариев. Pending/error/denial/history/audit здесь проверены по коду, без отдельного rendered evidence этих состояний.

Автор передал отдельные результаты: первый focus run exit 0, 10 тестов (8 PostgreSQL/HTTP/browser-to-DB и 2 contract) и 18 mocked UI сценариев; затем 59 admin regression тестов в 5 suites и 9 restore тестов, включая cancelled history/replay/ACL. Это переданные execution results, не самостоятельные запуски reviewer. Финальная UI-проверка увеличенного текста и дополнительных keyboard/late-response сценариев в момент передачи ещё выполнялась.

Эффективное увеличение текста, screen reader, физические Android/iOS Telegram WebView, клавиатура/safe areas/тема/сеть, target CI и полная приёмка F07/R1 остаются вне этого review. P-01…P-06 не утверждены. Этот вывод не разрешает реальные данные, полномочия или внешний выпуск.

## 5. Disposition

ship

Применяется к проверенной локальной форме/preview синтетической отмены и перечисленным кодовым путям. Полная функция F07 и фаза R1 этим review не приняты.

### Дополнительная проверка увеличенного текста

После основного review автор заменил `.impeccable/review/cancellation/text-scale-320.png`; reviewer открыл новый файл один раз. Полный документ начинается с шапки, preview формы действительно показывает увеличенные строки и controls. Scoped override `.catalog-publication` и descendants — `font-size:24px!important; line-height:1.6!important` — сохраняет читаемые переносы target/date/reason и кнопок, без видимого обрезания. Shipping UI не менялся; исходная восьмифайловая матрица и disposition `ship` сохраняют свой объём. Detector не повторялся, новая defect hunt не выполнялась.

Автор также передал final focused runner exit 0: 11 tests и 20 browser scenarios, включая required/keyboard, pending, denial и late response после смены области. Предыдущий полный admin runner имел 59 passed tests, 40 admin-catalog, 17 immediate-publication и 20 scheduling browser scenarios, затем остановился на blanket `*` text-override stress assertion. Полный runner не объявляется пройденным. Scoped новый снимок проверяет увеличение текста именно формы отмены; глобальное OS/browser увеличение всего workspace, физические устройства и Telegram остаются непроверенными этим review.
