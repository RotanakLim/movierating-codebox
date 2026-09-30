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
    create table auth.users (id uuid primary key, email_confirmed_at timestamptz, banned_until timestamptz);
    create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), ''))::jsonb;
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
    -- Reproduce projects with permissive default grants; migrations must revoke them.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    insert into auth.users values ('00000000-0000-0000-0000-000000000099', now());
    -- Minimal stand-in for Supabase Storage's schema (same names and RLS behaviour).
    create schema storage;
    grant usage on schema storage to anon, authenticated, service_role;
    create table storage.buckets (
      id text primary key, name text not null, public boolean default false,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
      name text not null, owner uuid default auth.uid(), created_at timestamptz default now()
    );
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
    create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
    declare _parts text[];
    begin
      select string_to_array(name, '/') into _parts;
      return _parts[1 : array_length(_parts, 1) - 1];
    end $$;
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
