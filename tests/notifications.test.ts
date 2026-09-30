import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getPublicConfig: () => ({ url: "x" }) }));
vi.mock("@/lib/auth/user", () => ({ getUser: mocks.user }));
const client = { rpc: mocks.rpc };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
import { loadNotifications, openNotification } from "@/lib/notifications/load";
import { markNotificationsRead } from "@/app/notifications/actions";
import { GET } from "@/app/api/notifications/route";
import { decodeCursor } from "@/lib/reviews/cursor";
import {
  UNAVAILABLE,
  notificationText,
  type InboxNotification,
} from "@/lib/notifications/types";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: uuid(n),
  kind: "review_comment",
  created_at: `2026-09-30T10:00:${String(59 - n).padStart(2, "0")}+00:00`,
  is_read: false,
  available: true,
  actor_username: "fan",
  actor_avatar: null,
  movie_title: "The Matrix",
  ...extra,
});
function respond(rows: unknown[], unread = 1, open: unknown[] = []) {
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "my_notifications") return { data: rows, error: null };
    if (name === "my_unread_notification_count")
      return { data: unread, error: null };
    if (name === "open_notification") return { data: open, error: null };
    return { data: 0, error: null };
  });
}
beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.user.mockReset();
  mocks.user.mockResolvedValue({ id: "me" });
});

describe("notification text", () => {
  const item = (extra: Partial<InboxNotification>): InboxNotification => ({
    id: "n",
    kind: "review_comment",
    createdAt: "2026-09-30T10:00:00Z",
    read: false,
    available: true,
    actor: { username: "fan", avatar: null },
    movieTitle: "The Matrix",
    ...extra,
  });
  it("describes each kind without any comment or review text", () => {
    expect(notificationText(item({ kind: "follow_request" }))).toBe(
      "@fan asked to follow you",
    );
    expect(notificationText(item({ kind: "follow_accepted" }))).toBe(
      "@fan accepted your follow request",
    );
    expect(notificationText(item({ kind: "new_follower" }))).toBe(
      "@fan started following you",
    );
    expect(notificationText(item({}))).toBe(
      "@fan commented on your review of The Matrix",
    );
    expect(notificationText(item({ kind: "comment_reply" }))).toBe(
      "@fan replied to your comment on a review of The Matrix",
    );
  });
  it("says the content is gone when the target is unavailable", () => {
    expect(notificationText(item({ available: false }))).toBe(UNAVAILABLE);
    expect(notificationText(item({ actor: null }))).toBe(UNAVAILABLE);
  });
});

describe("loadNotifications", () => {
  it("maps rows, withholds details of unavailable ones, and pages by cursor", async () => {
    const rows = Array.from({ length: 21 }, (_, n) => row(n + 1));
    rows[1] = row(2, {
      available: false,
      actor_username: "leak",
      movie_title: "leak",
    });
    respond(rows, 4);
    const page = await loadNotifications(client as never, null);
    expect(page.unread).toBe(4);
    expect(page.items).toHaveLength(20);
    expect(page.items[1]).toMatchObject({
      available: false,
      actor: null,
      movieTitle: null,
    });
    expect(decodeCursor(page.nextCursor)).toEqual({
      createdAt: rows[19].created_at,
      id: rows[19].id,
    });
    const cursor = { createdAt: rows[19].created_at, id: rows[19].id };
    await loadNotifications(client as never, cursor);
    expect(mocks.rpc).toHaveBeenCalledWith("my_notifications", {
      after_at: cursor.createdAt,
      after_id: cursor.id,
      page_size: 20,
    });
  });
});

describe("openNotification", () => {
  const open = async (target: Record<string, unknown> | null) => {
    respond([], 0, target ? [target] : []);
    return openNotification(client as never, uuid(1));
  };
  it("goes to the target when it is still available", async () => {
    expect(
      await open({
        kind: "comment_reply",
        available: true,
        actor_username: "fan",
        entry_id: uuid(5),
        comment_id: uuid(6),
      }),
    ).toBe(`/reviews/${uuid(5)}#comment-${uuid(6)}`);
    expect(
      await open({
        kind: "new_follower",
        available: true,
        actor_username: "fan",
      }),
    ).toBe("/u/fan");
    expect(
      await open({
        kind: "follow_request",
        available: true,
        actor_username: "fan",
      }),
    ).toBe("/notifications#requests");
  });
  it("returns null when gone and undefined when not the caller's", async () => {
    expect(await open({ kind: "review_comment", available: false })).toBeNull();
    expect(await open(null)).toBeUndefined();
  });
});

describe("mark read and the inbox route", () => {
  it("marks chosen notifications or all of them", async () => {
    respond([], 0);
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    expect(await markNotificationsRead({ ids: [uuid(1), uuid(2)] })).toEqual({
      ok: true,
      changed: 2,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("mark_notifications_read", {
      ids: [uuid(1), uuid(2)],
    });
    await markNotificationsRead({ ids: null });
    expect(mocks.rpc).toHaveBeenLastCalledWith("mark_notifications_read", {});
    expect((await markNotificationsRead({ ids: ["nope"] })).ok).toBe(false);
    mocks.user.mockResolvedValue(null);
    expect((await markNotificationsRead({ ids: null })).ok).toBe(false);
  });
  it("serves pages to signed-in users only, never cached", async () => {
    respond([row(1)], 1);
    const response = await GET(
      new NextRequest("https://codebox.test/api/notifications"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).unread).toBe(1);
    expect(
      (
        await GET(
          new NextRequest("https://codebox.test/api/notifications?cursor=bad"),
        )
      ).status,
    ).toBe(400);
    mocks.user.mockResolvedValue(null);
    expect(
      (await GET(new NextRequest("https://codebox.test/api/notifications")))
        .status,
    ).toBe(401);
  });
});
