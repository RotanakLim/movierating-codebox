// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({ mark: vi.fn(), changed: vi.fn() }));
vi.mock("@/app/notifications/actions", () => ({
  markNotificationsRead: mocks.mark,
}));
vi.mock("@/components/profile-link", () => ({
  notifyProfileChanged: mocks.changed,
}));
import { NotificationInbox } from "@/components/notifications/inbox";
import type { InboxNotification } from "@/lib/notifications/types";

const item = (
  n: number,
  extra: Partial<InboxNotification> = {},
): InboxNotification => ({
  id: `n${n}`,
  kind: "review_comment",
  createdAt: `2026-09-30T10:00:${String(50 - n).padStart(2, "0")}Z`,
  read: false,
  available: true,
  actor: { username: `fan${n}`, avatar: null },
  movieTitle: "The Matrix",
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
  vi.useRealTimers();
});

describe("<NotificationInbox>", () => {
  it("lists notifications linking through the access-checking route", () => {
    render(
      <NotificationInbox
        initial={{
          items: [
            item(1),
            item(2, {
              available: false,
              actor: null,
              movieTitle: null,
              read: true,
            }),
          ],
          nextCursor: null,
          unread: 1,
        }}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links[0].textContent).toBe(
      "Unread: @fan1 commented on your review of The Matrix",
    );
    expect(links[0].getAttribute("href")).toBe("/notifications/n1");
    expect(links[1].textContent).toBe("This content is no longer available.");
    expect(document.body.textContent).toContain("(1 unread)");
  });
  it("marks one read, then all read, and refreshes the nav badge", async () => {
    mocks.mark.mockResolvedValue({ ok: true, changed: 1 });
    render(
      <NotificationInbox
        initial={{ items: [item(1), item(2)], nextCursor: null, unread: 2 }}
      />,
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /Mark read: @fan1/ })),
    );
    expect(mocks.mark).toHaveBeenCalledWith({ ids: ["n1"] });
    expect(document.body.textContent).toContain("(1 unread)");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Mark all read" })),
    );
    expect(mocks.mark).toHaveBeenLastCalledWith({ ids: null });
    expect(document.body.textContent).toContain("(0 unread)");
    expect(screen.queryByRole("button", { name: /Mark read/ })).toBeNull();
    expect(mocks.changed).toHaveBeenCalledTimes(2);
  });
  it("polls on window focus and every 60 seconds, only while open", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () =>
      Response.json({ items: [item(0), item(1)], nextCursor: null, unread: 2 }),
    );
    const { unmount } = render(
      <NotificationInbox
        initial={{ items: [item(1)], nextCursor: null, unread: 1 }}
      />,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The route answers "private, no-store", so polls never come from a cache.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notifications",
      expect.anything(),
    );
    expect(document.body.textContent).toContain("@fan0");
    expect(document.body.textContent).toContain("(2 unread)");
    expect(mocks.changed).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("loads older notifications by cursor", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ items: [item(9)], nextCursor: null, unread: 1 }),
    );
    render(
      <NotificationInbox
        initial={{ items: [item(1)], nextCursor: "abc", unread: 1 }}
      />,
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Load older" })),
    );
    // The route answers "private, no-store", so polls never come from a cache.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notifications?cursor=abc",
      expect.anything(),
    );
    expect(document.body.textContent).toContain("@fan9");
  });
});
