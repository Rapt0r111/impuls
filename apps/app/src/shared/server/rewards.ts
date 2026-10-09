import "server-only";
import {
  rewardListQuerySchema,
  redemptionListQuerySchema,
  reserveRewardRequestSchema,
  cancelRedemptionRequestSchema,
  decideRedemptionRequestSchema,
  fulfillRedemptionRequestSchema,
  redemptionReviewQuerySchema,
  redemptionDecisionResponseSchema,
  redemptionReviewResponseSchema,
  rewardCatalogResponseSchema,
  redemptionListResponseSchema,
  redemptionMutationResponseSchema,
  taskSubmissionHeadersSchema,
  taskIdSchema,
} from "@impuls/contracts";
import {
  readRewardCatalog,
  readMyRedemptions,
  mutateRedemption,
  decideRedemption,
  fulfillRedemption,
  readRedemptionReview,
  hashSessionToken,
} from "@impuls/domain";
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

export async function handleRewardRead(
  request: NextRequest,
  action: "catalog" | "mine" | "review" | "fulfillment",
) {
  const id = requestId();
  try {
    const session = await getAuthorizedSession(request);
    if (session.kind !== "authorized")
      return errorResponse(
        session.kind === "missing" ? 401 : 403,
        session.kind === "missing" ? "UNAUTHORIZED" : "ACCESS_REVOKED",
        "Повторите вход через Telegram",
        id,
      );
    const entries = [...request.nextUrl.searchParams];
    if (new Set(entries.map(([key]) => key)).size !== entries.length)
      return errorResponse(400, "BAD_REQUEST", "Повторяющиеся параметры", id);
    const raw = Object.fromEntries(entries);
    const options = {
      allowSyntheticRewards: process.env.REWARDS_ENABLED === "true",
    };
    const hash = hashSessionToken(session.token);
    let result;
    if (action === "catalog") {
      const query = rewardListQuerySchema.safeParse(raw);
      if (!query.success)
        return errorResponse(
          400,
          "BAD_REQUEST",
          "Неверные параметры каталога",
          id,
        );
      result = await readRewardCatalog(getPool(), session.user.id, hash, {
        ...options,
        ...query.data,
      });
    } else if (action === "review" || action === "fulfillment") {
      const query = redemptionReviewQuerySchema.safeParse(raw);
      if (!query.success)
        return errorResponse(
          400,
          "BAD_REQUEST",
          "Неверные параметры очереди",
          id,
        );
      result = await readRedemptionReview(getPool(), session.user.id, hash, {
        ...options,
        ...query.data,
        purpose: action === "fulfillment" ? "fulfill" : "decide",
      });
    } else {
      const query = redemptionListQuerySchema.safeParse(raw);
      if (!query.success)
        return errorResponse(
          400,
          "BAD_REQUEST",
          "Неверные параметры заявок",
          id,
        );
      result = await readMyRedemptions(getPool(), session.user.id, hash, {
        ...options,
        ...query.data,
      });
    }
    if (result.kind === "unauthorized" || result.kind === "revoked")
      return errorResponse(
        result.kind === "unauthorized" ? 401 : 403,
        "ACCESS_REVOKED",
        "Повторите вход через Telegram",
        id,
      );
    if (result.kind === "invalid_cursor")
      return errorResponse(
        400,
        "INVALID_CURSOR",
        "Обновите список с первой страницы",
        id,
      );
    if (result.kind === "page_changed")
      return errorResponse(
        409,
        "PAGE_CHANGED",
        action === "catalog"
          ? "Каталог изменился. Обновите список"
          : "Очередь изменилась. Обновите список",
        id,
      );
    if (result.kind !== "ok")
      return errorResponse(404, "NOT_FOUND", "Каталог недоступен", id);
    return jsonResponse(
      action === "catalog"
        ? rewardCatalogResponseSchema.parse(result.response)
        : action === "review" || action === "fulfillment"
          ? redemptionReviewResponseSchema.parse(result.response)
          : redemptionListResponseSchema.parse(result.response),
      200,
      id,
    );
  } catch {
    return errorResponse(
      503,
      "UNAVAILABLE",
      "Не удалось загрузить поощрения",
      id,
    );
  }
}
export async function handleRewardMutation(
  request: NextRequest,
  redemptionId?: string,
  action: "cancel" | "decide" | "fulfill" = "cancel",
) {
  const id = requestId();
  if (!process.env.APP_ORIGIN || !process.env.CSRF_SECRET)
    return errorResponse(503, "UNAVAILABLE", "Сервис недоступен", id);
  if (!isAllowedOrigin(request))
    return errorResponse(403, "ORIGIN_DENIED", "Запрос не принят", id);
  try {
    const session = await getAuthorizedSession(request);
    if (session.kind !== "authorized")
      return errorResponse(
        session.kind === "missing" ? 401 : 403,
        "ACCESS_REVOKED",
        "Повторите вход через Telegram",
        id,
      );
    if (!hasValidCsrf(request, session.token))
      return errorResponse(403, "CSRF_DENIED", "Запрос не принят", id);
    const limited = await checkTaskMutationLimit(session.user.id, id);
    if (limited) return limited;
    if ([...request.nextUrl.searchParams].length)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Параметры не поддерживаются",
        id,
      );
    if (
      redemptionId !== undefined &&
      !taskIdSchema.safeParse(redemptionId).success
    )
      return errorResponse(404, "NOT_FOUND", "Заявка не найдена", id);
    const headers = taskSubmissionHeadersSchema.safeParse({
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    if (!headers.success)
      return errorResponse(400, "BAD_REQUEST", "Неверный ключ запроса", id);
    let raw: unknown;
    try {
      raw = await readJsonLimited(request, 8192);
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Неверный формат запроса", id);
    }
    const common = {
      actorId: session.user.id,
      sessionHash: hashSessionToken(session.token),
      idempotencyKey: headers.data.idempotencyKey,
      requestId: id,
      allowSyntheticRewards: process.env.REWARDS_ENABLED === "true",
    };
    let result;
    if (redemptionId !== undefined && action === "fulfill") {
      const body = fulfillRedemptionRequestSchema.safeParse(raw);
      if (!body.success)
        return errorResponse(
          400,
          "BAD_REQUEST",
          "Укажите версию заявки и основание выдачи",
          id,
        );
      result = await fulfillRedemption(getPool(), {
        ...common,
        redemptionId,
        ...body.data,
      });
    } else if (redemptionId !== undefined && action === "decide") {
      const body = decideRedemptionRequestSchema.safeParse(raw);
      if (!body.success)
        return errorResponse(
          400,
          "BAD_REQUEST",
          "Укажите решение, версию и причину",
          id,
        );
      result = await decideRedemption(getPool(), {
        ...common,
        redemptionId,
        ...body.data,
      });
    } else if (redemptionId !== undefined) {
      const body = cancelRedemptionRequestSchema.safeParse(raw);
      if (!body.success)
        return errorResponse(
          400,
          "BAD_REQUEST",
          "Укажите версию заявки и причину отмены",
          id,
        );
      result = await mutateRedemption(getPool(), {
        ...common,
        action: "cancel",
        redemptionId,
        ...body.data,
      });
    } else {
      const body = reserveRewardRequestSchema.safeParse(raw);
      if (!body.success)
        return errorResponse(400, "BAD_REQUEST", "Неверные данные заявки", id);
      result = await mutateRedemption(getPool(), {
        ...common,
        action: "reserve",
        ...body.data,
      });
    }
    if (result.kind === "ok")
      return jsonResponse(
        action === "decide" || action === "fulfill"
          ? redemptionDecisionResponseSchema.parse(result.response)
          : redemptionMutationResponseSchema.parse(result.response),
        "status" in result && result.status === 201 ? 201 : 200,
        id,
      );
    if (result.kind === "unauthorized" || result.kind === "revoked")
      return errorResponse(
        result.kind === "unauthorized" ? 401 : 403,
        "ACCESS_REVOKED",
        "Повторите вход через Telegram",
        id,
      );
    if (result.kind === "disabled" || result.kind === "not_found")
      return errorResponse(
        404,
        "NOT_FOUND",
        "Заявка или позиция недоступна",
        id,
      );
    if (result.kind === "conflict")
      return errorResponse(
        409,
        "REWARD_CONFLICT",
        "Условия или заявка изменились. Обновите данные",
        id,
        result.currentVersion,
      );
    const messages = {
      idempotency_conflict: "Ключ использован для другого запроса",
      insufficient_points: "Недостаточно доступных баллов",
      quota_full: "Свободных мест больше нет",
      already_pending:
        "По этой позиции уже есть активная заявка или право владения",
      recipient_inactive: "Получатель выбыл. Операция недоступна",
      reservation_expired:
        "Срок резерва достигнут. Одобрение недоступно; завершите резерв по истечению срока",
      reservation_not_due: "Срок резерва не задан или ещё не достигнут",
    };
    return errorResponse(
      409,
      result.kind.toUpperCase(),
      messages[result.kind],
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
