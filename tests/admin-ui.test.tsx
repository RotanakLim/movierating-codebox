// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({ moderate: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/app/admin/actions", () => ({ moderate: mocks.moderate }));
import {
  ModerationControls,
  choicesFor,
} from "@/components/admin/moderation-controls";
import type { QueueReport } from "@/lib/admin/types";

const report = (extra: Partial<QueueReport> = {}): QueueReport => ({
  id: "r1",
  status: "open",
  reason: "harassment",
  details: null,
  createdAt: "2026-09-30T00:00:00Z",
  resolvedAt: null,
  kind: "review",
  reporter: "fan",
  targetUserId: "u1",
  targetUsername: "author",
  targetSuspended: false,
  entryId: "e1",
  entryHidden: false,
  entryDeleted: false,
  movieId: 603,
  movieTitle: "The Matrix",
  score: 2,
  note: "Rude",
  spoiler: false,
  ...extra,
});
const labels = (value: QueueReport) =>
  choicesFor(value).map((choice) => choice.label);

beforeEach(() => Object.values(mocks).forEach((mock) => mock.mockReset()));
afterEach(cleanup);

describe("moderation choices", () => {
  it("offers dismiss, hide and suspend on an open review report", () => {
    expect(labels(report())).toEqual([
      "Dismiss",
      "Hide review",
      "Suspend @author",
    ]);
  });
  it("offers restore once content is hidden or the account suspended", () => {
    expect(
      labels(
        report({
          status: "resolved",
          entryHidden: true,
          targetSuspended: true,
        }),
      ),
    ).toEqual(["Restore review", "Restore @author"]);
  });
  it("never offers to hide a user report or a deleted review", () => {
    expect(labels(report({ kind: "user", entryId: null }))).toEqual([
      "Dismiss",
      "Suspend @author",
    ]);
    expect(labels(report({ entryDeleted: true }))).not.toContain("Hide review");
    expect(labels(report({ status: "dismissed" }))).toEqual([]);
  });
});

describe("<ModerationControls>", () => {
  it("requires a reason and sends the report with the chosen target", async () => {
    mocks.moderate.mockResolvedValue({ ok: true });
    render(<ModerationControls report={report()} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide review" }));
    const confirm = screen.getByRole("button", {
      name: "Confirm: Hide review",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason (required, audited)"), {
      target: { value: "Harassing other viewers" },
    });
    expect(confirm.disabled).toBe(false);
    await act(async () => fireEvent.click(confirm));
    expect(mocks.moderate).toHaveBeenCalledWith({
      action: "hide",
      reason: "Harassing other viewers",
      reportId: "r1",
      targetEntryId: "e1",
      targetUserId: null,
    });
    expect(screen.getByRole("status").textContent).toContain("recorded");
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("restores by target without reusing the closed report", async () => {
    mocks.moderate.mockResolvedValue({ ok: true });
    render(
      <ModerationControls
        report={report({ status: "resolved", targetSuspended: true })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Restore @author" }));
    fireEvent.change(screen.getByLabelText("Reason (required, audited)"), {
      target: { value: "Appeal accepted" },
    });
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Confirm: Restore @author" }),
      ),
    );
    expect(mocks.moderate).toHaveBeenCalledWith({
      action: "restore",
      reason: "Appeal accepted",
      reportId: null,
      targetEntryId: null,
      targetUserId: "u1",
    });
  });
  it("shows the database's refusal", async () => {
    mocks.moderate.mockResolvedValue({
      ok: false,
      error: "This report is already closed.",
    });
    render(<ModerationControls report={report()} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.change(screen.getByLabelText("Reason (required, audited)"), {
      target: { value: "Not abusive" },
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Confirm: Dismiss" })),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "This report is already closed.",
    );
  });
});
