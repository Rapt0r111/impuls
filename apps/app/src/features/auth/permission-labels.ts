import type { PermissionsResponse } from "@impuls/contracts";

export type Permission = PermissionsResponse["permissions"][number];

export const actionNames: Record<Permission["action"], string> = {
  "task.view": "Просмотр задач и истории",
  "task.create": "Создание задач",
  "task.assign": "Назначение задач",
  "task.edit": "Редактирование черновиков",
  "task.cancel": "Отмена задач",
  "task.review": "Проверка результатов",
  "reward.decide": "Решение по заявкам",
  "reward.fulfill": "Подтверждение выдачи",
  "admin.access": "Управление доступом",
  "admin.access.manage": "Выдача и отзыв прав",
  "admin.members.manage": "Допуск и отзыв участников",
  "admin.rules": "Управление правилами",
  "admin.catalog": "Управление каталогом",
  "admin.catalog.create": "Создание позиции каталога",
  "admin.catalog.publish": "Публикация условий каталога",
  "admin.catalog.schedule": "Отложенная публикация условий каталога",
  "admin.catalog.schedule.cancel": "Отмена будущих условий каталога",
  "admin.catalog.quota.publish": "Публикация периодов квоты",
  "admin.audit": "Просмотр журнала действий",
  "admin.notifications": "Просмотр симуляции уведомлений",
  "ledger.correct": "Исправление журнала",
};

export const scopeNames = {
  rota: "Рота",
  group: "Группа",
  project: "Проект",
} as const;
