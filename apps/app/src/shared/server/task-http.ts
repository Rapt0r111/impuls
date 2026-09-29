import "server-only";
import { consumeMutationAttempt, TaskError } from "@impuls/domain";
import { z } from "zod";
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

const keySchema = z.uuid();

function taskError(error: unknown, id: string) {
  if (error instanceof TaskError) {
    const messages: Record<string, string> = {
      FORBIDDEN: "Недостаточно полномочий",
      NOT_FOUND: "Задача недоступна",
      VERSION_CONFLICT: "Задача уже изменена. Обновите данные",
      STATE_CONFLICT: "Состояние задачи изменилось. Обновите данные",
      IDEMPOTENCY_CONFLICT: "Ключ запроса уже использован для другого действия",
      RULES_UNAVAILABLE: "Версия правил недоступна",
      FUND_OUT_OF_RANGE: "Фонд превышает предел версии правил",
      ASSIGNEE_UNAVAILABLE: "Участник недоступен",
      INVALID_CURSOR: "Неверный курсор списка",
    };
    return errorResponse(
      error.status,
      error.code,
      messages[error.code] ?? "Операция отклонена",
      id,
      error.currentVersion,
    );
  }
  console.error("Task API failed", {
    requestId: id,
    code: error instanceof Error ? error.name : "UNKNOWN",
  });
  return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
}

export async function taskRead(
  request: NextRequest,
  run: (actorId: string) => Promise<unknown>,
) {
  const id = requestId();
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
    return jsonResponse(await run(session.user.id), 200, id);
  } catch (error) {
    return taskError(error, id);
  }
}

export async function taskMutation<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
  run: (
    actorId: string,
    key: string,
    body: T,
  ) => Promise<{ status: number; data: unknown }>,
) {
  const id = requestId();
  if (!process.env.APP_ORIGIN || !process.env.CSRF_SECRET)
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  if (!isAllowedOrigin(request))
    return errorResponse(403, "ORIGIN_DENIED", "Запрос не принят", id);
  const key = request.headers.get("idempotency-key");
  if (!keySchema.safeParse(key).success)
    return errorResponse(400, "BAD_REQUEST", "Нужен Idempotency-Key UUID", id);
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
    const limit = await consumeMutationAttempt(
      getPool(),
      session.user.id,
      process.env.CSRF_SECRET,
    );
    if (!limit.allowed) {
      const response = errorResponse(
        429,
        "RATE_LIMITED",
        "Слишком много действий. Повторите позже",
        id,
      );
      response.headers.set("Retry-After", String(limit.retryAfter));
      return response;
    }
    let raw: unknown;
    try {
      raw = await readJsonLimited(request, 8_192);
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Неверный формат запроса", id);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      return errorResponse(400, "BAD_REQUEST", "Неверные данные запроса", id);
    const result = await run(session.user.id, key!, parsed.data);
    return jsonResponse(result.data, result.status, id);
  } catch (error) {
    return taskError(error, id);
  }
}
