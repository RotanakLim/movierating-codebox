export const FEED_TABS = ["following", "community"] as const;
export type FeedTab = (typeof FEED_TABS)[number];
export const FEED_PAGE_SIZE = 20;

/**
 * One feed card. Built only from activity_feed's safe columns: never review text,
 * spoiler flags or watch dates.
 */
export type FeedItem = {
  id: string;
  /** The entry behind the card; ratings and reviews have a review page. */
  entryId: string;
  kind: "rated" | "reviewed" | "watched";
  createdAt: string;
  user: { username: string; avatar: string | null };
  movie: {
    id: number;
    title: string;
    poster: string | null;
    year: number | null;
  };
  score: number | null;
};

export type FeedPage = { items: FeedItem[]; nextCursor: string | null };

export function feedTab(value: unknown): FeedTab | null {
  return FEED_TABS.includes(value as FeedTab) ? (value as FeedTab) : null;
}
