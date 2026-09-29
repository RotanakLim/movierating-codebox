"use client";
import { Moon, Sun } from "lucide-react";
export function ThemeToggle() {
  return (
    <button
      type="button"
      className="rounded-full border border-line p-2.5 text-muted hover:text-ink"
      aria-label="Toggle light and dark theme"
      onClick={() => {
        const dark = document.documentElement.classList.toggle("dark");
        try {
          localStorage.setItem("codebox-theme", dark ? "dark" : "light");
        } catch {
          /* Storage can be unavailable in private contexts. */
        }
      }}
    >
      <Sun size={18} className="hidden dark:block" aria-hidden="true" />
      <Moon size={18} className="dark:hidden" aria-hidden="true" />
    </button>
  );
}
