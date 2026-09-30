import { NextResponse, type NextRequest } from "next/server";
import { searchMovies, requireTmdbToken } from "@/lib/movies/tmdb";
import { searchFilters } from "@/lib/movies/validation";
import { movieErrorResponse } from "@/lib/movies/errors";
import { limitMovieRequest } from "@/lib/movies/limits";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const filters = searchFilters(request.nextUrl.searchParams);
    requireTmdbToken();
    await limitMovieRequest("search", request.headers);
    // Results are public and the same for every viewer, so shared caches may keep
    // them as long as the server's own search cache (5 minutes). Errors stay private.
    return NextResponse.json(await searchMovies(filters), {
      headers: {
        "Cache-Control":
          "public, max-age=0, s-maxage=300, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    return movieErrorResponse(error);
  }
}
