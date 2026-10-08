# ADR-0016: немедленная публикация синтетических условий каталога

Дата: 05.10.2026. Статус: принято для локального синтетического среза; не согласует P-01…P-06.

## Причина

F07 пока только читает условия/периоды. Расширение существующего admin.catalog до записи автоматически повысило бы полномочия всех читателей. Перезапись условий нарушила бы сохранённые версии и снимки F06; публикация без общего барьера могла бы принимать резерв по прежним условиям после изменения каталога.

## Решение

Отдельное exact admin.catalog.publish вместе с прежним read authority и отдельный выключенный flag. Для существующей synthetic cosmetic identity добавляется немедленная версия; будущие условия исключены до scheduling контракта. Общий advisory lock identity и FOR UPDATE всех quota rows сериализуют публикации/новые периоды; прежний quota-first reservation проверяет актуальную версию после барьера. Нет смены стека/пакетов/ролей runtime.

Append-only catalog_publications хранит автора, основание и ссылки на два immutable snapshot. Publication + record + idempotent response атомарны. Отдельная таблица не расширяет существующий audit_events object constraint и включается UNION reader в центральный admin.audit, с собственной allowlisted projection. Нет backfill или notification outbox: нейтральный transport для изменения каталога требует отдельного контракта.

## Последствия и проверка

Первичный источник семантики FOR UPDATE и transaction-level advisory locks: [PostgreSQL 17 — Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html). Локальный тест наблюдает реальные ожидания через pg_blocking_pids; он выполнен на 18.6, а не заменён предположением по документации.

000024 выдаёт только INSERT runtime на reward_versions и SELECT/INSERT на публикации с RLS, без UPDATE/DELETE; таблица запрещает изменение/удаление также guard trigger. Право публикации никому не назначается. Старые pending/approved/fulfilled заявки и квоты сохраняют исходные условия. Обратная миграция запрещена ради истории; rollback приложения выключает publication flag, schema/history сохраняются.

Общий mutation limiter пока имеет прежнее историческое имя task; publication использует тот же actor budget без нового квотного решения. При публикации нет активной квоты — операция допустима, доступность участнику не возникает автоматически. Весь модуль остаётся серверным; canPublish в UI не даёт полномочий. Нужны PostgreSQL concurrency/rollback/ACL, HTTP/browser/UI и восстановление с новой миграцией. Внешний выпуск, реальная экономика/контур, scheduling и создание позиций требуют отдельных решений.
