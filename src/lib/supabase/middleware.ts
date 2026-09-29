import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicConfig } from "@/lib/env";
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  // A response that may contain an authenticated session must never be publicly cached.
  response.headers.set("Cache-Control", "private, no-store");
  const config = getPublicConfig();
  if (!config) return response;
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        response.headers.set("Cache-Control", "private, no-store");
      },
    },
  });
  // getUser validates with Auth. Do not authorize using the cookie's getSession() user.
  // Protected pages/actions independently validate; middleware is not an authorization boundary.
  await supabase.auth.getUser();
  return response;
}
