"use client";
import { useActionState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { saveGenres } from "@/app/onboarding/actions";
import { MOVIE_GENRES } from "@/lib/movies/types";

export function GenreForm({
  next,
  selected,
  skipHref,
}: {
  next: string;
  selected: number[];
  skipHref: string;
}) {
  const [state, action, pending] = useActionState(saveGenres, {});
  return (
    <form action={action} className="mt-8">
      <input type="hidden" name="next" value={next} />
      <fieldset>
        <legend className="sr-only">Favorite genres</legend>
        <div className="flex flex-wrap gap-2">
          {MOVIE_GENRES.map(([id, name]) => (
            <label key={id} className="mb-0 cursor-pointer font-normal">
              <input
                type="checkbox"
                name="genre"
                value={id}
                defaultChecked={selected.includes(id)}
                className="peer sr-only"
              />
              <span className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent [&>svg]:hidden peer-checked:[&>svg]:inline">
                <Check size={14} aria-hidden="true" />
                {name}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {state.error && (
        <p role="alert" className="error mt-5">
          {state.error}
        </p>
      )}
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button className="button-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
          {!pending && <ArrowRight size={16} aria-hidden="true" />}
        </button>
        <Link href={skipHref} className="text-sm text-muted hover:text-ink">
          Skip for now
        </Link>
      </div>
    </form>
  );
}
