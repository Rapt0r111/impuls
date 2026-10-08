import type { NextRequest } from "next/server";
import { handleRewardRead } from "@/shared/server/rewards";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return handleRewardRead(request, "fulfillment");
}
