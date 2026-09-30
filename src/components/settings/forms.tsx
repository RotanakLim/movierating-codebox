"use client";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithGoogle } from "@/app/auth/actions";
import {
  deleteAccount,
  reauthenticate,
  saveProfile,
  saveTheme,
} from "@/app/settings/actions";
import { Avatar } from "@/components/avatar";
import { AVATAR_MAX_BYTES, AVATAR_TYPES } from "@/lib/settings/avatar-limits";
import {
  THEME_CHANGED,
  THEMES,
  applyTheme,
  storedTheme,
  type Theme,
} from "@/lib/settings/theme";

function Status({
  message,
  error,
}: {
  message: string | null;
  error?: boolean;
}) {
  if (!message) return null;
  return (
    <p
      role={error ? "alert" : "status"}
      className={error ? "error mt-3" : "mt-3 text-sm text-muted"}
    >
      {message}
    </p>
  );
}

export function ProfileForm({
  displayName,
  bio,
}: {
  displayName: string;
  bio: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(displayName);
  const [about, setAbout] = useState(bio);
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setResult(null);
        startTransition(async () => {
          const saved = await saveProfile({ displayName: name, bio: about });
          setResult(
            saved.ok
              ? { text: "Profile saved.", error: false }
              : { text: saved.error, error: true },
          );
          if (saved.ok) router.refresh();
        });
      }}
      className="space-y-5"
    >
      <div>
        <label htmlFor="display-name">Display name</label>
        <input
          id="display-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          autoComplete="nickname"
          aria-describedby="display-name-help"
        />
        <p id="display-name-help" className="mt-1 text-xs text-muted">
          Optional. Shown on your profile instead of your username.{" "}
          {name.length}/60
        </p>
      </div>
      <div>
        <label htmlFor="bio">Bio</label>
        <textarea
          id="bio"
          value={about}
          onChange={(event) => setAbout(event.target.value)}
          maxLength={300}
          rows={4}
          aria-describedby="bio-help"
        />
        <p id="bio-help" className="mt-1 text-xs text-muted">
          Optional. {about.length}/300
        </p>
      </div>
      <Status message={result?.text ?? null} error={result?.error} />
      <button type="submit" className="button-primary" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}

