import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/lib/profiles/load";
import type { Visibility } from "@/lib/profiles/types";
import { avatarUrl } from "@/lib/profiles/avatar-url";
import { isRecent, lastAuthenticatedAt } from "@/lib/auth/recent";
import { isTheme } from "@/lib/settings/theme";
import {
  FollowRequest,
  RemoveFollowerButton,
  UnblockButton,
  VisibilityForm,
} from "@/components/settings/controls";
import {
  AvatarUpload,
  DeleteAccount,
  ProfileForm,
  ThemeForm,
} from "@/components/settings/forms";
import { GenreForm } from "@/components/onboarding/genre-form";
import { FavoriteMoviesForm } from "@/components/onboarding/favorite-movies-form";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

const SECTIONS = [
  ["profile", "Profile"],
  ["favorites", "Favorites"],
  ["privacy", "Privacy"],
  ["theme", "Theme"],
  ["people", "Followers"],
  ["blocked", "Blocked"],
  ["delete-account", "Delete account"],
] as const;

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-6">
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        {title}
      </h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const { user, username, supabase } = await requireOnboardedUser("/settings");
  const [
    { data: me },
    { data: preferences },
    { data: favoriteRows },
    { data: incoming },
    { data: blocked },
    authenticatedAt,
  ] = await Promise.all([
    supabase
      .from("users")
      .select("visibility, avatar, profile")
      .eq("id", user.id)
      .single(),
    supabase
      .from("user_preferences")
      .select("favorite_genre_ids, theme")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("user_favorite_movies")
      .select("movie_id, added_at, movies(title, poster, year)")
      .eq("user_id", user.id)
      .order("added_at"),
    supabase
      .from("follows")
      .select("follower_id, status, created_at")
      .eq("following_id", user.id)
      .in("status", ["pending", "accepted"])
      .order("created_at", { ascending: false }),
    supabase.rpc("my_blocked_users"),
    lastAuthenticatedAt(supabase),
  ]);
  const ids = [...new Set((incoming ?? []).map((row) => row.follower_id))];
  const { data: people } = ids.length
    ? await supabase
        .from("user_identities")
        .select("id, username")
        .in("id", ids)
    : { data: [] };
  const names = new Map(
    (people ?? []).flatMap((person) =>
      person.id && person.username ? [[person.id, person.username]] : [],
    ),
  );
  const requests = (incoming ?? []).filter(
    (row) => row.status === "pending" && names.has(row.follower_id),
  );
  const followers = (incoming ?? []).filter(
    (row) => row.status === "accepted" && names.has(row.follower_id),
  );
  const profile = (me?.profile ?? {}) as {
    display_name?: string;
    bio?: string;
  };
  const favorites = (favoriteRows ?? []).flatMap((row) =>
    row.movies
      ? [
          {
            id: row.movie_id,
            title: row.movies.title,
            posterPath: row.movies.poster,
            year: row.movies.year,
          },
        ]
      : [],
  );
  const providers = new Set(
    (user.identities ?? []).map((identity) => identity.provider),
  );

  return (
    <div className="mx-auto max-w-2xl py-10 sm:py-14">
      <h1 className="font-display text-4xl">Settings</h1>
      <nav aria-label="Settings sections" className="mt-5">
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="text-muted hover:text-ink">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-10 space-y-12">
        <Section
          id="profile"
          title="Profile"
          description={`Your username, @${username}, is permanent.`}
        >
          <AvatarUpload current={avatarUrl(me?.avatar)} />
          <div className="mt-8">
            <ProfileForm
              displayName={profile.display_name ?? ""}
              bio={profile.bio ?? ""}
            />
          </div>
        </Section>

        <Section
          id="favorites"
          title="Favorites"
          description="Favorite genres and up to five favorite movies. They never create ratings or diary entries."
        >
          <h3 className="text-sm font-semibold">Genres</h3>
          <GenreForm
            next="/settings"
            selected={preferences?.favorite_genre_ids ?? []}
            mode="settings"
          />
          <div className="mt-10">
            <FavoriteMoviesForm
              next="/settings"
              initial={favorites}
              mode="settings"
            />
          </div>
        </Section>

        <Section
          id="privacy"
          title="Profile privacy"
          description="Choose who can see your profile page."
        >
          <VisibilityForm
            current={(me?.visibility ?? "public") as Visibility}
          />
        </Section>

        <Section
          id="theme"
          title="Theme"
          description="Saved in this browser and to your account, so it follows you when you sign in elsewhere."
        >
          <ThemeForm
            account={isTheme(preferences?.theme) ? preferences.theme : null}
          />
        </Section>

        <Section id="people" title="Follow requests and followers">
          <h3 className="mb-3 text-sm font-semibold">Requests</h3>
          {requests.length ? (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {requests.map((row) => (
                <li key={row.follower_id} className="p-4">
                  <FollowRequest
                    userId={row.follower_id}
                    username={names.get(row.follower_id)!}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No pending requests.</p>
          )}
          <h3 className="mb-3 mt-8 text-sm font-semibold">Followers</h3>
          {followers.length ? (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {followers.map((row) => {
                const name = names.get(row.follower_id)!;
                return (
                  <li
                    key={row.follower_id}
                    className="flex items-center justify-between gap-3 p-4"
                  >
                    <Link href={`/u/${name}`} className="font-medium">
                      @{name}
                    </Link>
                    <RemoveFollowerButton
                      userId={row.follower_id}
                      username={name}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">No followers yet.</p>
          )}
        </Section>

        <Section
          id="blocked"
          title="Blocked accounts"
          description="Blocked people can't see your profile or follow you, and you won't see theirs. Unblocking doesn't restore follows."
        >
          {blocked?.length ? (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {blocked.map((person) => (
                <li
                  key={person.id}
                  className="flex items-center justify-between gap-3 p-4"
                >
                  <span className="font-medium">@{person.username}</span>
                  <UnblockButton
                    userId={person.id}
                    username={person.username}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              You haven&apos;t blocked anyone.
            </p>
          )}
        </Section>

        <p className="text-sm text-muted">
          Email, password and sign-out are on your{" "}
          <Link href="/account" className="text-accent underline">
            account page
          </Link>
          .
        </p>

        <Section id="delete-account" title="Delete account">
          <DeleteAccount
            username={username}
            recent={isRecent(authenticatedAt)}
            hasPassword={providers.has("email") || !providers.has("google")}
            hasGoogle={providers.has("google")}
          />
        </Section>
      </div>
    </div>
  );
}
