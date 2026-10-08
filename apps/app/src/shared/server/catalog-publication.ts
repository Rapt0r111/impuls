import "server-only";
import {
  catalogPublicationRequestSchema,
  catalogSchedulingRequestSchema,
  catalogPublicationResponseSchema,
  taskIdSchema,
  taskSubmissionHeadersSchema,
} from "@impuls/contracts";
import { hashSessionToken, publishCatalogTerms } from "@impuls/domain";
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

export async function handleCatalogPublication(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
  scheduling = false,
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
    const body = (
      scheduling
        ? catalogSchedulingRequestSchema
        : catalogPublicationRequestSchema
    ).safeParse(raw);
    if (!body.success)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Проверьте условия и основание публикации",
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
    const result = await publishCatalogTerms(getPool(), {
      ...body.data,
      rewardId: params.data,
      actorId: session.user.id,
      sessionHash: hashSessionToken(session.token),
      idempotencyKey: headers.data.idempotencyKey,
      requestId: id,
      allowPublication:
        process.env.SYNTHETIC_ADMIN_CATALOG_ENABLED === "true" &&
        (scheduling
          ? process.env.SYNTHETIC_CATALOG_SCHEDULING_ENABLED
          : process.env.SYNTHETIC_CATALOG_PUBLICATION_ENABLED) === "true",
    });
    if (result.kind === "ok")
      return jsonResponse(
        catalogPublicationResponseSchema.parse(result.response),
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
        "CATALOG_PUBLICATION_UNAVAILABLE",
        "Публикация в этой области недоступна",
        id,
      );
    if (result.kind === "conflict")
      return errorResponse(
        409,
        "CATALOG_CONFLICT",
        "Условия изменились. Обновите каталог",
        id,
        result.currentVersion,
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
      result.kind === "invalid_effective_time"
        ? "CATALOG_TIME_INVALID"
        : result.kind === "scheduled"
          ? "CATALOG_SCHEDULED"
          : "CATALOG_CONFIGURATION_INVALID",
      result.kind === "invalid_effective_time"
        ? "Начало действия должно быть позже текущего времени сервера. Обновите дату"
        : result.kind === "scheduled"
          ? "Есть будущие условия. Их замена пока недоступна"
          : "Порядок сохранённых версий требует проверки",
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
