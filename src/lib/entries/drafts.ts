import type { EntryFields } from "./types";

// Unsent entry drafts in sessionStorage, scoped to one user (or the guest) and one
// movie. Drafts are restored into the composer but never submitted automatically.
const PREFIX = "codebox:entry-draft:v1:";

export type Draft = {
  /** "rate" edits targetId (or creates when null); "log" always creates. */
  mode: "rate" | "log";
  targetId: string | null;
  /** Version of targetId the draft was based on, so a stale draft still conflicts. */
  version: number | null;
  /** Client UUID for a create, reused across retries so they cannot duplicate. */
  clientId: string;
  fields: EntryFields;
};

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key"> & {
  readonly length: number;
};
function store(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // Blocked storage (privacy mode, sandboxed frame).
  }
}

export function draftKey(owner: string | null, movieId: number) {
  return `${PREFIX}${owner ?? "guest"}:${movieId}`;
}

function isDraft(value: unknown): value is Draft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<Draft>;
  const fields = draft.fields as Partial<EntryFields> | undefined;
  return (
    (draft.mode === "rate" || draft.mode === "log") &&
    (draft.targetId === null || typeof draft.targetId === "string") &&
    (draft.version === null || typeof draft.version === "number") &&
    (draft.targetId === null) === (draft.version === null) &&
    typeof draft.clientId === "string" &&
    !!fields &&
    (fields.score === null || typeof fields.score === "number") &&
    typeof fields.note === "string" &&
    typeof fields.spoiler === "boolean" &&
    typeof fields.watched === "boolean" &&
    (fields.watchedDate === null || typeof fields.watchedDate === "string")
  );
}

export function loadDraft(
  owner: string | null,
  movieId: number,
  storage = store(),
): Draft | null {
  try {
    const raw = storage?.getItem(draftKey(owner, movieId));
    const value: unknown = raw ? JSON.parse(raw) : null;
    return isDraft(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveDraft(
  owner: string | null,
  movieId: number,
  draft: Draft,
  storage = store(),
) {
  try {
    storage?.setItem(draftKey(owner, movieId), JSON.stringify(draft));
  } catch {
    /* Quota or blocked storage: drafts are a convenience only. */
  }
}

export function clearDraft(
  owner: string | null,
  movieId: number,
  storage = store(),
) {
  try {
    storage?.removeItem(draftKey(owner, movieId));
  } catch {
    /* ignore */
  }
}

/**
 * After sign-in, move a guest draft for this movie to the user's key (unless the
 * user already has one), so the guest's text survives the sign-in redirect.
 */
export function claimGuestDraft(
  userId: string,
  movieId: number,
  storage = store(),
): Draft | null {
  const own = loadDraft(userId, movieId, storage);
  const guest = loadDraft(null, movieId, storage);
  if (guest) clearDraft(null, movieId, storage);
  if (own) return own;
  if (guest) saveDraft(userId, movieId, guest, storage);
  return guest;
}

/** Remove every entry draft, e.g. on sign-out. */
export function clearAllDrafts(storage = store()) {
  try {
    if (!storage) return;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    /* ignore */
  }
}
