export const MODERATION_ACTIONS = [
  "dismiss",
  "hide",
  "suspend",
  "restore",
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const REPORT_STATUSES = ["open", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_REASON_LABELS: Record<string, string> = {
  spam: "Spam",
  harassment: "Harassment",
  inappropriate: "Inappropriate content",
  spoilers: "Unmarked spoilers",
  other: "Something else",
};

export type QueueReport = {
  id: string;
  status: ReportStatus;
  reason: string;
  details: string | null;
  createdAt: string;
  resolvedAt: string | null;
  kind: "user" | "review";
  reporter: string | null;
  targetUserId: string | null;
  targetUsername: string | null;
  targetSuspended: boolean;
  entryId: string | null;
  entryHidden: boolean;
  entryDeleted: boolean;
  movieId: number | null;
  movieTitle: string | null;
  score: number | null;
  note: string | null;
  spoiler: boolean;
};

export type AuditEntry = {
  id: string;
  action: string;
  reason: string;
  createdAt: string;
  admin: string | null;
  target: string | null;
  entryId: string | null;
};

/** ?status= for the queue page; anything unknown shows open reports. */
export function queueStatus(value: unknown): ReportStatus {
  return REPORT_STATUSES.includes(value as ReportStatus)
    ? (value as ReportStatus)
    : "open";
}
