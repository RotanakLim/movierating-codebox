import { CollectionView } from "@/components/profiles/collection-view";
import { loadCollection } from "@/lib/profiles/load";
import { collectionQuery } from "@/lib/profiles/types";
import { accessibleProfile } from "./access";

export default async function ProfileMovies({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const card = await accessibleProfile(params);
  if (!card) return null;
  const query = collectionQuery(await searchParams);
  const { rows, hasMore } = await loadCollection(card.id, query);
  return (
    <CollectionView
      rows={rows}
      query={query}
      basePath={`/u/${card.username}`}
      hasMore={hasMore}
      emptyText="No movies in this collection yet."
    />
  );
}
