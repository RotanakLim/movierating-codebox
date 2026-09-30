import { ListMovies } from "@/components/profiles/list-views";
import { loadList, watchlistId } from "@/lib/profiles/load";
import { accessibleProfile } from "../access";

export default async function ProfileWatchlist({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const card = await accessibleProfile(params);
  if (!card) return null;
  const id = await watchlistId(card.id);
  const result = id ? await loadList(id) : null;
  return (
    <ListMovies
      movies={result?.movies ?? []}
      owner={false}
      listId={id ?? ""}
      watchlist
      emptyText="Nothing on this watchlist yet."
    />
  );
}
