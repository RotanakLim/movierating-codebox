import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ListMovies } from "@/components/profiles/list-views";
import {
  DeleteListButton,
  ListForm,
} from "@/components/profiles/owner-controls";
import { loadList, requireOnboardedUser } from "@/lib/profiles/load";

export default async function MyList({
  params,
}: {
  params: Promise<{ listId: string }>;
}) {
  const { listId } = await params;
  const { user } = await requireOnboardedUser(`/me/lists/${listId}`);
  if (!z.uuid().safeParse(listId).success) notFound();
  const result = await loadList(listId);
  if (
    !result ||
    result.list.userId !== user.id ||
    result.list.kind !== "custom"
  )
    notFound();
  const { list, movies } = result;
  return (
    <div>
      <Link href="/me/lists" className="text-sm text-muted hover:text-ink">
        ← All lists
      </Link>
      <div className="mt-4 grid gap-10 lg:grid-cols-[1fr_320px]">
        <div>
          <h2 className="font-display text-2xl">{list.name}</h2>
          {list.description && (
            <p className="mt-2 text-sm text-muted">{list.description}</p>
          )}
          <p className="mt-2 text-xs text-muted">
            Add movies from any movie page with “Add to list”.
          </p>
          <div className="mt-6">
            <ListMovies
              movies={movies}
              owner
              listId={list.id}
              watchlist={false}
              emptyText="This list is empty."
            />
          </div>
        </div>
        <div className="space-y-6 rounded-2xl border border-line p-5">
          <ListForm list={list} />
          <DeleteListButton listId={list.id} name={list.name} />
        </div>
      </div>
    </div>
  );
}
