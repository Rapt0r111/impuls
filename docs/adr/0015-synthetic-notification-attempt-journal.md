# ADR-0015: неизменяемый журнал попыток симуляции

Дата: 05.10.2026. Статус: локальное техническое решение в режиме ожидания P-01…P-06. Продолжает ADR-0012–0014.

Receipt хранит только последнее состояние; смена lease и повторы стирают информацию о прежней попытке. Добавляем private append-only notification_simulation_events (000023), записываемый триггером в транзакции изменения receipt. Фазы started/retry/simulated/failed/suppressed/lease_expired имеют фиксированную семантику; lease_expired означает обнаружение истёкшего lease, а не доказанное падение или исход внешней отправки. История начинается после установки миграции; backfill отсутствует.

Выбран узкий SECURITY DEFINER trigger в неэкспонируемой impuls с search_path=pg_catalog, явными именами таблиц и отозванным PUBLIC EXECUTE. App и worker не получают прямой записи в журнал, поэтому worker не может подделать строку отдельным INSERT. Триггер получает данные только из OLD/NEW receipt, не принимает аргументы и не читает секреты/получателя. RLS и SELECT app совпадают с существующей private серверной границей; точная область и admin.notifications проверяются доменным query-service заново при каждой странице. Data API grants отсутствуют. Бизнес-outbox, lease algorithm, транспорт, runtime и зависимости не меняются.

Переход: остановить прежние workers, применить 000023 прямым migration connection, совместно выпустить API/UI, затем перезапустить worker. Старые терминальные receipts остаются без выдуманного журнала; уже processing может получить только outcome без прежнего started. Trigger не требует новой версии worker. Откат приложения допустим при сохранении схемы/истории; down запрещён. Проверить privileges, rollback, reclaim/attempt exhaustion, races, pagination и cleanup доступа на PostgreSQL; результат фиксируется в ../verification/2026-10-05-f08-attempt-journal.md.

Retention/архивирование требуют отдельного решения до пилота. Рост ограничен числом сохранённых событий и до пяти захватов на событие, но это не квота storage или нагрузочный замер. Реальная доставка, P-решения, хостинг, устройства и приёмка R1 остаются открытыми.

Первичные источники: [PostgreSQL trigger functions](https://www.postgresql.org/docs/current/plpgsql-trigger.html), [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres).
