import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicConfig } from "@/lib/env";
import { safeNext } from "@/lib/auth/redirect";
export async function GET(request: NextRequest) {
  const config = getPublicConfig();
  if (!config)
    return NextResponse.json(
      { error: "Authentication is not configured." },
      { status: 503 },
    );
  const token = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  if (token && (type === "email" || type === "signup" || type === "recovery")) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.verifyOtp({
        token_hash: token,
        type,
      });
      if (!error) {
        const next =
          type === "recovery"
            ? "/auth/update-password"
            : safeNext(request.nextUrl.searchParams.get("next"));
        return NextResponse.redirect(new URL(next, config.siteUrl));
      }
    } catch {
      /* Expired, malformed, or unavailable: no token details in the error URL. */
    }
  }
  return NextResponse.redirect(new URL("/auth/error", config.siteUrl));
}
