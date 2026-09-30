"use client";
import { useState } from "react";
import Link from "next/link";
import { EyeOff, LoaderCircle } from "lucide-react";
import { formatScore } from "@/lib/entries/score";
import {
  BlockedNotice,
  ReviewSafety,
} from "@/components/safety/safety-controls";
import type { Review, ReviewPage } from "@/lib/reviews/types";

function publishedOn(value: string) {
  // Fixed timezone so the server render and hydration agree.
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

/** Spoiler text stays out of the DOM (and screen-reader output) until revealed. */
function ReviewBody({ review }: { review: Review }) {
  const [revealed, setRevealed] = useState(false);
  if (!review.note) return null;
  if (review.spoiler && !revealed)
    return (
      <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line p-3 text-sm text-muted">
        <EyeOff size={14} aria-hidden="true" />
        This review contains spoilers.
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="font-semibold text-accent hover:underline"
        >
          Show review
        </button>
      </div>
    );
  return (
    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">
      {review.note}
    </p>
  );
}

export function ReviewList({
  movieId,
  initial,
  viewerId = null,
}: {
  movieId: number;
  initial: ReviewPage;
  /** Signed-in, onboarded viewer; others get no report/block controls. */
  viewerId?: string | null;
}) {
  const [writtenOnly, setWrittenOnly] = useState(false);
  // Authors blocked from this list: their reviews disappear here at once.
  const [blocked, setBlocked] = useState<{ id: string; username: string }[]>(
    [],
  );

  const [page, setPage] = useState<ReviewPage>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hiddenAuthors = new Set(blocked.map((author) => author.id));
  const visible = page.reviews.filter(
    (review) => !hiddenAuthors.has(review.author.id),
  );

  async function fetchPage(options: {
    written: boolean;
    cursor: string | null;
  }) {
    const query = new URLSearchParams();
    if (options.written) query.set("written", "1");
    if (options.cursor) query.set("cursor", options.cursor);
    const response = await fetch(`/api/movies/${movieId}/reviews?${query}`);
    const body = await response.json();
    if (!response.ok)
      throw new Error(
        typeof body.error === "string"
          ? body.error
          : "Reviews are unavailable right now.",
      );
    return body as ReviewPage;
  }
  async function changeFilter(written: boolean) {
    const before = writtenOnly;
    setWrittenOnly(written);
    setLoading(true);
    setError(null);
    try {
      setPage(await fetchPage({ written, cursor: null }));
    } catch (failure) {
      setWrittenOnly(before);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  }
  async function loadMore() {
    if (!page.nextCursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchPage({
        written: writtenOnly,
        cursor: page.nextCursor,
      });
      setPage((current) => {
        const seen = new Set(current.reviews.map((review) => review.id));
        return {
          reviews: [
            ...current.reviews,
            ...next.reviews.filter((review) => !seen.has(review.id)),
          ],
          nextCursor: next.nextCursor,
        };
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="reviews-heading" className="mt-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="reviews-heading" className="font-display text-2xl">
          Reviews
        </h2>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted">Newest first</span>
          <label className="mb-0 inline-flex items-center gap-2 font-normal">
            <input
              type="checkbox"
              checked={writtenOnly}
              onChange={(event) => changeFilter(event.target.checked)}
              disabled={loading}
              className="h-5 min-h-0 w-5 accent-[var(--accent)]"
            />
            Written reviews only
          </label>
        </div>
      </div>

      {blocked.map((author) => (
        <div key={author.id} className="mt-5">
          <BlockedNotice
            authorId={author.id}
            username={author.username}
            onUndo={() =>
              setBlocked((current) =>
                current.filter((item) => item.id !== author.id),
              )
            }
          />
        </div>
      ))}
      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {writtenOnly
            ? "No written reviews yet."
            : "No reviews yet. Be the first to rate or review this movie."}
        </p>
      ) : (
        <ul className="mt-5 space-y-4" aria-busy={loading}>
          {visible.map((review) => (
            <li
              key={review.id}
              className="rounded-2xl border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <Link
                  href={`/u/${review.author.username}`}
                  className="font-semibold hover:text-accent"
                >
                  @{review.author.username}
                </Link>
                <span className="text-xs text-muted">
                  {publishedOn(review.createdAt)}
                  {review.edited && " · edited"}
                </span>
              </div>
              {review.score !== null && (
                <p className="mt-1 text-sm">
                  <strong className="tabular-nums">
                    {formatScore(review.score)}
                  </strong>
                  <span className="text-muted">/10</span>
                </p>
              )}
              <ReviewBody review={review} />
              {viewerId && review.author.id !== viewerId && (
                <ReviewSafety
                  reviewId={review.id}
                  authorId={review.author.id}
                  username={review.author.username}
                  onBlockChange={() =>
                    setBlocked((current) => [
                      ...current,
                      {
                        id: review.author.id,
                        username: review.author.username,
                      },
                    ])
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
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
          {loading ? "Loading…" : "Load more reviews"}
        </button>
      )}
    </section>
  );
}
