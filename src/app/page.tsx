import Link from "next/link";
import {
  ArrowUpRight,
  Bookmark,
  Star,
  Users,
  Film,
  ArrowRight,
} from "lucide-react";
import { getUser } from "@/lib/auth/user";
export default async function Home() {
  const user = await getUser();
  return (
    <div className="py-12 sm:py-20">
      <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
        <section>
          <p className="eyebrow mb-6 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> FOR THE LOVE
            OF THE CREDITS
          </p>
          <h1 className="max-w-xl font-display text-5xl leading-[1.08] tracking-tight sm:text-7xl">
            Some movies
            <br />
            stay with you.
            <br />
            <span className="italic text-accent">Keep them here.</span>
          </h1>
          <p className="mt-7 max-w-md text-lg leading-relaxed text-muted">
            A home for your favorites, your hot takes, and everything you want
            to watch next.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-5">
            <Link
              href={user ? "/account" : "/auth/sign-up"}
              className="button-primary"
            >
              {user ? "Your account" : "Find your seat"}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link
              href={user ? "/auth/update-password" : "/auth/sign-in"}
              className="inline-flex items-center gap-1 text-sm font-medium"
            >
              {user ? "Account security" : "Already a member? Sign in"}
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <Link
            href="/discover"
            className="mt-6 inline-block text-sm text-accent underline"
          >
            Browse movies
          </Link>
          <p className="mt-5 text-xs text-muted">
            Your movie story starts with a little discovery.
          </p>
        </section>
        <section
          aria-label="A preview of your future movie diary"
          className="relative rounded-3xl border border-line bg-[#e8eee5] p-6 dark:bg-[#213326] sm:p-10"
        >
          <div className="mb-8 flex items-center justify-between">
            <span className="text-xs font-semibold tracking-widest text-muted">
              THE PERSONAL COLLECTION
            </span>
            <Film size={20} className="text-accent" aria-hidden="true" />
          </div>
          <div className="flex gap-4" aria-hidden="true">
            {[
              "bg-[#446c57] -rotate-6",
              "bg-[#c1a574] translate-y-4",
              "bg-[#53676c] rotate-6",
            ].map((style, i) => (
              <div
                key={i}
                className={`flex aspect-[2/3] flex-1 items-center justify-center rounded-lg shadow-lg ${style}`}
              >
                <div className="flex h-3/4 w-3/4 items-center justify-center rounded-t-full border border-white/25">
                  <Film className="text-white/60" size={30} />
                </div>
              </div>
            ))}
          </div>
          <div className="relative mt-10 rounded-2xl border border-line bg-surface p-5">
            <p
              className="mb-3 font-display text-lg text-accent"
              aria-hidden="true"
            >
              9.5<span className="text-sm text-muted">/10</span>
            </p>
            <p className="font-display text-2xl">
              Worth watching. Worth remembering.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Your diary will begin with your first movie. Ratings and movie
              lists are coming next.
            </p>
          </div>
          <p className="mt-5 text-center text-[10px] tracking-widest text-muted">
            A PREVIEW OF WHAT’S TO COME
          </p>
        </section>
      </div>
      <section className="mt-20 grid gap-8 border-t border-line pt-9 sm:grid-cols-3">
        {[
          {
            Icon: Star,
            title: "Every opinion counts",
            text: "Scores from 0.0 to 10.0 and room for the whole story.",
          },
          {
            Icon: Bookmark,
            title: "Never lose a recommendation",
            text: "A watchlist for all those “you have to see this” moments.",
          },
          {
            Icon: Users,
            title: "Good taste is better shared",
            text: "Follow friends and find your next favorite together.",
          },
        ].map(({ Icon, title, text }) => (
          <div key={title}>
            <Icon size={20} className="mb-4 text-accent" aria-hidden="true" />
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">
              {text}
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}
