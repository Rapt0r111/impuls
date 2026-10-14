import type { RealtimeResponse } from "@impuls/contracts";
import type { NextRequest } from "next/server";
import { getAuthorizedSession } from "@/shared/server/auth";
import { getPool } from "@/shared/server/db";
import {
  errorResponse,
  jsonResponse,
  logFailure,
  requestId,
} from "@/shared/server/http";

export const runtime = "nodejs";

// ADR-0038: выдаёт участнику параметры подписки на сигналы об изменениях.
// Без флага, адреса, ключа или миграции ответ «выключено»: приложение остаётся на опросе.
export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const session = await getAuthorizedSession(request);
    if (session.kind === "missing") {
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Откройте приложение через Telegram",
        id,
      );
    }
    if (session.kind === "revoked") {
      return errorResponse(
        403,
        "ACCESS_REVOKED",
        "Доступ к приложению отозван",
        id,
      );
    }
    const url = process.env.REALTIME_URL;
    const key = process.env.REALTIME_PUBLISHABLE_KEY;
    if (process.env.REALTIME_ENABLED !== "true" || !url || !key) {
      return jsonResponse(
        { enabled: false } satisfies RealtimeResponse,
        200,
        id,
      );
    }
    try {
      const { rows } = await getPool().query<{ topic: string }>(
        "SELECT impuls.realtime_topic($1) AS topic",
        [session.user.id],
      );
      const topic = rows[0]?.topic;
      if (!topic) throw new Error("topic missing");
      return jsonResponse(
        { enabled: true, url, key, topic } satisfies RealtimeResponse,
        200,
        id,
      );
    } catch (error) {
      // Миграция 000045 не применена или БД недоступна: сигналов нет, опрос работает.
      logFailure(id, "realtime_topic", error);
      return jsonResponse(
        { enabled: false } satisfies RealtimeResponse,
        200,
        id,
      );
    }
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
}
