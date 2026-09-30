"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { saveTheme } from "@/app/settings/actions";
import { applyTheme, isTheme, storedTheme } from "@/lib/settings/theme";

/** null = guest; username null = signed in but onboarding not finished. */
export type Profile = { username: string | null; requests: number } | null;
const PROFILE_CHANGED = "codebox:profile-changed";

/** Render after a server-side profile change (e.g. a claimed username). */
export function NotifyProfileChanged() {
  useEffect(() => {
    window.dispatchEvent(new Event(PROFILE_CHANGED));
  }, []);
  return null;
}

/** Supabase stores the session in a readable cookie named sb-<ref>-auth-token. */
function sessionCookie() {
  return (
    document.cookie.match(
      /(?:^|;\s*)(sb-[^=]+-auth-token(?:\.\d+)?=[^;]*)/,
    )?.[1] ?? null
  );
}

// The session the account theme was last synced for. Syncing once per session,
// not on every navigation, keeps a slow /api/me from undoing a newer local
// change, and keeps the extra query off ordinary page loads.
let themeSyncedFor: string | null = null;

/**
 * After sign-in the account theme wins over this browser's copy. If the account
 * has never chosen one, a choice made here (e.g. before signing in) is saved.
 */
function syncTheme(accountTheme: unknown, onboarded: boolean) {
  const local = storedTheme();
  if (isTheme(accountTheme)) {
    if (accountTheme !== local) applyTheme(accountTheme);
  } else if (onboarded && local !== "system") {
    saveTheme({ theme: local }).catch(() => undefined);
  }
}

/**
 * The signed-in user's username for navigation. Display only: pages and actions
 * still authorize with getUser(). Runs in the browser so the root layout stays
 * static, and uses a small JSON route rather than supabase-js so every page
 * doesn't ship the client. Guests (no session cookie) make no request.
 */
export function useProfile(): Profile {
  const pathname = usePathname();
  const [profile, setProfile] = useState<Profile>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const session = sessionCookie();
      if (!session) {
        themeSyncedFor = null;
        return setProfile(null);
      }
      const withTheme = themeSyncedFor !== session;
      try {
        const response = await fetch(
          withTheme ? "/api/me?theme=1" : "/api/me",
          {
            signal: controller.signal,
          },
        );
        const body = await response.json();
        const onboarded = typeof body.username === "string";
        // Before onboarding there is no account to sync with yet; try again after.
        if (response.ok && body.signedIn && withTheme && onboarded) {
          themeSyncedFor = session;
          syncTheme(body.theme, onboarded);
        }
        setProfile(
          response.ok && body.signedIn
            ? {
                username:
                  typeof body.username === "string" ? body.username : null,
                requests: typeof body.requests === "number" ? body.requests : 0,
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

  return profile;
}
