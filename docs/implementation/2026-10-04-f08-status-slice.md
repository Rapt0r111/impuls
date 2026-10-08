# F08/F07: просмотр сводки симуляции уведомлений

Основание: IMPLEMENTATION_PLAN.md §§ 7–8, 10–12, F08/F07; [ADR-0014](../adr/0014-scoped-notification-simulation-status.md).

## Контракт

Схема 000001–000022. Никаких новых пользователей, цен, полномочий, реальных данных или решений P-01…P-06. Приложение читает три колонки private receipts; worker продолжает свой прежний цикл. Reader не вызывает claim/process и не меняет исходный outbox, balances, ledger, audit, tasks, redemptions или receipts.

`GET /api/v1/admin/notifications` принимает только необязательный `scope` UUID. Повторяющиеся/неизвестные параметры дают 400; без действующей сессии 401, inactive/revoked 403, выключенный flag или недоступная область 404, ошибка инфраструктуры 503. Все ответы private/no-store. POST не поддержан. Нет пагинации или конфликта версии: сводка читается одним statement snapshot и перечитывается явно.

Отдельное `admin.notifications` действует только в точной области. Ни `admin.audit`, ни другой admin/task/reward/ledger binding, ни членство не заменяют его. Права перепроверяются на каждый запрос, включая обновление. По умолчанию выбирается первая разрешённая область по name/id.

Ответ `mode:simulation`, `scope`, `scopes`, `updatedAt`, `counts`, `errors`. Счётчики complete с нулями: unclaimed, ready, processing, retry, simulated, failed, suppressed. Обрабатываются только synthetic pending source events. Ошибки complete с нулями: transport_unavailable, timeout, attempts_exhausted, recipient_inactive, unsupported_kind. Каждое событие входит в один статус; error breakdown пересекается со статусами и не суммируется с ними как дополнительные события. Никаких recipient/task/reward/event IDs, имён получателей, текста push, причин предметного решения, lease или сырых исключений.

## UI и состояния

Operate: существующие navy/Manrope, mint controls, flat dividers, semantic dl, native select/details, 44 px controls. Рабочая кнопка «Уведомления» появляется по полученному серверному праву; это только discoverability, сервер решает доступ. Четыре рабочих направления занимают два столбца.

- Loading: текст загрузки и aria-busy; обновление disabled во время запроса.
- Ready/success: серверные counts и время МСК, явная симуляция без Telegram-отправки, ручное обновление; раскрываемые последние причины.
- Empty: пояснение, когда возникают события, без выдуманного результата worker.
- Offline/503/invalid response: сообщение о повторной загрузке; прежняя подтверждённая сводка сохраняется в памяти текущего экрана с прежним временем.
- 404 disabled/denied: разные тексты; protected сводки всех query keys очищаются, в том числе при повторном открытии.
- 401/403: очистка сводки, общий потерянный доступ и повторный вход; защищённые строки скрыты. Статусы 401/403/404 действуют и при не-JSON теле ошибки от proxy.
- 400 — некорректный внешний query, клиент не формирует его; нет формы/validation мутации. 409 не применим к чтению одного snapshot. Нет фонового polling, автоматического retry, записи в localStorage, изменения отчётов/черновиков или экономики. BackButton использует прежний workspace root guard.

## Проверка и эксплуатация

`bun run check` без TEST_DATABASE_URL. Изолированная локальная БД после миграций: `bun run test:task-slice --notification-status-only` с TEST_DATABASE_URL. Runner поднимает production Next на 3100 под impuls_app, запускает runtime/migration/HTTP/browser-to-DB и браузерную матрицу, останавливает сервер. Тесты удаляют только UUID-собственные записи; migration suite создаёт и удаляет проверенную disposable DB `impuls_status_<uuid>`.

История всех событий читается агрегированием без нового индекса; больших объёмов не измеряли. Перед пилотом нужны EXPLAIN/load checks и согласованные retention/RPO/RTO. Remote PostgreSQL 17.6, Telegram устройства, реальные transport failures и полный F08/R1 этим локальным срезом не принимаются. Следующие F08 работы: минимальный scoped event list/детализация, контракт неоднозначного Bot API результата, реальный transport и hosting.
