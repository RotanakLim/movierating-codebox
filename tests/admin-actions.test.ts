import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
  requireUser: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/user", () => ({
  getUser: mocks.user,
  requireUser: mocks.requireUser,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));
import { moderate } from "@/app/admin/actions";
import { loadReportQueue, requireAdmin } from "@/lib/admin/load";
import { queueStatus } from "@/lib/admin/types";

const REPORT = "10000000-0000-4000-8000-000000000001";
const ENTRY = "20000000-0000-4000-8000-000000000002";
const USER = "30000000-0000-4000-8000-000000000003";
const input = (extra: Record<string, unknown> = {}) => ({
  action: "hide",
  reason: "  Harassment  ",
  reportId: REPORT,
  targetEntryId: ENTRY,
  targetUserId: null,
  ...extra,
});

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.user.mockResolvedValue({ id: "admin-1" });
  mocks.rpc.mockResolvedValue({ data: "action-id", error: null });
});

describe("moderate", () => {
  it("sends the trimmed reason and targets to the audited database function", async () => {
    expect(await moderate(input())).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_moderate", {
      action: "hide",
      reason: "Harassment",
      report: REPORT,
      target_entry: ENTRY,
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  });
  it("requires a reason, a known action and real IDs before calling the database", async () => {
    expect(await moderate(input({ reason: "   " }))).toEqual({
      ok: false,
      error: "Give a reason for this action.",
    });
    expect((await moderate(input({ reason: "x".repeat(1001) }))).ok).toBe(
      false,
    );
    expect((await moderate(input({ action: "delete" }))).ok).toBe(false);
    expect((await moderate(input({ reportId: "nope" }))).ok).toBe(false);
    expect((await moderate(input({ extra: 1 }))).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes only the restore target it was given", async () => {
    await moderate(
      input({
        action: "restore",
        reportId: null,
        targetEntryId: null,
        targetUserId: USER,
      }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("admin_moderate", {
      action: "restore",
      reason: "Harassment",
      target_user: USER,
    });
  });
  it("maps database refusals, and never trusts the page for admin status", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await moderate(input())).toEqual({
      ok: false,
      error: "Admins only.",
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "This report is already closed" },
    });
    expect(await moderate(input())).toEqual({
      ok: false,
      error: "This report is already closed.",
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue(null);
    expect((await moderate(input())).ok).toBe(false);
  });
});

describe("admin access", () => {
  it("404s for anyone the database doesn't list as an admin", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(requireAdmin("/admin/reports")).rejects.toThrow("NOT_FOUND");
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(requireAdmin("/admin/reports")).rejects.toThrow("NOT_FOUND");
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await expect(requireAdmin("/admin/reports")).resolves.toBeTruthy();
    expect(mocks.requireUser).toHaveBeenCalledWith("/admin/reports");
  });
  it("maps queue rows and defaults unknown statuses to open", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: REPORT,
          status: "open",
          reason: "spam",
          details: null,
          created_at: "2026-09-30T00:00:00Z",
          resolved_at: null,
          target_kind: "review",
          reporter_username: "fan",
          target_user_id: USER,
          target_username: "author",
          target_suspended: false,
          target_entry_id: ENTRY,
          entry_hidden: false,
          entry_deleted: false,
          movie_id: 603,
          movie_title: "The Matrix",
          entry_score: 2,
          entry_note: "Bad",
          entry_spoiler: null,
        },
      ],
      error: null,
    });
    const client = (await import("@/lib/supabase/server")).createClient;
    const rows = await loadReportQueue(
      (await client()) as never,
      queueStatus("nonsense"),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("admin_reports", {
      filter_status: "open",
      max_rows: 100,
    });
    expect(rows[0]).toMatchObject({
      kind: "review",
      targetUsername: "author",
      movieTitle: "The Matrix",
      spoiler: false,
    });
  });
});
