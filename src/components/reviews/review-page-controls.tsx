"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEntry } from "@/app/entries/actions";
import { ReviewSafety } from "@/components/safety/safety-controls";

/** Owner-only: delete the review, with a clear note of what goes with it. */
export function DeleteReview({
  reviewId,
  movieId,
  likeCount,
  commentCount,
}: {
  reviewId: string;
  movieId: number;
  likeCount: number;
  commentCount: number;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  if (!asking)
    return (
      <button
        type="button"
        className="text-sm text-muted hover:text-ink"
        onClick={() => setAsking(true)}
      >
        Delete review
      </button>
    );
  return (
    <div
      role="group"
      aria-label="Delete this review"
      className="w-full rounded-xl border border-line p-4 text-sm"
    >
      <p>
        Delete this review permanently? Its score and text are removed
        everywhere, along with its {plural(likeCount, "like")} and the whole
        discussion ({plural(commentCount, "comment")}). This can&apos;t be
        undone.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-muted">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          className="button-danger"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteEntry({ id: reviewId }).catch(() => ({
                ok: false as const,
                error: "That didn't work. Please try again.",
              }));
              if (!result.ok) return setError(result.error);
              router.push(`/movies/${movieId}`);
            })
          }
        >
          {pending ? "Deleting…" : "Delete review"}
        </button>
        <button
          type="button"
          className="text-muted"
          onClick={() => setAsking(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Report or block from the review page; blocking leaves for the movie page. */
export function ReviewPageSafety({
  reviewId,
  authorId,
  username,
  movieId,
}: {
  reviewId: string;
  authorId: string;
  username: string;
  movieId: number;
}) {
  const router = useRouter();
  return (
    <ReviewSafety
      reviewId={reviewId}
      authorId={authorId}
      username={username}
      onBlockChange={() => router.push(`/movies/${movieId}`)}
    />
  );
}
