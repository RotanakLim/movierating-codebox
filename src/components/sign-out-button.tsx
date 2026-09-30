"use client";
import { signOut } from "@/app/auth/actions";
import { clearAllDrafts } from "@/lib/entries/drafts";

/** Sign-out that also removes unsent entry drafts from this browser tab. */
export function SignOutButton() {
  return (
    <form action={signOut} onSubmit={() => clearAllDrafts()}>
      <button className="button-secondary" type="submit">
        Sign out
      </button>
    </form>
  );
}
