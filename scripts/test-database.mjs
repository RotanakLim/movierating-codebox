import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";

// Isolated PostgreSQL engine, not mocked SQL. Only Supabase's auth schema/roles
// are stubbed; never load .env.local and never connect to a hosted database.
const root = new URL("../", import.meta.url);
const db = new PGlite();
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    -- Reproduce projects with permissive default grants; migrations must revoke them.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    insert into auth.users values ('00000000-0000-0000-0000-000000000099', now());
  `);
  const migrationDir = new URL("supabase/migrations/", root);
  for (const file of (await readdir(migrationDir))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(await readFile(new URL(file, migrationDir), "utf8"));
    console.log(`Applied ${file}`);
  }
  const testFile = new URL("supabase/tests/core.sql", root);
  await db.exec(await readFile(testFile, "utf8"));
  const { rows } = await db.query(
    "select count(*)::int as count from codebox_test.results",
  );
  console.log(
    `Passed ${rows[0].count} PostgreSQL schema, behavior, and RLS assertions.`,
  );
  console.log(
    "Auth-role harness only; hosted Supabase/PostgREST deployment has not been applied.",
  );
} catch (error) {
  console.error(`Database verification failed: ${error.message}`);
  if (error.where) console.error(error.where);
  if (error.detail) console.error(error.detail);
  process.exitCode = 1;
} finally {
  await db.close();
}
