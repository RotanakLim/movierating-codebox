import { NextResponse, type NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { processAccountDeletions } from "@/lib/supabase/account-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 32) return false;
  // Compare digests so the check takes the same time for any header length.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(
    digest(request.headers.get("authorization") ?? ""),
    digest(`Bearer ${secret}`),
  );
}

/**
 * Scheduled retry for account-deletion cleanup (see vercel.json). Vercel Cron
 * sends `Authorization: Bearer $CRON_SECRET`; anything else is refused.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request))
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers },
    );
  try {
    const result = await processAccountDeletions();
    return NextResponse.json(result, { headers });
  } catch {
    return NextResponse.json(
      { error: "Cleanup is unavailable." },
      { status: 503, headers },
    );
  }
}
