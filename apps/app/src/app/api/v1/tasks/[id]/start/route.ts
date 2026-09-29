import { startTaskRequestSchema } from "@impuls/contracts";
import { startTask } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getPool } from "@/shared/server/db";
import { taskMutation } from "@/shared/server/task-http";

export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return taskMutation(request, startTaskRequestSchema, (actorId, key, body) =>
    startTask(getPool(), actorId, id, key, body),
  );
}
