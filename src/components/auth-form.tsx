"use client";
import { useActionState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  signIn,
  signUp,
  forgotPassword,
  resendVerification,
  updatePassword,
  signInWithGoogle,
} from "@/app/auth/actions";
import type { AuthMode } from "@/lib/auth/types";
const actions = {
  "sign-in": signIn,
  "sign-up": signUp,
  "forgot-password": forgotPassword,
  verify: resendVerification,
  "update-password": updatePassword,
};
const labels = {
  "sign-in": "Sign in",
  "sign-up": "Create account",
  "forgot-password": "Send reset link",
  verify: "Resend confirmation",
  "update-password": "Save new password",
};
export function AuthForm({
  mode,
  next,
  configured,
}: {
  mode: AuthMode;
  next: string;
  configured: boolean;
}) {
  const [state, action, pending] = useActionState(actions[mode], {});
  const [googleState, googleAction, googlePending] = useActionState(
    signInWithGoogle,
    {},
  );
  const social = mode === "sign-in" || mode === "sign-up";
  const password = social || mode === "update-password";
  const createPassword = mode === "sign-up" || mode === "update-password";
  const disabled = !configured || pending || googlePending;
  const suffix = `?next=${encodeURIComponent(next)}`;
  return (
    <div className="space-y-6">
      {social && (
        <>
          <form action={googleAction}>
            <input type="hidden" name="next" value={next} />
            <button
              className="button-secondary w-full"
              disabled={disabled}
              type="submit"
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36ZM12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.12H3.04v2.6A10 10 0 0 0 12 22ZM6.39 13.92A6 6 0 0 1 6.08 12c0-.67.11-1.31.31-1.92v-2.6H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.52l3.35-2.6ZM12 5.96c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.96 5.48l3.35 2.6C7.18 7.72 9.39 5.96 12 5.96Z" />
              </svg>
              {googlePending ? "Connecting…" : "Continue with Google"}
            </button>
            {googleState.error && (
              <p role="alert" className="error mt-3">
                {googleState.error}
              </p>
            )}
          </form>
          <div className="flex items-center gap-4 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            or use your email
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      <form action={action} className="space-y-5">
        <input type="hidden" name="next" value={next} />
        {mode !== "update-password" && (
          <div>
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              placeholder="you@example.com"
              disabled={disabled}
            />
          </div>
        )}
        {password && (
          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="password">
                {createPassword ? "New password" : "Password"}
              </label>
              {mode === "sign-in" && (
                <Link
                  href="/auth/forgot-password"
                  className="text-xs text-accent hover:underline"
                >
                  Forgot password?
                </Link>
              )}
            </div>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={
                createPassword ? "new-password" : "current-password"
              }
              required
              minLength={createPassword ? 12 : 1}
              maxLength={128}
              disabled={disabled}
              aria-describedby={createPassword ? "password-hint" : undefined}
            />
            {createPassword && (
              <p id="password-hint" className="mt-2 text-xs text-muted">
                Use 12–128 characters. A passphrase works well.
              </p>
            )}
          </div>
        )}
        {createPassword && (
          <div>
            <label htmlFor="confirmPassword">Confirm password</label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              disabled={disabled}
            />
          </div>
        )}
        {state.error && (
          <p role="alert" className="error">
            {state.error}
          </p>
        )}
        {state.message && (
          <p
            role="status"
            className="rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm leading-relaxed"
          >
            {state.message}
          </p>
        )}
        <button
          className="button-primary w-full"
          type="submit"
          disabled={disabled}
        >
          {pending ? "Please wait…" : labels[mode]}
          {!pending && <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </form>
      <div className="text-center text-sm text-muted">
        {mode === "sign-in" ? (
          <>
            <p>
              New to CodeBox?{" "}
              <Link
                className="text-accent hover:underline"
                href={`/auth/sign-up${suffix}`}
              >
                Create an account
              </Link>
            </p>
            <Link
              className="mt-4 inline-block text-xs hover:underline"
              href={`/auth/verify${suffix}`}
            >
              Resend confirmation email
            </Link>
          </>
        ) : mode === "sign-up" ? (
          <p>
            Already a member?{" "}
            <Link
              className="text-accent hover:underline"
              href={`/auth/sign-in${suffix}`}
            >
              Sign in
            </Link>
          </p>
        ) : (
          <Link
            className="text-accent hover:underline"
            href={
              mode === "update-password" ? "/account" : `/auth/sign-in${suffix}`
            }
          >
            {mode === "update-password"
              ? "Back to your account"
              : "Back to sign in"}
          </Link>
        )}
      </div>
    </div>
  );
}
