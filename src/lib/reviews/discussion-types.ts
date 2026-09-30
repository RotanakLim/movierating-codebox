export const THREAD_PAGE_SIZE = 20;
export const REPLY_PREVIEW = 3;
export const REPLY_PAGE_SIZE = 20;
export const COMMENT_MAX = 2000;

/** How a comment appears to this viewer; only "visible" carries text or author. */
export type CommentState = "visible" | "deleted" | "removed" | "blocked";

export type DiscussionComment = {
  id: string;
  threadId: string | null;
  state: CommentState;
  author: { username: string; avatar: string | null } | null;
  replyTo: string | null;
  /** Whole-text spoiler: rendered only after an explicit reveal. */
  body: string | null;
  spoiler: boolean;
  createdAt: string;
  edited: boolean;
  mine: boolean;
};

export type DiscussionThread = DiscussionComment & {
  replies: DiscussionComment[];
  replyCount: number;
  /** Cursor for the next page of replies, or null when all are loaded. */
  nextReplyCursor: string | null;
};

export type ThreadPage = {
  threads: DiscussionThread[];
  nextCursor: string | null;
};
export type ReplyPage = {
  replies: DiscussionComment[];
  nextCursor: string | null;
};

export type ReviewPageData = {
  id: string;
  author: { id: string; username: string; avatar: string | null };
  movie: {
    id: number;
    title: string;
    poster: string | null;
    year: number | null;
  };
  score: number | null;
  note: string | null;
  spoiler: boolean;
  createdAt: string;
  edited: boolean;
  likeCount: number;
  liked: boolean;
  commentCount: number;
  hidden: boolean;
};
