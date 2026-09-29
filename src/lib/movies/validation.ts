import { MOVIE_GENRES, type MovieFilters } from "./types";
import { MovieError } from "./errors";
export function movieId(value: unknown): number {
  const id =
    typeof value === "string" && /^\d{1,10}$/.test(value)
      ? Number(value)
      : value;
  if (
    typeof id !== "number" ||
    !Number.isInteger(id) ||
    id <= 0 ||
    id > 2147483647
  )
    throw new MovieError(400, "Choose a valid movie.", "INVALID_MOVIE");
  return id;
}
export function searchFilters(params: URLSearchParams): MovieFilters {
  const query = (params.get("q") ?? "").trim();
  if (query.length > 100)
    throw new MovieError(
      400,
      "Keep your search under 101 characters.",
      "INVALID_SEARCH",
    );
  function integer(name: string, min: number, max: number) {
    const value = params.get(name);
    if (!value) return null;
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
      throw new MovieError(400, `Choose a valid ${name}.`, "INVALID_SEARCH");
    return Number(value);
  }
  const page = integer("page", 1, 500) ?? 1;
  const year = integer("year", 1800, 2200);
  const genre = integer("genre", 1, 99999);
  if (genre && !MOVIE_GENRES.some(([id]) => id === genre))
    throw new MovieError(400, "Choose a valid genre.", "INVALID_SEARCH");
  return { query, year, genre, page };
}
export function posterPath(value: unknown): string | null {
  return typeof value === "string" &&
    value.length <= 512 &&
    /^\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(value)
    ? value
    : null;
}
export function releaseYear(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const year = Number(value.slice(0, 4));
  return year >= 1800 && year <= 2200 ? year : null;
}
