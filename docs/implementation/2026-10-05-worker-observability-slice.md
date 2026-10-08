# F06/F08: локальная наблюдаемость и остановка worker

Основание: IMPLEMENTATION_PLAN.md §§ 8, 11 (F06/F08), 12, следующий шаг ADR-0019. [ADR-0020](../adr/0020-synthetic-worker-observability.md).

## Контракт до реализации

- 000028: без таблиц, изменений сроков/счётчиков/прав людей. `impuls.read_synthetic_expiry_status()` STABLE SQL SECURITY DEFINER, фиксированный search_path=pg_catalog, owner impuls_expiry_executor, EXECUTE только impuls_expiry_worker (и owner), без аргументов и прямого caller SELECT. Один statement snapshot.
- `--expire-status`: прежний независимый default-false SYNTHETIC_RESERVATION_EXPIRY_ENABLED. Disabled — exit 0 до URL/пула. Enabled — проверенная роль/TLS и только read. Ошибка — фиксированный WORKER_UNAVAILABLE/exit 1 без исключения/URL в выводе. Ответ: mode=reservation_expiry, status=observed, snapshotAt, counts {due, scheduled, untimedPending, automaticExpired}, oldestDueAt, oldestDueAgeSeconds, lastAutomaticExpiryAt. Даты UTC, отсутствие даты/возраста — null. Due включает заблокированные строки, time equality считается достигнутым сроком. Automatic expired не включает ручное истечение.
- Сводка не меняет redemptions, quota/balance, ledger/audit/outbox. Это глобальные технические агрегаты отдельной service role, не API человеческого admin. Ненулевой due — backlog, не ошибка возврата; NULL не получает придуманный deadline.
- Watch heartbeat только после завершённого шага (null тоже успех), не чаще раза в 60 s monotonic. status=alive + observedAt без бизнес-данных. После ошибки/при остановке новые alive не выдаются. Время процесса не используется в бизнес-операциях. Startup watching и observed status сами не доказывают liveness watch.
- Stop contract: SIGINT/SIGTERM перестаёт брать новые операции, завершает текущую и закрывает pool. Internal 20 s deadline покрывает operation/pool.end; при превышении WORKER_STOP_TIMEOUT/exit 1. После cleanup handlers/timer сняты. Supervisor timeout должен превышать внутренний deadline; ограниченный restart-on-failure не отменяет флаг или решение оператора остановить процесс.
- Runbook: отдельные два процесса/секрета, безопасные логи, backlog/heartbeat/error diagnosis, enable/stop/restart/rollback. Templates не устанавливаются и не выбирают external hosting. Технические интервалы шаблона предложены для synthetic rehearsal, реальные alerts/retention/SLA требуют оператора/P-решений.

## Проверка

Независимый synthetic набор: due/future/NULL/manual expired/automatic expired и terminal approved; точные counts и server timestamp/age. Read при удержании quota/balance lock и повтор не меняют состояние. PUBLIC/app/notification worker denial и отсутствие direct SELECT expiry caller. CLI disabled/wrong role/neutral error, отсутствие IDs/секретов. Heartbeat idle/load/error/stop/once, shutdown repeated signal/deadline/cleanup. POSIX SIGTERM idle и in-flight drain — отдельные Linux tests. Restore — владельцы/ACL и read после восстановления. Точные команды/результаты записываются в verification.

## Границы

Новых UI/HTTP/dependencies нет. Внешний supervisor не установлен, реальные секреты/доставка/сроки не включены. P-01…P-06, target PostgreSQL 17.6 CI, целевой Linux host, Telegram Android/iOS и приёмка F06/F08/R1 остаются открытыми.
