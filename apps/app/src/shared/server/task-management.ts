import "server-only";
import {
  taskAssignRequestSchema,
  taskCreateRequestSchema,
  taskIdSchema,
  taskManagementResponseSchema,
  taskSubmissionHeadersSchema,
} from "@impuls/contracts";
import { assignTask, createTask, hashSessionToken } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession, hasValidCsrf } from "./auth";
import { getPool } from "./db";
import {
  errorResponse,
  isAllowedOrigin,
  jsonResponse,
  readJsonLimited,
  requestId,
} from "./http";

export async function handleTaskManagementMutation(
  request: NextRequest,
  taskId?: string,
) {
  const id = requestId();
  if (!process.env.APP_ORIGIN || !process.env.CSRF_SECRET)
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  if (!isAllowedOrigin(request))
    return errorResponse(403, "ORIGIN_DENIED", "Запрос не принят", id);
  try {
    const session = await getAuthorizedSession(request);
    if (session.kind === "missing")
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Откройте приложение через Telegram",
        id,
      );
    if (session.kind === "revoked")
      return errorResponse(403, "ACCESS_REVOKED", "Доступ отозван", id);
    if (!hasValidCsrf(request, session.token))
      return errorResponse(403, "CSRF_DENIED", "Запрос не принят", id);
    if (taskId !== undefined && !taskIdSchema.safeParse(taskId).success)
      return errorResponse(404, "NOT_FOUND", "Задача не найдена", id);
    const headers = taskSubmissionHeadersSchema.safeParse({
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    if (!headers.success)
      return errorResponse(400, "BAD_REQUEST", "Неверный ключ запроса", id);
    let raw: unknown;
    try {
      raw = await readJsonLimited(request, 32_768);
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Неверный формат запроса", id);
    }
    const base = {
      actorId: session.user.id,
      sessionHash: hashSessionToken(session.token),
      idempotencyKey: headers.data.idempotencyKey,
      requestId: id,
      enabled: process.env.SYNTHETIC_TASK_MANAGEMENT_ENABLED === "true",
    };
    let result;
    if (taskId === undefined) {
      const body = taskCreateRequestSchema.safeParse(raw);
      if (!body.success)
        return errorResponse(400, "BAD_REQUEST", "Неверные данные задачи", id);
      result = await createTask(getPool(), { ...base, data: body.data });
    } else {
      const body = taskAssignRequestSchema.safeParse(raw);
      if (!body.success)
        return errorResponse(
          400,
          "BAD_REQUEST",
          "Неверные данные назначения",
          id,
        );
      result = await assignTask(getPool(), {
        ...base,
        taskId,
        data: body.data,
      });
    }
    switch (result.kind) {
      case "ok":
        return jsonResponse(
          taskManagementResponseSchema.parse(result.response),
          result.status,
          id,
        );
      case "revoked":
        return errorResponse(403, "ACCESS_REVOKED", "Доступ отозван", id);
      case "unauthorized":
        return errorResponse(401, "UNAUTHORIZED", "Проверьте вход снова", id);
      case "not_found":
        return errorResponse(
          404,
          "NOT_FOUND",
          "Задача или область недоступна",
          id,
        );
      case "idempotency_conflict":
        return errorResponse(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Ключ уже использован для другого запроса",
          id,
        );
      case "conflict":
        return errorResponse(
          409,
          "TASK_CONFLICT",
          "Задача изменилась. Обновите данные",
          id,
          result.currentVersion,
        );
      case "disabled":
        return errorResponse(
          422,
          "TASK_MANAGEMENT_DISABLED",
          "Создание и назначение в тестовом режиме выключены",
          id,
        );
      case "rules_invalid":
        return errorResponse(
          422,
          "TASK_RULES_INVALID",
          "Тестовая версия правил недоступна",
          id,
        );
      case "assignee_invalid":
        return errorResponse(
          422,
          "TASK_ASSIGNEE_INVALID",
          "Исполнитель недоступен в этой области",
          id,
        );
    }
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
}
