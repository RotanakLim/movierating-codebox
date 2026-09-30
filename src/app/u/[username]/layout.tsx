import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { getUser } from "@/lib/auth/user";
import { loadProfileCard, loadProfileDetails } from "@/lib/profiles/load";
import { VISIBILITY_LABELS } from "@/lib/profiles/types";
import { avatarUrl } from "@/lib/profiles/avatar-url";
import { Avatar } from "@/components/avatar";
import { ProfileTabs } from "@/components/profiles/tabs";
import { SocialControls } from "@/components/profiles/social-controls";

type Props = {
  children: React.ReactNode;
  params: Promise<{ username: string }>;
};

export async function generateMetadata({
  params,
}: Pick<Props, "params">): Promise<Metadata> {
  const { username } = await params;
  // Only the public username; never bio, lists or reviews.
  return { title: `@${decodeURIComponent(username).toLowerCase()}` };
}

const RESTRICTION: Record<string, string> = {
  followers: "Only approved followers can see this profile.",
  friends: "Only friends (people who follow each other) can see this profile.",
  private: "This profile is private.",
};

/**
 * Profile shell. RLS decides access; when the viewer may not see the profile,
 * only the username, avatar, a restriction message and follow/block/report
 * controls are shown: no counts, bio, lists or collection.
 */
export default async function ProfileLayout({ children, params }: Props) {
  const { username } = await params;
  const [card, viewer] = await Promise.all([
    loadProfileCard(decodeURIComponent(username)),
    getUser(),
  ]);
  if (!card) notFound();
  const base = `/u/${card.username}`;
  const details = card.canView ? await loadProfileDetails(card.id) : null;

  return (
    <section className="py-10 sm:py-14">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-center gap-4">
          <Avatar src={avatarUrl(card.avatar)} size={64} />
          <div>
            <h1 className="font-display text-3xl">
              {details?.displayName ?? `@${card.username}`}
            </h1>
            {details?.displayName && (
              <p className="text-sm text-muted">@{card.username}</p>
            )}
          </div>
        </div>
        {card.relationship !== "self" &&
          card.relationship !== "unavailable" &&
          card.visibility && (
            <SocialControls
              userId={card.id}
              username={card.username}
              visibility={card.visibility}
              followStatus={card.followStatus}
              blocked={card.relationship === "blocked"}
              signedIn={Boolean(viewer)}
            />
          )}
      </div>

      {card.canView ? (
        <>
          {details?.bio && (
            <p className="mt-5 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-muted">
              {details.bio}
            </p>
          )}
          {card.relationship === "self" && card.visibility && (
            <p className="mt-3 text-xs text-muted">
              Your profile is {VISIBILITY_LABELS[card.visibility].toLowerCase()}
              .
            </p>
          )}
          <div className="mt-8">
            <ProfileTabs base={base} />
          </div>
          <div className="mt-6">{children}</div>
        </>
      ) : (
        <div className="mt-10 flex max-w-xl items-start gap-3 rounded-2xl border border-line p-6 text-sm text-muted">
          <Lock size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            {card.relationship === "unavailable"
              ? "This profile isn't available."
              : card.relationship === "blocked"
                ? `You blocked @${card.username}.`
                : (RESTRICTION[card.visibility ?? "private"] ??
                  RESTRICTION.private)}
            {card.relationship === "none" &&
              " Their public ratings and reviews still appear on movie pages."}
          </p>
        </div>
      )}
    </section>
  );
}
