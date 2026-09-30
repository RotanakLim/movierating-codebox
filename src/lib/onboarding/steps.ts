import { safeNext } from "@/lib/auth/redirect";

export const ONBOARDING_STEPS = [
  "username",
  "genres",
  "movies",
  "finish",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export const FAVORITE_MOVIE_LIMIT = 5;

/** Where onboarding sends the user when it's done. Never back into onboarding. */
export function onboardingNext(value: unknown) {
  const next = safeNext(value, "/");
  const path = next.split(/[?#]/)[0];
  return path === "/onboarding" || path.startsWith("/onboarding/") ? "/" : next;
}

export function onboardingStepPath(step: OnboardingStep, next: unknown) {
  const params = new URLSearchParams();
  if (step !== "username") params.set("step", step);
  const destination = onboardingNext(next);
  if (destination !== "/") params.set("next", destination);
  const query = params.toString();
  return `/onboarding${query ? `?${query}` : ""}`;
}
