import "server-only";
import { unstable_cache } from "next/cache";
import { MovieError } from "./errors";
import { movieId, posterPath, releaseYear } from "./validation";
import type {
  CastMember,
  Movie,
  MovieDetails,
  MovieFilters,
  MovieSearch,
  Trailer,
} from "./types";

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

const PRINCIPAL_CAST = 8;
function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}
function parseCast(credits: unknown): CastMember[] {
  const cast = object(credits).cast;
  if (!Array.isArray(cast)) return [];
  return cast
    .map(object)
    .filter((person) => text(person.name, 100))
    .sort((a, b) => Number(a.order ?? 999) - Number(b.order ?? 999))
    .slice(0, PRINCIPAL_CAST)
    .map((person) => ({
      name: text(person.name, 100)!,
      character: text(person.character, 100),
    }));
}
// Only well-formed keys on known hosts become links; never embed or autoplay.
function trailerUrl(site: unknown, key: unknown) {
  if (typeof key !== "string") return null;
  if (site === "YouTube" && /^[A-Za-z0-9_-]{6,20}$/.test(key))
    return `https://www.youtube.com/watch?v=${key}`;
  if (site === "Vimeo" && /^\d{1,12}$/.test(key))
    return `https://vimeo.com/${key}`;
  return null;
}
function parseTrailer(videos: unknown): Trailer | null {
  const results = object(videos).results;
  if (!Array.isArray(results)) return null;
  const trailers = results
    .map(object)
    .filter((video) => video.type === "Trailer")
    .map((video) => ({
      official: video.official === true,
      name: text(video.name, 120) ?? "Trailer",
      url: trailerUrl(video.site, video.key),
    }))
    .filter(
      (video): video is { official: boolean; name: string; url: string } =>
        Boolean(video.url),
    );
  const best = trailers.find((video) => video.official) ?? trailers[0];
  return best ? { name: best.name, url: best.url } : null;
}
const DATE = /^\d{4}-\d{2}-\d{2}/;
/** Earliest known release date across countries and the primary release date. */
function earliestRelease(
  primary: unknown,
  releaseDates: unknown,
): string | null {
  const dates: string[] = [];
  if (typeof primary === "string" && DATE.test(primary))
    dates.push(primary.slice(0, 10));
  const countries = object(releaseDates).results;
  if (Array.isArray(countries))
    for (const country of countries.map(object))
      if (Array.isArray(country.release_dates))
        for (const release of country.release_dates.map(object))
          if (
            typeof release.release_date === "string" &&
            DATE.test(release.release_date)
          )
            dates.push(release.release_date.slice(0, 10));
  return dates.sort()[0] ?? null;
}

const cachedDetails = unstable_cache(
  async (id: number): Promise<MovieDetails> => {
    // One request: details plus credits, videos and release dates.
    const raw = await requestTmdb(`/movie/${movieId(id)}`, {
      append_to_response: "credits,videos,release_dates",
    });
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
      availableFrom: earliestRelease(raw.release_date, raw.release_dates),
      cast: parseCast(raw.credits),
      trailer: parseTrailer(raw.videos),
    };
  },
  // v2: adds cast, trailer and availableFrom; old cached shapes are not reused.
  ["tmdb-movie-details-v2"],
  { revalidate: 86400 },
);
export async function getMovieDetails(id: number) {
  requireTmdbToken();
  return cachedDetails(movieId(id));
}
