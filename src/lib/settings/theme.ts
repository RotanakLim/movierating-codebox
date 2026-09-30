export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_KEY = "codebox-theme";
/** Window event fired with the new theme whenever it is applied. */
export const THEME_CHANGED = "codebox:theme-changed";

export function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

/** The theme this browser remembers ("system" when nothing is stored). */
export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/**
 * Apply a theme and remember it in this browser. The inline script in the root
 * layout reads the same key before first paint, so pages never flash; "system"
 * removes the key and follows the operating system again.
 */
export function applyTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* Storage can be unavailable in private contexts. */
  }
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  window.dispatchEvent(new CustomEvent(THEME_CHANGED, { detail: theme }));
}
