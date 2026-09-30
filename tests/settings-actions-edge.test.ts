import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  contributor: vi.fn(),
  username: vi.fn(),
  authenticatedAt: vi.fn(),
  update: vi.fn(),
  rpc: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  cleanup: vi.fn(),
  preferences: vi.fn(),
  revalidate: vi.fn(),
  limit: vi.fn(),
  after: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/movies/limits", () => ({ limitMovieRequest: mocks.limit }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/auth/user", () => ({ getUser: mocks.user }));
vi.mock("@/lib/auth/contributor", () => ({
  requireContributor: mocks.contributor,
}));
vi.mock("@/lib/onboarding/profile", () => ({ readUsername: mocks.username }));
vi.mock("@/lib/auth/recent", async (original) => ({
  ...(await original<typeof import("@/lib/auth/recent")>()),
  lastAuthenticatedAt: mocks.authenticatedAt,
}));
vi.mock("@/lib/settings/preferences", () => ({
  savePreferences: mocks.preferences,
}));
vi.mock("@/lib/supabase/account-cleanup", () => ({
  cleanUpDeletedAccount: mocks.cleanup,
}));
const client = {
  rpc: mocks.rpc,
  from: () => ({
    update: (values: unknown) => ({
      eq: (_column: string, id: string) => mocks.update(values, id),
    }),
  }),
  auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut },
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
import {
  deleteAccount,
  reauthenticate,
  saveProfile,
  saveTheme,
} from "@/app/settings/actions";

const USER = { id: "user-1", email: "fan@codebox.test" };
const now = () => Math.floor(Date.now() / 1000);
const FAILED = { ok: false, error: "That didn't work. Please try again." };

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.user.mockResolvedValue(USER);
  mocks.contributor.mockResolvedValue({
    ok: true,
    user: USER,
    supabase: client,
  });
  mocks.username.mockResolvedValue("film_fan");
  mocks.authenticatedAt.mockResolvedValue(now() - 60);
  mocks.update.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.signIn.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.cleanup.mockResolvedValue(true);
  mocks.preferences.mockResolvedValue(true);
});

describe("saveProfile edge cases", () => {
  it("returns the generic failure and does not revalidate on a DB error", async () => {
    mocks.update.mockResolvedValue({ error: { code: "23514" } });
    expect(await saveProfile({ displayName: "Ada", bio: "" })).toEqual(FAILED);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("revalidates the whole layout on success", async () => {
    await saveProfile({ displayName: "Ada", bio: "" });
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  });

  it("validates before checking the session", async () => {
    expect((await saveProfile({ displayName: 1, bio: "" })).ok).toBe(false);
    expect((await saveProfile(null)).ok).toBe(false);
    expect((await saveProfile({ displayName: "x" })).ok).toBe(false);
    expect(mocks.contributor).not.toHaveBeenCalled();
  });

  it("measures limits after whitespace folding (padding does not count)", async () => {
    expect(
      await saveProfile({ displayName: `  ${"x".repeat(60)}   `, bio: "" }),
    ).toEqual({ ok: true });
    expect(
      (await saveProfile({ displayName: "x".repeat(2001), bio: "" })).ok,
    ).toBe(false);
  });

  it("strips control characters and treats a control-only name as empty", async () => {
    await saveProfile({ displayName: "\u0000\u0007", bio: "a\u0000b" });
    expect(mocks.update).toHaveBeenLastCalledWith(
      { profile: { bio: "ab" } },
      "user-1",
    );
  });
});

describe("saveTheme edge cases", () => {
  it("keeps the choice local (ok, no DB write) for a user without a username", async () => {
    mocks.username.mockResolvedValue(null);
    expect(await saveTheme({ theme: "dark" })).toEqual({ ok: true });
    expect(mocks.preferences).not.toHaveBeenCalled();
  });

  it("reports the generic failure when the preferences write fails", async () => {
    mocks.preferences.mockResolvedValue(false);
    expect(await saveTheme({ theme: "light" })).toEqual(FAILED);
  });

  it("rejects extra fields and non-objects", async () => {
    expect(await saveTheme({ theme: "dark", userId: "other" })).toEqual({
      ok: false,
      error: "Choose a theme.",
    });
    expect((await saveTheme("dark")).ok).toBe(false);
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it("gives a sign-in message to guests", async () => {
    mocks.user.mockResolvedValue(null);
    expect(await saveTheme({ theme: "system" })).toEqual({
      ok: false,
      error: "Sign in to save your theme.",
    });
  });
});

describe("reauthenticate edge cases", () => {
  it("reports rate limiting (429) separately from a wrong password", async () => {
    mocks.signIn.mockResolvedValue({ error: { status: 429 } });
    expect(await reauthenticate({ password: "anything" })).toEqual({
      ok: false,
      error: "Too many attempts. Please wait and try again.",
    });
  });

  it("refuses empty and overlong passwords without calling auth", async () => {
    expect(await reauthenticate({ password: "" })).toEqual({
      ok: false,
      error: "Enter your password.",
    });
    expect((await reauthenticate({ password: "x".repeat(129) })).ok).toBe(
      false,
    );
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("requires a signed-in user with an email", async () => {
    mocks.user.mockResolvedValue(null);
    expect(await reauthenticate({ password: "pw" })).toEqual({
      ok: false,
      error: "Sign in to continue.",
    });
    mocks.user.mockResolvedValue({ id: "user-1" });
    expect((await reauthenticate({ password: "pw" })).ok).toBe(false);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("revalidates /settings only on success", async () => {
    mocks.signIn.mockResolvedValue({ error: { status: 400 } });
    await reauthenticate({ password: "wrong" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    mocks.signIn.mockResolvedValue({ error: null });
    await reauthenticate({ password: "right" });
    expect(mocks.revalidate).toHaveBeenCalledWith("/settings");
  });
});

describe("deleteAccount edge cases", () => {
  it("refuses when the account has no username yet (the database would too)", async () => {
    mocks.username.mockResolvedValue(null);
    expect(await deleteAccount({ confirmation: "delete" })).toEqual({
      ok: false,
      error: "Choose a username to continue.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed input before reading the session", async () => {
    expect(await deleteAccount({})).toEqual({
      ok: false,
      error: "Type your username.",
    });
    expect((await deleteAccount({ confirmation: "x".repeat(101) })).ok).toBe(
      false,
    );
    expect(
      (await deleteAccount({ confirmation: "film_fan", userId: "other" })).ok,
    ).toBe(false);
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it("checks the confirmation before the sign-in age", async () => {
    mocks.authenticatedAt.mockResolvedValue(null);
    expect(await deleteAccount({ confirmation: "nope" })).toEqual({
      ok: false,
      error: "Type your username to confirm.",
    });
    expect(mocks.authenticatedAt).not.toHaveBeenCalled();
  });

  it("finishes even if the local sign-out rejects", async () => {
    mocks.signOut.mockRejectedValue(new Error("cookie write failed"));
    await expect(deleteAccount({ confirmation: "film_fan" })).rejects.toThrow(
      "REDIRECT:/account/deleted",
    );
    await mocks.after.mock.calls[0][0]();
    expect(mocks.cleanup).toHaveBeenCalledWith("user-1");
  });

  it("does not sign out or clean up when the RPC fails", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "57014" } });
    expect(await deleteAccount({ confirmation: "film_fan" })).toEqual(FAILED);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
});
