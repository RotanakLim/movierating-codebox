"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { checkUsername, claimUsername } from "@/app/onboarding/actions";
import {
  USERNAME_MESSAGES,
  normalizeUsername,
  usernameProblem,
  type UsernameStatus,
} from "@/lib/onboarding/username";

type Availability =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "done"; status: UsernameStatus }
  | { state: "error" };

export function UsernameForm({ next }: { next: string }) {
  const [formState, action, pending] = useActionState(claimUsername, {});
  const [value, setValue] = useState("");
  const [availability, setAvailability] = useState<Availability>({
    state: "idle",
  });
  const latest = useRef(0);
  const username = normalizeUsername(value);
  const problem = value ? usernameProblem(value) : null;

  useEffect(() => {
    const request = ++latest.current;
    if (!username || problem) {
      setAvailability({ state: "idle" });
      return;
    }
    setAvailability({ state: "checking" });
    const timer = setTimeout(async () => {
      try {
        const status = await checkUsername(username);
        // Ignore responses for anything but the latest keystroke.
        if (request !== latest.current) return;
        setAvailability(
          status === "error" ? { state: "error" } : { state: "done", status },
        );
      } catch {
        if (request === latest.current) setAvailability({ state: "error" });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [username, problem]);

  const available =
    availability.state === "done" && availability.status === "available";
  const hint = problem
    ? problem
    : availability.state === "checking"
      ? "Checking availability…"
      : availability.state === "error"
        ? "We couldn't check availability. You can still try to save it."
        : availability.state === "done"
          ? USERNAME_MESSAGES[availability.status]
          : "3–24 lowercase letters, numbers, or underscores.";
  const blocked =
    pending ||
    !username ||
    Boolean(problem) ||
    availability.state === "checking" ||
    (availability.state === "done" && !available);

  return (
    <form action={action} className="mt-8 space-y-5">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="username">Username</label>
        <div className="relative">
          <span
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden="true"
          >
            @
          </span>
          <input
            id="username"
            name="username"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            minLength={3}
            maxLength={24}
            pattern="[A-Za-z0-9_]{3,24}"
            className="pl-9"
            aria-describedby="username-hint username-permanent"
            aria-invalid={
              Boolean(problem) || (availability.state === "done" && !available)
            }
          />
          {availability.state === "checking" && (
            <LoaderCircle
              size={16}
              className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-muted"
              aria-hidden="true"
            />
          )}
          {available && (
            <Check
              size={16}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-accent"
              aria-hidden="true"
            />
          )}
        </div>
        <p
          id="username-hint"
          role="status"
          aria-live="polite"
          className={`mt-2 text-xs ${available ? "text-accent" : "text-muted"}`}
        >
          {hint}
        </p>
      </div>
      <p
        id="username-permanent"
        className="rounded-xl border border-line bg-surface p-4 text-sm leading-relaxed text-muted"
      >
        <strong className="text-ink">Usernames are permanent.</strong> You
        can&apos;t change it after you save it, so links to your profile always
        keep working.
      </p>
      {formState.error && (
        <p role="alert" className="error">
          {formState.error}
        </p>
      )}
      <button
        className="button-primary w-full"
        type="submit"
        disabled={blocked}
      >
        {pending ? "Saving…" : "Save username"}
        {!pending && <ArrowRight size={16} aria-hidden="true" />}
      </button>
    </form>
  );
}
