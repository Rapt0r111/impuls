# ADR-0020: наблюдаемость синтетических обработчиков

Дата: 05.10.2026. Статус: локальное техническое решение режима ожидания. Основание: IMPLEMENTATION_PLAN.md §§ 8, 10–12, ADR-0013/0019.

## Решение

Добавить read-only `--expire-status` к отдельному expiry process. Миграция 000028 предоставляет `impuls_expiry_worker` только EXECUTE агрегирующей SQL SECURITY DEFINER функции без аргументов. Владелец — прежний `impuls_expiry_executor`, фиксированный search_path=pg_catalog, PUBLIC EXECUTE отозван. Прямой SELECT caller к заявкам, балансам, людям и журналу не добавляется. App и notification worker функцию не вызывают.

Один statement snapshot и серверное время возвращают число synthetic pending с достигнутым, будущим и NULL сроком, число automatic expired, самый ранний достигнутый срок/его возраст и последнее automatic decided_at. Никаких идентификаторов, сумм, областей, имён или текстов. Чтение не освобождает резерв, не создаёт receipt и не пишет heartbeat в БД. Пустая очередь не доказывает наличие работающего watch, а пропуск заблокированной квоты не равен пустой очереди.

Оба watch режима выводят нейтральный `alive` после успешно завершённого шага, включая пустую очередь, максимум раз в 60 секунд по монотонным часам. Время строки — часы процесса; время сводки — часы БД. Ошибка шага не даёт нового alive. Once/status не становятся watch. Существующие counts/neutral error codes и выход 1 сохраняются; внешняя система собирает ошибки и проверяет свежесть процесса отдельно от backlog.

Runbook и неустановленные systemd templates описывают отдельные processes/credentials, ограниченный restart и остановку: SIGTERM, drain, внутренний deadline 20 секунд, внешний hard stop через 25 секунд. Это предлагаемая конфигурация синтетического стенда, а не выбранный hosting, автоматическое включение или SLA. Флаги по умолчанию false; credentials/реальные данные/мониторинг не создаются. Общий shutdown извлечён для проверки deadline и cleanup без подмены production timeout.

## Проверки и последствия

Контракт: [срез](../implementation/2026-10-05-worker-observability-slice.md). Агрегаты/ACL, read-only под lock, CLI, heartbeat и stop/deadline проверяются отдельно. Restore сохраняет owner/ACL новой функции. POSIX tests включены в Linux CI; Windows не подтверждает SIGTERM или установленный supervisor. Новых runtime dependencies, HTTP routes и UI нет.

P-01…P-06, внешний hosting/оператор/alert thresholds/retention, Bot API, физические устройства, целевой Linux запуск и полная приёмка R1 остаются открытыми.
