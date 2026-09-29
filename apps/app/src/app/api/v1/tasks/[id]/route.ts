import { getTaskDetail } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getPool } from "@/shared/server/db";
import { taskRead } from "@/shared/server/task-http";

export const runtime = "nodejs";
export function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return taskRead(request, async (actorId) => {
    const { id } = await params;
    return getTaskDetail(getPool(), actorId, id);
  });
}
