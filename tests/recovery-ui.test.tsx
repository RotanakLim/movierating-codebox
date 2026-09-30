// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  refresh: vi.fn(),
  pathname: "/",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
  usePathname: () => mocks.pathname,
}));
vi.mock("@/app/reviews/actions", () => ({
  setLike: vi.fn(),
  addComment: mocks.addComment,
  editComment: vi.fn(),
  deleteComment: vi.fn(),
}));
vi.mock("@/app/profiles/actions", () => ({
  block: vi.fn(),
  unblock: vi.fn(),
  reportUser: vi.fn(),
  reportReview: vi.fn(),
  reportComment: vi.fn(),
}));
import { getJson, RequestError } from "@/lib/http/get-json";
import {
  clearAllDrafts,
  commentDraftKey,
  loadCommentDraft,
  saveCommentDraft,
} from "@/lib/entries/drafts";
import { Discussion } from "@/components/reviews/discussion";
import { FeedList } from "@/components/feed/feed-list";
import { ConfirmAction } from "@/components/confirm-action";
import { BlockConfirm } from "@/components/safety/safety-controls";
import type { FeedItem } from "@/lib/feed/types";

const fetchMock = vi.fn();
beforeEach(() => {
  mocks.addComment.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("getJson", () => {
  it("returns the body on success", async () => {
    fetchMock.mockResolvedValue(json(200, { items: [1] }));
    await expect(getJson("/api/x", "Fallback")).resolves.toEqual({
      items: [1],
    });
  });
  it("uses the route's error text", async () => {
    fetchMock.mockResolvedValue(json(503, { error: "Feed is down." }));
    await expect(getJson("/api/x", "Fallback")).rejects.toMatchObject({
      message: "Feed is down.",
      status: 503,
    });
  });
  it("never shows a parser error for a non-JSON error page", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>Bad gateway</html>", { status: 502 }),
    );
    await expect(getJson("/api/x", "Fallback")).rejects.toMatchObject({
      message: "Fallback",
    });
  });
  it("says so when offline", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(getJson("/api/x", "Fallback")).rejects.toMatchObject({
      message: expect.stringMatching(/offline/),
      status: 0,
    });
  });
  it("lets a cancelled request through as an abort, not 'offline'", async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    const failure = await getJson(
      "/api/x",
      "Fallback",
      controller.signal,
    ).catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(RequestError);
  });
  it("marks an expired session", async () => {
    fetchMock.mockResolvedValue(json(401, { error: "Sign in." }));
    const failure = await getJson("/api/x", "Fallback").catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(RequestError);
    expect((failure as RequestError).signedOut).toBe(true);
  });
});

describe("comment drafts", () => {
  it("are scoped to account, review and slot, and cleared on sign-out", () => {
    const key = commentDraftKey("me", "r1", "new");
    saveCommentDraft(key, { body: "Hello", spoiler: true });
    expect(loadCommentDraft(key)).toEqual({ body: "Hello", spoiler: true });
    expect(loadCommentDraft(commentDraftKey("other", "r1", "new"))).toBeNull();
    expect(loadCommentDraft(commentDraftKey("me", "r1", "thread"))).toBeNull();
    saveCommentDraft(key, { body: "   ", spoiler: false });
    expect(loadCommentDraft(key)).toBeNull();
    saveCommentDraft(key, { body: "Again", spoiler: false });
    clearAllDrafts();
    expect(loadCommentDraft(key)).toBeNull();
  });
  it("ignore malformed storage", () => {
    sessionStorage.setItem(commentDraftKey("me", "r1", "new"), "{nope");
    expect(loadCommentDraft(commentDraftKey("me", "r1", "new"))).toBeNull();
  });
});

describe("<Discussion> drafts", () => {
  const props = {
    reviewId: "r1",
    initial: { threads: [], nextCursor: null },
    viewer: { username: "me", avatar: null },
    signInHref: "/auth/sign-in?next=%2Freviews%2Fr1",
  };
  it("restores an unsent comment and offers sign-in when the session ended", async () => {
    saveCommentDraft(commentDraftKey("me", "r1", "new"), {
      body: "Kept for later",
      spoiler: true,
    });
    render(<Discussion {...props} />);
    const box = screen.getByLabelText("Post comment") as HTMLTextAreaElement;
    expect(box.value).toBe("Kept for later");
    expect(
      (screen.getByLabelText("Contains spoilers") as HTMLInputElement).checked,
    ).toBe(true);

    mocks.addComment.mockResolvedValue({
      ok: false,
      error: "Sign in to continue.",
      code: "SIGN_IN_REQUIRED",
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "your text will be here when you come back",
    );
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe(props.signInHref);
    expect(box.value).toBe("Kept for later");
    expect(loadCommentDraft(commentDraftKey("me", "r1", "new"))?.body).toBe(
      "Kept for later",
    );
  });
  it("clears the draft once the comment is posted", async () => {
    render(<Discussion {...props} />);
    fireEvent.change(screen.getByLabelText("Post comment"), {
      target: { value: "Posted" },
    });
    expect(loadCommentDraft(commentDraftKey("me", "r1", "new"))?.body).toBe(
      "Posted",
    );
    mocks.addComment.mockResolvedValue({ ok: true, id: "c1" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    });
    expect(loadCommentDraft(commentDraftKey("me", "r1", "new"))).toBeNull();
  });
});

describe("<FeedList> failures", () => {
  const item: FeedItem = {
    id: "a1",
    entryId: "e1",
    kind: "rated",
    createdAt: "2026-09-30T10:00:00Z",
    user: { username: "someone", avatar: null },
    movie: { id: 1, title: "Kept", poster: null, year: 2020 },
    score: 8,
  };
  it("keeps loaded items and offers sign-in when the session ended", async () => {
    mocks.pathname = "/";
    window.history.replaceState(null, "", "/?tab=following");
    fetchMock.mockResolvedValue(json(401, { error: "Sign in." }));
    render(
      <FeedList
        tab="following"
        initial={{ items: [item], nextCursor: "c" }}
        emptyText="Nothing"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    });
    expect(screen.getByText("Kept")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Your session has ended",
    );
    // The query string survives, so the tab comes back after signing in.
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe("/auth/sign-in?next=%2F%3Ftab%3Dfollowing");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("focus for inline confirmations", () => {
  it("ConfirmAction moves focus in and back out on Escape", async () => {
    render(
      <ConfirmAction
        label="Delete"
        confirmLabel="Delete it"
        question="Delete this?"
        action={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Delete" });
    trigger.focus();
    await act(async () => fireEvent.click(trigger));
    const confirm = screen.getByRole("button", { name: "Delete it" });
    expect(document.activeElement).toBe(confirm);
    await act(async () => fireEvent.keyDown(confirm, { key: "Escape" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Delete" }),
    );
  });
  it("BlockConfirm returns focus to its opener, also under StrictMode", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open block
          </button>
          {open && (
            <BlockConfirm
              username="x"
              pending={false}
              onConfirm={vi.fn()}
              onCancel={() => setOpen(false)}
            />
          )}
        </>
      );
    }
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    const opener = screen.getByRole("button", { name: "Open block" });
    opener.focus();
    await act(async () => fireEvent.click(opener));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Block @x" }),
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Cancel" })),
    );
    expect(document.activeElement).toBe(opener);
  });
  it("BlockConfirm focuses its confirm button and Escape cancels", () => {
    const onCancel = vi.fn();
    render(
      <BlockConfirm
        username="x"
        pending={false}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const confirm = screen.getByRole("button", { name: "Block @x" });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(confirm, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});
