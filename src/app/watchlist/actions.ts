"use server";
import { z } from "zod";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { ensureMovieCached } from "@/lib/movies/ensure-cached";
import { MovieError } from "@/lib/movies/errors";
import { readUsername } from "@/lib/onboarding/profile";

export type WatchlistResult =
  | { ok: true; watchlisted: boolean }
  | {
      ok: false;
      code:
        | "INVALID"
        | "SIGN_IN_REQUIRED"
        | "VERIFICATION_REQUIRED"
        | "USERNAME_REQUIRED"
        | "UNAVAILABLE";
      error: string;
    };

const inputSchema = z
  .object({
    movieId: z.number().int().positive().max(2_147_483_647),
    watchlisted: z.boolean(),
  })
  .strict();
const unavailable: WatchlistResult = {
  ok: false,
  code: "UNAVAILABLE",
  error: "We couldn't update your watchlist. Please try again.",
};

/**
 * Add a movie to, or remove it from, the signed-in user's default watchlist.
 * Unreleased movies are allowed. Idempotent: repeating either request is safe.
 */
export async function setWatchlisted(input: unknown): Promise<WatchlistResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, code: "INVALID", error: "Choose a valid movie." };
  const { movieId, watchlisted } = parsed.data;

  const user = await getUser();
  if (!user)
    return {
      ok: false,
      code: "SIGN_IN_REQUIRED",
      error: "Sign in to use your watchlist.",
    };
  if (!user.email_confirmed_at)
    return {
      ok: false,
      code: "VERIFICATION_REQUIRED",
      error: "Confirm your email to use your watchlist.",
    };
  const supabase = await createClient();
  if (!(await readUsername(supabase, user.id)))
    return {
      ok: false,
      code: "USERNAME_REQUIRED",
      error: "Choose a username to use your watchlist.",
    };

  // The owner's list comes from the session, never from the client.
  const { data: list, error: listError } = await supabase
    .from("lists")
    .select("id")
    .eq("user_id", user.id)
    .eq("kind", "watchlist")
    .maybeSingle();
  if (listError || !list) return unavailable;

  if (!watchlisted) {
    const { error } = await supabase
      .from("list_items")
      .delete()
      .eq("list_id", list.id)
      .eq("movie_id", movieId);
    return error ? unavailable : { ok: true, watchlisted: false };
  }

  try {
    await ensureMovieCached(supabase, movieId, user.id);
  } catch (error) {
    if (error instanceof MovieError)
      return {
        ok: false,
        code: error.status === 404 ? "INVALID" : "UNAVAILABLE",
        error:
          error.status === 404 ? "This movie is unavailable." : error.message,
      };
    return unavailable;
  }
  const { error } = await supabase
    .from("list_items")
    .insert({ list_id: list.id, movie_id: movieId });
  // 23505: already on the watchlist (double click, second tab) is still success.
  if (error && error.code !== "23505") return unavailable;
  return { ok: true, watchlisted: true };
}
