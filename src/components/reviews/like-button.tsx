"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { setLike } from "@/app/reviews/actions";

/**
 * Like or unlike a review. The count and state change at once, then settle on
 * the database's answer, or roll back (with a message) if it refuses.
 */
export function LikeButton({
  reviewId,
  initialLiked,
  initialCount,
  mode,
  signInHref,
}: {
  reviewId: string;
  initialLiked: boolean;
  initialCount: number;
  /** "own": authors can't like their own review; "guest": sign in first. */
  mode: "can-like" | "own" | "guest";
  signInHref: string;
}) {
  const [state, setState] = useState({
    liked: initialLiked,
    count: initialCount,
  });
  const [error, setError] = useState<string | null>(null);
  // Only the newest click's answer may settle the state.
  const latest = useRef(0);
  const label = `${state.count} ${state.count === 1 ? "like" : "likes"}`;

  if (mode !== "can-like")
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Heart size={16} aria-hidden="true" />
        {label}
        {mode === "guest" && (
          <Link href={signInHref} className="text-accent hover:underline">
            Sign in to like
          </Link>
        )}
      </p>
    );

  async function toggle() {
    const before = state;
    const want = !before.liked;
    const request = ++latest.current;
    setError(null);
    setState({ liked: want, count: before.count + (want ? 1 : -1) });
    try {
      const result = await setLike({ reviewId, liked: want });
      if (request !== latest.current) return;
      if (!result.ok) {
        setState(before);
        setError(result.error);
        return;
      }
      setState({ liked: result.liked, count: result.count });
    } catch {
      if (request !== latest.current) return;
      setState(before);
      setError("That didn't work. Please try again.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={state.liked}
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm ${
          state.liked
            ? "border-accent bg-accent/10 font-semibold text-ink"
            : "border-line text-muted hover:text-ink"
        }`}
      >
        <Heart
          size={16}
          aria-hidden="true"
          className={state.liked ? "fill-current text-accent" : ""}
        />
        {state.liked ? "Liked" : "Like"}
        <span className="tabular-nums">· {state.count}</span>
      </button>
      {error && (
        <p role="alert" className="text-sm text-muted">
          {error}
        </p>
      )}
    </div>
  );
}