export function AvatarUpload({ current }: { current: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function send(method: "POST" | "DELETE", file?: File) {
    setError(null);
    setMessage(null);
    setPending(true);
    try {
      const response = await fetch("/api/avatar", {
        method,
        body: file,
        headers: file ? { "Content-Type": file.type } : undefined,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        return setError(
          typeof body.error === "string"
            ? body.error
            : "That didn't work. Please try again.",
        );
      setMessage(file ? "Avatar updated." : "Avatar removed.");
      router.refresh();
    } catch {
      setError("That didn't work. Please try again.");
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <Avatar src={current} size={80} />
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <label
            className={`button-secondary mb-0 cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${pending ? "pointer-events-none opacity-60" : ""}`}
          >
            {pending ? "Working…" : current ? "Change avatar" : "Upload avatar"}
            <input
              ref={input}
              id="avatar-file"
              type="file"
              accept={AVATAR_TYPES.join(",")}
              className="sr-only"
              disabled={pending}
              aria-describedby="avatar-help"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (!AVATAR_TYPES.includes(file.type))
                  return setError("Choose a JPEG, PNG or WebP image.");
                if (file.size > AVATAR_MAX_BYTES)
                  return setError("Images can be up to 2 MB.");
                send("POST", file);
              }}
            />
          </label>
          {current && (
            <button
              type="button"
              className="text-sm text-muted hover:text-ink"
              disabled={pending}
              onClick={() => send("DELETE")}
            >
              Remove
            </button>
          )}
        </div>
        <p id="avatar-help" className="mt-2 text-xs text-muted">
          JPEG, PNG or WebP, up to 2 MB. We crop it to a square. Your avatar is
          always public.
        </p>
        <Status message={error ?? message} error={Boolean(error)} />
      </div>
    </div>
  );
}

const THEME_LABELS: Record<Theme, { label: string; help: string }> = {
  system: { label: "System", help: "Follow your device's light or dark mode." },
  light: { label: "Light", help: "Always light." },
  dark: { label: "Dark", help: "Always dark." },
};

export function ThemeForm({ account }: { account: Theme | null }) {
  const [theme, setTheme] = useState<Theme>(account ?? "system");
  const [error, setError] = useState<string | null>(null);
  // Without an account choice, show what this browser is using.
  useEffect(() => {
    if (!account) setTheme(storedTheme());
  }, [account]);
  // Follow changes made elsewhere, e.g. the header toggle or a sign-in sync.
  useEffect(() => {
    const follow = (event: Event) =>
      setTheme((event as CustomEvent<Theme>).detail);
    window.addEventListener(THEME_CHANGED, follow);
    return () => window.removeEventListener(THEME_CHANGED, follow);
  }, []);
  return (
    <fieldset className="grid gap-3 sm:grid-cols-3">
      <legend className="sr-only">Theme</legend>
      {THEMES.map((option) => (
        <label
          key={option}
          className="mb-0 flex cursor-pointer gap-3 rounded-xl border border-line p-3 font-normal has-[:checked]:border-accent"
        >
          <input
            type="radio"
            name="theme"
            value={option}
            checked={theme === option}
            onChange={async () => {
              setTheme(option);
              setError(null);
              applyTheme(option);
              const result = await saveTheme({ theme: option }).catch(() => ({
                ok: false as const,
                error: "Couldn't save your theme to your account.",
              }));
              if (!result.ok) setError(result.error);
            }}
            className="mt-1 h-4 min-h-0 w-4"
          />
          <span>
            <span className="font-semibold">{THEME_LABELS[option].label}</span>
            <span className="block text-sm text-muted">
              {THEME_LABELS[option].help}
            </span>
          </span>
        </label>
      ))}
      <div className="sm:col-span-3">
        <Status message={error} error />
      </div>
    </fieldset>
  );
}

/** Step 1: prove it's you (password or Google) if the last sign-in isn't recent. */
function Reauthenticate({
  hasPassword,
  hasGoogle,
  setPasswordFirst,
}: {
  hasPassword: boolean;
  hasGoogle: boolean;
  setPasswordFirst: boolean;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [googleState, googleAction, googlePending] = useActionState(
    signInWithGoogle,
    {},
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        For your security, confirm it&apos;s you before deleting your account.
      </p>
      {setPasswordFirst && (
        <p className="text-sm text-muted">
          Google sign-in is turned off on this site. If you haven&apos;t set a
          password for your account yet,{" "}
          <Link
            href={`/auth/update-password?next=${encodeURIComponent("/settings")}`}
            className="text-accent underline"
          >
            set one first
          </Link>
          , then confirm with it here.
        </p>
      )}
      {hasPassword && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await reauthenticate({ password });
              if (!result.ok) return setError(result.error);
              setPassword("");
              router.refresh();
            });
          }}
        >
          <label htmlFor="reauth-password">Password</label>
          <input
            id="reauth-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <Status message={error} error />
          <button
            type="submit"
            className="button-secondary mt-3"
            disabled={pending || !password}
          >
            {pending ? "Checking…" : "Confirm password"}
          </button>
        </form>
      )}
      {hasGoogle && (
        <form action={googleAction}>
          <input type="hidden" name="next" value="/settings" />
          <button
            type="submit"
            className="button-secondary"
            disabled={googlePending}
          >
            {googlePending ? "Connecting…" : "Confirm with Google"}
          </button>
          <Status message={googleState.error ?? null} error />
        </form>
      )}
    </div>
  );
}

export function DeleteAccount({
  username,
  recent,
  hasPassword,
  hasGoogle,
  setPasswordFirst = false,
}: {
  username: string;
  recent: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
  /** Google-only account while Google is off: link to setting a password. */
  setPasswordFirst?: boolean;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const matches = confirmation.trim().toLowerCase() === username;
  return (
    <div className="rounded-2xl border border-red-300 p-5 dark:border-red-800">
      <p className="text-sm leading-relaxed">
        Deleting your account is{" "}
        <strong>permanent and can&apos;t be undone</strong>. You&apos;ll be
        signed out everywhere straight away, and we remove your profile, avatar,
        ratings, reviews, diary, watchlist, lists, favorites, follows and
        blocks, and your sign-in. Your username may be claimed by someone else.
        Reports you were part of are kept without your name or details. Our
        hosting provider&apos;s backups expire on their normal schedule, not
        immediately.
      </p>
      <div className="mt-5">
        {!recent ? (
          <Reauthenticate
            hasPassword={hasPassword}
            hasGoogle={hasGoogle}
            setPasswordFirst={setPasswordFirst}
          />
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!matches) return;
              setError(null);
              startTransition(async () => {
                // On success the action redirects; this only returns on failure.
                const result = await deleteAccount({ confirmation });
                if (result && !result.ok) setError(result.error);
              });
            }}
          >
            <label htmlFor="delete-confirmation">
              Type <strong>{username}</strong> to confirm
            </label>
            <input
              id="delete-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <Status message={error} error />
            <button
              type="submit"
              className="button-danger mt-4"
              disabled={pending || !matches}
            >
              {pending ? "Deleting…" : "Delete my account permanently"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
