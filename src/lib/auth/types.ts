export type AuthState = { error?: string; message?: string };
export type AuthMode =
  "sign-in" | "sign-up" | "forgot-password" | "verify" | "update-password";
