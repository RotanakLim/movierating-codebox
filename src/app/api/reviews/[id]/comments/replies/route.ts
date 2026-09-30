import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPublicConfig } from "@/lib/env";
import { decodeCursor } from "@/lib/reviews/cursor";
import { loadReplies } from "@/lib/reviews/discussion";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers });

/**
 * GET ?thread=<comment id>&cursor=<opaque> — more replies in one thread. The
 * database checks the thread belongs to a review the viewer may see.
 */
export async function GET(request: NextRequest) {
  if (!getPublicConfig())
    return fail(503, "Discussions are not available yet.");
  const params = request.nextUrl.searchParams;
  const thread = z.uuid().safeParse(params.get("thread"));
  let cursor;
  try {
    cursor = decodeCursor(params.get("cursor"));
  } catch {
    return fail(400, "Invalid request.");
  }
  if (!thread.success) return fail(400, "Invalid request.");
  try {
    return NextResponse.json(await loadReplies(thread.data, cursor), {
      headers,
    });
  } catch {
    return fail(503, "Replies are unavailable right now. Please try again.");
  }
}
