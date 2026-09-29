import "server-only";
import { unstable_cache } from "next/cache";
import { MovieError } from "./errors";
import { movieId, posterPath, releaseYear } from "./validation";
import type { Movie, MovieDetails, MovieFilters, MovieSearch } from "./types";

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
export function requireTmdbToken() {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
  if (!token)
    throw new MovieError(
      503,
      "Movie discovery is being set up. Please check back soon.",
      "NOT_CONFIGURED",
    );
  return token;
}
async function requestTmdb(
  path: string,
  params: Record<string, string>,
): Promise<JsonObject> {
  const token = requireTmdbToken();
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  Object.entries({ language: "en-US", ...params }).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    )
      throw new MovieError(
        504,
        "Movie search took too long. Please try again.",
        "UPSTREAM_TIMEOUT",
      );
    throw new MovieError(
      502,
      "We couldn't reach the movie catalog. Please try again.",
    );
  }
  if (response.status === 429) {
    const raw = Number(response.headers.get("retry-after"));
    throw new MovieError(
      429,
      "The movie catalog is busy. Please try again shortly.",
      "RATE_LIMITED",
      Number.isFinite(raw) && raw > 0 ? Math.min(Math.ceil(raw), 3600) : 30,
    );
  }
  if (response.status === 404)
    throw new MovieError(404, "This movie is unavailable.", "MOVIE_NOT_FOUND");
  if (!response.ok)
    throw new MovieError(
      response.status === 401 || response.status === 403 ? 503 : 502,
      "The movie catalog is temporarily unavailable. Please try again.",
    );
  try {
    return object(await response.json());
  } catch {
    throw new MovieError(
      502,
      "The movie catalog returned an unexpected response. Please try again.",
    );
  }
}
function parseMovie(value: unknown): Movie | null {
  const row = object(value);
  // Fail closed if a provider record is adult-marked or has no explicit adult flag.
  if (
    row.adult !== false ||
    typeof row.title !== "string" ||
    !row.title.trim() ||
    row.title.trim().length > 300
  )
    return null;
  let id: number;
  try {
    id = movieId(row.id);
  } catch {
    return null;
  }
  return {
    id,
    title: row.title.trim(),
    posterPath: posterPath(row.poster_path),
    year: releaseYear(row.release_date),
    genreIds: Array.isArray(row.genre_ids)
      ? row.genre_ids.filter(
          (id): id is number => typeof id === "number" && Number.isInteger(id),
        )
      : [],
  };
}
// Only public, sanitized metadata is cached. Tokens are read inside the server-only
// closure, never passed as cache arguments or exposed in URLs/client responses.
const cachedSearch = unstable_cache(
  async (filters: MovieFilters): Promise<MovieSearch> => {
    const params: Record<string, string> = {
      include_adult: "false",
      page: String(filters.page),
      region: "US",
    };
    if (filters.year) params.primary_release_year = String(filters.year);
    if (filters.query) params.query = filters.query;
    else {
      params.sort_by = "popularity.desc";
      params.include_video = "false";
      if (filters.genre) params.with_genres = String(filters.genre);
    }
    const raw = await requestTmdb(
      filters.query ? "/search/movie" : "/discover/movie",
      params,
    );
    if (
      !Array.isArray(raw.results) ||
      !Number.isInteger(raw.total_pages) ||
      Number(raw.total_pages) < 0
    )
      throw new MovieError(
        502,
        "The movie catalog returned an unexpected response. Please try again.",
      );
    const movies = raw.results
      .map(parseMovie)
      .filter((movie): movie is Movie => movie !== null)
      .filter(
        (movie) =>
          !filters.query ||
          !filters.genre ||
          movie.genreIds.includes(filters.genre),
      );
    return {
      movies,
      page: filters.page,
      hasMore: filters.page < Math.min(Number(raw.total_pages), 500),
      filteredPage: Boolean(filters.query && filters.genre),
    };
  },
  ["tmdb-movie-search-v1"],
  { revalidate: 300 },
);
export async function searchMovies(filters: MovieFilters) {
  requireTmdbToken();
  return cachedSearch(filters);
}

const cachedDetails = unstable_cache(
  async (id: number): Promise<MovieDetails> => {
    const raw = await requestTmdb(`/movie/${movieId(id)}`, {});
    const movie = parseMovie(raw);
    if (!movie || movie.id !== id)
      throw new MovieError(
        404,
        "This movie is unavailable.",
        "MOVIE_NOT_FOUND",
      );
    const genres = Array.isArray(raw.genres)
      ? raw.genres
          .map(object)
          .filter(
            (genre) =>
              typeof genre.id === "number" && typeof genre.name === "string",
          )
      : [];
    return {
      ...movie,
      genreIds: genres.map((genre) => Number(genre.id)),
      genres: genres.map((genre) => String(genre.name).slice(0, 60)),
      overview:
        typeof raw.overview === "string" && raw.overview.trim()
          ? raw.overview.slice(0, 10000)
          : null,
      runtime:
        typeof raw.runtime === "number" && raw.runtime > 0 && raw.runtime < 2000
          ? raw.runtime
          : null,
      releaseDate: movie.year ? String(raw.release_date) : null,
      voteAverage:
        typeof raw.vote_average === "number" &&
        raw.vote_average >= 0 &&
        raw.vote_average <= 10
          ? raw.vote_average
          : null,
      voteCount:
        typeof raw.vote_count === "number" &&
        Number.isInteger(raw.vote_count) &&
        raw.vote_count > 0
          ? raw.vote_count
          : 0,
    };
  },
  ["tmdb-movie-details-v1"],
  { revalidate: 86400 },
);
export async function getMovieDetails(id: number) {
  requireTmdbToken();
  return cachedDetails(movieId(id));
}
