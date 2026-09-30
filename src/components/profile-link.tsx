"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Profile = { username: string | null } | null;
const PROFILE_CHANGED = "codebox:profile-changed";

/** Render after a server-side profile change (e.g. a claimed username). */
export function NotifyProfileChanged() {
  useEffect(() => {
    window.dispatchEvent(new Event(PROFILE_CHANGED));
  }, []);
  return null;
}

/** Supabase stores the session in a readable cookie named sb-<ref>-auth-token. */
function hasSessionCookie() {
  return /(?:^|;\s*)sb-[^=]+-auth-token(?:\.\d+)?=/.test(document.cookie);
}

/**
 * Header link to the signed-in user's profile, or to onboarding when they have no
 * username yet. Display only: pages and actions still authorize with getUser().
 * Runs in the browser so the root layout stays static for public pages, and uses a
 * small JSON route rather than supabase-js so every page doesn't ship the client.
 */
export function ProfileLink() {
  const pathname = usePathname();
  const [profile, setProfile] = useState<Profile>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      // Guests have no session cookie: skip the request entirely.
      if (!hasSessionCookie()) return setProfile(null);
      try {
        const response = await fetch("/api/me", { signal: controller.signal });
        const body = await response.json();
        setProfile(
          response.ok && body.signedIn
            ? {
                username:
                  typeof body.username === "string" ? body.username : null,
              }
            : null,
        );
      } catch {
        if (!controller.signal.aborted) setProfile(null);
      }
    }
    load();
    window.addEventListener(PROFILE_CHANGED, load);
    return () => {
      controller.abort();
      window.removeEventListener(PROFILE_CHANGED, load);
    };
    // Sign-in, sign-out and onboarding change cookies server-side, then navigate.
  }, [pathname]);

  if (!profile) return null;
  if (!profile.username)
    return (
      <Link
        href="/onboarding"
        className="text-sm font-semibold text-accent hover:underline"
      >
        Finish setup
      </Link>
    );
  return (
    <Link
      href={`/u/${profile.username}`}
      className="text-sm text-muted hover:text-ink"
      aria-label={`Your profile, @${profile.username}`}
    >
      @{profile.username}
    </Link>
  );
}
