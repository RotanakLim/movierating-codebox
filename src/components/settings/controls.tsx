"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmAction } from "@/components/confirm-action";
import {
  removeFollower,
  respondToFollow,
  setVisibility,
  unblock,
} from "@/app/profiles/actions";
import { VISIBILITY_LABELS, type Visibility } from "@/lib/profiles/types";

const EXPLANATIONS: Record<Visibility, string> = {
  public:
    "Anyone can see your profile. New followers are accepted automatically.",
  followers: "Only followers you approve can see your profile.",
  friends: "Only people you follow who also follow you can see your profile.",
  private:
    "Only you can see your profile. Follow requests can be accepted but don't grant access.",
};

export function VisibilityForm({ current }: { current: Visibility }) {
  const router = useRouter();
  const [value, setValue] = useState<Visibility>(current);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const result = await setVisibility({ visibility: value });
          setMessage(result.ok ? "Privacy setting saved." : result.error);
          if (result.ok) router.refresh();
        });
      }}
    >
      <fieldset className="space-y-3">
        <legend className="sr-only">Profile privacy</legend>
        {(Object.keys(EXPLANATIONS) as Visibility[]).map((mode) => (
          <label
            key={mode}
            className="mb-0 flex cursor-pointer gap-3 rounded-xl border border-line p-3 font-normal has-[:checked]:border-accent"
          >
            <input
              type="radio"
              name="visibility"
              value={mode}
              checked={value === mode}
              onChange={() => setValue(mode)}
              className="mt-1 h-4 min-h-0 w-4"
            />
            <span>
              <span className="font-semibold">{VISIBILITY_LABELS[mode]}</span>
              <span className="block text-sm text-muted">
                {EXPLANATIONS[mode]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="mt-3 text-xs text-muted">
        Your username and avatar are always public, and your scores and reviews
        stay visible on movie pages whatever you choose. Existing followers keep
        following you; access is re-checked immediately.
      </p>
      {message && (
        <p role="status" className="mt-3 text-sm text-muted">
          {message}
        </p>
      )}
      <button
        type="submit"
        className="button-primary mt-4"
        disabled={pending || value === current}
      >
        {pending ? "Saving…" : "Save privacy setting"}
      </button>
    </form>
  );
}

export function FollowRequest({
  userId,
  username,
}: {
  userId: string;
  username: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const respond = (approve: boolean) =>
    startTransition(async () => {
      const result = await respondToFollow({ userId, approve });
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="font-medium">@{username}</span>
      <div className="flex gap-3 text-sm">
        <button
          type="button"
          className="font-semibold text-accent hover:underline"
          disabled={pending}
          onClick={() => respond(true)}
        >
          Accept
        </button>
        <button
          type="button"
          className="text-muted hover:text-ink"
          disabled={pending}
          onClick={() => respond(false)}
        >
          Decline
        </button>
      </div>
      {error && (
        <p role="alert" className="w-full text-xs text-muted">
          {error}
        </p>
      )}
    </div>
  );
}

export function RemoveFollowerButton({
  userId,
  username,
}: {
  userId: string;
  username: string;
}) {
  return (
    <ConfirmAction
      label="Remove"
      confirmLabel="Remove follower"
      question={`Remove @${username} as a follower?`}
      action={() => removeFollower({ userId })}
    />
  );
}

export function UnblockButton({
  userId,
  username,
}: {
  userId: string;
  username: string;
}) {
  return (
    <ConfirmAction
      label="Unblock"
      confirmLabel="Unblock"
      question={`Unblock @${username}? Follows are not restored.`}
      action={() => unblock({ userId })}
    />
  );
}
