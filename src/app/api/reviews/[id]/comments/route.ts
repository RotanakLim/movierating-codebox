import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPublicConfig } from "@/lib/env";
import { decodeCursor } from "@/lib/reviews/cursor";
import { loadThreads } from "@/lib/reviews/discussion";

export const runtime = "nodejs";
// Viewer-specific (blocks, own comments), so never shared-cached.
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers });

/** GET ?cursor=<opaque> — the next page of a review's discussion threads. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!getPublicConfig())
    return fail(503, "Discussions are not available yet.");
  const id = z.uuid().safeParse((await params).id);
  let cursor;
  try {
    cursor = decodeCursor(request.nextUrl.searchParams.get("cursor"));
  } catch {
    return fail(400, "Invalid request.");
  }
  if (!id.success) return fail(400, "Invalid request.");
  try {
    return NextResponse.json(await loadThreads(id.data, cursor), { headers });
  } catch {
    return fail(
      503,
      "The discussion is unavailable right now. Please try again.",
    );
  }
}
