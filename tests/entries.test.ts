import { describe, expect, it } from "vitest";
import {
  formatScore,
  isValidScore,
  scoreForFraction,
  scoreForKey,
  scoreLabel,
} from "@/lib/entries/score";
import { formatDate, isCalendarDate, todayIn } from "@/lib/entries/dates";
import {
  claimGuestDraft,
  clearAllDrafts,
  clearDraft,
  draftKey,
  loadDraft,
  saveDraft,
  type Draft,
} from "@/lib/entries/drafts";
import { entryToEdit, type Entry } from "@/lib/entries/types";

describe("score rules", () => {
  it.each([0, 0.1, 1, 5.5, 9.5, 9.9, 10])("accepts %d", (score) => {
    expect(isValidScore(score)).toBe(true);
  });
  it.each([-0.1, 10.1, 10.5, 9.55, 0.05, Number.NaN, Infinity, "9"])(
    "rejects %s",
    (score) => {
      expect(isValidScore(score)).toBe(false);
    },
  );
  it("formats and labels with one decimal place", () => {
    expect(formatScore(8)).toBe("8.0");
    expect(scoreLabel(9.5)).toBe("9.5 out of 10");
    expect(scoreLabel(null)).toBe("Not rated");
  });
  it("steps in exact tenths without floating-point drift", () => {
    let value: number | null = null;
    for (let step = 0; step < 101; step++)
      value = scoreForKey(value, "ArrowUp") as number;
    expect(value).toBe(10);
    expect(scoreForKey(0.3, "ArrowUp")).toBe(0.4);
    expect(scoreForKey(0, "ArrowDown")).toBe(0);
    expect(scoreForKey(5, "Tab")).toBeUndefined();
    expect(scoreForFraction(0.555)).toBe(5.6);
  });
});

describe("watch dates", () => {
  it("computes today in the viewer's timezone", () => {
    const instant = new Date("2026-09-30T02:00:00Z");
    expect(todayIn("America/Los_Angeles", instant)).toBe("2026-09-29");
    expect(todayIn("Asia/Tokyo", instant)).toBe("2026-09-30");
  });
  it("validates calendar dates without timezone shifts", () => {
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(formatDate("2026-06-01")).toBe("Jun 1, 2026");
  });
});

const entry = (overrides: Partial<Entry>): Entry => ({
  id: "00000000-0000-4000-8000-000000000000",
  version: 1,
  score: null,
  note: null,
  spoiler: false,
  watched: true,
  watchedDate: null,
  watchedTimezone: "UTC",
  createdAt: "2026-01-01T00:00:00+00:00",
  ...overrides,
});

describe("which entry 'Rate or review' edits", () => {
  it("prefers the current rated entry by known watch date", () => {
    const june = entry({ id: "a", score: 8, watchedDate: "2026-06-01" });
    const september = entry({ id: "b", score: 6.5, watchedDate: "2026-09-01" });
    const undated = entry({
      id: "c",
      score: 10,
      createdAt: "2026-09-29T00:00:00+00:00",
    });
    const unrated = entry({ id: "d", createdAt: "2026-09-30T00:00:00+00:00" });
    expect(entryToEdit([june, september, undated, unrated])?.id).toBe("b");
    expect(entryToEdit([june, undated, unrated])?.id).toBe("a");
    expect(entryToEdit([undated, unrated])?.id).toBe("c");
  });
  it("falls back to the newest entry, then to a new one", () => {
    const older = entry({ id: "a" });
    const newer = entry({ id: "b", createdAt: "2026-05-01T00:00:00+00:00" });
    expect(entryToEdit([older, newer])?.id).toBe("b");
    expect(entryToEdit([])).toBeNull();
  });
});

class MemoryStorage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}
const draft: Draft = {
  mode: "rate",
  targetId: null,
  version: null,
  clientId: "11111111-1111-4111-8111-111111111111",
  fields: {
    score: 9.5,
    note: "Line one\nLine two",
    spoiler: false,
    watched: true,
    watchedDate: "2026-09-30",
  },
};

describe("entry drafts", () => {
  it("are scoped to one user and one movie", () => {
    const storage = new MemoryStorage();
    saveDraft("user-a", 10, draft, storage);
    expect(loadDraft("user-a", 10, storage)).toEqual(draft);
    expect(loadDraft("user-b", 10, storage)).toBeNull();
    expect(loadDraft("user-a", 11, storage)).toBeNull();
    expect(draftKey(null, 10)).toContain("guest:10");
    clearDraft("user-a", 10, storage);
    expect(loadDraft("user-a", 10, storage)).toBeNull();
  });
  it("move a guest draft to the user after sign-in", () => {
    const storage = new MemoryStorage();
    saveDraft(null, 10, draft, storage);
    expect(claimGuestDraft("user-a", 10, storage)).toEqual(draft);
    expect(loadDraft(null, 10, storage)).toBeNull();
    expect(loadDraft("user-a", 10, storage)).toEqual(draft);
  });
  it("keep a user's own draft over a leftover guest draft", () => {
    const storage = new MemoryStorage();
    const own = { ...draft, fields: { ...draft.fields, note: "mine" } };
    saveDraft("user-a", 10, own, storage);
    saveDraft(null, 10, draft, storage);
    expect(claimGuestDraft("user-a", 10, storage)?.fields.note).toBe("mine");
  });
  it("are all cleared on sign-out, leaving other storage alone", () => {
    const storage = new MemoryStorage();
    saveDraft("user-a", 10, draft, storage);
    saveDraft(null, 11, draft, storage);
    storage.setItem("codebox-theme", "dark");
    clearAllDrafts(storage);
    expect(storage.length).toBe(1);
    expect(storage.getItem("codebox-theme")).toBe("dark");
  });
  it("ignore corrupted or tampered data", () => {
    const storage = new MemoryStorage();
    storage.setItem(draftKey("user-a", 10), "{not json");
    expect(loadDraft("user-a", 10, storage)).toBeNull();
    storage.setItem(
      draftKey("user-a", 10),
      JSON.stringify({ ...draft, targetId: "x", version: null }),
    );
    expect(loadDraft("user-a", 10, storage)).toBeNull();
  });
});
