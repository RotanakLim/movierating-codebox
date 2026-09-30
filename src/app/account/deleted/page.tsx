import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Account deleted",
  robots: { index: false, follow: false },
};

export default function AccountDeletedPage() {
  return (
    <section className="mx-auto max-w-2xl py-16">
      <h1 className="font-display text-4xl">Your account has been deleted.</h1>
      <p className="mt-6 leading-relaxed text-muted">
        You&apos;ve been signed out everywhere. Your profile, ratings, reviews,
        diary, lists, follows and avatar have been removed from CodeBox Movies.
        Reports you were part of are kept without your name or details for
        moderation records. Copies in our hosting provider&apos;s backups expire
        on their normal schedule rather than immediately.
      </p>
      <Link href="/" className="button-secondary mt-8">
        Back to CodeBox Movies
      </Link>
    </section>
  );
}
