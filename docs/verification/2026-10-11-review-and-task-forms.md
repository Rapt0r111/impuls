# Проверка: формы проверки отчётов и постановки задач (11 октября 2026)

Срез переносит две формы на макетный язык карточек, плиток и основной кнопки.
Макета для этих форм в концепте нет: стиль выведен из карточек задач и
поощрений и из общего слоя `service.css` (PR #9).

## Что изменено

- `apps/app/src/app/globals.css` — решение по отчёту (`.review-decision`)
  стало двумя плитками. Радио остаётся настоящим управлением: клавиатура и
  чтение экрана работают как раньше, выбранный вариант подсвечивается через
  `:has(input:checked)`.
- `apps/app/src/features/task-management/task-management.tsx` — поля «Фонд XP»
  и «Фонд баллов» обёрнуты в `div.task-mgmt__pair`. Атрибуты `aria-labelledby`
  и тексты не менялись.
- `apps/app/src/features/task-management/task-management.css` — строка
  `.task-mgmt__pair` в две колонки на 320–390 px; основная кнопка формы
  создания на всю ширину.

## Что проверено

- `npx prettier --check` на изменённых каталогах — файлы в стиле Prettier.
- `bun run --cwd apps/app typecheck` — `tsc --noEmit` без ошибок.
- `npx eslint` на `apps/app/src/features/task-management` и
  `apps/app/src/features/reviews` — без замечаний.
- `bun run test:unit` — 0 сбоев.
- `node scripts/verify-workspace-reflow.mjs` на production-сборке
  (`127.0.0.1:3100` при `TEST_APP_ORIGIN`) — `{"scenarios":150,"failures":0}`.
- Скриншоты 390 px с синтетическими данными (`/api/v1/reviews`,
  `/api/v1/task-management`, полномочия через мок): до и после изменения.
  Скриншоты хранятся вне репозитория.

## Что не проверено

- Интеграционные и браузерные сценарии проверки и управления задачами
  (`task-reviews`, `task-management`, `task-acceptance`): нужен PostgreSQL,
  в этой среде его нет.
- Telegram WebView на Android и iOS: не проверялось.
- Экран 320 px для формы создания: в reflow-наборе покрыт, отдельный
  скриншот не снимался.
- Нижняя панель на полноэкранном скриншоте перекрывает содержимое; это
  артефакт съёмки `fullPage` с фиксированной панелью, а не подтверждённая
  ошибка прокрутки. Проверить в живом Telegram.
