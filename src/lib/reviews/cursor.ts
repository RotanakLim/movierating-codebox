// Opaque keyset cursor for review lists: the (created_at, id) of the last row shown.
export type ReviewCursor = { createdAt: string; id: string };

const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeCursor(cursor: ReviewCursor) {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`).toString("base64url");
}

/** null for a missing cursor; throws for a malformed one. */
export function decodeCursor(value: string | null): ReviewCursor | null {
  if (!value) return null;
  if (value.length > 200) throw new Error("Invalid cursor");
  const [createdAt, id, extra] = Buffer.from(value, "base64url")
    .toString("utf8")
    .split("|");
  if (extra !== undefined || !TIMESTAMP.test(createdAt) || !UUID.test(id))
    throw new Error("Invalid cursor");
  return { createdAt, id };
}
