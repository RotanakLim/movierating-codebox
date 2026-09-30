import "server-only";
import { getPublicConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { encodeCursor, type ReviewCursor } from "./cursor";
import {
  REPLY_PAGE_SIZE,
  REPLY_PREVIEW,
  THREAD_PAGE_SIZE,
  type CommentState,
  type DiscussionComment,
  type DiscussionThread,
  type ReplyPage,
  type ReviewPageData,
  type ThreadPage,
} from "./discussion-types";

type Row = {
  id: string;
  parent_id: string | null;
  author_username: string | null;
  author_avatar: string | null;
  reply_to_username: string | null;
  body: string | null;
  spoiler: boolean;
  state: string;
  created_at: string;
  edited_at: string | null;
  reply_count: number;
  is_mine: boolean;
};

const STATES = new Set(["visible", "deleted", "removed", "blocked"]);

function comment(row: Row): DiscussionComment {
  const state = (STATES.has(row.state) ? row.state : "removed") as CommentState;
  const visible = state === "visible";
  return {
    id: row.id,
    threadId: row.parent_id,
    state,
    author:
      visible && row.author_username
        ? { username: row.author_username, avatar: row.author_avatar }
        : null,
    replyTo: visible ? row.reply_to_username : null,
    body: visible ? row.body : null,
    spoiler: visible && row.spoiler,
    createdAt: row.created_at,
    edited: visible && !!row.edited_at,
    mine: visible && row.is_mine,
  };
}

/** The review and its database counts, or null if the viewer may not see it. */
export async function loadReviewPage(
  id: string,
): Promise<ReviewPageData | null> {
  if (!getPublicConfig()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_details", { target: id });
  const row = data?.[0];
  if (error || !row) return null;
  return {
    id: row.id,
    author: { id: row.user_id, username: row.username, avatar: row.avatar },
    movie: {
      id: row.movie_id,
      title: row.title,
      poster: row.poster,
      year: row.year,
    },
    score: row.score,
    note: row.note,
    spoiler: row.spoiler,
    createdAt: row.created_at,
    edited: Date.parse(row.updated_at) - Date.parse(row.created_at) > 60_000,
    likeCount: row.like_count,
    liked: row.liked,
    commentCount: row.comment_count,
    hidden: row.is_hidden,
  };
}

/**
 * One page of threads (oldest first), each with its first replies. The database
 * decides what each viewer may see; hidden text and authors never reach here.
 */
export async function loadThreads(
  reviewId: string,
  cursor: ReviewCursor | null,
): Promise<ThreadPage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_threads", {
    target: reviewId,
    ...(cursor ? { after_at: cursor.createdAt, after_id: cursor.id } : {}),
    page_size: THREAD_PAGE_SIZE,
    reply_limit: REPLY_PREVIEW,
  });
  if (error) throw new Error("The discussion is unavailable right now.");
  const rows = (data ?? []) as Row[];
  const tops = rows.filter((row) => row.parent_id === null);
  const shown = tops.slice(0, THREAD_PAGE_SIZE);
  const threads: DiscussionThread[] = shown.map((top) => {
    const replies = rows.filter((row) => row.parent_id === top.id).map(comment);
    const last = replies.at(-1);
    return {
      ...comment(top),
      replies,
      replyCount: top.reply_count,
      nextReplyCursor:
        top.reply_count > replies.length && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  });
  const lastTop = shown.at(-1);
  return {
    threads,
    nextCursor:
      tops.length > THREAD_PAGE_SIZE && lastTop
        ? encodeCursor({ createdAt: lastTop.created_at, id: lastTop.id })
        : null,
  };
}

/** More replies in one thread, oldest first. */
export async function loadReplies(
  threadId: string,
  cursor: ReviewCursor | null,
): Promise<ReplyPage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_replies", {
    thread: threadId,
    ...(cursor ? { after_at: cursor.createdAt, after_id: cursor.id } : {}),
    page_size: REPLY_PAGE_SIZE,
  });
  if (error) throw new Error("Replies are unavailable right now.");
  const rows = (data ?? []) as Row[];
  const replies = rows.slice(0, REPLY_PAGE_SIZE).map(comment);
  const last = replies.at(-1);
  return {
    replies,
    nextCursor:
      rows.length > REPLY_PAGE_SIZE && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}
