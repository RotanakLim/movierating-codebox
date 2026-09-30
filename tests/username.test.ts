import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RESERVED_USERNAMES,
  localUsernameStatus,
  normalizeUsername,
  usernameProblem,
} from "@/lib/onboarding/username";
import { usernameSchema } from "@/lib/onboarding/username-schema";
import { onboardingNext, onboardingStepPath } from "@/lib/onboarding/steps";

describe("username validation", () => {
  it.each(["abc", "film_fan", "user123", "a".repeat(24), "  Mixed_Case  "])(
    "accepts %j",
    (value) => {
      expect(usernameProblem(value)).toBeNull();
      expect(usernameSchema.safeParse(value).success).toBe(true);
    },
  );
  it("normalizes like the database: trimmed and lowercase", () => {
    expect(normalizeUsername("  Film_Fan ")).toBe("film_fan");
    expect(usernameSchema.parse("  Film_Fan ")).toBe("film_fan");
  });
  it.each([
    ["ab", "3 to 24"],
    ["a".repeat(25), "3 to 24"],
    ["film-fan", "lowercase letters"],
    ["film fan", "lowercase letters"],
    ["café", "lowercase letters"],
    ["", "3 to 24"],
  ])("rejects %j", (value, message) => {
    expect(usernameProblem(value)).toContain(message);
    expect(localUsernameStatus(value)).toBe("invalid");
    expect(usernameSchema.safeParse(value).success).toBe(false);
  });
});

describe("reserved usernames", () => {
  it.each(["admin", "Onboarding", "settings", "u", "me", "codebox"])(
    "rejects %j",
    (value) => {
      // Short reserved names ("u", "me") fail the length rule first.
      expect(localUsernameStatus(value)).toBe(
        value.length < 3 ? "invalid" : "reserved",
      );
      expect(usernameSchema.safeParse(value).success).toBe(false);
    },
  );
  it("matches the database's valid_username() list exactly", () => {
    const sql = readFileSync(
      "supabase/migrations/20260930000500_onboarding.sql",
      "utf8",
    );
    const body = sql.match(
      /function codebox_private\.valid_username[\s\S]*?not in \(([\s\S]*?)\);/,
    );
    expect(body).not.toBeNull();
    const fromSql = [...body![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...fromSql].sort()).toEqual([...RESERVED_USERNAMES].sort());
  });
});

describe("onboarding paths", () => {
  it("preserves a safe next path", () => {
    expect(onboardingStepPath("username", "/movies/10?from=x")).toBe(
      "/onboarding?next=%2Fmovies%2F10%3Ffrom%3Dx",
    );
    expect(onboardingStepPath("genres", "/")).toBe("/onboarding?step=genres");
  });
  it.each([
    "//evil.test",
    "https://evil.test",
    "/auth/sign-in",
    "/onboarding",
    "/onboarding?step=finish",
  ])("never continues to %j", (value) => {
    expect(onboardingNext(value)).toBe("/");
  });
});
