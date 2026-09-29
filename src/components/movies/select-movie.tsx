"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowUpRight, Check, LoaderCircle } from "lucide-react";
export function SelectMovie({
  movieId,
  title,
  destination,
}: {
  movieId: number;
  title: string;
  destination?: string;
}) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState(false);
  const [error, setError] = useState<{ text: string; code?: string } | null>(
    null,
  );
  async function selectMovie() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/movies/cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: movieId }),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (!response.ok) {
        setError({
          text:
            typeof result.error === "string"
              ? result.error
              : "We couldn't select this movie. Please try again.",
          code: result.code,
        });
        return;
      }
      setSelected(true);
      if (destination) router.push(destination);
    } catch {
      setError({
        text: "We couldn't select this movie. Check your connection and try again.",
      });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div className="mt-4">
      <button
        type="button"
        className="button-secondary w-full"
        onClick={selectMovie}
        disabled={pending || selected}
        aria-label={`${selected ? "Selected" : "Select"} ${title}`}
      >
        {pending ? (
          <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
        ) : selected ? (
          <Check size={15} aria-hidden="true" />
        ) : (
          <ArrowUpRight size={15} aria-hidden="true" />
        )}
        {pending ? "Selecting…" : selected ? "Selected" : "Select movie"}
      </button>
      {selected && !destination && (
        <p role="status" className="mt-2 text-sm text-accent">
          Movie selected.
        </p>
      )}
      {error && (
        <div className="mt-3 text-sm">
          <p role="alert" className="text-muted">
            {error.text}
          </p>
          {error.code === "SIGN_IN_REQUIRED" && (
            <Link
              className="mt-2 inline-block font-semibold text-accent underline"
              href={`/auth/sign-in?next=${encodeURIComponent(destination ?? `/movies/${movieId}`)}`}
            >
              Sign in to continue
            </Link>
          )}
          {error.code === "VERIFICATION_REQUIRED" && (
            <Link
              className="mt-2 inline-block font-semibold text-accent underline"
              href="/auth/verify"
            >
              Confirm your email
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
