"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  block,
  follow,
  reportUser,
  unblock,
  unfollow,
} from "@/app/profiles/actions";
import type { FollowStatus, Visibility } from "@/lib/profiles/types";

type Props = {
  userId: string;
  username: string;
  visibility: Visibility;
  followStatus: FollowStatus | null;
  blocked: boolean;
  signedIn: boolean;
};

/** Follow/request, block (with disclosure) and report controls for a profile. */
export function SocialControls(props: Props) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [panel, setPanel] = useState<"block" | "report" | null>(null);
  const [pending, startTransition] = useTransition();
  const back = `/u/${props.username}`;

  if (!props.signedIn)
    return (
      <Link
        href={`/auth/sign-in?next=${encodeURIComponent(back)}`}
        className="button-secondary"
      >
        Sign in to follow
      </Link>
    );

  function run(
    task: () => Promise<{ ok: boolean; error?: string }>,
    done?: string,
  ) {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await task();
        if (!result.ok) return setMessage(result.error ?? "That didn't work.");
        setPanel(null);
        if (done) setMessage(done);
        router.refresh();
      } catch {
        setMessage("That didn't work. Please try again.");
      }
    });
  }

  if (props.blocked)
    return (
      <div className="space-y-2">
        <button
          type="button"
          className="button-secondary"
          disabled={pending}
          onClick={() => run(() => unblock({ userId: props.userId }))}
        >
          Unblock @{props.username}
        </button>
        <p className="text-xs text-muted">
          Unblocking doesn&apos;t restore any follows.
        </p>
        {message && (
          <p role="alert" className="text-sm text-muted">
            {message}
          </p>
        )}
      </div>
    );

  const followLabel =
    props.followStatus === "accepted"
      ? "Following"
      : props.followStatus === "pending"
        ? "Requested"
        : props.visibility === "public"
          ? "Follow"
          : "Request to follow";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={
            props.followStatus === "accepted" ||
            props.followStatus === "pending"
              ? "button-secondary"
              : "button-primary"
          }
          aria-pressed={props.followStatus === "accepted"}
          disabled={pending}
          onClick={() =>
            props.followStatus === "accepted" ||
            props.followStatus === "pending"
              ? run(() => unfollow({ userId: props.userId }))
              : run(() => follow({ userId: props.userId }))
          }
          title={
            props.followStatus === "accepted"
              ? "Unfollow"
              : props.followStatus === "pending"
                ? "Cancel request"
                : undefined
          }
        >
          {pending ? "Working…" : followLabel}
        </button>
        <button
          type="button"
          className="text-sm text-muted hover:text-ink"
          onClick={() => setPanel(panel === "block" ? null : "block")}
          aria-expanded={panel === "block"}
        >
          Block
        </button>
        <button
          type="button"
          className="text-sm text-muted hover:text-ink"
          onClick={() => setPanel(panel === "report" ? null : "report")}
          aria-expanded={panel === "report"}
        >
          Report
        </button>
      </div>
      {props.followStatus === "declined" && (
        <p className="text-xs text-muted">
          Your last request was declined. You can ask again 24 hours later.
        </p>
      )}
      {panel === "block" && (
        <div className="rounded-xl border border-line p-4 text-sm">
          <p>
            Block @{props.username}? You&apos;ll both stop following each other,
            pending requests are removed, and you won&apos;t see each
            other&apos;s content while signed in. Public content is still
            visible to anyone who is signed out. Unblocking later won&apos;t
            restore follows.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              className="font-semibold text-red-700 hover:underline dark:text-red-300"
              disabled={pending}
              onClick={() => run(() => block({ userId: props.userId }))}
            >
              Block @{props.username}
            </button>
            <button
              type="button"
              className="text-muted"
              onClick={() => setPanel(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {panel === "report" && (
        <ReportForm
          userId={props.userId}
          username={props.username}
          onDone={(receipt) => {
            setPanel(null);
            setMessage(
              `Thanks. Your report was received (receipt ${receipt}). Reports are private: @${props.username} won't see who reported them.`,
            );
          }}
        />
      )}
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
    </div>
  );
}

const REASONS = [
  ["spam", "Spam"],
  ["harassment", "Harassment"],
  ["inappropriate", "Inappropriate content"],
  ["spoilers", "Unmarked spoilers"],
  ["other", "Something else"],
] as const;

function ReportForm({
  userId,
  username,
  onDone,
}: {
  userId: string;
  username: string;
  onDone: (receipt: string) => void;
}) {
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>("spam");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="space-y-3 rounded-xl border border-line p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await reportUser({ userId, reason, details });
          if (!result.ok) return setError(result.error);
          onDone(result.receipt);
        });
      }}
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Report @{username}</legend>
        {REASONS.map(([value, label]) => (
          <label
            key={value}
            className="mb-1 flex items-center gap-2 font-normal"
          >
            <input
              type="radio"
              name="reason"
              value={value}
              checked={reason === value}
              onChange={() => setReason(value)}
              className="h-4 min-h-0 w-4"
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="report-details">Details (optional)</label>
        <textarea
          id="report-details"
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          maxLength={1000}
          rows={3}
          className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-base"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-muted">
          {error}
        </p>
      )}
      <button type="submit" className="button-secondary" disabled={pending}>
        {pending ? "Sending…" : "Send report"}
      </button>
    </form>
  );
}
