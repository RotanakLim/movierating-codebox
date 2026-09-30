"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getPublicConfig } from "@/lib/env";
import { safeNext } from "@/lib/auth/redirect";
import { destinationAfterAuth } from "@/lib/onboarding/profile";
import type { AuthState } from "@/lib/auth/types";

const unavailable = {
  error: "Sign-in is not configured yet. Please try again later.",
};
const networkError = {
  error: "We couldn't reach the account service. Please try again.",
};
function text(data: FormData, name: string) {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}
function email(data: FormData) {
  return text(data, "email").trim().toLowerCase();
}
function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function passwordError(value: string) {
  return value.length < 12 || value.length > 128
    ? { error: "Use a password between 12 and 128 characters." }
    : null;
}
function rateLimited(error: { status?: number } | null) {
  return error?.status === 429;
}

export async function signIn(
  _state: AuthState,
  data: FormData,
): Promise<AuthState> {
  if (!getPublicConfig()) return unavailable;
  if (!validEmail(email(data)) || !text(data, "password"))
    return { error: "Enter your email and password." };
  let destination: string;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email(data),
      password: text(data, "password"),
    });
    if (error)
      return {
        error: rateLimited(error)
          ? "Too many attempts. Please wait and try again."
          : "Unable to sign in. Check your credentials and confirm your email.",
      };
    // Accounts without a username finish onboarding first, then continue to next.
    destination = await destinationAfterAuth(
      safeNext(data.get("next")),
      supabase,
    );
  } catch {
    return networkError;
  }
  revalidatePath("/", "layout");
  redirect(destination);
}

export async function signUp(
  _state: AuthState,
  data: FormData,
): Promise<AuthState> {
  const config = getPublicConfig();
  if (!config) return unavailable;
  if (!validEmail(email(data)))
    return { error: "Enter a valid email address." };
  const invalid = passwordError(text(data, "password"));
  if (invalid) return invalid;
  if (text(data, "password") !== text(data, "confirmPassword"))
    return { error: "Your passwords don't match." };
  try {
    const supabase = await createClient();
    const next = safeNext(data.get("next"));
    const confirmation = new URL("/auth/confirm", config.siteUrl);
    confirmation.searchParams.set("next", next);
    const { error } = await supabase.auth.signUp({
      email: email(data),
      password: text(data, "password"),
      options: { emailRedirectTo: confirmation.toString() },
    });
    if (rateLimited(error))
      return { error: "Too many requests. Please wait before trying again." };
    if (
      error &&
      !["user_already_exists", "email_exists"].includes(error.code ?? "")
    )
      return {
        error: "We couldn't create your account. Please try again later.",
      };
    // A generic response also covers an already-registered address.
    return {
      message:
        "Check your email to confirm your account. If you already have an account, sign in or reset your password.",
    };
  } catch {
    return networkError;
  }
}

export async function signInWithGoogle(
  _state: AuthState,
  data: FormData,
): Promise<AuthState> {
  const config = getPublicConfig();
  if (!config) return unavailable;
  let destination: string | undefined;
  try {
    const supabase = await createClient();
    const callback = new URL("/auth/callback", config.siteUrl);
    callback.searchParams.set("next", safeNext(data.get("next")));
    const { data: result, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString(), skipBrowserRedirect: true },
    });
    if (error || !result.url)
      return {
        error: "Google sign-in is unavailable. Try email or try again later.",
      };
    destination = result.url;
  } catch {
    return networkError;
  }
  redirect(destination);
}

export async function forgotPassword(
  _state: AuthState,
  data: FormData,
): Promise<AuthState> {
  const config = getPublicConfig();
  if (!config) return unavailable;
  if (!validEmail(email(data)))
    return { error: "Enter a valid email address." };
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email(data), {
      redirectTo: `${config.siteUrl}/auth/confirm?next=/auth/update-password`,
    });
    if (rateLimited(error))
      return { error: "Too many requests. Please wait before trying again." };
    if (error) return networkError;
    return {
      message:
        "If an account uses that email, you'll receive a password reset link shortly.",
    };
  } catch {
    return networkError;
  }
}

export async function resendVerification(
  _state: AuthState,
  data: FormData,
): Promise<AuthState> {
  const config = getPublicConfig();
  if (!config) return unavailable;
  if (!validEmail(email(data)))
    return { error: "Enter a valid email address." };
  try {
    const supabase = await createClient();
    const confirmation = new URL("/auth/confirm", config.siteUrl);
    confirmation.searchParams.set("next", safeNext(data.get("next")));
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email(data),
      options: { emailRedirectTo: confirmation.toString() },
    });
    if (rateLimited(error))
      return { error: "Too many requests. Please wait before trying again." };
    // Avoid revealing whether the address exists or was already verified.
    return {
      message:
        "If your account needs verification, a new confirmation link will arrive shortly.",
    };
  } catch {
    return networkError;
  }
}

export async function updatePassword(
  _state: AuthState,
  data: FormData,
): Promise<AuthState> {
  if (!getPublicConfig()) return unavailable;
  const invalid = passwordError(text(data, "password"));
  if (invalid) return invalid;
  if (text(data, "password") !== text(data, "confirmPassword"))
    return { error: "Your passwords don't match." };
  try {
    const supabase = await createClient();
    const { data: current, error: userError } = await supabase.auth.getUser();
    if (userError || !current.user?.email_confirmed_at)
      return {
        error: "Your session expired. Request a new password reset link.",
      };
    const { error } = await supabase.auth.updateUser({
      password: text(data, "password"),
    });
    if (error)
      return {
        error:
          "Couldn't update your password. Choose a different password or request a new reset link.",
      };
    return {
      message:
        "Your password has been updated. You can return to your account.",
    };
  } catch {
    return networkError;
  }
}

export async function signOut(): Promise<void> {
  if (getPublicConfig()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) redirect("/auth/error?reason=signout");
  }
  revalidatePath("/", "layout");
  redirect("/auth/sign-in");
}
