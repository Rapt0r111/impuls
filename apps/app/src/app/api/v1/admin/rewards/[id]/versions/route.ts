import {
  adminCatalogHistoryParamsSchema,
  adminCatalogHistoryQuerySchema,
  adminCatalogHistoryResponseSchema,
} from "@impuls/contracts";
import { hashSessionToken, readAdminCatalogHistory } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession } from "@/shared/server/auth";
import { getPool } from "@/shared/server/db";
import { errorResponse, jsonResponse, requestId } from "@/shared/server/http";
import { handleCatalogPublication } from "@/shared/server/catalog-publication";

export const runtime = "nodejs";
export const POST = handleCatalogPublication;
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const id = requestId();
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
    const params = request.nextUrl.searchParams;
    const keys = [...params.keys()];
    const path = adminCatalogHistoryParamsSchema.safeParse(
      await context.params,
    );
    const query = adminCatalogHistoryQuerySchema.safeParse(
      Object.fromEntries(params),
    );
    if (!path.success || !query.success || new Set(keys).size !== keys.length)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Неверные параметры истории каталога",
        id,
      );
    const result = await readAdminCatalogHistory(
      getPool(),
      session.user.id,
      hashSessionToken(session.token),
      path.data.id,
      {
        ...query.data,
        enabled: process.env.ADMIN_CATALOG_ENABLED === "true",
      },
    );
    if (result.kind === "unauthorized")
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Повторите вход через Telegram",
        id,
      );
    if (result.kind === "revoked")
      return errorResponse(403, "ACCESS_REVOKED", "Доступ отозван", id);
    if (result.kind === "disabled")
      return errorResponse(
        404,
        "ADMIN_CATALOG_DISABLED",
        "Просмотр управления каталогом выключен",
        id,
      );
    if (result.kind === "not_found")
      return errorResponse(
        404,
        "NOT_FOUND",
        "История позиции в этой области недоступна",
        id,
      );
    if (result.kind === "invalid_cursor")
      return errorResponse(
        400,
        "INVALID_CURSOR",
        "Обновите историю с первой страницы",
        id,
      );
    return jsonResponse(
      adminCatalogHistoryResponseSchema.parse(result.response),
      200,
      id,
    );
  } catch {
    return errorResponse(
      503,
      "UNAVAILABLE",
      "История каталога временно недоступна",
      id,
    );
  }
}
