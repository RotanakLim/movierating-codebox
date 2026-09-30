import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contributor: vi.fn(),
  user: vi.fn(),
  rpc: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({ getUser: mocks.user }));
vi.mock("@/lib/auth/contributor", () => ({
  requireContributor: mocks.contributor,
}));
const client = {
  rpc: mocks.rpc,
  from: () => ({ insert: mocks.insert }),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
import {
  addComment,
  deleteComment,
  editComment,
  setLike,
} from "@/app/reviews/actions";
import { reportComment } from "@/app/profiles/actions";

const REVIEW = "10000000-0000-4000-8000-000000000001";
const COMMENT = "20000000-0000-4000-8000-000000000002";

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.contributor.mockResolvedValue({
    ok: true,
    user: { id: "me" },
    supabase: client,
  });
  mocks.user.mockResolvedValue({ id: "me" });
});

describe("likes", () => {
  it("returns the database's state and count", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ is_liked: true, like_count: 4 }],
      error: null,
    });
    expect(await setLike({ reviewId: REVIEW, liked: true })).toEqual({
      ok: true,
      liked: true,
      count: 4,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("set_review_like", {
      target: REVIEW,
      should_like: true,
    });
  });
  it("explains refusals: own review, limit, bad input", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023" } });
    expect(await setLike({ reviewId: REVIEW, liked: true })).toEqual({
      ok: false,
      error: "You can't like this review.",
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "PT429", details: "300" },
    });
    expect(await setLike({ reviewId: REVIEW, liked: false })).toEqual({
      ok: false,
      error: "You've changed a lot of likes recently. Try again in 5 minutes.",
    });
    expect((await setLike({ reviewId: "x", liked: true })).ok).toBe(false);
  });
  it("requires a contributor", async () => {
    mocks.contributor.mockResolvedValue({ ok: false, error: "Sign in." });
    expect(await setLike({ reviewId: REVIEW, liked: true })).toEqual({
      ok: false,
      error: "Sign in.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("comments", () => {
  it("trims text and passes the reply target", async () => {
    mocks.rpc.mockResolvedValue({ data: COMMENT, error: null });
    expect(
      await addComment({
        reviewId: REVIEW,
        body: "  Great point\r\n  ",
        spoiler: true,
        replyTo: COMMENT,
      }),
    ).toEqual({ ok: true, id: COMMENT });
    expect(mocks.rpc).toHaveBeenCalledWith("add_review_comment", {
      target: REVIEW,
      comment_text: "Great point",
      is_spoiler: true,
      reply_to: COMMENT,
    });
  });
  it("rejects empty and over-long text before the database", async () => {
    expect(
      await addComment({
        reviewId: REVIEW,
        body: "   ",
        spoiler: false,
        replyTo: null,
      }),
    ).toEqual({ ok: false, error: "Write something first." });
    expect(
      await addComment({
        reviewId: REVIEW,
        body: "x".repeat(2001),
        spoiler: false,
        replyTo: null,
      }),
    ).toEqual({ ok: false, error: "Comments can be up to 2,000 characters." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("maps limits and blocks", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "PT429", details: "90" },
    });
    expect(
      (
        await addComment({
          reviewId: REVIEW,
          body: "Hi",
          spoiler: false,
          replyTo: null,
        })
      ).ok,
    ).toBe(false);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(
      await addComment({
        reviewId: REVIEW,
        body: "Hi",
        spoiler: false,
        replyTo: COMMENT,
      }),
    ).toEqual({ ok: false, error: "You can't do that here." });
  });
  it("edits and deletes through the owner-checked functions", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(
      await editComment({ commentId: COMMENT, body: " New ", spoiler: false }),
    ).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("edit_review_comment", {
      target: COMMENT,
      comment_text: "New",
      is_spoiler: false,
    });
    expect(await deleteComment({ commentId: COMMENT })).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith("delete_review_comment", {
      target: COMMENT,
    });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await deleteComment({ commentId: COMMENT })).ok).toBe(false);
  });
});

describe("comment reports", () => {
  it("reports by comment ID only; the database records the author", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    mocks.insert.mockResolvedValue({ error: null });
    const result = await reportComment({
      commentId: COMMENT,
      reason: "harassment",
      details: "",
    });
    expect(result).toMatchObject({ ok: true });
    expect(mocks.insert).toHaveBeenCalledWith({
      id: expect.any(String),
      target_comment_id: COMMENT,
      reason: "harassment",
      details: null,
    });
    mocks.insert.mockResolvedValue({ error: { code: "23505" } });
    expect(
      await reportComment({ commentId: COMMENT, reason: "spam", details: "" }),
    ).toEqual({
      ok: false,
      error: "You already have an open report about this comment.",
    });
  });
});
