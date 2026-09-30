import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ListMovies } from "@/components/profiles/list-views";
import { loadList } from "@/lib/profiles/load";
import { accessibleProfile } from "../../access";

export default async function ProfileList({
  params,
}: {
  params: Promise<{ username: string; listId: string }>;
}) {
  const card = await accessibleProfile(params);
  if (!card) return null;
  const { listId } = await params;
  if (!z.uuid().safeParse(listId).success) notFound();
  const result = await loadList(listId);
  // Lists belong to their owner's profile; never show another user's list here.
  if (
    !result ||
    result.list.userId !== card.id ||
    result.list.kind !== "custom"
  )
    notFound();
  return (
    <div>
      <Link
        href={`/u/${card.username}/lists`}
        className="text-sm text-muted hover:text-ink"
      >
        ← All lists
      </Link>
      <h2 className="mt-4 font-display text-2xl">{result.list.name}</h2>
      {result.list.description && (
        <p className="mt-2 max-w-2xl text-sm text-muted">
          {result.list.description}
        </p>
      )}
      <div className="mt-6">
        <ListMovies
          movies={result.movies}
          owner={false}
          listId={listId}
          watchlist={false}
          emptyText="This list is empty."
        />
      </div>
    </div>
  );
}
