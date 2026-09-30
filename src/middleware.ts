import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
export function middleware(request: NextRequest) {
  return updateSession(request);
}
export const config = {
  matcher: [
    // /api/movies/search is public and sessionless; skip the session refresh.
    "/((?!_next/static|_next/image|favicon.ico|api/movies/search$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
