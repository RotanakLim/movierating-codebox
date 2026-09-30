"use client";
import { useEffect } from "react";
import { clearAllDrafts } from "@/lib/entries/drafts";

/** Removes unsent entry drafts from this tab, e.g. once an account is deleted. */
export function ClearDrafts() {
  useEffect(() => clearAllDrafts(), []);
  return null;
}
