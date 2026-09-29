import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  resend: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth })),
}));
vi.mock("@/lib/env", () => ({
  getPublicConfig: () => ({ siteUrl: "https://codebox.test" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import {
  signUp,
  signIn,
  signInWithGoogle,
  forgotPassword,
  updatePassword,
  signOut,
} from "@/app/auth/actions";
function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}
const credentials = {
  email: "person@example.test",
  password: "a-long-test-passphrase",
  confirmPassword: "a-long-test-passphrase",
};
beforeEach(() => Object.values(auth).forEach((mock) => mock.mockReset()));
describe("auth actions", () => {
  it("rejects weak passwords before contacting auth", async () => {
    expect(
      (await signUp({}, form({ ...credentials, password: "short" }))).error,
    ).toContain("12");
    expect(auth.signUp).not.toHaveBeenCalled();
  });
  it("rejects mismatched passwords", async () => {
    expect(
      (
        await signUp(
          {},
          form({ ...credentials, confirmPassword: "different-password" }),
        )
      ).error,
    ).toContain("match");
    expect(auth.signUp).not.toHaveBeenCalled();
  });
  it("sends a canonical safe signup redirect", async () => {
    auth.signUp.mockResolvedValue({ error: null });
    const result = await signUp(
      {},
      form({ ...credentials, next: "//evil.test" }),
    );
    expect(result.message).toContain("Check your email");
    expect(auth.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(
      "https://codebox.test/auth/confirm?next=%2Faccount",
    );
  });
  it("does not redirect on failed login or disclose provider details", async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: { message: "secret detail" },
    });
    const result = await signIn({}, form(credentials));
    expect(result.error).toContain("Unable to sign in");
    expect(result.error).not.toContain("secret detail");
  });
  it("redirects a successful login safely", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(
      signIn({}, form({ ...credentials, next: "https://evil.test" })),
    ).rejects.toThrow("REDIRECT:/account");
  });
  it("starts Google with PKCE and a safe callback", async () => {
    auth.signInWithOAuth.mockResolvedValue({
      data: { url: "https://provider.test/authorize" },
      error: null,
    });
    await expect(
      signInWithGoogle({}, form({ next: "/account" })),
    ).rejects.toThrow("REDIRECT:https://provider.test/authorize");
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://codebox.test/auth/callback?next=%2Faccount",
        skipBrowserRedirect: true,
      },
    });
  });
  it("provides a generic reset response", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    expect(
      (await forgotPassword({}, form({ email: credentials.email }))).message,
    ).toContain("If an account");
  });
  it("never updates a password for a forged or expired session", async () => {
    auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid" },
    });
    expect((await updatePassword({}, form(credentials))).error).toContain(
      "session expired",
    );
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("updates a password for a verified user", async () => {
    auth.getUser.mockResolvedValue({
      data: { user: { email_confirmed_at: "2026-09-29" } },
      error: null,
    });
    auth.updateUser.mockResolvedValue({ error: null });
    expect((await updatePassword({}, form(credentials))).message).toContain(
      "updated",
    );
    expect(auth.updateUser).toHaveBeenCalledWith({
      password: credentials.password,
    });
  });
  it("signs out the current browser and redirects", async () => {
    auth.signOut.mockResolvedValue({ error: null });
    await expect(signOut()).rejects.toThrow("REDIRECT:/auth/sign-in");
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
