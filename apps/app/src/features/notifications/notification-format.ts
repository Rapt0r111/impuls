import type { NotificationStatusResponse } from "@impuls/contracts";
export const statusNames: Record<
  keyof NotificationStatusResponse["counts"],
  string
> = {
  unclaimed: "Ещё не подобраны",
  ready: "Готовы к обработке",
  processing: "В обработке",
  retry: "Ожидают повтора",
  simulated: "Симуляция успешна",
  delivered: "Доставлено в Telegram",
  failed: "Попытки завершены с ошибкой",
  suppressed: "Обработка запрещена",
};
export const errorNames: Record<
  keyof NotificationStatusResponse["errors"],
  string
> = {
  transport_unavailable: "Тестовый транспорт недоступен",
  timeout: "Истекло время тестовой попытки",
  attempts_exhausted: "Исчерпаны попытки после потери обработчика",
  recipient_inactive: "Доступ получателя отозван",
  unsupported_kind: "Тип события не поддерживается",
  rate_limited: "Telegram ограничил частоту отправки",
  recipient_unreachable: "Telegram не принимает сообщения получателя",
};
export const eventNames: Record<
  NotificationStatusResponse["recentEvents"][number]["kind"],
  string
> = {
  "task.assigned": "Назначение задачи",
  "task.claimed": "Свободную задачу взяли",
  "task.due_soon": "Приближается срок задачи",
  "task.returned": "Возврат результата",
  "task.accepted": "Приёмка результата",
  "ledger.corrected": "Корректировка журнала",
  "reward.reserved": "Резерв по заявке",
  "reward.cancelled": "Отмена заявки",
  "reward.approved": "Согласование заявки",
  "reward.rejected": "Отказ по заявке",
  "reward.fulfilled": "Выдача косметики",
  "reward.expired": "Истечение заявки",
  unsupported: "Неподдерживаемый тип события",
};
export class StatusError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Notification status request failed");
  }
}
export const notificationDate = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
