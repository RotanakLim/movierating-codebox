"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmAction } from "@/components/confirm-action";
import { deleteEntry } from "@/app/entries/actions";
import { setWatchlisted } from "@/app/watchlist/actions";
import {
  createList,
  deleteList,
  setListMembership,
  updateList,
} from "@/app/lists/actions";

export function DeleteEntryButton({
  entryId,
  title,
}: {
  entryId: string;
  title: string;
}) {
  return (
    <ConfirmAction
      label="Delete"
      confirmLabel="Delete entry"
      question={`Delete this entry for ${title}? Its score, review, likes and comments are removed everywhere.`}
      action={() => deleteEntry({ id: entryId })}
    />
  );
}

export function RemoveFromWatchlistButton({
  movieId,
  title,
}: {
  movieId: number;
  title: string;
}) {
  return (
    <ConfirmAction
      label="Remove"
      confirmLabel="Remove"
      question={`Remove ${title} from your watchlist?`}
      action={async () => {
        const result = await setWatchlisted({ movieId, watchlisted: false });
        return result.ok ? { ok: true } : result;
      }}
    />
  );
}

export function RemoveFromListButton({
  listId,
  movieId,
  title,
}: {
  listId: string;
  movieId: number;
  title: string;
}) {
  return (
    <ConfirmAction
      label="Remove"
      confirmLabel="Remove"
      question={`Remove ${title} from this list?`}
      action={() => setListMembership({ listId, movieId, included: false })}
    />
  );
}

export function DeleteListButton({
  listId,
  name,
}: {
  listId: string;
  name: string;
}) {
  const router = useRouter();
  return (
    <ConfirmAction
      label="Delete list"
      confirmLabel="Delete list"
      question={`Delete “${name}”? The movies stay in your collection.`}
      action={() => deleteList({ id: listId })}
      onDone={() => router.push("/me/lists")}
      className="text-sm font-semibold text-muted hover:text-ink"
    />
  );
}

/** Create (no id) or rename/describe (with id) a custom list. */
export function ListForm({
  list,
}: {
  list?: { id: string; name: string; description: string | null };
}) {
  const router = useRouter();
  const [name, setName] = useState(list?.name ?? "");
  const [description, setDescription] = useState(list?.description ?? "");
  const [message, setMessage] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const result = list
            ? await updateList({ id: list.id, name, description })
            : await createList({ name, description });
          if (!result.ok)
            return setMessage({ error: true, text: result.error });
          if (list) {
            setMessage({ error: false, text: "Saved." });
            router.refresh();
          } else if ("id" in result) {
            router.push(`/me/lists/${result.id}`);
          }
        });
      }}
    >
      <div>
        <label htmlFor={list ? `list-name-${list.id}` : "new-list-name"}>
          {list ? "Name" : "New list name"}
        </label>
        <input
          id={list ? `list-name-${list.id}` : "new-list-name"}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          required
          disabled={pending}
        />
      </div>
      <div>
        <label
          htmlFor={
            list ? `list-description-${list.id}` : "new-list-description"
          }
        >
          Description (optional)
        </label>
        <textarea
          id={list ? `list-description-${list.id}` : "new-list-description"}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={500}
          rows={2}
          disabled={pending}
          className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-base"
        />
      </div>
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className="text-sm text-muted"
        >
          {message.text}
        </p>
      )}
      <button type="submit" className="button-primary" disabled={pending}>
        {pending ? "Saving…" : list ? "Save changes" : "Create list"}
      </button>
    </form>
  );
}
