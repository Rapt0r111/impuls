# Архитектурные решения

ADR-0022: [отмена будущих синтетических условий](0022-synthetic-schedule-cancellation.md), append-only evidence, separate exact authority и сохранение номеров отменённых версий.

ADR-0021: [отложенная публикация синтетических условий](0021-synthetic-catalog-scheduling.md), F07 от 05.10.2026; отдельные exact право/flag/endpoint, append одной будущей версии, server time после barrier, immutable audit/replay и сохранение старых заявок.

ADR-0020: [наблюдаемость синтетических worker](0020-synthetic-worker-observability.md), F06/F08 от 05.10.2026; service-only expiry aggregates, bounded successful-step heartbeat, общий stop/deadline и предложенный supervisor runbook без внешней установки.

ADR-0019: [автоматическое синтетическое истечение](0019-synthetic-automatic-reservation-expiry.md), F06 от 05.10.2026; отдельная NOLOGIN service authority, атомарный возврат без вымышленного actor, гонки и restore с владельцем definer.

ADR-0018: [выключенная synthetic cosmetic identity](0018-synthetic-catalog-creation.md), F07 от 05.10.2026; separate exact create permission, disabled version 1 без квоты и immutable initial evidence/replay.

ADR-0017: [публикация будущего периода синтетической квоты](0017-synthetic-quota-publication.md), F07 от 05.10.2026; отдельное exact право, append без пересечений, сохранение прежних резервов и immutable audit snapshot.

ADR-0016: [немедленная публикация синтетических условий каталога](0016-synthetic-catalog-publication.md), F07 от 05.10.2026; отдельное scoped право, append версии, общий барьер с резервированием и неизменяемое основание без изменения квот.

ADR-0015: [неизменяемый журнал попыток симуляции](0015-synthetic-notification-attempt-journal.md), F08/F07 от 05.10.2026; private transactional trigger, история только новых переходов, минимальный exact-scope reader без Telegram-доставки.

ADR-0014: [сводка симуляции в точной области](0014-scoped-notification-simulation-status.md), F08/F07 от 04.10.2026; отдельное admin.notifications, private column SELECT, aggregate-only API/UI без доставки или повторов из приложения.

ADR-0013: [постоянный режим worker симуляции](0013-synthetic-worker-watch.md), локальное продолжение F08 от 04.10.2026; пакетный цикл, interruptible pause, drain и crash recovery без Bot API. Внешний supervisor/hosting и приёмка F08/R1 остаются открытыми.

ADR-0012: [worker симуляции уведомлений](0012-synthetic-notification-worker.md), первый локальный F08 от 04.10.2026; отдельная роль, lease/retry/access lock и simulation receipts без Bot API и изменения исходного outbox. Реальная доставка, admin UI, эксплуатация и P-решения остаются открытыми.

ADR-0011: [явный срок синтетического резерва](0011-synthetic-reservation-expiry.md), локальный F06 от 04.10.2026; без срока по умолчанию, ручное истечение через reward.decide, запрет просроченного одобрения. Автоматическая обработка и P-03/P-04 остаются открытыми.

ADR-0010: [выдача синтетической косметики](0010-synthetic-cosmetic-fulfillment.md), продолжение F06 от 03.10.2026; отдельное reward.fulfill, уникальное владение, без повторного списания. P-03/P-04 не утверждены.

ADR-0009: [решения по синтетическим заявкам](0009-synthetic-reward-decisions.md), продолжение F06 от 03.10.2026; отдельное reward.decide, запрет самоодобрения, однократное потребление/возврат резерва. Выдача и реальные P-03/P-04 остаются открытыми.

ADR-0008: [синтетический каталог и резерв](0008-synthetic-reward-reservations.md), локальный F06 от 03.10.2026; новые цены/квоты не создаются автоматически, решения/выдача и P-03/P-04 остаются открытыми.

ADR-0007: [независимый просмотр синтетического аудита](0007-scoped-synthetic-audit-reader.md), локальный F07 от 02.10.2026; полномочия не выдаются автоматически, реальные P-01/P-02 остаются открытыми.

ADR-0006: [личный синтетический профиль и первое достижение](0006-synthetic-profile-and-first-result.md), продолжение F05 от 02.10.2026; реальные пороги и политика исправлений остаются P-04/P-05.

ADR-0005: [ограниченный синтетический рейтинг](0005-synthetic-ranking-preview.md), первый F05 от 02.10.2026, без утверждения P-05 и реальной видимости.

ADR-0004: [полный синтетический возврат начисления](0004-synthetic-acceptance-reversal.md), F04 от 02.10.2026, без утверждения реальной политики P-04.

ADR-0003: [условия черновика и отмена задачи](0003-draft-conditions-and-task-cancellation.md), синтетический F03 от 02.10.2026.

Изменения зафиксированной архитектуры `IMPLEMENTATION_PLAN.md` оформляются отдельным ADR. Номер и короткое имя входят в имя файла, например `0001-change-example.md`.

Скопируйте `template.md`, заполните доказательства и обновите затронутые разделы плана, `PRODUCT.md` и `DESIGN.md` в той же задаче.

ADR-0023: [управление синтетическим доступом](0023-synthetic-access-management.md), два точных права, запрет самовыдачи и делегирования прав управления.

ADR-0024: [владелец функций в миграциях на управляемом PostgreSQL](0024-migration-owner-grant-managed-postgres.md), временное `SET` для `ALTER OWNER` в 000027/000028.
