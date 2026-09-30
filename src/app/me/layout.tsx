import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/lib/profiles/load";
import { ProfileTabs } from "@/components/profiles/tabs";

export const metadata: Metadata = {
  title: "My movies",
  robots: { index: false, follow: false },
};

export default async function MeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { username } = await requireOnboardedUser("/me/movies");
  return (
    <section className="py-10 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-4xl">My movies</h1>
        <Link
          href={`/u/${username}`}
          className="text-sm text-muted hover:text-ink"
        >
          View my public profile
        </Link>
      </div>
      <div className="mt-6">
        <ProfileTabs base="/me" />
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}
