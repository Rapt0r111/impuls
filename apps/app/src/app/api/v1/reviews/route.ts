import {
  reviewListQuerySchema,
  reviewListResponseSchema,
} from "@impuls/contracts";
import { listActivePermissions, listReviewQueue } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession } from "@/shared/server/auth";
import { getPool } from "@/shared/server/db";
import { errorResponse, jsonResponse, requestId } from "@/shared/server/http";

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
    const query = reviewListQuerySchema.safeParse(Object.fromEntries(params));
    if (new Set(keys).size !== keys.length || !query.success)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Неверные параметры очереди",
        id,
      );
    const permissions = await listActivePermissions(getPool(), session.user.id);
    // A chosen verifier sees the reports they can return; accepting stays with task.review.
    if (
      !permissions.some(
        (p) => p.action === "task.review" || p.action === "task.verify",
      )
    )
      return errorResponse(
        403,
        "PERMISSION_DENIED",
        "Право проверки отсутствует",
        id,
      );
    const queue = await listReviewQueue(getPool(), session.user.id, {
      ...query.data,
      allowSyntheticAccrual: process.env.ECONOMY_ENABLED === "true",
    });
    return jsonResponse(reviewListResponseSchema.parse(queue), 200, id);
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Очередь временно недоступна", id);
  }
}
