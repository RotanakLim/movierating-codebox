"use client";
import { createBrowserClient } from "@supabase/ssr";
import { requirePublicConfig } from "@/lib/env";
import type { Database } from "./database.types";
export function createClient() {
  const { url, key } = requirePublicConfig();
  return createBrowserClient<Database>(url, key);
}
