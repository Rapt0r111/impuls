import "server-only";
import {
  taskIdSchema,
  taskStartRequestSchema,
  taskStartResponseSchema,
  taskSubmissionHeadersSchema,
  taskSubmissionRequestSchema,
  taskSubmissionResponseSchema,
} from "@impuls/contracts";
import { hashSessionToken, mutateAssignedTask } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession, hasValidCsrf } from "./auth";
import { getPool } from "./db";
import { checkTaskMutationLimit } from "./task-rate-limit";
import {
  errorResponse,
  isAllowedOrigin,
  jsonResponse,
  readJsonLimited,
  requestId,
} from "./http";

export async function handleTaskMutation(
  request: NextRequest,
  taskId: string,
  action: "start" | "submit",
) {
  const id = requestId();
  if (!process.env.APP_ORIGIN || !process.env.CSRF_SECRET) {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
  if (!isAllowedOrigin(request)) {
    return errorResponse(403, "ORIGIN_DENIED", "Запрос не принят", id);
  }
  try {
    const session = await getAuthorizedSession(request);
    if (session.kind === "missing") {
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Откройте приложение через Telegram",
        id,
      );
    }
    if (session.kind === "revoked") {
      return errorResponse(
        403,
        "ACCESS_REVOKED",
        "Доступ к приложению отозван",
        id,
      );
    }
    if (!hasValidCsrf(request, session.token)) {
      return errorResponse(403, "CSRF_DENIED", "Запрос не принят", id);
    }
    const limited = await checkTaskMutationLimit(session.user.id, id);
    if (limited) return limited;
    if (!taskIdSchema.safeParse(taskId).success) {
      return errorResponse(404, "NOT_FOUND", "Задача не найдена", id);
    }
    const headers = taskSubmissionHeadersSchema.safeParse({
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    if (!headers.success) {
      return errorResponse(400, "BAD_REQUEST", "Неверный ключ запроса", id);
    }
    let rawBody: unknown;
    try {
      rawBody = await readJsonLimited(request, 32_768);
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Неверный формат запроса", id);
    }
    const body =
      action === "start"
        ? taskStartRequestSchema.safeParse(rawBody)
        : taskSubmissionRequestSchema.safeParse(rawBody);
    if (!body.success) {
      return errorResponse(400, "BAD_REQUEST", "Неверные данные задачи", id);
    }
    const result = await mutateAssignedTask(
      getPool(),
      action === "start"
        ? {
            action,
            taskId,
            actorId: session.user.id,
            sessionHash: hashSessionToken(session.token),
            expectedVersion: body.data.expectedVersion,
            idempotencyKey: headers.data.idempotencyKey,
          }
        : {
            action,
            taskId,
            actorId: session.user.id,
            sessionHash: hashSessionToken(session.token),
            expectedVersion: body.data.expectedVersion,
            idempotencyKey: headers.data.idempotencyKey,
            text: (body.data as { text: string }).text,
          },
    );
    if (result.kind === "unauthorized") {
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Откройте приложение через Telegram",
        id,
      );
    }
    if (result.kind === "revoked") {
      return errorResponse(
        403,
        "ACCESS_REVOKED",
        "Доступ к приложению отозван",
        id,
      );
    }
    if (result.kind === "not_found") {
      return errorResponse(404, "NOT_FOUND", "Задача не найдена", id);
    }
    if (result.kind === "idempotency_conflict") {
      return errorResponse(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Ключ уже использован для другого запроса",
        id,
      );
    }
    if (result.kind === "conflict") {
      return errorResponse(
        409,
        "TASK_CONFLICT",
        "Задача изменилась. Обновите данные",
        id,
        result.currentVersion,
      );
    }
    const response =
      action === "start"
        ? taskStartResponseSchema.parse(result.response)
        : taskSubmissionResponseSchema.parse(result.response);
    return jsonResponse(response, result.status, id);
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
}
