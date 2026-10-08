# F02/F07: управление синтетическим доступом

Основание: IMPLEMENTATION_PLAN.md §§ 4, 5, 6, 11–12, F02/F07; ADR-0023.

## Контракт

- `POST /api/v1/admin/access/grants`: `{scope, subjectId, action, validUntil|null, reason}`. `POST /api/v1/admin/access/revocations`: `{scope, bindingId, expectedVersion, reason}`. Оба требуют Origin, CSRF, сессию, `Idempotency-Key`, лимит мутаций; ответ 201 `{mode, kind, scope, changeId, binding, updatedAt}`.
- Авторизация: оба права `admin.access` и `admin.access.manage` в точной области; иначе 404 без раскрытия. Выключенный флаг — 404.
- Запрещено (422): себе, `admin.access*`. Не участник области — 404. Срок в прошлом — 422. Дубликат активного права или устаревшая версия — 409. Повтор с другим телом — 409.
- Неизменяемое свидетельство в `access_changes` (000031) с автором, получателем, действием, сроком и основанием.

## Границы

Только синтетика. UI, HTTP/browser-проверки, чтение в scoped audit и выдача самих прав управления не реализованы. P-01…P-06, целевой Linux/17.6 CI, устройства и приёмка R1 открыты. Внешний выпуск не выполнялся.
