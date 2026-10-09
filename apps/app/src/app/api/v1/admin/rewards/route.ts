import {
  adminCatalogQuerySchema,
  adminCatalogResponseSchema,
} from "@impuls/contracts";
import { hashSessionToken, readAdminCatalog } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession } from "@/shared/server/auth";
import { getPool } from "@/shared/server/db";
import { errorResponse, jsonResponse, requestId } from "@/shared/server/http";

import { handleCatalogCreation } from "@/shared/server/catalog-creation";
export const POST = handleCatalogCreation;
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
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
    const query = adminCatalogQuerySchema.safeParse(Object.fromEntries(params));
    if (new Set(keys).size !== keys.length || !query.success)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Неверные параметры каталога управления",
        id,
      );
    const result = await readAdminCatalog(
      getPool(),
      session.user.id,
      hashSessionToken(session.token),
      {
        ...query.data,
        enabled: process.env.ADMIN_CATALOG_ENABLED === "true",
        allowCreation: process.env.CATALOG_CREATION_ENABLED === "true",
        allowPublication: process.env.CATALOG_PUBLICATION_ENABLED === "true",
        allowCancellation: process.env.CATALOG_CANCELLATION_ENABLED === "true",
        allowScheduling: process.env.CATALOG_SCHEDULING_ENABLED === "true",
        allowQuotaPublication: process.env.QUOTA_PUBLICATION_ENABLED === "true",
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
        "Каталог управления в этой области недоступен",
        id,
      );
    if (result.kind === "invalid_cursor")
      return errorResponse(
        400,
        "INVALID_CURSOR",
        "Обновите каталог с первой страницы",
        id,
      );
    return jsonResponse(
      adminCatalogResponseSchema.parse(result.response),
      200,
      id,
    );
  } catch {
    return errorResponse(
      503,
      "UNAVAILABLE",
      "Каталог управления временно недоступен",
      id,
    );
  }
}
