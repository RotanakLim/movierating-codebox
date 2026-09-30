import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getPublicConfig: () => ({ url: "x" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));
import {
  loadReplies,
  loadReviewPage,
  loadThreads,
} from "@/lib/reviews/discussion";
import { decodeCursor } from "@/lib/reviews/cursor";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (n: number) =>
  `2026-09-30T10:00:${String(n).padStart(2, "0")}+00:00`;
const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: uuid(n),
  parent_id: null,
  author_username: `fan${n}`,
  author_avatar: null,
  reply_to_username: null,
  body: `Comment ${n}`,
  spoiler: false,
  state: "visible",
  created_at: at(n),
  edited_at: null,
  reply_count: 0,
  is_mine: false,
  ...extra,
});

beforeEach(() => mocks.rpc.mockReset());

describe("loadThreads", () => {
  it("groups replies under their thread and pages replies after the preview", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        row(1, { reply_count: 5 }),
        row(2, { parent_id: uuid(1), reply_to_username: "fan9" }),
        row(3, { parent_id: uuid(1) }),
        row(4, { parent_id: uuid(1) }),
        row(5, {
          state: "deleted",
          author_username: null,
          body: null,
          reply_count: 1,
        }),
        row(6, { parent_id: uuid(5) }),
      ],
      error: null,
    });
    const page = await loadThreads(uuid(99), null);
    expect(mocks.rpc).toHaveBeenCalledWith("review_threads", {
      target: uuid(99),
      page_size: 20,
      reply_limit: 3,
    });
    expect(page.nextCursor).toBeNull();
    const [first, second] = page.threads;
    expect(first.replies.map((reply) => reply.body)).toEqual([
      "Comment 2",
      "Comment 3",
      "Comment 4",
    ]);
    expect(first.replies[0].replyTo).toBe("fan9");
    expect(decodeCursor(first.nextReplyCursor)).toEqual({
      createdAt: at(4),
      id: uuid(4),
    });
    expect(second).toMatchObject({
      state: "deleted",
      author: null,
      body: null,
      replyCount: 1,
      nextReplyCursor: null,
    });
  });
  it("never passes text or authors through for comments that aren't visible", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        row(1, {
          state: "removed",
          body: "leak",
          author_username: "who",
          is_mine: true,
        }),
      ],
      error: null,
    });
    const [thread] = (await loadThreads(uuid(99), null)).threads;
    expect(thread).toMatchObject({ body: null, author: null, mine: false });
  });
  it("continues after a thread cursor and reports the next one", async () => {
    mocks.rpc.mockResolvedValue({
      data: Array.from({ length: 21 }, (_, n) => row(n + 1)),
      error: null,
    });
    const cursor = { createdAt: at(0), id: uuid(0) };
    const page = await loadThreads(uuid(99), cursor);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "review_threads",
      expect.objectContaining({ after_at: at(0), after_id: uuid(0) }),
    );
    expect(page.threads).toHaveLength(20);
    expect(decodeCursor(page.nextCursor)).toEqual({
      createdAt: at(20),
      id: uuid(20),
    });
  });
});

describe("loadReplies and loadReviewPage", () => {
  it("pages replies", async () => {
    mocks.rpc.mockResolvedValue({
      data: Array.from({ length: 21 }, (_, n) =>
        row(n + 1, { parent_id: uuid(0) }),
      ),
      error: null,
    });
    const page = await loadReplies(uuid(0), null);
    expect(page.replies).toHaveLength(20);
    expect(page.nextCursor).not.toBeNull();
  });
  it("maps the review with database counts, or null when unavailable", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: uuid(1),
          user_id: uuid(2),
          username: "author",
          avatar: null,
          movie_id: 603,
          title: "The Matrix",
          poster: null,
          year: 1999,
          score: 9.5,
          note: "Great",
          spoiler: false,
          created_at: "2026-09-30T10:00:00+00:00",
          updated_at: "2026-09-30T12:00:00+00:00",
          like_count: 3,
          liked: true,
          comment_count: 2,
          is_hidden: false,
        },
      ],
      error: null,
    });
    expect(await loadReviewPage(uuid(1))).toMatchObject({
      author: { username: "author" },
      likeCount: 3,
      liked: true,
      commentCount: 2,
      edited: true,
    });
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await loadReviewPage(uuid(1))).toBeNull();
  });
});
