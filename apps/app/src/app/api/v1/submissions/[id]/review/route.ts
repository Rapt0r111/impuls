import {
  taskIdSchema,
  taskSubmissionHeadersSchema,
  taskReviewRequestSchema,
  taskAcceptanceResponseSchema,
  taskReturnResponseSchema,
} from "@impuls/contracts";
import { hashSessionToken, reviewTaskSubmission } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession, hasValidCsrf } from "@/shared/server/auth";
import { getPool } from "@/shared/server/db";
import { checkTaskMutationLimit } from "@/shared/server/task-rate-limit";
import {
  errorResponse,
  isAllowedOrigin,
  jsonResponse,
  readJsonLimited,
  requestId,
} from "@/shared/server/http";

export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
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
        "Повторите вход через Telegram",
        id,
      );
    if (session.kind === "revoked")
      return errorResponse(403, "ACCESS_REVOKED", "Доступ отозван", id);
    if (!hasValidCsrf(request, session.token))
      return errorResponse(403, "CSRF_DENIED", "Запрос не принят", id);
    const limited = await checkTaskMutationLimit(session.user.id, id);
    if (limited) return limited;
    const { id: submissionId } = await context.params;
    if (!taskIdSchema.safeParse(submissionId).success)
      return errorResponse(404, "NOT_FOUND", "Отчёт не найден", id);
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
    const body = taskReviewRequestSchema.safeParse(raw);
    if (!body.success)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Укажите причину от 1 до 2000 символов и версию задачи",
        id,
      );
    const result = await reviewTaskSubmission(getPool(), {
      action: body.data.action,
      allowSyntheticAccrual: process.env.ECONOMY_ENABLED === "true",
      requestId: id,
      actorId: session.user.id,
      sessionHash: hashSessionToken(session.token),
      submissionId,
      expectedVersion: body.data.expectedVersion,
      reason: body.data.reason,
      idempotencyKey: headers.data.idempotencyKey,
      ...(body.data.action === "accept"
        ? {
            baseXp: body.data.baseXp,
            basePoints: body.data.basePoints,
            bonusCode: body.data.bonusCode,
          }
        : {}),
    });
    if (result.kind === "unauthorized")
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Повторите вход через Telegram",
        id,
      );
    if (result.kind === "revoked")
      return errorResponse(403, "ACCESS_REVOKED", "Доступ отозван", id);
    if (result.kind === "not_found")
      return errorResponse(404, "NOT_FOUND", "Отчёт недоступен", id);
    if (result.kind === "self_review")
      return errorResponse(
        403,
        "SELF_REVIEW_DENIED",
        "Нельзя проверять собственный результат",
        id,
      );
    if (result.kind === "idempotency_conflict")
      return errorResponse(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Ключ уже использован для другого запроса",
        id,
      );
    if (result.kind === "conflict")
      return errorResponse(
        409,
        "TASK_CONFLICT",
        "Задача изменилась. Обновите очередь",
        id,
        result.currentVersion,
      );
    if (result.kind === "recipient_revoked")
      return errorResponse(
        422,
        "RECIPIENT_REVOKED",
        "Доступ исполнителя отозван",
        id,
      );
    if (result.kind === "economy_disabled")
      return errorResponse(
        503,
        "ECONOMY_DISABLED",
        "Синтетические начисления отключены",
        id,
      );
    if (result.kind === "economy_rules_invalid")
      return errorResponse(
        422,
        "ECONOMY_RULES_INVALID",
        "Настройки начислений не разрешают начисление",
        id,
      );
    if (result.kind === "award_invalid")
      return errorResponse(
        422,
        "AWARD_INVALID",
        {
          adjustment_not_allowed:
            "Настройки начислений не разрешают корректировать базовые значения",
          adjustment_exceeds_limit:
            "Значения превышают предел корректировки в настройках начислений",
          adjustment_below_limit:
            "Значения ниже минимума корректировки в настройках начислений",
          bonus_unknown:
            "Такого бонуса нет в настройках начислений этой задачи",
          points_above_limit:
            "Баллы за задачу не могут быть больше 100, с учётом надбавки",
          award_too_large: "Итоговое начисление слишком велико",
        }[result.reason],
        id,
      );
    return jsonResponse(
      (body.data.action === "accept"
        ? taskAcceptanceResponseSchema
        : taskReturnResponseSchema
      ).parse(result.response),
      200,
      id,
    );
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
}
