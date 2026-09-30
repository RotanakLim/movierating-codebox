import Link from "next/link";
import { MoviePoster } from "@/components/movies/poster";
import type { ListSummary, ListedMovie } from "@/lib/profiles/types";
import {
  RemoveFromListButton,
  RemoveFromWatchlistButton,
} from "./owner-controls";

export function ListsIndex({
  lists,
  basePath,
}: {
  lists: ListSummary[];
  basePath: string;
}) {
  const custom = lists.filter((list) => list.kind === "custom");
  if (!custom.length)
    return <p className="text-sm text-muted">No lists yet.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {custom.map((list) => (
        <li key={list.id}>
          <Link
            href={`${basePath}/${list.id}`}
            className="block rounded-2xl border border-line p-4 hover:border-accent"
          >
            <span className="font-semibold">{list.name}</span>
            <span className="block text-xs text-muted">
              {list.count} {list.count === 1 ? "movie" : "movies"}
            </span>
            {list.description && (
              <span className="mt-2 line-clamp-2 block text-sm text-muted">
                {list.description}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Movies in a list or watchlist, most recently added first. */
export function ListMovies({
  movies,
  owner,
  listId,
  watchlist,
  emptyText,
}: {
  movies: ListedMovie[];
  owner: boolean;
  listId: string;
  watchlist: boolean;
  emptyText: string;
}) {
  if (!movies.length) return <p className="text-sm text-muted">{emptyText}</p>;
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {movies.map((movie) => (
        <li key={movie.movieId} className="group min-w-0">
          <Link href={`/movies/${movie.movieId}`}>
            <MoviePoster path={movie.poster} title={movie.title} size="w342" />
          </Link>
          <h3 className="mt-3 truncate text-sm font-semibold">
            <Link
              href={`/movies/${movie.movieId}`}
              className="hover:text-accent"
            >
              {movie.title}
            </Link>
          </h3>
          <p className="text-xs text-muted">{movie.year ?? "Year unknown"}</p>
          {owner && (
            <div className="mt-1">
              {watchlist ? (
                <RemoveFromWatchlistButton
                  movieId={movie.movieId}
                  title={movie.title}
                />
              ) : (
                <RemoveFromListButton
                  listId={listId}
                  movieId={movie.movieId}
                  title={movie.title}
                />
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
