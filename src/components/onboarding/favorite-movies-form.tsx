"use client";
import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus, Search, X } from "lucide-react";
import { saveFavoriteMovies } from "@/app/onboarding/actions";
import { MoviePoster } from "@/components/movies/poster";
import { FAVORITE_MOVIE_LIMIT } from "@/lib/onboarding/steps";
import type { MovieSearch } from "@/lib/movies/types";

export type FavoriteMovie = {
  id: number;
  title: string;
  posterPath: string | null;
  year: number | null;
};
type Results =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; movies: FavoriteMovie[] }
  | { state: "error"; message: string };

export function FavoriteMoviesForm({
  next,
  initial,
  skipHref,
}: {
  next: string;
  initial: FavoriteMovie[];
  skipHref: string;
}) {
  const [state, action, pending] = useActionState(saveFavoriteMovies, {});
  const [picked, setPicked] = useState(initial);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>({ state: "idle" });
  const full = picked.length >= FAVORITE_MOVIE_LIMIT;
  const term = query.trim();

  useEffect(() => {
    if (!term) {
      setResults({ state: "idle" });
      return;
    }
    // Same public search endpoint as /discover: debounced, obsolete requests cancelled.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setResults({ state: "loading" });
      try {
        const response = await fetch(
          `/api/movies/search?${new URLSearchParams({ q: term })}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : "Search is unavailable right now.",
          );
        setResults({
          state: "done",
          movies: (body as MovieSearch).movies.slice(0, 8),
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setResults({
          state: "error",
          message:
            error instanceof Error
              ? error.message
              : "Search is unavailable right now.",
        });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  return (
    <form action={action} className="mt-8">
      <input type="hidden" name="next" value={next} />
      {picked.map((movie) => (
        <input key={movie.id} type="hidden" name="movie" value={movie.id} />
      ))}
      <h2 className="text-sm font-semibold">
        Your favorites ({picked.length}/{FAVORITE_MOVIE_LIMIT})
      </h2>
      {picked.length ? (
        <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
          {picked.map((movie) => (
            <li key={movie.id} className="min-w-0">
              <MoviePoster
                path={movie.posterPath}
                title={movie.title}
                size="w342"
              />
              <p className="mt-2 truncate text-xs font-semibold">
                {movie.title}
              </p>
              <button
                type="button"
                onClick={() =>
                  setPicked((items) =>
                    items.filter((item) => item.id !== movie.id),
                  )
                }
                className="mt-1 inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
                aria-label={`Remove ${movie.title}`}
              >
                <X size={12} aria-hidden="true" />
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">None yet.</p>
      )}

      <div className="mt-8">
        <label htmlFor="favorite-search">Search for a movie</label>
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            id="favorite-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title"
            className="pl-10"
            maxLength={100}
            disabled={full}
            aria-describedby="favorite-search-status"
          />
        </div>
        <p
          id="favorite-search-status"
          role="status"
          aria-live="polite"
          className="mt-2 text-xs text-muted"
        >
          {full
            ? "You've picked five. Remove one to add another."
            : results.state === "loading"
              ? "Searching…"
              : results.state === "error"
                ? results.message
                : results.state === "done" && !results.movies.length
                  ? "No movies found. Try another title."
                  : ""}
        </p>
        {!full && results.state === "done" && results.movies.length > 0 && (
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
            {results.movies.map((movie) => {
              const chosen = picked.some((item) => item.id === movie.id);
              return (
                <li
                  key={movie.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="min-w-0 truncate text-sm">
                    {movie.title}
                    <span className="text-muted">
                      {" "}
                      {movie.year ? `(${movie.year})` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={chosen}
                    onClick={() =>
                      setPicked((items) =>
                        items.length >= FAVORITE_MOVIE_LIMIT ||
                        items.some((item) => item.id === movie.id)
                          ? items
                          : [...items, movie],
                      )
                    }
                    className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-accent disabled:text-muted"
                    aria-label={`${chosen ? "Added" : "Add"} ${movie.title}`}
                  >
                    {!chosen && <Plus size={14} aria-hidden="true" />}
                    {chosen ? "Added" : "Add"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {state.error && (
        <p role="alert" className="error mt-5">
          {state.error}
        </p>
      )}
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button className="button-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
          {!pending && <ArrowRight size={16} aria-hidden="true" />}
        </button>
        <Link href={skipHref} className="text-sm text-muted hover:text-ink">
          Skip for now
        </Link>
      </div>
    </form>
  );
}
