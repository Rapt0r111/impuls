import type { NextRequest } from "next/server";
import { handleTaskManagementMutation } from "@/shared/server/task-management";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleTaskManagementMutation(request, id, "edit");
}
