import Link from "next/link";
import { ListMovies } from "@/components/profiles/list-views";
import {
  loadList,
  requireOnboardedUser,
  watchlistId,
} from "@/lib/profiles/load";

export default async function MyWatchlist() {
  const { user } = await requireOnboardedUser("/me/watchlist");
  const id = await watchlistId(user.id);
  const result = id ? await loadList(id) : null;
  return (
    <div>
      <p className="mb-6 text-sm text-muted">
        Add movies from any movie page. Logging a watch removes it from here.{" "}
        <Link href="/discover" className="text-accent underline">
          Discover movies
        </Link>
      </p>
      <ListMovies
        movies={result?.movies ?? []}
        owner
        listId={id ?? ""}
        watchlist
        emptyText="Your watchlist is empty."
      />
    </div>
  );
}
