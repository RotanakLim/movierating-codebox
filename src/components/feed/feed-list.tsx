"use client";
import { useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { MoviePoster } from "@/components/movies/poster";
import { formatScore } from "@/lib/entries/score";
import { avatarUrl } from "@/lib/profiles/avatar-url";
import type { FeedItem, FeedPage, FeedTab } from "@/lib/feed/types";

function when(value: string) {
  // Fixed timezone so the server render and hydration agree.
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

/**
 * A feed card. Reviews link to the movie page, where spoiler reviews stay hidden
 * behind a reveal; the card itself never includes review text.
 */
export function FeedCard({ item }: { item: FeedItem }) {
  const who = (
    <Link
      href={`/u/${item.user.username}`}
      className="font-semibold hover:text-accent"
    >
      @{item.user.username}
    </Link>
  );
  const movie = (
    <Link
      href={`/movies/${item.movie.id}`}
      className="font-semibold hover:text-accent"
    >
      {item.movie.title}
    </Link>
  );
  return (
    <article className="flex gap-4 rounded-2xl border border-line bg-surface p-4">
      <Link
        href={`/movies/${item.movie.id}`}
        className="w-14 shrink-0 sm:w-16"
        tabIndex={-1}
        aria-hidden="true"
      >
        <MoviePoster
          path={item.movie.poster}
          title={item.movie.title}
          size="w342"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Avatar src={avatarUrl(item.user.avatar)} size={28} />
          <p className="min-w-0 text-sm">
            {who}{" "}
            {item.kind === "rated"
              ? "rated"
              : item.kind === "reviewed"
                ? "reviewed"
                : "watched"}{" "}
            {movie}
            {item.movie.year ? (
              <span className="text-muted"> ({item.movie.year})</span>
            ) : null}
          </p>
        </div>
        {item.kind === "rated" && item.score !== null && (
          <p className="mt-2 text-lg">
            <strong className="tabular-nums">{formatScore(item.score)}</strong>
            <span className="text-sm text-muted">/10</span>
          </p>
        )}
        <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted">
          <time dateTime={item.createdAt}>{when(item.createdAt)}</time>
          {item.kind !== "watched" && (
            <Link href={`/reviews/${item.entryId}`} className="hover:text-ink">
              {item.kind === "reviewed"
                ? "Read review"
                : "Likes and discussion"}
            </Link>
          )}
        </p>
      </div>
    </article>
  );
}

export function FeedList({
  tab,
  initial,
  emptyText,
}: {
  tab: FeedTab;
  initial: FeedPage;
  emptyText: React.ReactNode;
}) {
  const [page, setPage] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!page.nextCursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ tab, cursor: page.nextCursor });
      const response = await fetch(`/api/feed?${query}`);
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : "The feed is unavailable right now.",
        );
      const next = body as FeedPage;
      setPage((current) => {
        const seen = new Set(current.items.map((item) => item.id));
        return {
          items: [
            ...current.items,
            ...next.items.filter((item) => !seen.has(item.id)),
          ],
          nextCursor: next.nextCursor,
        };
      });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The feed is unavailable right now.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (!page.items.length)
    return <div className="mt-6 text-sm text-muted">{emptyText}</div>;
  return (
    <div className="mt-6">
      <ul className="space-y-4" aria-busy={loading}>
        {page.items.map((item) => (
          <li key={item.id}>
            <FeedCard item={item} />
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-4 text-sm text-muted">
          {error}
        </p>
      )}
      {page.nextCursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="button-secondary mt-5"
        >
          {loading && (
            <LoaderCircle
              size={16}
              className="animate-spin"
              aria-hidden="true"
            />
          )}
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
