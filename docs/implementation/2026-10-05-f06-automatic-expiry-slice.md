# F06: автоматический возврат просроченного синтетического резерва

Основание: IMPLEMENTATION_PLAN.md § 5 (возврат квоты ровно один раз), § 8 (worker), § 11 F02/F04/F06/F07 и § 12 (гонки, журнал, восстановление); отдельный следующий срез после F07 creation. [ADR-0019](../adr/0019-synthetic-automatic-reservation-expiry.md) фиксирует служебную границу и уточнение restore.

## Контракт

- 000027 сохраняет прежние даты/суммы/авторов, добавляя default-false automatic source. Никакого backfill сроков или выдачи полномочий людям.
- `impuls.expire_one_synthetic_reservation()` без аргументов доступен только expiry caller. true — одна committed expiration; false — нет выбранного доступного кандидата, включая contention. Worker не выбирает actor/scope/price/time/recipient.
- Locks совпадают с reserve/cancel/decide: quota → balance → redemption. Quota SKIP LOCKED откладывает занятый период. Баланс может ждать; worker statement timeout 10 s завершает ошибку без частичного возврата. После потери соединения старый backend может кратко удерживать lock; watch повторяет следующий проход.
- Pending + reached saved deadline → expired/version+1, fixed reason/time/null actor. Возвращаются исходная цена и место исходного периода; XP/used/условия/сезон сохраняются. Возврат неактивному владельцу не восстанавливает его session или membership и не разрешает notification delivery.
- `reward_expiration` ledger связан с первоначальной reserve entry; `reward.expire` audit и `reward.expired` outbox атомарны. UNIQUE resolution и terminal transition запрещают второй возврат. Ошибка любой записи откатывает всё. Внутренним ключом результата служит redemption; ручные ключи/версии/права сохраняются.
- API my-redemptions/audit передают null actor только для automatic expiration с фиксированным текстом; wire schemas отвергают null автора одобрения/другого действия. Owner/exact-scope reads сохраняются. Чтение и часы устройства сами ничего не возвращают.
- UI использует прежнюю историю, показывает «Обработчик» вместо вымышленного человека и сообщает, что возврат подтверждает сохранённый expired. Нет обещания мгновенной обработки или SLA.

## Запуск и остановка

После миграции и сборок задать отдельному процессу `WORKER_DATABASE_URL` с действительной ролью `impuls_expiry_worker` и `SYNTHETIC_RESERVATION_EXPIRY_ENABLED=true`. `bun run worker:expire` выполняет до 20 операций; `bun run worker:expire:watch` повторяет пачки с `WORKER_POLL_INTERVAL_MS`. Notification flag не включает expiry и наоборот. Приложение не получает service credentials. NOLOGIN роль требует отдельно согласованного authenticator/member provisioning; миграция не создаёт hosting credential.

При выключенном flag disabled возвращается до URL/pool. Неправильная роль/интервал/TLS/БД — neutral WORKER_UNAVAILABLE/exit 1. Логи: только mode/status/counts/error code. Локальный watch не является внешним supervisor или доставкой Bot API.

000027/API/UI/worker выпускаются согласованно перед включением. Откат: остановить процесс и выключить флаг, сохранять committed history. Restore выполняется с owner+ACL в пустую БД и уже существующими cluster roles; `--no-owner` не допускается.

## Проверки и следующий шаг

`bun run test:expiry-worker` собирает app+worker и проверяет isolated migrated DB, upgrade старого NULL deadline, future/disabled, grants/provenance, независимые суммы 120→97+23→120+0, reverse source/season, inactive recipient, races workers/manual cancel/reject/expire/approve, rollback outbox, locked quota/смена условий, CLI/watch/hard stop и real HTTP/Chromium history. `bun run test:task-slice --reward-expiry-only` проверяет также ручные F06, аудит и fulfillment; предварительно собрать app+worker. `bun run test:restore` сравнивает owners/ACL и continuation новой операции после pg_restore. Exact results и ограничения: verification.

Следующий предложенный срез — локальный эксплуатационный contract supervisor/lag/error monitoring и целевая Linux stop/deadline проверка. До P-02/P-06 только синтетические операции. Scheduling условий, изменение/отмена квот, Bot API, реальные сроки/поощрения, P-01…P-06, PostgreSQL 17.6 CI, физические Telegram Android/iOS и полная приёмка F06/R1 остаются открытыми.
