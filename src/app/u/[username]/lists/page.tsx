import { ListsIndex } from "@/components/profiles/list-views";
import { loadLists } from "@/lib/profiles/load";
import { accessibleProfile } from "../access";

export default async function ProfileLists({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const card = await accessibleProfile(params);
  if (!card) return null;
  return (
    <ListsIndex
      lists={await loadLists(card.id)}
      basePath={`/u/${card.username}/lists`}
    />
  );
}
