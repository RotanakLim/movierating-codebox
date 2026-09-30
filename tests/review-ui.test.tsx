// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  setLike: vi.fn(),
  addComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
  deleteEntry: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/app/reviews/actions", () => ({
  setLike: mocks.setLike,
  addComment: mocks.addComment,
  editComment: mocks.editComment,
  deleteComment: mocks.deleteComment,
}));
vi.mock("@/app/entries/actions", () => ({ deleteEntry: mocks.deleteEntry }));
vi.mock("@/app/profiles/actions", () => ({
  block: vi.fn(),
  unblock: vi.fn(),
  reportUser: vi.fn(),
  reportReview: vi.fn(),
  reportComment: vi.fn(),
}));
import { LikeButton } from "@/components/reviews/like-button";
import { Discussion } from "@/components/reviews/discussion";
import { DeleteReview } from "@/components/reviews/review-page-controls";
import type {
  DiscussionComment,
  DiscussionThread,
} from "@/lib/reviews/discussion-types";

const comment = (
  id: string,
  extra: Partial<DiscussionComment> = {},
): DiscussionComment => ({
  id,
  threadId: null,
  state: "visible",
  author: { username: `user_${id}`, avatar: null },
  replyTo: null,
  body: `Text ${id}`,
  spoiler: false,
  createdAt: "2026-09-30T10:00:00Z",
  edited: false,
  mine: false,
  ...extra,
});
const thread = (
  id: string,
  replies: DiscussionComment[] = [],
  extra: Partial<DiscussionThread> = {},
): DiscussionThread => ({
  ...comment(id),
  replies,
  replyCount: replies.length,
  nextReplyCursor: null,
  ...extra,
});
const viewer = { username: "me", avatar: null };
const fetchMock = vi.fn();
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<LikeButton>", () => {
  it("updates at once, then settles on the database's count", async () => {
    let resolve!: (value: unknown) => void;
    mocks.setLike.mockReturnValue(new Promise((done) => (resolve = done)));
    render(
      <LikeButton
        reviewId="r1"
        initialLiked={false}
        initialCount={2}
        mode="can-like"
        signInHref="/s"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Like/ }));
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button").textContent).toContain("3");
    await act(async () => resolve({ ok: true, liked: true, count: 5 }));
    expect(screen.getByRole("button").textContent).toContain("5");
  });
  it("rolls back and explains when the database refuses", async () => {
    mocks.setLike.mockResolvedValue({
      ok: false,
      error: "You've changed a lot of likes recently. Try again in 5 minutes.",
    });
    render(
      <LikeButton
        reviewId="r1"
        initialLiked={true}
        initialCount={4}
        mode="can-like"
        signInHref="/s"
      />,
    );
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(mocks.setLike).toHaveBeenCalledWith({
      reviewId: "r1",
      liked: false,
    });
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button").textContent).toContain("4");
    expect(screen.getByRole("alert").textContent).toContain("5 minutes");
  });
  it("is a plain count for the author and a sign-in link for guests", () => {
    const { unmount } = render(
      <LikeButton
        reviewId="r1"
        initialLiked={false}
        initialCount={1}
        mode="own"
        signInHref="/s"
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.body.textContent).toContain("1 like");
    unmount();
    render(
      <LikeButton
        reviewId="r1"
        initialLiked={false}
        initialCount={0}
        mode="guest"
        signInHref="/sign"
      />,
    );
    expect(
      screen
        .getByRole("link", { name: "Sign in to like" })
        .getAttribute("href"),
    ).toBe("/sign");
  });
});

