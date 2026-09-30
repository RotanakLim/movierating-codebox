import { NextResponse, type NextRequest } from "next/server";
import { getPublicConfig } from "@/lib/env";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { decodeCursor } from "@/lib/reviews/cursor";
import { loadNotifications } from "@/lib/notifications/load";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers });

/**
 * GET ?cursor=<opaque> — a page of the signed-in user's notifications and the
 * unread count. The inbox polls this on focus and every 60 s while it's open.
 */
export async function GET(request: NextRequest) {
  if (!getPublicConfig())
    return fail(503, "Notifications are not available yet.");
  let cursor;
  try {
    cursor = decodeCursor(request.nextUrl.searchParams.get("cursor"));
  } catch {
    return fail(400, "Invalid request.");
  }
  if (!(await getUser())) return fail(401, "Sign in to see notifications.");
  try {
    return NextResponse.json(
      await loadNotifications(await createClient(), cursor),
      { headers },
    );
  } catch {
    return fail(503, "Notifications are unavailable right now.");
  }
}
