import "server-only";
import {
  quotaPublicationRequestSchema,
  quotaPublicationResponseSchema,
  taskIdSchema,
  taskSubmissionHeadersSchema,
} from "@impuls/contracts";
import { hashSessionToken, publishQuotaPeriod } from "@impuls/domain";
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

export async function handleQuotaPublication(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const id = requestId();
  if (!process.env.APP_ORIGIN || !process.env.CSRF_SECRET)
    return errorResponse(503, "UNAVAILABLE", "Сервис недоступен", id);
  if (!isAllowedOrigin(request))
    return errorResponse(
      403,
      "ORIGIN_DENIED",
      "Недопустимый источник запроса",
      id,
    );
  try {
    const params = taskIdSchema.safeParse((await context.params).id);
    const headers = taskSubmissionHeadersSchema.safeParse({
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    if (
      !params.success ||
      !headers.success ||
      request.nextUrl.searchParams.size ||
      request.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Неверные параметры публикации",
        id,
      );
    let raw;
    try {
      raw = await readJsonLimited(request);
    } catch (error) {
      return errorResponse(
        error instanceof Error && error.message === "body too large"
          ? 413
          : 400,
        "BAD_REQUEST",
        "Неверное или слишком большое тело запроса",
        id,
      );
    }
    const body = quotaPublicationRequestSchema.safeParse(raw);
    if (!body.success)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Проверьте даты, число мест и основание публикации",
        id,
      );
    const session = await getAuthorizedSession(request);
    if (session.kind !== "authorized")
      return errorResponse(
        session.kind === "missing" ? 401 : 403,
        "ACCESS_REVOKED",
        "Повторите вход через Telegram",
        id,
      );
    if (!hasValidCsrf(request, session.token))
      return errorResponse(
        403,
        "CSRF_DENIED",
        "Повторите вход через Telegram",
        id,
      );
    const limited = await checkTaskMutationLimit(session.user.id, id);
    if (limited) return limited;
    const result = await publishQuotaPeriod(getPool(), {
      ...body.data,
      rewardId: params.data,
      actorId: session.user.id,
      sessionHash: hashSessionToken(session.token),
      idempotencyKey: headers.data.idempotencyKey,
      requestId: id,
      allowPublication:
        process.env.SYNTHETIC_ADMIN_CATALOG_ENABLED === "true" &&
        process.env.SYNTHETIC_QUOTA_PUBLICATION_ENABLED === "true",
    });
    if (result.kind === "ok")
      return jsonResponse(
        quotaPublicationResponseSchema.parse(result.response),
        201,
        id,
      );
    if (result.kind === "revoked" || result.kind === "unauthorized")
      return errorResponse(
        result.kind === "revoked" ? 403 : 401,
        "ACCESS_REVOKED",
        "Повторите вход через Telegram",
        id,
      );
    if (result.kind === "not_found" || result.kind === "disabled")
      return errorResponse(
        404,
        "QUOTA_PUBLICATION_UNAVAILABLE",
        "Публикация в этой области недоступна",
        id,
      );
    if (result.kind === "overlap")
      return errorResponse(
        409,
        "QUOTA_OVERLAP",
        "Периоды пересекаются. Перечитайте периоды квоты",
        id,
      );
    if (result.kind === "idempotency_conflict")
      return errorResponse(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Ключ использован для другого запроса",
        id,
      );
    return errorResponse(
      422,
      "QUOTA_PERIOD_INVALID",
      "Начало периода уже наступило либо параметры неверны. Проверьте даты UTC",
      id,
    );
  } catch {
    return errorResponse(
      503,
      "UNAVAILABLE",
      "Результат не подтверждён. Повторите тот же запрос",
      id,
    );
  }
}
