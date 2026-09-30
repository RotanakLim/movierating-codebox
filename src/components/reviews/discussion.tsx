"use client";
import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { SpoilerText } from "@/components/reviews/spoiler-text";
import {
  ReportForm,
  receiptMessage,
} from "@/components/safety/safety-controls";
import { addComment, deleteComment, editComment } from "@/app/reviews/actions";
import { avatarUrl } from "@/lib/profiles/avatar-url";
import {
  COMMENT_MAX,
  type DiscussionComment,
  type DiscussionThread,
  type ReplyPage,
  type ThreadPage,
} from "@/lib/reviews/discussion-types";

type Viewer = { username: string; avatar: string | null } | null;

function when(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

const PLACEHOLDER: Record<string, string> = {
  deleted: "[deleted]",
  removed: "[removed by a moderator]",
  blocked: "[hidden]",
};

/** Text box with a spoiler flag and character count, for new, reply and edit. */
function CommentForm({
  initialBody = "",
  initialSpoiler = false,
  submitLabel,
  replyingTo,
  onSubmit,
  onCancel,
}: {
  initialBody?: string;
  initialSpoiler?: boolean;
  submitLabel: string;
  replyingTo?: string | null;
  onSubmit: (body: string, spoiler: boolean) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const id = useId();
  const [body, setBody] = useState(initialBody);
  const [spoiler, setSpoiler] = useState(initialSpoiler);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const empty = !body.trim();
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (empty) return;
        setError(null);
        startTransition(async () => {
          const problem = await onSubmit(body, spoiler).catch(
            () => "That didn't work. Please try again.",
          );
          if (problem) return setError(problem);
          setBody("");
          setSpoiler(false);
        });
      }}
    >
      {replyingTo && (
        <p className="text-xs text-muted">Replying to @{replyingTo}</p>
      )}
      <label htmlFor={`${id}-body`} className="sr-only">
        {submitLabel}
      </label>
      <textarea
        id={`${id}-body`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={COMMENT_MAX}
        rows={3}
        placeholder="Plain text, up to 2,000 characters"
        aria-describedby={`${id}-count`}
      />
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="mb-0 inline-flex items-center gap-2 font-normal">
          <input
            type="checkbox"
            checked={spoiler}
            onChange={(event) => setSpoiler(event.target.checked)}
            className="h-4 min-h-0 w-4"
          />
          Contains spoilers
        </label>
        <span id={`${id}-count`} className="text-xs text-muted">
          {body.length}/{COMMENT_MAX.toLocaleString("en-US")}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-muted">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="submit"
          className="button-secondary"
          disabled={pending || empty}
        >
          {pending ? "Posting…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            className="text-sm text-muted"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function CommentItem({
  comment,
  canInteract,
  onReply,
  onEdit,
  onDelete,
}: {
  comment: DiscussionComment;
  canInteract: boolean;
  onReply: (comment: DiscussionComment) => void;
  onEdit: (comment: DiscussionComment, body: string, spoiler: boolean) => void;
  onDelete: (comment: DiscussionComment) => void;
}) {
  const [panel, setPanel] = useState<"edit" | "delete" | "report" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (comment.state !== "visible" || !comment.author || comment.body === null)
    return (
      <p className="text-sm italic text-muted">
        {PLACEHOLDER[comment.state] ?? "[unavailable]"}
      </p>
    );
  const author = comment.author;
  const body = comment.body;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Avatar src={avatarUrl(author.avatar)} size={24} />
        <Link
          href={`/u/${author.username}`}
          className="font-semibold hover:text-accent"
        >
          @{author.username}
        </Link>
        <span className="text-xs text-muted">
          {when(comment.createdAt)}
          {comment.edited && " · edited"}
        </span>
      </div>
      {comment.replyTo && (
        <p className="mt-1 text-xs text-muted">
          replying to @{comment.replyTo}
        </p>
      )}
      {panel === "edit" ? (
        <CommentForm
          initialBody={body}
          initialSpoiler={comment.spoiler}
          submitLabel="Save changes"
          onCancel={() => setPanel(null)}
          onSubmit={async (text, spoiler) => {
            const result = await editComment({
              commentId: comment.id,
              body: text,
              spoiler,
            });
            if (!result.ok) return result.error;
            onEdit(comment, text.trim(), spoiler);
            setPanel(null);
            return null;
          }}
        />
      ) : (
        <SpoilerText text={body} spoiler={comment.spoiler} kind="comment" />
      )}
      {canInteract && panel !== "edit" && (
        <div className="mt-2 flex flex-wrap gap-4 text-xs">
          <button
            type="button"
            className="text-muted hover:text-ink"
            onClick={() => onReply(comment)}
          >
            Reply
          </button>
          {comment.mine ? (
            <>
              <button
                type="button"
                className="text-muted hover:text-ink"
                onClick={() => setPanel("edit")}
              >
                Edit
              </button>
              <button
                type="button"
                className="text-muted hover:text-ink"
                aria-expanded={panel === "delete"}
                onClick={() => setPanel(panel === "delete" ? null : "delete")}
              >
                Delete
              </button>
            </>
          ) : (
            <button
              type="button"
              className="text-muted hover:text-ink"
              aria-expanded={panel === "report"}
              onClick={() => setPanel(panel === "report" ? null : "report")}
            >
              Report
            </button>
          )}
        </div>
      )}
      {panel === "delete" && (
        <div
          role="group"
          aria-label="Delete this comment"
          className="mt-2 rounded-xl border border-line p-3 text-sm"
        >
          <p>
            Delete this comment? If it has replies it will show as
            &ldquo;[deleted]&rdquo; so the thread stays readable.
          </p>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              className="font-semibold text-red-700 hover:underline dark:text-red-300"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteComment({
                    commentId: comment.id,
                  }).catch(() => ({
                    ok: false as const,
                    error: "That didn't work. Please try again.",
                  }));
                  if (!result.ok) return setMessage(result.error);
                  setPanel(null);
                  onDelete(comment);
                })
              }
            >
              {pending ? "Deleting…" : "Delete comment"}
            </button>
            <button
              type="button"
              className="text-muted"
              onClick={() => setPanel(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {panel === "report" && (
        <div className="mt-2 text-sm">
          <ReportForm
            target={{
              kind: "comment",
              commentId: comment.id,
              username: author.username,
            }}
            onCancel={() => setPanel(null)}
            onDone={(receipt) => {
              setPanel(null);
              setMessage(receiptMessage(receipt));
            }}
          />
        </div>
      )}
      {message && (
        <p role="status" className="mt-2 text-sm text-muted">
          {message}
        </p>
      )}
    </div>
  );
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok)
    throw new Error(typeof body.error === "string" ? body.error : fallback);
  return body as T;
}

