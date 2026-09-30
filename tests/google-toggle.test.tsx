// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/app/auth/actions", () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  forgotPassword: vi.fn(),
  resendVerification: vi.fn(),
  updatePassword: vi.fn(),
  signInWithGoogle: vi.fn(),
}));
import { AuthForm } from "@/components/auth-form";
import { googleAuthEnabled } from "@/lib/env";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("Google sign-in toggle", () => {
  it("is off unless GOOGLE_AUTH_ENABLED is true", () => {
    vi.stubEnv("GOOGLE_AUTH_ENABLED", "");
    expect(googleAuthEnabled()).toBe(false);
    vi.stubEnv("GOOGLE_AUTH_ENABLED", "false");
    expect(googleAuthEnabled()).toBe(false);
    vi.stubEnv("GOOGLE_AUTH_ENABLED", " TRUE ");
    expect(googleAuthEnabled()).toBe(true);
  });
  it.each(["1", "yes", "on", "enabled", "truee", "0", "false"])(
    "treats %j as off (only the word true turns it on)",
    (value) => {
      vi.stubEnv("GOOGLE_AUTH_ENABLED", value);
      expect(googleAuthEnabled()).toBe(false);
    },
  );
  it("is off when the variable is missing", () => {
    vi.stubEnv("GOOGLE_AUTH_ENABLED", undefined);
    expect(googleAuthEnabled()).toBe(false);
  });
  it("hides the Google button and divider when off", () => {
    render(<AuthForm mode="sign-in" next="/" configured />);
    expect(
      screen.queryByRole("button", { name: "Continue with Google" }),
    ).toBeNull();
    expect(screen.queryByText("or use your email")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });
  it("shows it on sign-in and sign-up when on, never on other forms", () => {
    render(<AuthForm mode="sign-up" next="/" configured googleEnabled />);
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeTruthy();
    cleanup();
    render(
      <AuthForm mode="forgot-password" next="/" configured googleEnabled />,
    );
    expect(
      screen.queryByRole("button", { name: "Continue with Google" }),
    ).toBeNull();
  });
});
