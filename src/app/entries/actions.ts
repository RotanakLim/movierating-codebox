"use server";
import { headers } from "next/headers";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { cacheMovie } from "@/lib/supabase/movie-cache";
import { getMovieDetails } from "@/lib/movies/tmdb";
import { limitMovieRequest } from "@/lib/movies/limits";
import { MovieError } from "@/lib/movies/errors";
import { readUsername } from "@/lib/onboarding/profile";
import { entryInputSchema } from "@/lib/entries/schema";
import type { SaveEntryErrorCode, SaveEntryResult } from "@/lib/entries/types";

const fail = (code: SaveEntryErrorCode, error: string): SaveEntryResult => ({
  ok: false,
  code,
  error,
});
const unavailable = () =>
  fail("UNAVAILABLE", "We couldn't save your entry. Please try again.");

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

  // Entries reference movies: cache authoritative TMDB metadata if it's missing.
  try {
    const { data: cached, error } = await supabase
      .from("movies")
      .select("tmdb_id")
      .eq("tmdb_id", entry.movieId)
      .maybeSingle();
    if (error) return unavailable();
    if (!cached) {
      await limitMovieRequest("selection", await headers(), user.id);
      await cacheMovie(await getMovieDetails(entry.movieId));
    }
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
