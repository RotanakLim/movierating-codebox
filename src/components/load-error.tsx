"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RequestError } from "@/lib/http/get-json";

/** A failed load or refresh. Loaded items stay on the page; this sits below them. */
export function LoadError({
  error,
  className = "mt-4",
}: {
  error: unknown;
  className?: string;
}) {
  const pathname = usePathname();
  // Come back to the same view, query string included (e.g. /?tab=community).
  // Only rendered after a client-side failure, so window is always there.
  const here =
    typeof window === "undefined"
      ? pathname
      : `${window.location.pathname}${window.location.search}`;
  const message =
    error instanceof Error
      ? error.message
      : "That didn't load. Please try again.";
  return (
    <p role="alert" className={`${className} text-sm text-muted`}>
      {message}
      {error instanceof RequestError && error.signedOut && (
        <>
          {" "}
          <Link
            href={`/auth/sign-in?next=${encodeURIComponent(here)}`}
            className="text-accent underline"
          >
            Sign in
          </Link>
        </>
      )}
    </p>
  );
}
