"use client";
export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="mx-auto max-w-md py-16">
      <h1 className="font-display text-4xl">An unexpected pause.</h1>
      <p className="my-5 text-muted">
        Something went wrong. Please try again in a moment.
      </p>
      <button className="button-primary" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
