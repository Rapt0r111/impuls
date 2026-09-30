import {
  taskManagementListQuerySchema,
  taskManagementListResponseSchema,
} from "@impuls/contracts";
import { listManagedTasks } from "@impuls/domain";
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
        "Откройте приложение через Telegram",
        id,
      );
    if (session.kind === "revoked")
      return errorResponse(403, "ACCESS_REVOKED", "Доступ отозван", id);
    const params = request.nextUrl.searchParams;
    if (new Set(params.keys()).size !== [...params.keys()].length)
      return errorResponse(400, "BAD_REQUEST", "Неверные параметры списка", id);
    const query = taskManagementListQuerySchema.safeParse(
      Object.fromEntries(params),
    );
    if (!query.success)
      return errorResponse(400, "BAD_REQUEST", "Неверные параметры списка", id);
    return jsonResponse(
      taskManagementListResponseSchema.parse(
        await listManagedTasks(getPool(), session.user.id, query.data),
      ),
      200,
      id,
    );
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
}
