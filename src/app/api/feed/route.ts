import { NextResponse, type NextRequest } from "next/server";
import { getPublicConfig } from "@/lib/env";
import { getUser } from "@/lib/auth/user";
import { decodeCursor } from "@/lib/reviews/cursor";
import { loadFeed } from "@/lib/feed/load";
import { feedTab } from "@/lib/feed/types";

export const runtime = "nodejs";
// Viewer-specific (follows, blocks, privacy), so never shared-cached.
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers });

/** GET ?tab=following|community&cursor=<opaque> — the next page of a home feed. */
export async function GET(request: NextRequest) {
  if (!getPublicConfig()) return fail(503, "The feed is not available yet.");
  const params = request.nextUrl.searchParams;
  const tab = feedTab(params.get("tab"));
  let cursor;
  try {
    cursor = decodeCursor(params.get("cursor"));
  } catch {
    return fail(400, "Invalid request.");
  }
  if (!tab) return fail(400, "Invalid request.");
  if (tab === "following" && !(await getUser()))
    return fail(401, "Sign in to see who you follow.");
  try {
    return NextResponse.json(await loadFeed(tab, cursor), { headers });
  } catch {
    return fail(503, "The feed is unavailable right now. Please try again.");
  }
}
