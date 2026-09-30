// Mirrors codebox_private.valid_username() in
// supabase/migrations/20260930000500_onboarding.sql. tests/username.test.ts fails if
// the two lists drift apart.
export const RESERVED_USERNAMES = [
  "admin",
  "account",
  "auth",
  "api",
  "about",
  "discover",
  "movies",
  "reviews",
  "people",
  "settings",
  "notifications",
  "onboarding",
  "me",
  "u",
  "support",
  "codebox",
] as const;
const reserved = new Set<string>(RESERVED_USERNAMES);

export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
export type UsernameStatus = "available" | "taken" | "invalid" | "reserved";

/** The database lowercases and trims usernames; match it before validating. */
export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

/** Local format check. Availability always comes from the server. */
export function usernameProblem(value: string): string | null {
  const username = normalizeUsername(value);
  if (username.length < 3 || username.length > 24)
    return "Use 3 to 24 characters.";
  if (!USERNAME_PATTERN.test(username))
    return "Use only lowercase letters, numbers, and underscores.";
  if (reserved.has(username)) return "That name is reserved. Try another.";
  return null;
}

/** "invalid" or "reserved" when the name can't be used, else null (check the server). */
export function localUsernameStatus(
  value: string,
): Extract<UsernameStatus, "invalid" | "reserved"> | null {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) return "invalid";
  return reserved.has(username) ? "reserved" : null;
}

export const USERNAME_MESSAGES: Record<UsernameStatus, string> = {
  available: "That username is available.",
  taken: "That username is taken. Try another.",
  invalid: "Use 3–24 lowercase letters, numbers, and underscores.",
  reserved: "That name is reserved. Try another.",
};
