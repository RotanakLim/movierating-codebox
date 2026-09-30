"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Focus for an inline panel (a confirmation or a small form) that opens in place:
 * the returned ref's element gets focus when the panel mounts, and focus goes back
 * to whatever opened it when the panel closes, unless focus has already moved on.
 */
export function usePanelFocus<T extends HTMLElement>() {
  const first = useRef<T>(null);
  // Read during the first render, before any effect moves focus into the panel
  // (StrictMode runs effects twice, so reading it in the effect could find the
  // panel's own button). Panels only open in the browser, after a click.
  const [opener] = useState(() =>
    typeof document !== "undefined" &&
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  useEffect(() => {
    first.current?.focus();
    return () => {
      const current = document.activeElement;
      if (opener?.isConnected && (!current || current === document.body))
        opener.focus();
    };
  }, [opener]);
  return first;
}
