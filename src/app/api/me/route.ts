import { NextResponse, type NextRequest } from "next/server";
import { getPublicConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { readUsername } from "@/lib/onboarding/profile";
import { isTheme } from "@/lib/settings/theme";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

/**
 * The signed-in user's username for the header link, their pending follow
 * request count for the Notifications badge, and (with ?theme=1) their account
 * theme (null if never chosen) so a new sign-in picks it up. Display only: getClaims
 * verifies the JWT (locally with asymmetric signing keys) but does not detect a
 * revoked session, so nothing here may authorize a read or write.
 */
export async function GET(request: NextRequest) {
  if (!getPublicConfig())
    return NextResponse.json({ signedIn: false }, { headers });
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return NextResponse.json({ signedIn: false }, { headers });
  // Pending follow requests for the Notifications badge. The theme is only
  // needed once per session (`?theme=1`), not on every page.
  const withTheme = request.nextUrl.searchParams.get("theme") === "1";
  const [username, { count }, theme] = await Promise.all([
    readUsername(supabase, userId),
    supabase
      .from("follows")
      .select("follower_id", { count: "exact", head: true })
      .eq("following_id", userId)
      .eq("status", "pending"),
    withTheme
      ? supabase
          .from("user_preferences")
          .select("theme")
          .eq("user_id", userId)
          .maybeSingle()
          .then(({ data: row }) => (isTheme(row?.theme) ? row.theme : null))
      : undefined,
  ]);
  return NextResponse.json(
    {
      signedIn: true,
      username,
      requests: count ?? 0,
      ...(withTheme ? { theme } : {}),
    },
    { headers },
  );
}
