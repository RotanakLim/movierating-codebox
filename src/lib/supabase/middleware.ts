import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicConfig } from "@/lib/env";
import type { Database } from "./database.types";

const PRIVATE_PREFIXES = ["/auth", "/account"];
function isPrivatePath(pathname: string) {
  return PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  let refreshed = false;
  const config = getPublicConfig();
  if (config) {
    const supabase = createServerClient<Database>(config.url, config.key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values) => {
          refreshed = true;
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    // getClaims refreshes an expired session (triggering setAll) and verifies the
    // JWT. With asymmetric signing keys it verifies locally against the cached JWKS,
    // with no Auth round trip; with a legacy symmetric secret it falls back to
    // calling Auth. It does not detect a session revoked since the JWT was issued,
    // so middleware is not an authorization boundary: protected pages and server
    // actions must still call getUser().
    await supabase.auth.getClaims();
  }
  // Only a response that sets session cookies, or an auth/account page, is
  // user-specific. Leave everything else cacheable.
  if (refreshed || isPrivatePath(request.nextUrl.pathname))
    response.headers.set("Cache-Control", "private, no-store");
  return response;
}
