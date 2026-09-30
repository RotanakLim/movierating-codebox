"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { setWatchlisted } from "@/app/watchlist/actions";

type Viewer = "guest" | "unverified" | "no-username" | "ready";

/**
 * Optimistic watchlist toggle: flips immediately, then rolls back and explains if
 * the server refuses or can't be reached. Unreleased movies are allowed.
 */
export function WatchlistToggle({
  movieId,
  initial,
  viewer,
}: {
  movieId: number;
  initial: boolean;
  viewer: Viewer;
}) {
  const router = useRouter();
  const [watchlisted, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(0);

  // A fresh server render (e.g. after logging a watch) is the new truth, unless a
  // toggle is still in flight.
  useEffect(() => {
    if (!pending.current) setState(initial);
  }, [initial]);

  async function toggle() {
    if (viewer === "guest") {
      router.push(
        `/auth/sign-in?next=${encodeURIComponent(`/movies/${movieId}`)}`,
      );
      return;
    }
    const previous = watchlisted;
    const next = !previous;
    setState(next);
    setError(null);
    const request = ++pending.current;
    try {
      const result = await setWatchlisted({ movieId, watchlisted: next });
      if (request !== pending.current) return; // A newer click owns the state.
      if (!result.ok) {
        setState(previous);
        setError(result.error);
      }
    } catch {
      if (request !== pending.current) return;
      setState(previous);
      setError("We couldn't reach CodeBox. Please try again.");
    } finally {
      if (request === pending.current) pending.current = 0;
    }
  }

  const blocked = viewer === "unverified" || viewer === "no-username";
  return (
    <div>
      <button
        type="button"
        className="button-secondary w-full"
        aria-pressed={watchlisted}
        onClick={toggle}
        disabled={blocked}
      >
        {watchlisted ? (
          <BookmarkCheck size={16} className="text-accent" aria-hidden="true" />
        ) : (
          <Bookmark size={16} aria-hidden="true" />
        )}
        {watchlisted ? "On your watchlist" : "Add to watchlist"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-muted">
          {error}
        </p>
      )}
      {viewer === "unverified" && (
        <p className="mt-2 text-xs text-muted">
          <Link href="/auth/verify" className="text-accent underline">
            Confirm your email
          </Link>{" "}
          to use your watchlist.
        </p>
      )}
      {viewer === "no-username" && (
        <p className="mt-2 text-xs text-muted">
          <Link
            href={`/onboarding?next=${encodeURIComponent(`/movies/${movieId}`)}`}
            className="text-accent underline"
          >
            Choose a username
          </Link>{" "}
          to use your watchlist.
        </p>
      )}
    </div>
  );
}
