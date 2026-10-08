# F07: отложенная публикация синтетических условий

Основание: IMPLEMENTATION_PLAN.md §§ 5–7, 10–12, F02/F06/F07; ADR-0021.

## Контракт до реализации

- POST `/api/v1/admin/rewards/:id/scheduled-versions`: strict прежние поля публикации плюс `effectiveFrom` в UTC с миллисекундами. Отдельное exact `admin.catalog.schedule` вместе с `admin.catalog`; независимый `SYNTHETIC_CATALOG_SCHEDULING_ENABLED=false` и read flag. Немедленное publish не даёт schedule и не принимает дату.
- Только existing synthetic cosmetic identity, expected current version и отсутствие другой будущей версии. Append version N+1 без изменения прежних условий/квот/балансов/заявок. Начало строго позже серверного времени после ожидания identity/quota barrier, повторная проверка при INSERT. Отклонённая дата не оставляет записей.
- Общая транзакция сохраняет `catalog_publications`, автора/основание/immutable terms и response; operation `catalog.schedule` отделяет ключи от немедленного publish. Replay проверяет актуальные полномочия после ожидания и возвращает первоначальное подтверждение даже после наступления даты. Аудит `catalog.publish` означает запись условий; effectiveFrom отделён от createdAt и не доказывает наступление условий.
- Действие доступно отдельной кнопкой под позицией; существующая inline форма получает required datetime UTC. Preview показывает intended date в МСК; retry unknown результата сохраняет date/body/key, conflict/422 требуют перечитывания, denied очищает protected caches. Dirty/Back и закрытие сохраняют прежний guard. Новых токенов, зависимостей или motion нет.
- Выбор действующей версии использует PostgreSQL effective_from; отдельный worker активации не нужен. Будущие условия не являются разрешением заявки; квота/членство/флаги проверяются отдельно. Отмена/замена будущей версии вне среза.

## Проверки

Контракты/точные права и флаги; immutable audit/replay; future/past/date after lock wait; competing schedule/publish/reserve; сохранение старого резерва и выбор новой версии после даты; реальный HTTP и browser-to-DB; responsive 320/360/390 и отрицательные состояния формы. Restore всех миграций с ACL. Проверки фиксируются отдельно и не объявляют F07/R1 принятыми.

## Границы

Только синтетика. P-01…P-06, отмена/правка квот и scheduled terms, реальный Bot API/hosting, целевой Linux/17.6 CI, Android/iOS и приёмка R1 остаются открытыми. Внешний выпуск не выполняется.
