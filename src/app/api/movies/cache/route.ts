import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/user";
import { getPublicConfig } from "@/lib/env";
import { getMovieDetails, requireTmdbToken } from "@/lib/movies/tmdb";
import { movieId } from "@/lib/movies/validation";
import { cacheMovie } from "@/lib/supabase/movie-cache";
import { MovieError, movieErrorResponse } from "@/lib/movies/errors";
import { limitMovieRequest } from "@/lib/movies/limits";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const config = getPublicConfig();
    if (!config)
      throw new MovieError(
        503,
        "Movie selection is being set up. Please check back soon.",
        "NOT_CONFIGURED",
      );
    // Cookie-authenticated mutation: only the configured origin may submit it.
    if (request.headers.get("origin") !== config.siteUrl)
      throw new MovieError(
        403,
        "Please select the movie from this website.",
        "INVALID_ORIGIN",
      );
    const user = await getUser();
    if (!user)
      throw new MovieError(
        401,
        "Sign in to select a movie.",
        "SIGN_IN_REQUIRED",
      );
    if (!user.email_confirmed_at)
      throw new MovieError(
        403,
        "Confirm your email before selecting a movie.",
        "VERIFICATION_REQUIRED",
      );
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new MovieError(415, "Send a movie ID as JSON.", "INVALID_BODY");
    // Bound the body even when Content-Length is absent/chunked.
    const reader = request.body?.getReader();
    if (!reader)
      throw new MovieError(400, "Choose a movie first.", "INVALID_BODY");
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 256) {
        await reader.cancel();
        throw new MovieError(413, "Send only the movie ID.", "INVALID_BODY");
      }
      chunks.push(part.value);
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new MovieError(400, "Choose a valid movie.", "INVALID_BODY");
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !("tmdbId" in body)
    )
      throw new MovieError(400, "Send only the movie ID.", "INVALID_BODY");
    const id = movieId(body.tmdbId);
    requireTmdbToken();
    await limitMovieRequest("selection", request.headers, user.id);
    // Always use authoritative TMDB metadata, never a client-submitted title/poster.
    const movie = await getMovieDetails(id);
    await cacheMovie(movie);
    return NextResponse.json(
      {
        movie: {
          id: movie.id,
          title: movie.title,
          posterPath: movie.posterPath,
          year: movie.year,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return movieErrorResponse(error);
  }
}
