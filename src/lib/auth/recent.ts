import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Sensitive actions (account deletion) need a sign-in this recent. */
export const REAUTH_WINDOW_SECONDS = 10 * 60;

/**
 * When the current session last proved who the user is (password, Google, email
 * link...), in epoch seconds. Read from the session's `amr` claim, which token
 * refreshes keep unchanged, so an old session can't pass as a fresh sign-in.
 * Call only after getUser() has verified the same session with the server.
 */
export async function lastAuthenticatedAt(
  supabase: SupabaseClient,
): Promise<number | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  const times = (data.claims.amr ?? []).flatMap((entry) =>
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.timestamp === "number"
      ? [entry.timestamp]
      : [],
  );
  return times.length ? Math.max(...times) : null;
}

export function isRecent(authenticatedAt: number | null, now = Date.now()) {
  return (
    authenticatedAt !== null &&
    now / 1000 - authenticatedAt <= REAUTH_WINDOW_SECONDS
  );
}
