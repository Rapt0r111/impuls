# F08/F07: проверка сохранения дизайн-системы

Дата: 05.10.2026. Роль: shipped Impeccable documenter; прочитаны установленный `agents/impeccable_documenter.toml` и `reference/document.md` версии 4.3.1. Это обычное расширение существующей Operate-поверхности. Новая визуальная система и изменение общих токенов не согласовывались; `DESIGN.md` и `.impeccable/design.json` сохранены без правок этого прохода.

## Подтверждено файлами и кодом

Проверены `DESIGN.md`, `.impeccable/design.json`, `PRODUCT.md`, §7 IMPLEMENTATION_PLAN.md, [surface brief](../../apps/app/.impeccable/surfaces/apps-app-src-features-notifications-notification-status-tsx.md), [контракт](../implementation/2026-10-05-f08-event-history-slice.md), четыре notification-файла, `apps/app/src/shared/ui/tokens.css` и `apps/app/src/app/globals.css`.

| Слой              | Фактическое расширение                                                                                                                                                                                                                                          | Основание сохранения системы                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Палитра           | CSS страницы использует существующие `--color-muted`, `--color-ink`, `--color-bg`, `--color-line`, `--color-mint`; новых цветов нет.                                                                                                                            | Navy/Manrope/mint из DESIGN.md; `tokens.css:2`–`12`. Gold остаётся общим фокусом, а не окраской статусов событий.                                                                   |
| Типографика       | Общий body — 15px/1.5; заголовок секции — 20px. Новое локальное правило `.notification-history .notification-note` — 14px и распространяется на пояснение, дату создания и подсказку возврата к первой странице.                                                | `globals.css:35`, `globals.css:384`, `notification-status.css:85`; минимум длинного мобильного чтения — IMPLEMENTATION_PLAN.md:227. Это локальный размер, не новый системный токен. |
| Материал и ритм   | Native details/summary, плоские строки с верхним разделителем и 16px вертикального padding, 8px между абзацами. Без новой тени, фоновой иллюстрации или анимации.                                                                                               | `notification-status.css:65`, `notification-status.css:77`; DESIGN.md:205, The Flat Surface Rule.                                                                                   |
| Управление        | Закрытое «Все события», запрос только при открытии, отдельные дата чтения/refresh/next; Back закрывает раскрытие. Действия используют существующий `.tasks-action`, disclosure имеет минимум 44px.                                                              | `notification-events.tsx:50`, `:54`, `:64`, `:117`, `:145`, `:182`; `globals.css:485`.                                                                                              |
| Состояния и смысл | 503/offline сохраняет датированную страницу и запрещает paging; 400 скрывает страницу. Отказ дочерней или родительской операции отменяет параллельные reads и очищает оба кэша. Текущие состояния и время создания явно отличены от журнала попыток и доставки. | `notification-events.tsx:74`, `:100`, `:120`; `notification-status.tsx:57`, `:189`; общий allowlist/date в `notification-format.ts`.                                                |

## Проверенное evidence и пределы

В этом проходе визуально открыты `events-320.png`, `events-large-text-320.png` и `events-retained-503-320.png` из [каталога снимков](assets/f08-event-history/notification-status). Они показывают наследуемый фон, тонкие разделители, native disclosure, перенос длинного пояснения и самостоятельную дату страницы; retained-503 сохраняет строку и делает next неактивным. Размер исходного enlarged-text capture — 320×2501; просмотрщик уменьшил его до 262×2048, поэтому по изображению не утверждается точный computed font-size.

Остальные четыре events capture и все семь повторных снимков после typography fix проверены [UI reviewer](2026-10-05-f08-event-history-ui-review.md). Его `ship` относится только к найденной и исправленной типографике. [Основной verification report](2026-10-05-f08-event-history.md) фиксирует 14 реальных integration tests, 32 browser scenarios и provenance scan 18 rasters/0 missing; documenter эти команды повторно не запускал. Чтение source не заменяет их поведенческий результат.

Physical Telegram Android/iOS, screen readers, computed contrast/system zoom и полная приёмка F08/F07/R1 остаются непроверенными. Новых P-решений этот документ не фиксирует.

## Пять строк системы

1. Палитра: существующие navy base/panel, pale ink/muted, mint действия; gold обозначает награды и общий видимый фокус.
2. Тип: Manrope; рабочий body 15px/1.5, секция 20px, новые history notes 14px, metadata read time 13px, controls 13px.
3. The Meaningful Accent Rule: цвет сопровождает смысл и текстовую подпись; событие не превращено в золотую награду или progress metric.
4. The Flat Surface Rule: native раскрытие и строки с разделителями сохраняют плоскую рабочую поверхность.
5. Operate: точная область, ручные действия, датированные подтверждённые данные и явные отказ/пустота; новых font/asset/motion/dependency нет.

Не канонизировано и не исправлено: основной type/layout слой DESIGN.md и sidecar описывает исторический R0, включая 13px app paragraphs; существующие пояснения вне нового disclosure также остаются 13px (`notification-status.css:15`). Это не разрешение наследовать такой размер для длинного мобильного чтения вопреки §7. Sidecar имеет исторический `generatedAt` 22.09.2026 и не содержит отдельного notification pattern; расширение не требует его регенерации. Системная актуализация и правка соседних пояснений вне согласованной границы не выполнялись.
