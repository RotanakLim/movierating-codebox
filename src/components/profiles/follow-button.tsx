"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { follow, unfollow } from "@/app/profiles/actions";
import type { FollowStatus, Visibility } from "@/lib/profiles/types";

/**
 * Follow, request, cancel a request, or unfollow. The database decides whether a
 * follow is accepted at once (public profiles) or becomes a request. Declined
 * requests show as not following; asking again within 24 hours is refused with a
 * message.
 */
export function FollowButton({
  userId,
  username,
  visibility = null,
  initial,
  followBack = false,
}: {
  userId: string;
  username: string;
  /** Unknown (null) when the viewer can't see the profile's mode. */
  visibility?: Visibility | null;
  initial: FollowStatus | null;
  followBack?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<FollowStatus | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = status === "accepted" || status === "pending";

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        if (active) {
          const result = await unfollow({ userId });
          if (!result.ok) return setError(result.error);
          setStatus(null);
        } else {
          const result = await follow({ userId });
          if (!result.ok) return setError(result.error);
          setStatus(result.status);
        }
        router.refresh();
      } catch {
        setError("That didn't work. Please try again.");
      }
    });
  }

  const label =
    status === "accepted"
      ? "Unfollow"
      : status === "pending"
        ? "Cancel request"
        : visibility && visibility !== "public"
          ? "Request to follow"
          : followBack
            ? "Follow back"
            : "Follow";
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {active && (
          <span className="text-xs text-muted">
            {status === "accepted" ? "Following" : "Requested"}
          </span>
        )}
        <button
          type="button"
          className={
            active
              ? "rounded-full border border-line px-3 py-1.5 text-sm text-muted hover:text-ink"
              : "rounded-full bg-accent px-3 py-1.5 text-sm font-semibold text-canvas hover:opacity-90"
          }
          aria-label={`${label} @${username}`}
          disabled={pending}
          onClick={run}
        >
          {pending ? "…" : label}
        </button>
      </div>
      {error && (
        <p role="alert" className="max-w-56 text-right text-xs text-muted">
          {error}
        </p>
      )}
    </div>
  );
}
