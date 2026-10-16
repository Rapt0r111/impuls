# Проверка: единый выпадающий список (2026-10-16)

## Что изменено

- Все 19 нативных `<select>` в `apps/app/src` заменены на общий компонент `apps/app/src/shared/ui/select.tsx` (стили в `select.css`). Список рисует приложение, поэтому вид одинаков в Telegram на Android, iOS и в браузере.
- Клавиатура: кнопка открывает список, стрелки, Home/End, Enter/Space выбирают, Escape закрывает с возвратом фокуса, буквы переходят к пункту. Пункты и кнопка не ниже 48 px, шрифт 16 px.
- Удалены правила `select` из CSS функций (`globals.css`, `service.css`, `task-management.css`, `leaderboard.css`, `audit-log.css`, `rewards.css`, `notification-status.css`).
- Поля даты и времени (`datetime-local`, `date`, `time`, `month`) не менялись: это системные пикеры, а их внешний вид выбирает ОС.
- Тесты в `tests/browser` и `tests/integration` переведены с `selectOption` на помощник `tests/browser/select-option.mjs`.

## Команды и результаты

| Команда                                                                      | Результат                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run format:check`                                                       | проходит                                                                                                                                                                                                                                                                                                     |
| `bun run lint`                                                               | 0 ошибок                                                                                                                                                                                                                                                                                                     |
| `bun run typecheck`                                                          | проходит                                                                                                                                                                                                                                                                                                     |
| `bun run build:app`                                                          | проходит                                                                                                                                                                                                                                                                                                     |
| `node scripts/verify-workspace-reflow.mjs`                                   | 150 сценариев, 0 ошибок (320/360/390)                                                                                                                                                                                                                                                                        |
| `node tests/browser/<имя>.mjs` с `TEST_APP_ORIGIN` на собранный `next start` | пройдены: task-management (29), leaderboard (14), audit (28), reward-decisions (30), notification-status (49), catalog-publication (17), catalog-creation (20), admin-catalog (40), quota-publication (19), catalog-cancellation (20), catalog-scheduling (20), task-acceptance (23), access-management (19) |

## Не проверено или не подтверждено

- `rules-admin.mjs` падает на строке 177: ожидаемая строка «Уровни: не заданы → 2-й с 100 XP, 3-й с 250 XP» не найдена. Это проверка текста уровней, а не выпадающего списка. На `main` её не запускали, поэтому причину не подтверждаю.
- Тесты `access-real`, `reward-decisions-real`, `task-flow-real` и интеграционные тесты с PostgreSQL здесь не запускались: нет базы. Строки с `selectOption` в них переведены, но не выполнены.
- Серверный CI недоступен (минуты Actions исчерпаны), `bun run ci:local --db-url=…` не запускался.
- Статический предпросмотр открытого списка в 320 и 390 px: горизонтального переполнения нет. Это отдельная страница с тем же CSS, а не экран приложения.
- Telegram WebView на Android и iOS, экранный диктор и физическое устройство не проверялись.
