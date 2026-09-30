import { DiaryView } from "@/components/profiles/diary-view";
import { loadDiary, requireOnboardedUser } from "@/lib/profiles/load";
import { pageNumber } from "@/lib/profiles/types";

export default async function MyDiary({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { user } = await requireOnboardedUser("/me/diary");
  const page = pageNumber((await searchParams).page);
  const { rows, hasMore } = await loadDiary(user.id, page);
  return (
    <DiaryView
      rows={rows}
      owner
      basePath="/me/diary"
      page={page}
      hasMore={hasMore}
    />
  );
}
