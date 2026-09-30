import type { Database } from "@/lib/supabase/database.types";

export type Visibility = Database["public"]["Enums"]["profile_visibility"];
export type FollowStatus = Database["public"]["Enums"]["follow_status"];

export type ProfileCard = {
  id: string;
  username: string;
  avatar: string | null;
  /** null when the owner blocked the viewer ("unavailable"). */
  visibility: Visibility | null;
  canView: boolean;
  relationship: "self" | "blocked" | "unavailable" | "none";
  /** The viewer's own follow of this profile, if any. */
  followStatus: FollowStatus | null;
};

export const COLLECTION_SORTS = [
  "rating-desc",
  "rating-asc",
  "title",
  "latest-watch",
] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];
export const SORT_LABELS: Record<CollectionSort, string> = {
  "rating-desc": "Highest rated",
  "rating-asc": "Lowest rated",
  title: "Title A–Z",
  "latest-watch": "Latest watch",
};
export const COLLECTION_PAGE_SIZE = 48;
export const DIARY_PAGE_SIZE = 50;

export type CollectionQuery = {
  sort: CollectionSort;
  rated: boolean;
  watched: boolean;
  page: number;
};

/** Parse ?sort=&rated=1&watched=1&page= safely; unknown values fall back to defaults. */
export function collectionQuery(params: Record<string, string | undefined>) {
  const sort = COLLECTION_SORTS.find((value) => value === params.sort);
  const page = Number(params.page);
  return {
    sort: sort ?? "rating-desc",
    rated: params.rated === "1",
    watched: params.watched === "1",
    page: Number.isInteger(page) && page > 0 && page <= 1000 ? page : 1,
  } satisfies CollectionQuery;
}
export function pageNumber(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 && page <= 1000 ? page : 1;
}

export type CollectionRow = {
  movieId: number;
  title: string;
  poster: string | null;
  year: number | null;
  score: number | null;
  lastWatched: string | null;
  watchCount: number;
};
export type DiaryRow = {
  id: string;
  movieId: number;
  title: string;
  year: number | null;
  score: number | null;
  note: string | null;
  spoiler: boolean;
  watchedDate: string | null;
};
export type ListSummary = {
  id: string;
  kind: "watchlist" | "custom";
  name: string;
  description: string | null;
  count: number;
};
export type ListedMovie = {
  movieId: number;
  title: string;
  poster: string | null;
  year: number | null;
  addedAt: string;
};

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: "Public",
  followers: "Followers only",
  friends: "Friends only",
  private: "Private",
};
