"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Search,
  SlidersHorizontal,
  X,
  LoaderCircle,
  ArrowDown,
  Film,
} from "lucide-react";
import { getJson } from "@/lib/http/get-json";
import { MOVIE_GENRES, type MovieSearch, type Movie } from "@/lib/movies/types";
import { MoviePoster } from "./poster";

type Results = {
  movies: Movie[];
  page: number;
  hasMore: boolean;
  filteredPage: boolean;
  loading: boolean;
  moreLoading: boolean;
  error: string | null;
  moreError: string | null;
};
const initial: Results = {
  movies: [],
  page: 0,
  hasMore: false,
  filteredPage: false,
  loading: true,
  moreLoading: false,
  error: null,
  moreError: null,
};
export function MovieSearchPage() {
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  const genre = params.get("genre") ?? "";
  const year = params.get("year") ?? "";
  const filterKey = JSON.stringify([query, genre, year]);
  const [results, setResults] = useState<Results>(initial);
  const [retry, setRetry] = useState(0);
  const active = useRef<AbortController | null>(null);
  const moreBusy = useRef(false);
  function changeFilters(changes: Record<string, string>) {
    // Native history is integrated with useSearchParams; no server navigation per keystroke.
    const next = new URLSearchParams(window.location.search);
    Object.entries(changes).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    next.delete("page");
    window.history.replaceState(
      null,
      "",
      `/discover${next.size ? `?${next}` : ""}`,
    );
  }
  const fetchPage = useCallback(
    async (page: number, signal: AbortSignal): Promise<MovieSearch> => {
      const search = new URLSearchParams({ page: String(page) });
      if (query.trim()) search.set("q", query.trim());
      if (genre) search.set("genre", genre);
      if (year) search.set("year", year);
      return getJson<MovieSearch>(
        `/api/movies/search?${search}`,
        "Movie search is unavailable. Please try again.",
        signal,
      );
    },
    [query, genre, year],
  );
  useEffect(() => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    moreBusy.current = false;
    setResults(initial);
    const timer = setTimeout(async () => {
      try {
        const page = await fetchPage(1, controller.signal);
        if (!controller.signal.aborted)
          setResults({
            ...initial,
            ...page,
            movies: [
              ...new Map(
                page.movies.map((movie) => [movie.id, movie]),
              ).values(),
            ],
            loading: false,
          });
      } catch (error) {
        if (!controller.signal.aborted)
          setResults({
            ...initial,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Check your connection and try again.",
          });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
      active.current?.abort();
    };
  }, [filterKey, fetchPage, retry]);
  async function loadMore() {
    if (moreBusy.current || !results.hasMore || results.loading) return;
    moreBusy.current = true;
    const controller = new AbortController();
    active.current = controller;
    setResults((previous) => ({
      ...previous,
      moreLoading: true,
      moreError: null,
    }));
    try {
      const next = await fetchPage(results.page + 1, controller.signal);
      if (!controller.signal.aborted)
        setResults((previous) => ({
          ...previous,
          ...next,
          movies: [
            ...new Map(
              [...previous.movies, ...next.movies].map((movie) => [
                movie.id,
                movie,
              ]),
            ).values(),
          ],
          moreLoading: false,
        }));
    } catch (error) {
      if (!controller.signal.aborted)
        setResults((previous) => ({
          ...previous,
          moreLoading: false,
          moreError:
            error instanceof Error
              ? error.message
              : "Couldn't load more movies. Please try again.",
        }));
    } finally {
      if (!controller.signal.aborted) moreBusy.current = false;
    }
  }
  const currentSearch = new URLSearchParams();
  if (query) currentSearch.set("q", query);
  if (genre) currentSearch.set("genre", genre);
  if (year) currentSearch.set("year", year);
  const returnPath = `/discover${currentSearch.size ? `?${currentSearch}` : ""}`;
  const currentYear = new Date().getFullYear();
  return (
    <div className="py-10 sm:py-14">
      <header className="mb-9 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow mb-4">THE WORLD IS FULL OF GREAT MOVIES</p>
          <h1 className="font-display text-4xl tracking-tight sm:text-5xl">
            Find your next <span className="italic text-accent">favorite.</span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            An old comfort watch. A new obsession. Start with a title, or see
            what catches your eye.
          </p>
        </div>
        <span className="hidden items-center gap-2 rounded-full border border-line px-4 py-2 text-xs text-muted sm:flex">
          <Film size={14} aria-hidden="true" />
          Movies only. Endless possibilities.
        </span>
      </header>
      <section
        aria-label="Search and filters"
        className="rounded-2xl border border-line bg-surface p-4 sm:p-5"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_200px_160px]">
          <div>
            <label htmlFor="movie-query" className="sr-only">
              Search movies
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-4 top-4 text-muted"
                size={20}
                aria-hidden="true"
              />
              <input
                id="movie-query"
                type="search"
                name="q"
                value={query}
                maxLength={100}
                onChange={(event) => changeFilters({ q: event.target.value })}
                placeholder="Search by movie title…"
                autoComplete="off"
                className="!pl-12"
              />
            </div>
          </div>
          <div>
            <label htmlFor="movie-genre" className="sr-only">
              Genre
            </label>
            <select
              id="movie-genre"
              value={genre}
              onChange={(event) => changeFilters({ genre: event.target.value })}
              className="min-h-12 w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm"
            >
              <option value="">All genres</option>
              {MOVIE_GENRES.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="movie-year" className="sr-only">
              Release year
            </label>
            <select
              id="movie-year"
              value={year}
              onChange={(event) => changeFilters({ year: event.target.value })}
              className="min-h-12 w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm"
            >
              <option value="">All years</option>
              {Array.from(
                { length: currentYear + 2 - 1870 + 1 },
                (_, index) => currentYear + 2 - index,
              ).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <span className="flex items-center gap-2">
            <SlidersHorizontal size={13} aria-hidden="true" />
            Make a little room for discovery.
          </span>
          {(query || genre || year) && (
            <button
              type="button"
              className="flex min-h-8 items-center gap-1.5 hover:text-ink"
              onClick={() => changeFilters({ q: "", genre: "", year: "" })}
            >
              <X size={13} aria-hidden="true" />
              Clear filters
            </button>
          )}
        </div>
      </section>
      <section
        aria-label="Movie results"
        aria-busy={results.loading || results.moreLoading}
        className="mt-10"
      >
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {query.trim()
              ? `Results for “${query.trim()}”`
              : genre || year
                ? "Explore your picks"
                : "Popular right now"}
          </h2>
          <p role="status" className="text-xs text-muted">
            {results.loading
              ? "Finding movies…"
              : results.error
                ? "Search unavailable"
                : `${results.movies.length} movies shown`}
          </p>
        </div>
        {results.filteredPage && (
          <p className="mb-5 text-sm text-muted">
            Genre filters apply to the title results loaded so far. Load more to
            keep looking; this is not a complete matching total.
          </p>
        )}
        {results.loading ? (
          <div
            className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5"
            aria-label="Loading movies"
          >
            {Array.from({ length: 10 }, (_, index) => (
              <div key={index} className="animate-pulse">
                <div className="aspect-[2/3] rounded-xl bg-line" />
                <div className="mt-4 h-4 w-3/4 rounded bg-line" />
                <div className="mt-2 h-3 w-1/3 rounded bg-line" />
              </div>
            ))}
          </div>
        ) : results.error ? (
          <div className="rounded-2xl border border-line bg-surface p-8 text-center">
            <p role="alert" className="text-muted">
              {results.error}
            </p>
            <button
              type="button"
              className="button-secondary mt-5"
              onClick={() => setRetry((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {results.movies.length === 0 && (
              <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
                <Search
                  size={28}
                  className="mx-auto mb-4 text-muted"
                  aria-hidden="true"
                />
                <h3 className="font-display text-2xl">
                  {results.hasMore
                    ? "No matches on these pages yet."
                    : "No movies found this time."}
                </h3>
                <p className="mt-3 text-sm text-muted">
                  {results.hasMore
                    ? "There are more title results to explore. Load the next page or broaden your filters."
                    : "Try a different title, a different year, or fewer filters."}
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-5">
              {results.movies.map((movie) => {
                const destination = `/movies/${movie.id}?from=${encodeURIComponent(returnPath)}`;
                return (
                  <article key={movie.id} className="group min-w-0">
                    <Link href={destination} aria-label={`View ${movie.title}`}>
                      <MoviePoster
                        path={movie.posterPath}
                        title={movie.title}
                        size="w342"
                      />
                    </Link>
                    <div className="mt-4">
                      <h3 className="min-h-10 text-sm font-semibold leading-5">
                        <Link href={destination} className="hover:text-accent">
                          {movie.title}
                        </Link>
                      </h3>
                      <p className="mt-1 text-xs text-muted">
                        {movie.year ?? "Year unknown"}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
            {results.moreError && (
              <p role="alert" className="mt-8 text-center text-sm text-muted">
                {results.moreError}
              </p>
            )}
            {results.hasMore && (
              <div className="mt-10 text-center">
                <button
                  type="button"
                  className="button-secondary min-w-48"
                  onClick={loadMore}
                  disabled={results.moreLoading}
                >
                  {results.moreLoading ? (
                    <LoaderCircle
                      className="animate-spin"
                      size={16}
                      aria-hidden="true"
                    />
                  ) : (
                    <ArrowDown size={16} aria-hidden="true" />
                  )}
                  {results.moreLoading
                    ? "Loading movies…"
                    : results.moreError
                      ? "Retry loading more"
                      : "Load more movies"}
                </button>
              </div>
            )}
          </>
        )}
      </section>
      <p className="mt-12 text-center text-xs text-muted">
        Movie information and posters provided by{" "}
        <a
          href="https://www.themoviedb.org"
          className="underline"
          target="_blank"
          rel="noreferrer"
        >
          TMDB
        </a>
        .{" "}
        <Link href="/about" className="underline">
          Credits
        </Link>
      </p>
    </div>
  );
}
