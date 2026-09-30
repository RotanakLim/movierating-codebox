// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  follow: vi.fn(),
  unfollow: vi.fn(),
  refresh: vi.fn(),
  loadFeed: vi.fn(),
  followsAnyone: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/app/profiles/actions", () => ({
  follow: mocks.follow,
  unfollow: mocks.unfollow,
}));
vi.mock("@/lib/feed/load", () => ({
  loadFeed: mocks.loadFeed,
  followsAnyone: mocks.followsAnyone,
}));
import { FollowButton } from "@/components/profiles/follow-button";
import { FeedCard, FeedList } from "@/components/feed/feed-list";
import { FeedHome } from "@/components/home/feed-home";
import type { FeedItem } from "@/lib/feed/types";

const item = (n: number, extra: Partial<FeedItem> = {}): FeedItem => ({
  id: `item-${n}`,
  kind: "rated",
  createdAt: "2026-09-30T10:00:00Z",
  user: { username: `fan${n}`, avatar: null },
  movie: { id: 603, title: `Movie ${n}`, poster: null, year: 1999 },
  score: 8,
  ...extra,
});
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

describe("<FollowButton>", () => {
  it("follows a public profile and then offers Unfollow", async () => {
    mocks.follow.mockResolvedValue({ ok: true, status: "accepted" });
    render(
      <FollowButton
        userId="u1"
        username="pat"
        visibility="public"
        initial={null}
      />,
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Follow @pat" })),
    );
    expect(mocks.follow).toHaveBeenCalledWith({ userId: "u1" });
    expect(screen.getByText("Following")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unfollow @pat" })).toBeTruthy();
  });
  it("requests a restricted profile, then cancels the request", async () => {
    mocks.follow.mockResolvedValue({ ok: true, status: "pending" });
    mocks.unfollow.mockResolvedValue({ ok: true });
    render(
      <FollowButton
        userId="u2"
        username="sam"
        visibility="private"
        initial={null}
      />,
    );
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Request to follow @sam" }),
      ),
    );
    expect(screen.getByText("Requested")).toBeTruthy();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Cancel request @sam" }),
      ),
    );
    expect(mocks.unfollow).toHaveBeenCalledWith({ userId: "u2" });
    expect(
      screen.getByRole("button", { name: "Request to follow @sam" }),
    ).toBeTruthy();
  });
  it("shows refusals such as the follow limit and keeps the state", async () => {
    mocks.follow.mockResolvedValue({
      ok: false,
      error:
        "You've sent a lot of follow requests recently. Try again in 20 minutes.",
    });
    render(
      <FollowButton userId="u3" username="al" initial={null} followBack />,
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Follow back @al" })),
    );
    expect(screen.getByRole("alert").textContent).toContain("20 minutes");
    expect(
      screen.getByRole("button", { name: "Follow back @al" }),
    ).toBeTruthy();
  });
});

describe("feed cards", () => {
  it("never show review text and link reviews to the movie page", () => {
    render(<FeedCard item={item(1, { kind: "reviewed", score: null })} />);
    expect(document.body.textContent).toContain("@fan1 reviewed Movie 1");
    expect(
      screen
        .getByRole("link", { name: "Read on the movie page" })
        .getAttribute("href"),
    ).toBe("/movies/603");
  });
  it("show a rating's score", () => {
    render(<FeedCard item={item(2)} />);
    expect(document.body.textContent).toContain("8.0/10");
  });
  it("load the next page by cursor without duplicates", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ items: [item(2), item(3)], nextCursor: null }),
    );
    render(
      <FeedList
        tab="community"
        initial={{ items: [item(1), item(2)], nextCursor: "abc" }}
        emptyText="empty"
      />,
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Load more" })),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/feed?tab=community&cursor=abc",
    );
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
  it("show the honest empty state, never placeholder activity", () => {
    render(
      <FeedList
        tab="community"
        initial={{ items: [], nextCursor: null }}
        emptyText="No public ratings or reviews yet."
      />,
    );
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(document.body.textContent).toContain(
      "No public ratings or reviews yet.",
    );
  });
});

describe("signed-in home", () => {
  const home = async (
    following: boolean,
    requested: "following" | "community" | null,
  ) => {
    mocks.followsAnyone.mockResolvedValue(following);
    mocks.loadFeed.mockResolvedValue({ items: [], nextCursor: null });
    render(
      await FeedHome({
        supabase: {} as never,
        userId: "me",
        username: "me_fan",
        requested,
      }),
    );
  };
  const current = () =>
    screen
      .getByRole("navigation", { name: "Feeds" })
      .querySelector('[aria-current="page"]')?.textContent;
  it("defaults to Following once the user follows someone, with no people prompt", async () => {
    await home(true, null);
    expect(current()).toBe("Following");
    expect(mocks.loadFeed).toHaveBeenCalledWith("following", null, {});
    expect(
      screen.queryByRole("heading", { name: "Find people to follow" }),
    ).toBeNull();
  });
  it("shows new users Community and a find-people prompt", async () => {
    await home(false, null);
    expect(current()).toBe("Community");
    expect(mocks.loadFeed).toHaveBeenCalledWith("community", null, {});
    expect(
      screen.getByRole("link", { name: "Find people" }).getAttribute("href"),
    ).toBe("/people");
  });
  it("honors an explicit tab choice", async () => {
    await home(false, "following");
    expect(current()).toBe("Following");
    expect(document.body.textContent).toContain(
      "You're not following anyone yet",
    );
  });
});
