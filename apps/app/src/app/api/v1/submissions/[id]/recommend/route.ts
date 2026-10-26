import {
  taskIdSchema,
  taskRecommendRequestSchema,
  taskRecommendationResponseSchema,
} from "@impuls/contracts";
import { hashSessionToken, recommendTaskSubmission } from "@impuls/domain";
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
    let raw: unknown;
    try {
      raw = await readJsonLimited(request, 32_768);
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Неверный формат запроса", id);
    }
    const body = taskRecommendRequestSchema.safeParse(raw);
    if (!body.success)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Укажите версию задачи и значения от 0 до 100",
        id,
      );
    const result = await recommendTaskSubmission(getPool(), {
      actorId: session.user.id,
      sessionHash: hashSessionToken(session.token),
      submissionId,
      expectedVersion: body.data.expectedVersion,
      recommendedXp: body.data.recommendedXp,
      recommendedPoints: body.data.recommendedPoints,
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
    if (result.kind === "over_fund")
      return errorResponse(
        422,
        "TASK_RECOMMENDATION_OVER_FUND",
        "Рекомендация больше фонда задачи",
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
    return jsonResponse(
      taskRecommendationResponseSchema.parse(result.response),
      200,
      id,
    );
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
}
