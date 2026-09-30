"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { block, unblock } from "@/app/profiles/actions";
import { FollowButton } from "@/components/profiles/follow-button";
import {
  BlockConfirm,
  ReportForm,
  receiptMessage,
} from "@/components/safety/safety-controls";
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <FollowButton
          userId={props.userId}
          username={props.username}
          visibility={props.visibility}
          initial={
            props.followStatus === "declined" ? null : props.followStatus
          }
        />
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
        <BlockConfirm
          username={props.username}
          pending={pending}
          onConfirm={() => run(() => block({ userId: props.userId }))}
          onCancel={() => setPanel(null)}
        />
      )}
      {panel === "report" && (
        <ReportForm
          target={{
            kind: "user",
            userId: props.userId,
            username: props.username,
          }}
          onCancel={() => setPanel(null)}
          onDone={(receipt) => {
            setPanel(null);
            setMessage(receiptMessage(receipt));
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
