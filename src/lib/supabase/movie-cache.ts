import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { getPublicConfig } from "@/lib/env";
import { MovieError } from "@/lib/movies/errors";
import type { MovieDetails } from "@/lib/movies/types";
import type { Database } from "./database.types";

function createCacheClient() {
  const config = getPublicConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !key)
    throw new MovieError(
      503,
      "Movie discovery is being set up. Please check back soon.",
      "NOT_CONFIGURED",
    );
  // This client never receives user cookies. It is not used for ordinary user writes.
  return createClient<Database>(config.url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
    },
  });
}
export async function cacheMovie(movie: MovieDetails) {
  const client = createCacheClient();
  // Explicit allowlist: never store synopsis, genres, scores, credits or raw TMDB JSON.
  const row = {
    tmdb_id: movie.id,
    title: movie.title,
    poster: movie.posterPath,
    year: movie.year,
    cached_at: new Date().toISOString(),
  };
  const { error } = await client
    .from("movies")
    .upsert(row, { onConflict: "tmdb_id" });
  if (error)
    throw new MovieError(
      503,
      "We couldn't select this movie. Please try again.",
      "CACHE_UNAVAILABLE",
    );
  return row;
}
export async function readCachedMovie(
  id: number,
): Promise<MovieDetails | null> {
  if (!getPublicConfig()) return null;
  try {
    const client = await createSessionClient();
    const { data, error } = await client
      .from("movies")
      .select("tmdb_id,title,poster,year")
      .eq("tmdb_id", id)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.tmdb_id,
      title: data.title,
      posterPath: data.poster,
      year: data.year,
      genreIds: [],
      genres: [],
      runtime: null,
      overview: null,
      releaseDate: null,
      availableFrom: null,
      cast: [],
      trailer: null,
      voteAverage: null,
      voteCount: 0,
      stale: true,
    };
  } catch {
    return null;
  }
}
export async function consumeMovieLimit(
  scope: "search" | "selection" | "avatar",
  keyHash: string,
) {
  const client = createCacheClient();
  const { data, error } = await client.rpc("consume_movie_request_limit", {
    request_scope: scope,
    key_hash: keyHash,
  });
  // The RPC returns jsonb, typed as the generic Json union; narrow it explicitly.
  const result =
    data && typeof data === "object" && !Array.isArray(data) ? data : null;
  if (
    error ||
    !result ||
    typeof result.allowed !== "boolean" ||
    typeof result.retry_after !== "number"
  )
    throw new MovieError(
      503,
      "Movie discovery is temporarily unavailable. Please try again.",
    );
  if (!result.allowed)
    throw new MovieError(
      429,
      "You've made a few too many requests. Please wait a moment and try again.",
      "RATE_LIMITED",
      Math.max(1, result.retry_after),
    );
}
