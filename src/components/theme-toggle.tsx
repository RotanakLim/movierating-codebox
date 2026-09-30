"use client";
import { Moon, Sun } from "lucide-react";
import { saveTheme } from "@/app/settings/actions";
import { applyTheme } from "@/lib/settings/theme";

/** Quick light/dark switch. Signed-in choices are also saved to the account. */
export function ThemeToggle({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <button
      type="button"
      className="rounded-full border border-line p-2.5 text-muted hover:text-ink"
      aria-label="Toggle light and dark theme"
      onClick={() => {
        const theme = document.documentElement.classList.contains("dark")
          ? "light"
          : "dark";
        applyTheme(theme);
        if (signedIn) saveTheme({ theme }).catch(() => undefined);
      }}
    >
      <Sun size={18} className="hidden dark:block" aria-hidden="true" />
      <Moon size={18} className="dark:hidden" aria-hidden="true" />
    </button>
  );
}
