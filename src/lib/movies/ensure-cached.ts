import "server-only";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { cacheMovie } from "@/lib/supabase/movie-cache";
import { getMovieDetails } from "./tmdb";
import { limitMovieRequest } from "./limits";
import { MovieError } from "./errors";
import type { MovieDetails } from "./types";

/**
 * Make sure a movie exists in `movies` before a user writes something that
 * references it, and return its TMDB details when available.
 *
 * - Not cached: fetch authoritative TMDB metadata (rate-limited per user) and cache it.
 * - Already cached: read details from the 24-hour TMDB cache. If TMDB is down the
 *   details are unknown (null) rather than blocking the write; a TMDB "not found"
 *   (deleted or adult) still rejects.
 */
export async function ensureMovieCached(
  supabase: SupabaseClient<Database>,
  movieId: number,
  userId: string,
): Promise<MovieDetails | null> {
  const { data: cached, error } = await supabase
    .from("movies")
    .select("tmdb_id")
    .eq("tmdb_id", movieId)
    .maybeSingle();
  if (error)
    throw new MovieError(
      503,
      "We couldn't save that right now. Please try again.",
    );
  if (cached) {
    try {
      return await getMovieDetails(movieId);
    } catch (failure) {
      if (failure instanceof MovieError && failure.status === 404)
        throw failure;
      return null;
    }
  }
  await limitMovieRequest("selection", await headers(), userId);
  const details = await getMovieDetails(movieId);
  await cacheMovie(details);
  return details;
}