describe("<Discussion>", () => {
  it("keeps spoiler comments out of the page until revealed", () => {
    render(
      <Discussion
        reviewId="r1"
        initial={{
          threads: [thread("a", [], { body: "The twist", spoiler: true })],
          nextCursor: null,
        }}
        viewer={null}
        signInHref="/s"
      />,
    );
    expect(document.body.textContent).not.toContain("The twist");
    fireEvent.click(screen.getByRole("button", { name: "Show comment" }));
    expect(document.body.textContent).toContain("The twist");
  });
  it("shows [deleted] for a removed comment that still has replies", () => {
    render(
      <Discussion
        reviewId="r1"
        initial={{
          threads: [
            thread("a", [comment("b", { threadId: "a" })], {
              state: "deleted",
              author: null,
              body: null,
            }),
          ],
          nextCursor: null,
        }}
        viewer={null}
        signInHref="/s"
      />,
    );
    expect(document.body.textContent).toContain("[deleted]");
    expect(document.body.textContent).toContain("Text b");
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe("/s");
  });
  it("replies to a reply in the same thread with 'replying to'", async () => {
    mocks.addComment.mockResolvedValue({ ok: true, id: "new" });
    render(
      <Discussion
        reviewId="r1"
        initial={{
          threads: [thread("a", [comment("b", { threadId: "a" })])],
          nextCursor: null,
        }}
        viewer={viewer}
        signInHref="/s"
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[1]);
    expect(document.body.textContent).toContain("Replying to @user_b");
    fireEvent.change(screen.getAllByRole("textbox").at(-1)!, {
      target: { value: "Good point" },
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Post reply" })),
    );
    expect(mocks.addComment).toHaveBeenCalledWith({
      reviewId: "r1",
      body: "Good point",
      spoiler: false,
      replyTo: "b",
    });
    const replies = screen.getAllByRole("list")[1];
    expect(within(replies).getByText("Good point")).toBeTruthy();
    expect(within(replies).getByText("replying to @user_b")).toBeTruthy();
  });
  it("lets owners edit (marked edited) and delete with confirmation", async () => {
    mocks.editComment.mockResolvedValue({ ok: true });
    mocks.deleteComment.mockResolvedValue({ ok: true });
    render(
      <Discussion
        reviewId="r1"
        initial={{
          threads: [
            thread("a", [comment("b", { threadId: "a" })], { mine: true }),
          ],
          nextCursor: null,
        }}
        viewer={viewer}
        signInHref="/s"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getAllByRole("textbox")[1], {
      target: { value: "Changed" },
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Save changes" })),
    );
    expect(document.body.textContent).toContain("Changed");
    expect(document.body.textContent).toContain("edited");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      screen.getByRole("group", { name: "Delete this comment" }).textContent,
    ).toContain("[deleted]");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Delete comment" })),
    );
    expect(mocks.deleteComment).toHaveBeenCalledWith({ commentId: "a" });
    expect(document.body.textContent).toContain("[deleted]");
    expect(document.body.textContent).toContain("Text b");
  });
  it("offers Report (not Edit/Delete) on other people's comments", () => {
    render(
      <Discussion
        reviewId="r1"
        initial={{ threads: [thread("a")], nextCursor: null }}
        viewer={viewer}
        signInHref="/s"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(document.body.textContent).toContain(
      "Report this comment by @user_a",
    );
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
  it("loads more threads and replies by cursor", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          replies: [comment("c", { threadId: "a" })],
          nextCursor: null,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ threads: [thread("z")], nextCursor: null }),
      );
    render(
      <Discussion
        reviewId="r1"
        initial={{
          threads: [
            thread("a", [comment("b", { threadId: "a" })], {
              replyCount: 2,
              nextReplyCursor: "rc",
            }),
          ],
          nextCursor: "tc",
        }}
        viewer={null}
        signInHref="/s"
      />,
    );
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Show more replies (1)" }),
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reviews/r1/comments/replies?thread=a&cursor=rc",
    );
    expect(document.body.textContent).toContain("Text c");
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Load more comments" }),
      ),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/reviews/r1/comments?cursor=tc",
    );
    expect(document.body.textContent).toContain("Text z");
  });
});

describe("<DeleteReview>", () => {
  it("confirms that likes and the discussion go too", async () => {
    mocks.deleteEntry.mockResolvedValue({ ok: true });
    render(
      <DeleteReview
        reviewId="r1"
        movieId={603}
        likeCount={3}
        commentCount={1}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete review" }));
    const confirm = screen.getByRole("group", { name: "Delete this review" });
    expect(confirm.textContent).toContain("3 likes");
    expect(confirm.textContent).toContain("1 comment");
    await act(async () =>
      fireEvent.click(
        within(confirm).getByRole("button", { name: "Delete review" }),
      ),
    );
    expect(mocks.deleteEntry).toHaveBeenCalledWith({ id: "r1" });
    expect(mocks.push).toHaveBeenCalledWith("/movies/603");
  });
});
