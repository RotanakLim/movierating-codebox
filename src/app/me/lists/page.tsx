import { ListsIndex } from "@/components/profiles/list-views";
import { ListForm } from "@/components/profiles/owner-controls";
import { loadLists, requireOnboardedUser } from "@/lib/profiles/load";

export default async function MyLists() {
  const { user } = await requireOnboardedUser("/me/lists");
  const lists = await loadLists(user.id);
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
      <ListsIndex lists={lists} basePath="/me/lists" />
      <div className="rounded-2xl border border-line p-5">
        <h2 className="mb-4 font-semibold">Create a list</h2>
        <ListForm />
      </div>
    </div>
  );
}
