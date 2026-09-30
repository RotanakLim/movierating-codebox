export type Movie = {
  id: number;
  title: string;
  posterPath: string | null;
  year: number | null;
  genreIds: number[];
};
export type CastMember = { name: string; character: string | null };
export type Trailer = { name: string; url: string };
export type MovieDetails = Movie & {
  overview: string | null;
  runtime: number | null;
  genres: string[];
  releaseDate: string | null;
  /** Earliest known release date anywhere (YYYY-MM-DD); null when unknown. */
  availableFrom: string | null;
  /** Principal cast in billing order. */
  cast: CastMember[];
  /** An external trailer link, opened only by explicit user action. */
  trailer: Trailer | null;
  voteAverage: number | null;
  voteCount: number;
  stale?: boolean;
};
export type MovieSearch = {
  movies: Movie[];
  page: number;
  hasMore: boolean;
  filteredPage: boolean;
};
export type MovieFilters = {
  query: string;
  genre: number | null;
  year: number | null;
  page: number;
};
// TMDB's stable movie genre IDs. TV genres are intentionally excluded.
export const MOVIE_GENRES = [
  [28, "Action"],
  [12, "Adventure"],
  [16, "Animation"],
  [35, "Comedy"],
  [80, "Crime"],
  [99, "Documentary"],
  [18, "Drama"],
  [10751, "Family"],
  [14, "Fantasy"],
  [36, "History"],
  [27, "Horror"],
  [10402, "Music"],
  [9648, "Mystery"],
  [10749, "Romance"],
  [878, "Science fiction"],
  [10770, "TV movie"],
  [53, "Thriller"],
  [10752, "War"],
  [37, "Western"],
] as const;