/**
 * A review's discussion: threads oldest first, one reply level. Replying to a
 * reply posts in the same thread with "replying to @user". The database applies
 * blocks, moderation and ancestry; this view only reflects what it returns.
 */
export function Discussion({
  reviewId,
  initial,
  viewer,
  signInHref,
}: {
  reviewId: string;
  initial: ThreadPage;
  /** Signed-in, onboarded viewer who may comment; null for everyone else. */
  viewer: Viewer;
  signInHref: string;
}) {
  const [threads, setThreads] = useState<DiscussionThread[]>(initial.threads);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [replying, setReplying] = useState<{
    threadId: string;
    to: DiscussionComment;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const mine = (
    id: string,
    body: string,
    spoiler: boolean,
    threadId: string | null,
    replyTo: string | null,
  ): DiscussionComment => ({
    id,
    threadId,
    state: "visible",
    author: viewer
      ? { username: viewer.username, avatar: viewer.avatar }
      : null,
    replyTo,
    body: body.trim(),
    spoiler,
    createdAt: new Date().toISOString(),
    edited: false,
    mine: true,
  });

  function update(
    id: string,
    change: (item: DiscussionComment) => DiscussionComment,
  ) {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === id
          ? { ...thread, ...change(thread) }
          : {
              ...thread,
              replies: thread.replies.map((reply) =>
                reply.id === id ? change(reply) : reply,
              ),
            },
      ),
    );
  }

  function removed(comment: DiscussionComment) {
    setThreads((current) =>
      current.flatMap((thread) => {
        if (thread.id === comment.id)
          return thread.replyCount > 0
            ? [
                {
                  ...thread,
                  state: "deleted" as const,
                  author: null,
                  body: null,
                  spoiler: false,
                  mine: false,
                },
              ]
            : [];
        const replies = thread.replies.filter(
          (reply) => reply.id !== comment.id,
        );
        if (replies.length === thread.replies.length) return [thread];
        const replyCount = Math.max(0, thread.replyCount - 1);
        // A "[deleted]" comment goes once its last reply does.
        if (thread.state === "deleted" && replyCount === 0) return [];
        return [{ ...thread, replies, replyCount }];
      }),
    );
  }

  async function loadMoreThreads() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setNotice(null);
    try {
      const page = await getJson<ThreadPage>(
        `/api/reviews/${reviewId}/comments?${new URLSearchParams({ cursor: nextCursor })}`,
        "The discussion is unavailable right now.",
      );
      setThreads((current) => {
        const seen = new Set(current.map((thread) => thread.id));
        return [...current, ...page.threads.filter((t) => !seen.has(t.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  }

  async function loadMoreReplies(thread: DiscussionThread) {
    if (!thread.nextReplyCursor) return;
    setNotice(null);
    try {
      const page = await getJson<ReplyPage>(
        `/api/reviews/${reviewId}/comments/replies?${new URLSearchParams({
          thread: thread.id,
          cursor: thread.nextReplyCursor,
        })}`,
        "Replies are unavailable right now.",
      );
      setThreads((current) =>
        current.map((item) => {
          if (item.id !== thread.id) return item;
          const seen = new Set(item.replies.map((reply) => reply.id));
          return {
            ...item,
            replies: [
              ...item.replies,
              ...page.replies.filter((reply) => !seen.has(reply.id)),
            ],
            nextReplyCursor: page.nextCursor,
          };
        }),
      );
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : String(failure));
    }
  }

  const count = threads.reduce(
    (total, thread) =>
      total + (thread.state === "visible" ? 1 : 0) + thread.replyCount,
    0,
  );

  return (
    <section aria-labelledby="discussion-heading" className="mt-12">
      <h2 id="discussion-heading" className="font-display text-2xl">
        Discussion
      </h2>
      {viewer ? (
        <CommentForm
          submitLabel="Post comment"
          onSubmit={async (body, spoiler) => {
            const result = await addComment({
              reviewId,
              body,
              spoiler,
              replyTo: null,
            });
            if (!result.ok) return result.error;
            if (nextCursor)
              setNotice(
                "Your comment was posted at the end of the discussion.",
              );
            else
              setThreads((current) => [
                ...current,
                {
                  ...mine(result.id, body, spoiler, null, null),
                  replies: [],
                  replyCount: 0,
                  nextReplyCursor: null,
                },
              ]);
            return null;
          }}
        />
      ) : (
        <p className="mt-3 text-sm text-muted">
          <Link href={signInHref} className="text-accent underline">
            Sign in
          </Link>{" "}
          to join the discussion.
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-muted">
          {notice}
        </p>
      )}

      {threads.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No comments yet.</p>
      ) : (
        <>
          <p className="mt-6 text-xs text-muted">
            {count} comment{count === 1 ? "" : "s"} shown
          </p>
          <ul className="mt-3 space-y-5">
            {threads.map((thread) => (
              <li
                key={thread.id}
                id={`comment-${thread.id}`}
                className="scroll-mt-6 rounded-2xl border border-line bg-surface p-4"
              >
                <CommentItem
                  comment={thread}
                  canInteract={!!viewer}
                  onReply={(comment) =>
                    setReplying({ threadId: thread.id, to: comment })
                  }
                  onEdit={(comment, body, spoiler) =>
                    update(comment.id, (item) => ({
                      ...item,
                      body,
                      spoiler,
                      edited: item.edited || body !== comment.body,
                    }))
                  }
                  onDelete={removed}
                />
                {thread.replies.length > 0 && (
                  <ul className="mt-4 space-y-4 border-l-2 border-line pl-4">
                    {thread.replies.map((reply) => (
                      <li
                        key={reply.id}
                        id={`comment-${reply.id}`}
                        className="scroll-mt-6"
                      >
                        <CommentItem
                          comment={reply}
                          canInteract={!!viewer}
                          onReply={(comment) =>
                            setReplying({ threadId: thread.id, to: comment })
                          }
                          onEdit={(comment, body, spoiler) =>
                            update(comment.id, (item) => ({
                              ...item,
                              body,
                              spoiler,
                              edited: item.edited || body !== comment.body,
                            }))
                          }
                          onDelete={removed}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {thread.nextReplyCursor && (
                  <button
                    type="button"
                    className="mt-3 text-xs font-semibold text-accent hover:underline"
                    onClick={() => loadMoreReplies(thread)}
                  >
                    Show more replies (
                    {thread.replyCount - thread.replies.length})
                  </button>
                )}
                {replying?.threadId === thread.id && viewer && (
                  <div className="mt-3 border-l-2 border-accent pl-4">
                    <CommentForm
                      submitLabel="Post reply"
                      replyingTo={
                        replying.to.id === thread.id
                          ? null
                          : replying.to.author?.username
                      }
                      onCancel={() => setReplying(null)}
                      onSubmit={async (body, spoiler) => {
                        const to = replying.to;
                        const result = await addComment({
                          reviewId,
                          body,
                          spoiler,
                          replyTo: to.id,
                        });
                        if (!result.ok) return result.error;
                        const replyTo =
                          to.id !== thread.id &&
                          to.author &&
                          to.author.username !== viewer.username
                            ? to.author.username
                            : null;
                        setThreads((current) =>
                          current.map((item) =>
                            item.id === thread.id
                              ? {
                                  ...item,
                                  // Shown now only if every reply is loaded.
                                  replies: item.nextReplyCursor
                                    ? item.replies
                                    : [
                                        ...item.replies,
                                        mine(
                                          result.id,
                                          body,
                                          spoiler,
                                          thread.id,
                                          replyTo,
                                        ),
                                      ],
                                  replyCount: item.replyCount + 1,
                                }
                              : item,
                          ),
                        );
                        setReplying(null);
                        return null;
                      }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {nextCursor && (
        <button
          type="button"
          onClick={loadMoreThreads}
          disabled={loading}
          className="button-secondary mt-5"
        >
          {loading && (
            <LoaderCircle
              size={16}
              className="animate-spin"
              aria-hidden="true"
            />
          )}
          {loading ? "Loading…" : "Load more comments"}
        </button>
      )}
    </section>
  );
}
