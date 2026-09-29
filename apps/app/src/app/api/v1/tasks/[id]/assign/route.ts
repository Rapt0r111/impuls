import { assignTaskRequestSchema } from "@impuls/contracts";
import { assignTask } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getPool } from "@/shared/server/db";
import { taskMutation } from "@/shared/server/task-http";

export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return taskMutation(request, assignTaskRequestSchema, (actorId, key, body) =>
    assignTask(getPool(), actorId, id, key, body),
  );
}
