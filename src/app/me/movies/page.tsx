import { CollectionView } from "@/components/profiles/collection-view";
import { loadCollection, requireOnboardedUser } from "@/lib/profiles/load";
import { collectionQuery } from "@/lib/profiles/types";

export default async function MyMovies({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user } = await requireOnboardedUser("/me/movies");
  const query = collectionQuery(await searchParams);
  const { rows, hasMore } = await loadCollection(user.id, query);
  return (
    <CollectionView
      rows={rows}
      query={query}
      basePath="/me/movies"
      hasMore={hasMore}
      emptyText="Rate, review or log a movie and it will appear here."
    />
  );
}
