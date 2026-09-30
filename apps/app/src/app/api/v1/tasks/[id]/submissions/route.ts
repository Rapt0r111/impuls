import type { NextRequest } from "next/server";
import { handleTaskMutation } from "@/shared/server/task-mutation";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleTaskMutation(request, id, "submit");
}
