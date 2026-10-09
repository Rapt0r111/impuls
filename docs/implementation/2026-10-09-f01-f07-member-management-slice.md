# F01/F02/F07: допуск и отзыв участников

Основание: IMPLEMENTATION_PLAN.md §§ 4, 5, 6 (`/admin/users`), 11 (F01 «допуск, отзыв», F07 «отдельный режим управления»), 12; ADR-0023, ADR-0026.

## Контракт

- `POST /api/v1/admin/members/admissions`: `{scope, telegramId (положительное целое), displayName (1–80, без управляющих символов), validUntil|null, reason (1–500)}`.
- `POST /api/v1/admin/members/removals`: `{scope, membershipId, expectedVersion, reason}`.
- Обе: Origin, CSRF, сессия, `Idempotency-Key`, лимит мутаций; ответ 201 `{mode, kind, scope, changeId, member{membershipId,userId,displayName,version,validUntil}, updatedAt}` и для `admit` — `userCreated`, `userReactivated`, для `remove` — `revokedBindings`, `userDeactivated`. Telegram ID в ответах и списках не возвращается.
- Авторизация: оба права `admin.access` и `admin.members.manage` в точной области, иначе 404 без раскрытия. Выключенный `SYNTHETIC_MEMBER_MANAGEMENT_ENABLED` — 404.
- Исходы: 409 — участник уже допущен, членство изменилось, ключ другим телом; 422 — срок в прошлом, нельзя изменить себя или администратора области; 400 — форма; 401/403 — сессия.
- `GET /api/v1/admin/access?scope=` дополнен `canManageMembers` и по каждому участнику `membershipId`, `membershipVersion`.

## Данные (000033)

- `role_bindings.action` допускает `admin.members.manage`; он не выдаётся через приложение.
- `member_changes`: неизменяемый журнал (автор, участник, область, создан/активирован/деактивирован ли пользователь, число снятых прав, срок, request ID, основание). Запись — только функциями ниже.
- `impuls.admit_member`, `impuls.remove_member`: SECURITY DEFINER, EXECUTE только у `impuls_app`; сами проверяют полномочия, запреты, версии и пишут пользователя, членство, права и журнал одной транзакцией.

## UI

Раздел «Состав области» на экране «Доступ»: «Допустить» и «Отозвать допуск», предпросмотр без записи, подтверждение, повтор того же запроса, блокировка при 409/422, очистка при 404. Виден при `canManageMembers`.

## Аудит

`GET /api/v1/admin/audit` (право `admin.audit` в области) возвращает `member.admit` и `member.remove` с `member{membershipId, subject{id,displayName}, validUntil, userCreated, userReactivated, userDeactivated, revokedBindings}`; Telegram ID не выдаётся. Фильтр `action` принимает оба значения. Журнал UI: «Допуск участника», «Отзыв допуска участника».

## Границы

- Только synthetic; P-01…P-06, Telegram Android/iOS, Supabase/Production, PostgreSQL 17.6 не проверены. Реальный доступ остаётся выключен.
- Не изменяются задачи и резервы отозванного участника; смена имени существующего пользователя, передача состава между областями и массовые операции не реализованы.
- Первое право `admin.members.manage` в области выдаёт владелец окружения вне приложения.
