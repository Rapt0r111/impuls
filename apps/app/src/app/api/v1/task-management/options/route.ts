import { taskManagementOptionsResponseSchema } from "@impuls/contracts";
import { readTaskManagementOptions } from "@impuls/domain";
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
    if ([...request.nextUrl.searchParams.keys()].length)
      return errorResponse(400, "BAD_REQUEST", "Неверные параметры", id);
    const options = await readTaskManagementOptions(
      getPool(),
      session.user.id,
      { enabled: process.env.SYNTHETIC_TASK_MANAGEMENT_ENABLED === "true" },
    );
    return jsonResponse(
      taskManagementOptionsResponseSchema.parse(options),
      200,
      id,
    );
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
}
