# CodeBox Movies — project rules

- Stack: Next.js 15 App Router, TypeScript, Tailwind 4, Supabase (Postgres/Auth/Storage) via @supabase/ssr, TMDB, Vercel.
- The ONLY rating system is a decimal score 0.0–10.0 with one decimal place (e.g. 1.0, 5.0, 9.5), stored as
  `score numeric(3,1)` (NULL = unrated). No stars/half-stars, no buckets, no comparisons, no manual ranking
  positions. Never reintroduce them.
- SPEC.md is the product source of truth; README.md and DATABASE.md must stay in sync with the code.
- Database changes are NEW forward migrations in supabase/migrations/ (timestamped). Never edit a migration that
  already exists in git. Add assertions for new SQL behavior to supabase/tests/core.sql.
- Normal user reads/writes use the session-bound server client (src/lib/supabase/server.ts) and RLS.
  The service-role client is server-only and limited to the TMDB movie cache, rate limits, admin actions,
  and account-deletion cleanup.
- Validate every mutation on the server with zod (add it as a dependency the first time you need it), check
  getUser() (never getSession()) before writes, and never trust client-supplied owner IDs or scores.
- Before a user can write an entry, list item, or follow, make sure the movie exists in `movies` by reusing
  cacheMovie() in src/lib/supabase/movie-cache.ts (entries have a foreign key to movies).
- Keep secrets out of `NEXT_PUBLIC_*` variables, logs, and git.
- Before finishing: run npm run lint, npm run typecheck, npm test, npm run test:db, npm run build. Fix failures.
- List the files you changed and anything you're unsure about. Then stop and wait for review.
