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
  limit: vi.fn(),
  after: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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
import { MovieError } from "@/lib/movies/errors";

const USER = { id: "user-1", email: "fan@codebox.test" };
const now = () => Math.floor(Date.now() / 1000);

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
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.cleanup.mockResolvedValue(true);
  mocks.preferences.mockResolvedValue(true);
});

describe("saveProfile", () => {
  it("trims text, keeps bio line breaks and drops empty fields", async () => {
    expect(
      await saveProfile({
        displayName: "  Ada   Lovelace ",
        bio: " Line one \r\n\n\n\nLine\ttwo\u0007 ",
      }),
    ).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledWith(
      {
        profile: { display_name: "Ada Lovelace", bio: "Line one\n\nLine two" },
      },
      "user-1",
    );
    await saveProfile({ displayName: " ", bio: "" });
    expect(mocks.update).toHaveBeenLastCalledWith({ profile: {} }, "user-1");
  });

  it("enforces the 60 and 300 character limits and rejects extra fields", async () => {
    expect(await saveProfile({ displayName: "x".repeat(61), bio: "" })).toEqual(
      {
        ok: false,
        error: "Display name can be up to 60 characters.",
      },
    );
    expect(
      await saveProfile({ displayName: "", bio: "x".repeat(301) }),
    ).toEqual({ ok: false, error: "Bio can be up to 300 characters." });
    expect(
      (await saveProfile({ displayName: "", bio: "", avatar: "x" })).ok,
    ).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("requires a contributor", async () => {
    mocks.contributor.mockResolvedValue({ ok: false, error: "Sign in." });
    expect(await saveProfile({ displayName: "A", bio: "" })).toEqual({
      ok: false,
      error: "Sign in.",
    });
  });
});

describe("saveTheme", () => {
  it("saves only system, light or dark for the signed-in user", async () => {
    expect(await saveTheme({ theme: "dark" })).toEqual({ ok: true });
    expect(mocks.preferences).toHaveBeenCalledWith(client, "user-1", {
      theme: "dark",
    });
    expect((await saveTheme({ theme: "neon" })).ok).toBe(false);
    mocks.user.mockResolvedValue(null);
    expect((await saveTheme({ theme: "light" })).ok).toBe(false);
    expect(mocks.preferences).toHaveBeenCalledTimes(1);
  });
});

describe("reauthenticate", () => {
  it("signs in again with the session's own email", async () => {
    mocks.signIn.mockResolvedValue({ error: null });
    expect(await reauthenticate({ password: "correct horse" })).toEqual({
      ok: true,
    });
    expect(mocks.signIn).toHaveBeenCalledWith({
      email: "fan@codebox.test",
      password: "correct horse",
    });
    mocks.signIn.mockResolvedValue({ error: { status: 400 } });
    expect(await reauthenticate({ password: "wrong" })).toEqual({
      ok: false,
      error: "That password isn't right.",
    });
    expect(
      (await reauthenticate({ password: "x", email: "other@x.test" })).ok,
    ).toBe(false);
  });

  it("limits password re-checks per account before calling Auth", async () => {
    expect(mocks.limit).not.toHaveBeenCalled();
    mocks.limit.mockRejectedValue(new MovieError(429, "slow down"));
    expect(await reauthenticate({ password: "guess" })).toEqual({
      ok: false,
      error: "Too many attempts. Please wait 15 minutes and try again.",
    });
    expect(mocks.limit).toHaveBeenCalledWith(
      "reauth",
      expect.any(Headers),
      "user-1",
    );
    expect(mocks.signIn).not.toHaveBeenCalled();
    mocks.limit.mockRejectedValue(new MovieError(503, "not configured"));
    expect((await reauthenticate({ password: "guess" })).ok).toBe(false);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
});

describe("deleteAccount", () => {
  it("requires a username and the username typed exactly", async () => {
    mocks.username.mockResolvedValueOnce(null);
    expect(await deleteAccount({ confirmation: "delete" })).toEqual({
      ok: false,
      error: "Choose a username to continue.",
    });
    expect(await deleteAccount({ confirmation: "someone_else" })).toEqual({
      ok: false,
      error: "Type your username to confirm.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a sign-in within the last few minutes", async () => {
    mocks.authenticatedAt.mockResolvedValue(now() - 11 * 60);
    expect(await deleteAccount({ confirmation: "film_fan" })).toEqual({
      ok: false,
      error: "For your security, sign in again before deleting your account.",
    });
    mocks.authenticatedAt.mockResolvedValue(null);
    expect((await deleteAccount({ confirmation: "film_fan" })).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("disables the account, signs out, leaves, and cleans up after responding", async () => {
    await expect(deleteAccount({ confirmation: " Film_Fan " })).rejects.toThrow(
      "REDIRECT:/account/deleted",
    );
    // The typed text goes to the database, which checks it again.
    expect(mocks.rpc).toHaveBeenCalledWith("request_account_deletion", {
      confirmation: " Film_Fan ",
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.cleanup).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.cleanup).toHaveBeenCalledWith("user-1");
  });

  it("maps database refusals to clear messages and cleans up nothing", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "42501" } });
    expect(await deleteAccount({ confirmation: "film_fan" })).toEqual({
      ok: false,
      error: "For your security, sign in again before deleting your account.",
    });
    mocks.rpc.mockResolvedValue({ error: { code: "22023" } });
    expect(await deleteAccount({ confirmation: "film_fan" })).toEqual({
      ok: false,
      error: "Type your username to confirm.",
    });
    mocks.rpc.mockResolvedValue({ error: { code: "XX000" } });
    expect((await deleteAccount({ confirmation: "film_fan" })).ok).toBe(false);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue(null);
    expect((await deleteAccount({ confirmation: "film_fan" })).ok).toBe(false);
  });
});
