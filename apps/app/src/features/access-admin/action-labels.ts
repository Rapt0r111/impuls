import type { grantableActions } from "@impuls/contracts";

export const actionLabels: Record<(typeof grantableActions)[number], string> = {
  "task.view": "Просмотр задач",
  "task.create": "Создание задач",
  "task.assign": "Назначение задач",
  "task.edit": "Редактирование задач",
  "task.cancel": "Отмена задач",
  "task.review": "Проверка отчётов",
  "task.return": "Возврат на доработку",
  "task.verify": "Проверка самостоятельных задач",
  "reward.decide": "Решения по заявкам",
  "reward.fulfill": "Выдача поощрений",
  "admin.rules": "Настройки начислений",
  "admin.catalog": "Управление каталогом",
  "admin.catalog.create": "Создание позиций каталога",
  "admin.catalog.publish": "Публикация условий каталога",
  "admin.catalog.schedule": "Отложенная публикация условий",
  "admin.catalog.schedule.cancel": "Отмена будущих условий",
  "admin.catalog.quota.publish": "Публикация периодов квоты",
  "admin.audit": "Просмотр журнала действий",
  "admin.notifications": "Состояние уведомлений",
  "ledger.correct": "Исправление журнала",
};
