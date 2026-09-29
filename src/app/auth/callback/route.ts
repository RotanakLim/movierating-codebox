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
  const code = request.nextUrl.searchParams.get("code");
  if (code && !request.nextUrl.searchParams.has("error")) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error)
        return NextResponse.redirect(
          new URL(
            safeNext(request.nextUrl.searchParams.get("next")),
            config.siteUrl,
          ),
        );
    } catch {
      /* Show a safe error; never reflect provider errors or credentials. */
    }
  }
  return NextResponse.redirect(new URL("/auth/error", config.siteUrl));
}
