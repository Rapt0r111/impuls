# Флаги функций (Vercel Production и worker)

Все флаги по умолчанию выключены: значение включает только строка `true`. Для приложения они читаются при сборке и запуске функций; после изменения в Vercel нужен новый деплой. Для имён до 09.10.2026 см. [ADR-0029](../adr/0029-drop-synthetic-labels.md): префикс `SYNTHETIC_` убран, кроме `SYNTHETIC_NOTIFICATIONS_ENABLED`.

## Приложение

| Флаг                                                                                                                                                 | Что включает                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ACCESS_MANAGEMENT_ENABLED`                                                                                                                          | экран «Доступ»: чтение, выдача и отзыв прав; без него не откроется и «Состав»       |
| `MEMBER_MANAGEMENT_ENABLED`                                                                                                                          | «Состав»: допуск и отзыв участников (работает вместе с `ACCESS_MANAGEMENT_ENABLED`) |
| `AUDIT_ENABLED`                                                                                                                                      | журнал действий                                                                     |
| `PROFILE_ENABLED`                                                                                                                                    | профиль: уровни, «Первый результат», собственное имя                                |
| `TASK_MANAGEMENT_ENABLED`                                                                                                                            | создание, назначение, правка и отмена задач                                         |
| `ECONOMY_ENABLED`                                                                                                                                    | начисление при приёмке (правила версии 1 — тестовые, P-04)                          |
| `LEDGER_CORRECTIONS_ENABLED`                                                                                                                         | возврат начисления                                                                  |
| `REWARDS_ENABLED`                                                                                                                                    | каталог поощрений, заявки, решения, выдача                                          |
| `ADMIN_CATALOG_ENABLED`                                                                                                                              | чтение условий и квот в админ-каталоге                                              |
| `CATALOG_CREATION_ENABLED`, `CATALOG_PUBLICATION_ENABLED`, `CATALOG_SCHEDULING_ENABLED`, `CATALOG_CANCELLATION_ENABLED`, `QUOTA_PUBLICATION_ENABLED` | запись в админ-каталоге (каждая независимо, вместе с `ADMIN_CATALOG_ENABLED`)       |
| `NOTIFICATION_STATUS_ENABLED`                                                                                                                        | экран состояния уведомлений                                                         |
| `RANKING_ENABLED`                                                                                                                                    | месячный рейтинг; не включать до решения P-05                                       |

## Worker (отдельный процесс, не размещён)

| Флаг                              | Что включает                                      |
| --------------------------------- | ------------------------------------------------- |
| `TELEGRAM_DELIVERY_ENABLED`       | реальную отправку через Bot API (ADR-0025)        |
| `TASK_REMINDERS_ENABLED`          | напоминания о сроке задачи (ADR-0027)             |
| `SYNTHETIC_NOTIFICATIONS_ENABLED` | только симуляцию доставки, без Bot API (ADR-0012) |
| `RESERVATION_EXPIRY_ENABLED`      | автоматический возврат просроченных резервов      |
