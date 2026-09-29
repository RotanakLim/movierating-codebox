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
    return NextResponse.json(await searchMovies(filters), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return movieErrorResponse(error);
  }
}
