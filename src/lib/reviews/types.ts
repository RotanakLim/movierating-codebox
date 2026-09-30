export type Review = {
  id: string;
  author: { username: string; avatar: string | null };
  score: number | null;
  /** Review text; for spoiler reviews it is rendered only after an explicit reveal. */
  note: string | null;
  spoiler: boolean;
  createdAt: string;
  edited: boolean;
};

export type ReviewPage = { reviews: Review[]; nextCursor: string | null };
