# F08: локальная обработка synthetic outbox

Требование: F08 из § 11, нейтральные сообщения и независимость от бизнес-транзакций из § 8; режим ожидания § 10 и критерии § 12. Архитектурное решение — [ADR-0012](../adr/0012-synthetic-notification-worker.md).

## Контракт

- Миграция 000021 не исполняет очередь и не меняет ранее сохранённые события. Enroll происходит только при явно разрешённом запуске; pending synthetic outbox получает одну simulation row. Sent/failed/suppressed исходного outbox не включаются.
- Claim: короткая транзакция, до 100 enroll, SKIP LOCKED, attempt +1, lease 30 s с новым token. Неистёкшая обработка не захватывается заново. До пяти попыток; исчерпанные crash leases закрываются до выбора следующего события.
- Process: блокировка simulation row, проверка собственного token/срока, private lock/read active получателя, повторная проверка срока, fixed text по десяти существующим видам события, fake transport, запись результата. Ошибка БД откатывает simulation writes; lease остаётся для восстановления. Отзыв active перед получением блокировки подавляет событие навсегда; отзыв после блокировки ждёт завершения. Logout/истечение отдельной сессии не означает выбытия участника и не подавляет событие.
- Сбой транспорта: retry с задержкой 30/60/120/240 s, пятый сбой failed. Зависание ограничено 5 s и сигналом отмены. Только codes transport_unavailable/timeout/recipient_inactive/unsupported_kind/attempts_exhausted; сырые исключения не сохраняются. Transport не получает заголовки, описания, причины, суммы, Telegram ID или сессии.
- Готовые результаты имеют status simulated, а не sent. Исходный outbox, балансы, audit/ledger/заявки не меняются. Терминальные результаты защищены DB trigger. Уведомления о согласовании не заявляют выдачу.
- Worker использует отдельную роль и окружение. `SYNTHETIC_NOTIFICATIONS_ENABLED=false` — default. Никаких автоматических чтений app env, подключений/записей при false, bot token, Bot API или реальных адресатов.

## Локальные команды

```powershell
# TEST_DATABASE_URL — только изолированная тестовая БД с правом создать disposable DB.
$env:TEST_DATABASE_URL='postgres://impuls_test@127.0.0.1:55432/impuls_f03'
bun run test:notifications
```

Тест создаёт `impuls_notifications_<uuid>` с проверкой имени, применяет 000001–000021 и удаляет только эту БД. Данные исходной указанной БД не включаются в обработку. Для отдельной локальной симуляции предварительно применить миграции через существующий `db:migrate`; настроить отдельное соединение с current_user=impuls_worker и явно включить flag. В локальном доверенном harness допускается URL option `-c role=impuls_worker` от тестового владельца. Это не production credential provisioning.

```powershell
bun run build:worker
bun run worker:simulate
bun run worker:status
```

Первая команда строит ESM; вторая обрабатывает максимум 20 попыток; третья читает только агрегированные счётчики. Worker не запускает бесконечный цикл или scheduler, не переоткрывает failed/suppressed/simulated и не сбрасывает очередь. Ошибка/неверная роль дают exit 1 и нейтральный WORKER_UNAVAILABLE; успешный disabled запуск даёт exit 0 без подключения. TLS на удалённом endpoint требует CA и не принимает конфликтующие URL ssl options.

## Границы приёмки

Новый UI отсутствует; браузерные размеры, клавиатура и Telegram WebView не относятся к этому серверному изменению. Не выполнены admin UI, Bot API и его ошибки, реальная доставка/consent, reminder/season events, hosting/supervisor, backup restore и PostgreSQL 17.6 CI. P-01…P-06 и F08/R1 не закрыты. Scheduler истечения F06 — отдельная операция с правилами и аудитом, а не побочный эффект уведомления. [Точные результаты](../verification/2026-10-04-f08-simulation-worker.md).
