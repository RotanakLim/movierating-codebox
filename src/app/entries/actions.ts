"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContributor, type ActionResult } from "@/lib/auth/contributor";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { ensureMovieCached } from "@/lib/movies/ensure-cached";
import { MovieError } from "@/lib/movies/errors";
import { formatDate, todayIn } from "@/lib/entries/dates";
import { readUsername } from "@/lib/onboarding/profile";
import { entryInputSchema } from "@/lib/entries/schema";
import type { SaveEntryErrorCode, SaveEntryResult } from "@/lib/entries/types";
import { rateLimitRetry, retryPhrase } from "@/lib/rate-limit";

const fail = (
  code: SaveEntryErrorCode,
  error: string,
  retryAfter?: number,
): SaveEntryResult => ({
  ok: false,
  code,
  error,
  ...(retryAfter ? { retryAfter } : {}),
});
const unavailable = () =>
  fail("UNAVAILABLE", "We couldn't save your entry. Please try again.");
const suspended = () =>
  fail(
    "SUSPENDED",
    "Your account is suspended, so you can't add or edit entries right now.",
  );

/**
 * Create or update one of the signed-in user's entries. The client supplies the
 * entry UUID so a retried create cannot duplicate it, and the version it last saw
 * so a stale edit cannot overwrite a newer one.
 */
export async function saveEntry(input: unknown): Promise<SaveEntryResult> {
  const parsed = entryInputSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0].message);
  const entry = parsed.data;

  const user = await getUser();
  if (!user) return fail("SIGN_IN_REQUIRED", "Sign in to save your entry.");
  if (!user.email_confirmed_at)
    return fail(
      "VERIFICATION_REQUIRED",
      "Confirm your email before saving entries.",
    );
  const supabase = await createClient();
  if (!(await readUsername(supabase, user.id)))
    return fail(
      "USERNAME_REQUIRED",
      "Choose a username before saving entries.",
    );
  const { data: isSuspended } = await supabase.rpc("my_account_suspended");
  if (isSuspended === true) return suspended();

  // Entries reference movies: cache authoritative TMDB metadata if it's missing.
  try {
    const details = await ensureMovieCached(supabase, entry.movieId, user.id);
    // Contributions open on the earliest known release date, in the viewer's
    // timezone. An unknown date (or TMDB being unreachable) does not block them.
    if (
      details?.availableFrom &&
      details.availableFrom > todayIn(entry.timeZone)
    )
      return fail(
        "NOT_RELEASED",
        `Ratings, reviews and watch logs open on ${formatDate(details.availableFrom)}.`,
      );
  } catch (error) {
    if (error instanceof MovieError)
      return fail(
        error.status === 404 ? "INVALID" : "UNAVAILABLE",
        error.status === 404 ? "This movie is unavailable." : error.message,
      );
    return unavailable();
  }

  // Owner comes from auth.uid() (column default + RLS), never from the client.
  const fields = {
    score: entry.score,
    note: entry.note || null,
    spoiler: entry.spoiler,
    watched: entry.watched,
    watched_date: entry.watched ? entry.watchedDate : null,
    watched_timezone: entry.timeZone,
  };

  if (entry.expectedVersion === null) {
    const { data, error } = await supabase
      .from("entries")
      .insert({ id: entry.id, movie_id: entry.movieId, ...fields })
      .select("id, version")
      .single();
    if (data) return { ok: true, entry: data };
    if (error?.code === "23505") {
      // A retry of a create that already succeeded: return the saved entry.
      const { data: existing } = await supabase
        .from("entries")
        .select("id, version")
        .eq("id", entry.id)
        .eq("user_id", user.id)
        .eq("movie_id", entry.movieId)
        .maybeSingle();
      if (existing) return { ok: true, entry: existing };
      return fail(
        "CONFLICT",
        "This entry couldn't be saved. Reload and try again.",
      );
    }
    if (error?.code === "23514")
      return fail(
        "INVALID",
        "Check the score, review and date, then try again.",
      );
    // New entries are limited per user (default 20 an hour); edits are not.
    const retryAfter = rateLimitRetry(error);
    if (retryAfter !== null)
      return fail(
        "RATE_LIMITED",
        `You've added a lot of entries recently. Try again ${retryPhrase(retryAfter)}. Your draft is kept.`,
        retryAfter,
      );
    return unavailable();
  }

  const { data, error } = await supabase
    .from("entries")
    .update(fields)
    .eq("id", entry.id)
    .eq("movie_id", entry.movieId)
    .eq("version", entry.expectedVersion)
    .select("id, version");
  if (error?.code === "23514")
    return fail("INVALID", "Check the score, review and date, then try again.");
  if (error) return unavailable();
  if (!data.length)
    return fail(
      "CONFLICT",
      "This entry changed somewhere else. Reload to see the latest version.",
    );
  return { ok: true, entry: data[0] };
}

/**
 * Delete one of the signed-in user's entries. The database cascades its feed
 * event, and the community average and collections recompute on read.
 */
export async function deleteEntry(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ id: z.uuid() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose an entry." };
  const session = await requireContributor();
  if (!session.ok) return session;
  const { data, error } = await session.supabase
    .from("entries")
    .delete()
    .eq("id", parsed.data.id)
    .eq("user_id", session.user.id)
    .select("id");
  if (error)
    return {
      ok: false,
      error: "We couldn't delete that entry. Please try again.",
    };
  if (!data.length)
    return { ok: false, error: "That entry was already deleted." };
  revalidatePath("/", "layout");
  return { ok: true };
}
