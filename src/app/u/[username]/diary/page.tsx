import { DiaryView } from "@/components/profiles/diary-view";
import { loadDiary } from "@/lib/profiles/load";
import { pageNumber } from "@/lib/profiles/types";
import { accessibleProfile } from "../access";

export default async function ProfileDiary({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const card = await accessibleProfile(params);
  if (!card) return null;
  const page = pageNumber((await searchParams).page);
  const { rows, hasMore } = await loadDiary(card.id, page);
  return (
    <DiaryView
      rows={rows}
      owner={false}
      basePath={`/u/${card.username}/diary`}
      page={page}
      hasMore={hasMore}
    />
  );
}
