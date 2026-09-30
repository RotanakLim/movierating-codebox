"use client";
import { useState } from "react";
import Link from "next/link";
import { ListPlus } from "lucide-react";
import { setListMembership } from "@/app/lists/actions";

export type ListChoice = { id: string; name: string; included: boolean };

/** Add or remove this movie from the viewer's custom lists (optimistic). */
export function AddToLists({
  movieId,
  lists,
}: {
  movieId: number;
  lists: ListChoice[];
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(lists);
  const [error, setError] = useState<string | null>(null);

  async function toggle(list: ListChoice) {
    const next = !list.included;
    setError(null);
    setState((all) =>
      all.map((item) =>
        item.id === list.id ? { ...item, included: next } : item,
      ),
    );
    try {
      const result = await setListMembership({
        listId: list.id,
        movieId,
        included: next,
      });
      if (result.ok) return;
      setError(result.error);
    } catch {
      setError("We couldn't update that list. Please try again.");
    }
    setState((all) =>
      all.map((item) =>
        item.id === list.id ? { ...item, included: !next } : item,
      ),
    );
  }

  return (
    <div>
      <button
        type="button"
        className="button-secondary w-full"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ListPlus size={16} aria-hidden="true" />
        Add to list
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-line p-3 text-sm">
          {state.length ? (
            <ul className="space-y-2">
              {state.map((list) => (
                <li key={list.id}>
                  <label className="mb-0 flex items-center gap-2 font-normal">
                    <input
                      type="checkbox"
                      checked={list.included}
                      onChange={() => toggle(list)}
                      className="h-4 min-h-0 w-4"
                    />
                    {list.name}
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">You don&apos;t have any lists yet.</p>
          )}
          <Link
            href="/me/lists"
            className="mt-3 inline-block text-xs text-accent underline"
          >
            Create or manage lists
          </Link>
          {error && (
            <p role="alert" className="mt-2 text-xs text-muted">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
