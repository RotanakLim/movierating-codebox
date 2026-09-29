"use client";
import { createBrowserClient } from "@supabase/ssr";
import { requirePublicConfig } from "@/lib/env";
export function createClient() {
  const { url, key } = requirePublicConfig();
  return createBrowserClient(url, key);
}
