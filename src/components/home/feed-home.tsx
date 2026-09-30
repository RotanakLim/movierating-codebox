import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { UserPlus } from "lucide-react";
import type { Database } from "@/lib/supabase/database.types";
import { followsAnyone, loadFeed } from "@/lib/feed/load";
import type { FeedPage, FeedTab } from "@/lib/feed/types";
import { FeedList } from "@/components/feed/feed-list";

const TAB_LABELS: Record<FeedTab, string> = {
  following: "Following",
  community: "Community",
};

/**
 * Signed-in home. Following is the default once the viewer follows someone;
 * until then Community is shown with a prompt to find people. Every card is a
 * real rating, review or watch; an empty feed says so instead of inventing any.
 */
export async function FeedHome({
  supabase,
  userId,
  username,
  requested,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
  username: string;
  requested: FeedTab | null;
}) {
  const following = await followsAnyone(supabase, userId);
  const tab: FeedTab = requested ?? (following ? "following" : "community");
  let page: FeedPage | null = null;
  try {
    page = await loadFeed(tab, null, supabase);
  } catch {
    page = null;
  }

  const empty =
    tab === "following" ? (
      following ? (
        <p>
          Nothing new from the people you follow yet. Their ratings, reviews and
          watches appear here.
        </p>
      ) : (
        <p>
          You&apos;re not following anyone yet.{" "}
          <Link href="/people" className="text-accent underline">
            Find people to follow
          </Link>
          .
        </p>
      )
    ) : (
      <p>
        No public ratings or reviews yet.{" "}
        <Link href="/discover" className="text-accent underline">
          Rate a movie
        </Link>{" "}
        to start the community feed.
      </p>
    );

  return (
    <section className="mx-auto max-w-2xl py-10 sm:py-14">
      <p className="eyebrow mb-4">HOME</p>
      <h1 className="font-display text-4xl">Welcome back, @{username}.</h1>

      {!following && (
        <div className="mt-8 flex items-start gap-4 rounded-2xl border border-line bg-surface p-5">
          <UserPlus
            size={22}
            className="mt-0.5 shrink-0 text-accent"
            aria-hidden="true"
          />
          <div>
            <h2 className="font-semibold">Find people to follow</h2>
            <p className="mt-1 text-sm text-muted">
              Follow friends and critics you like, and their ratings and reviews
              will fill your Following feed.
            </p>
            <Link href="/people" className="button-secondary mt-4">
              Find people
            </Link>
          </div>
        </div>
      )}

      <nav
        aria-label="Feeds"
        className="mt-8 flex gap-6 border-b border-line text-sm"
      >
        {(["following", "community"] as const).map((item) => (
          <Link
            key={item}
            href={`/?tab=${item}`}
            aria-current={item === tab ? "page" : undefined}
            className={`-mb-px border-b-2 pb-3 ${
              item === tab
                ? "border-accent font-semibold text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {TAB_LABELS[item]}
          </Link>
        ))}
      </nav>
      <p className="mt-3 text-xs text-muted">
        {tab === "following"
          ? "Ratings, reviews and watches from people you follow, newest first."
          : "Public ratings and reviews from everyone, newest first."}
      </p>

      {page ? (
        <FeedList key={tab} tab={tab} initial={page} emptyText={empty} />
      ) : (
        <p role="alert" className="mt-6 text-sm text-muted">
          The feed is unavailable right now. Please refresh to try again.
        </p>
      )}
    </section>
  );
}
