import { AuthForm } from "@/components/auth-form";
import { getPublicConfig, googleAuthEnabled } from "@/lib/env";
import type { AuthMode } from "@/lib/auth/types";
const copy = {
  "sign-in": ["Welcome back.", "Your next great movie starts here."],
  "sign-up": [
    "Make room for favorites.",
    "Create your account and start your movie story.",
  ],
  "forgot-password": [
    "Let's get you back in.",
    "We'll email you a link to choose a new password.",
  ],
  verify: [
    "Check your inbox.",
    "Confirm your email to finish creating your account. Need a new link?",
  ],
  "update-password": [
    "A fresh start.",
    "Choose a new password for your CodeBox account.",
  ],
};
export function AuthScreen({
  mode,
  next = "/account",
}: {
  mode: AuthMode;
  next?: string;
}) {
  const configured = Boolean(getPublicConfig());
  return (
    <div className="mx-auto w-full max-w-md py-10 sm:py-16">
      <div className="mb-8">
        <p className="eyebrow mb-3">YOUR SEAT IS SAVED</p>
        <h1 className="font-display text-4xl tracking-tight">
          {copy[mode][0]}
        </h1>
        <p className="mt-3 leading-relaxed text-muted">{copy[mode][1]}</p>
      </div>
      {!configured && (
        <div
          role="status"
          className="mb-6 rounded-xl border border-line bg-surface p-4 text-sm text-muted"
        >
          Account setup is in progress. Sign-in will be available once this site
          is connected to Supabase.
        </div>
      )}
      <AuthForm
        mode={mode}
        next={next}
        configured={configured}
        google={googleAuthEnabled()}
      />
    </div>
  );
}
