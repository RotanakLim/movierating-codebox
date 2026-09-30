// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const env = vi.hoisted(() => ({ google: false }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/settings/actions", () => ({
  saveTheme: vi.fn(),
  saveProfile: vi.fn(),
  deleteAccount: vi.fn(),
  reauthenticate: vi.fn(),
}));
vi.mock("@/app/onboarding/actions", () => ({
  saveGenres: vi.fn(),
  saveFavoriteMovies: vi.fn(),
}));
vi.mock("@/app/auth/actions", () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  forgotPassword: vi.fn(),
  resendVerification: vi.fn(),
  updatePassword: vi.fn(),
  signInWithGoogle: vi.fn(),
}));
vi.mock("@/lib/env", () => ({
  getPublicConfig: () => ({ siteUrl: "https://codebox.test" }),
  googleAuthEnabled: () => env.google,
}));
import { reauthOptions } from "@/lib/settings/reauth";
import { DeleteAccount } from "@/components/settings/forms";
import { AuthScreen } from "@/components/auth-screen";

afterEach(() => {
  cleanup();
  env.google = false;
});

const set = (...providers: string[]) => new Set(providers);

describe("reauthOptions", () => {
  it("never leaves a Google-only account without a way to confirm", () => {
    expect(reauthOptions(set("google"), false)).toEqual({
      hasGoogle: false,
      hasPassword: true,
      setPasswordFirst: true,
    });
  });
  it("offers Google for Google accounts while it's switched on", () => {
    expect(reauthOptions(set("google"), true)).toEqual({
      hasGoogle: true,
      hasPassword: false,
      setPasswordFirst: false,
    });
    expect(reauthOptions(set("email", "google"), true)).toEqual({
      hasGoogle: true,
      hasPassword: true,
      setPasswordFirst: false,
    });
  });
  it("uses the password for email accounts either way", () => {
    for (const enabled of [true, false])
      expect(reauthOptions(set("email"), enabled)).toEqual({
        hasGoogle: false,
        hasPassword: true,
        setPasswordFirst: false,
      });
    // Google linked to an email account, Google off: password only, no hint.
    expect(reauthOptions(set("email", "google"), false)).toEqual({
      hasGoogle: false,
      hasPassword: true,
      setPasswordFirst: false,
    });
  });
});

describe("<DeleteAccount> with Google switched off", () => {
  it("shows the password check and a link to set a password, not Google", () => {
    render(
      <DeleteAccount
        username="film_fan"
        recent={false}
        {...reauthOptions(set("google"), false)}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Confirm with Google" }),
    ).toBeNull();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "set one first" }).getAttribute("href"),
    ).toBe("/auth/update-password?next=%2Fsettings");
  });
});

describe("<AuthScreen> passes the Google switch to the form", () => {
  it.each(["sign-in", "sign-up"] as const)(
    "shows Google and the divider on %s when on",
    (mode) => {
      env.google = true;
      render(<AuthScreen mode={mode} />);
      expect(
        screen.getByRole("button", { name: "Continue with Google" }),
      ).toBeTruthy();
      expect(screen.getByText("or use your email")).toBeTruthy();
    },
  );
  it("hides both when off", () => {
    render(<AuthScreen mode="sign-in" />);
    expect(
      screen.queryByRole("button", { name: "Continue with Google" }),
    ).toBeNull();
    expect(screen.queryByText("or use your email")).toBeNull();
  });
});
