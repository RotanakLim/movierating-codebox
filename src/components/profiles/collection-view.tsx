import Link from "next/link";
import { MoviePoster } from "@/components/movies/poster";
import { formatScore } from "@/lib/entries/score";
import { formatDate } from "@/lib/entries/dates";
import {
  COLLECTION_SORTS,
  SORT_LABELS,
  type CollectionQuery,
  type CollectionRow,
} from "@/lib/profiles/types";

function href(
  base: string,
  query: CollectionQuery,
  change: Partial<CollectionQuery>,
) {
  const next = { ...query, page: 1, ...change };
  const params = new URLSearchParams();
  if (next.sort !== "rating-desc") params.set("sort", next.sort);
  if (next.rated) params.set("rated", "1");
  if (next.watched) params.set("watched", "1");
  if (next.page > 1) params.set("page", String(next.page));
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

/**
 * A sortable collection: one card per movie with its current score, last known
 * watch date and watch count. There is no manual ordering.
 */
export function CollectionView({
  rows,
  query,
  basePath,
  hasMore,
  emptyText,
}: {
  rows: CollectionRow[];
  query: CollectionQuery;
  basePath: string;
  hasMore: boolean;
  emptyText: string;
}) {
  return (
    <div>
      <nav
        aria-label="Sort and filter"
        className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm"
      >
        <span className="text-muted">Sort:</span>
        {COLLECTION_SORTS.map((sort) => (
          <Link
            key={sort}
            href={href(basePath, query, { sort })}
            aria-current={query.sort === sort ? "true" : undefined}
            className={
              query.sort === sort
                ? "font-semibold text-ink"
                : "text-muted hover:text-ink"
            }
          >
            {SORT_LABELS[sort]}
          </Link>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-line sm:inline-block" />
        {(["rated", "watched"] as const).map((filter) => (
          <Link
            key={filter}
            href={href(basePath, query, { [filter]: !query[filter] })}
            aria-current={query[filter] ? "true" : undefined}
            className={`rounded-full border px-3 py-1 ${
              query[filter]
                ? "border-accent bg-accent/10 text-ink"
                : "border-line text-muted hover:text-ink"
            }`}
          >
            {filter === "rated" ? "Rated" : "Watched"}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-muted">{emptyText}</p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {rows.map((row) => (
            <li key={row.movieId} className="group min-w-0">
              <Link href={`/movies/${row.movieId}`}>
                <MoviePoster path={row.poster} title={row.title} size="w342" />
              </Link>
              <h3 className="mt-3 truncate text-sm font-semibold">
                <Link
                  href={`/movies/${row.movieId}`}
                  className="hover:text-accent"
                >
                  {row.title}
                </Link>
              </h3>
              <p className="text-xs text-muted">
                {row.score !== null ? (
                  <strong className="text-ink tabular-nums">
                    {formatScore(row.score)}/10
                  </strong>
                ) : (
                  "Unrated"
                )}
                {row.year ? ` · ${row.year}` : ""}
              </p>
              <p className="text-xs text-muted">
                {row.watchCount > 0
                  ? `Watched ${row.watchCount}× · ${
                      row.lastWatched
                        ? formatDate(row.lastWatched)
                        : "date unknown"
                    }`
                  : "Not watched"}
              </p>
            </li>
          ))}
        </ul>
      )}

      {(query.page > 1 || hasMore) && (
        <nav aria-label="Pages" className="mt-8 flex gap-4 text-sm">
          {query.page > 1 && (
            <Link
              href={href(basePath, query, { page: query.page - 1 })}
              className="button-secondary"
            >
              Previous
            </Link>
          )}
          {hasMore && (
            <Link
              href={href(basePath, query, { page: query.page + 1 })}
              className="button-secondary"
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
