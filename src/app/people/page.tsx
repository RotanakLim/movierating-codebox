import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { readUsername } from "@/lib/onboarding/profile";
import { findPeople, peopleQuery, type Person } from "@/lib/people/load";
import { avatarUrl } from "@/lib/profiles/avatar-url";
import { VISIBILITY_LABELS } from "@/lib/profiles/types";
import { Avatar } from "@/components/avatar";
import { FollowButton } from "@/components/profiles/follow-button";

export const metadata: Metadata = { title: "People" };

function PersonRow({
  person,
  canFollow,
}: {
  person: Person;
  canFollow: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-4 p-4">
      <Link
        href={`/u/${person.username}`}
        className="flex min-w-0 items-center gap-3 hover:text-accent"
      >
        <Avatar src={avatarUrl(person.avatar)} size={44} />
        <span className="min-w-0">
          <span className="block truncate font-semibold">
            {person.displayName ?? `@${person.username}`}
          </span>
          <span className="block truncate text-xs text-muted">
            {person.displayName && `@${person.username} · `}
            {VISIBILITY_LABELS[person.visibility]}
          </span>
        </span>
      </Link>
      {canFollow ? (
        <FollowButton
          userId={person.id}
          username={person.username}
          visibility={person.visibility}
          initial={
            person.followStatus === "declined" ? null : person.followStatus
          }
        />
      ) : null}
    </li>
  );
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { term, valid } = peopleQuery((await searchParams).q);
  const user = await getUser();
  const canFollow = Boolean(
    user?.email_confirmed_at &&
    (await readUsername(await createClient(), user.id)),
  );
  let people: Person[] = [];
  let failed = false;
  if (valid)
    try {
      people = await findPeople(term);
    } catch {
      failed = true;
    }

  return (
    <section className="mx-auto max-w-2xl py-10 sm:py-14">
      <h1 className="font-display text-4xl">People</h1>
      <p className="mt-3 text-muted">
        Find friends by username, or browse public profiles.
      </p>
      <form action="/people" role="search" className="mt-6">
        <label htmlFor="people-search">Username</label>
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            id="people-search"
            name="q"
            type="search"
            defaultValue={term}
            placeholder="e.g. film_fan"
            maxLength={25}
            autoCapitalize="none"
            spellCheck={false}
            className="pl-10"
          />
        </div>
      </form>
      {!user && (
        <p className="mt-4 text-sm text-muted">
          <Link
            href="/auth/sign-in?next=%2Fpeople"
            className="text-accent underline"
          >
            Sign in
          </Link>{" "}
          to follow people.
        </p>
      )}

      <h2 className="mt-10 text-lg font-semibold">
        {term
          ? `Usernames starting with “${term}”`
          : "Recently active public profiles"}
      </h2>
      {!valid ? (
        <p role="alert" className="mt-4 text-sm text-muted">
          Usernames use only lowercase letters, numbers and underscores.
        </p>
      ) : failed ? (
        <p role="alert" className="mt-4 text-sm text-muted">
          People search is unavailable right now. Please try again.
        </p>
      ) : people.length ? (
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
          {people.map((person) => (
            <PersonRow key={person.id} person={person} canFollow={canFollow} />
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted">
          {term
            ? "No one found with that username."
            : "No public profiles yet."}
        </p>
      )}
    </section>
  );
}
