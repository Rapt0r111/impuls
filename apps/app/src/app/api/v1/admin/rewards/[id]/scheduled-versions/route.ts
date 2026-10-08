import type { NextRequest } from "next/server";
import { handleCatalogPublication } from "@/shared/server/catalog-publication";

export const runtime = "nodejs";
export function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handleCatalogPublication(request, context, true);
}
