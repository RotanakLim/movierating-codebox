import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { consumeMovieLimit } from "@/lib/supabase/movie-cache";
import { MovieError } from "./errors";
export async function limitMovieRequest(
  scope: "search" | "selection" | "avatar",
  headers: Pick<Headers, "get">,
  userId?: string,
) {
  // Dedicated HMAC key: rotating it only resets quotas, and it never doubles as a
  // database credential. Require at least 32 random bytes (64 hex characters).
  const secret = process.env.RATE_LIMIT_SECRET?.trim();
  if (
    !secret ||
    secret.length < 64 ||
    secret === process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  )
    throw new MovieError(
      503,
      "Movie discovery is being set up. Please check back soon.",
      "NOT_CONFIGURED",
    );
  const forwarded =
    process.env.VERCEL === "1"
      ? headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
      : null;
  // Do not trust arbitrary proxy headers on a self-hosted server. Use a shared
  // bucket there until the deployment supplies a verified proxy integration.
  const identity =
    userId ?? (forwarded && isIP(forwarded) ? forwarded : "shared-origin");
  const key = createHmac("sha256", secret)
    .update(`${scope}:${identity}`)
    .digest("hex");
  await consumeMovieLimit(scope, key);
}
