import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requirePublicConfig } from "@/lib/env";
import type { Database } from "./database.types";
export async function createClient() {
  const { url, key } = requirePublicConfig();
  const store = await cookies();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          /* Server Components cannot write cookies; middleware refreshes the session. */
        }
      },
    },
  });
}
