-- Isolated disposable database test suite. Do NOT run this fixture against production.
-- The runner creates a minimal auth schema; the migrations themselves use real
-- Supabase auth.users/auth.uid(). Every actor below is synthetic.
create schema codebox_test;
create table codebox_test.results (label text primary key);
grant usage on schema codebox_test to anon, authenticated, service_role;
grant insert on codebox_test.results to anon, authenticated, service_role;

create function codebox_test.ok(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'FAIL: %', label; end if;
  insert into codebox_test.results values (label);
end;
$$;
create function codebox_test.denied(statement text, expected_state text, label text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected_state then
      insert into codebox_test.results values (label);
      return;
    end if;
    raise exception 'FAIL: % (expected %, got %: %)', label, expected_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % (statement unexpectedly succeeded)', label;
end;
$$;
grant execute on function codebox_test.ok(boolean, text), codebox_test.denied(text, text, text) to anon, authenticated;

select codebox_test.ok((select count(*) = 1 from public.users where id = '00000000-0000-0000-0000-000000000099'), 'migration backfills existing auth users');
select codebox_test.ok((select count(*) = 1 from public.lists where user_id = '00000000-0000-0000-0000-000000000099' and kind = 'watchlist'), 'migration backfills default watchlist');
select codebox_test.ok((select count(*) = 10 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity), 'all ten public tables have RLS');
select codebox_test.ok((select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'no public table lacks RLS');
select codebox_test.ok(not has_function_privilege('anon', 'public.request_follow(uuid)', 'EXECUTE'), 'guest has no follow RPC grant');
select codebox_test.ok(not has_function_privilege('authenticated', 'codebox_private.handle_auth_signup()', 'EXECUTE'), 'clients cannot invoke privileged trigger function');
select codebox_test.ok((select count(*) = 5 from information_schema.columns where table_schema = 'public' and table_name = 'movies'), 'TMDB cache is minimal');
select codebox_test.ok((select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'entries' and column_name in ('score', 'bucket', 'position', 'star_half_units')), 'entries keep only the decimal score: no bucket, position, or star columns');
select codebox_test.ok(to_regclass('public.rankings') is null and to_regclass('public.current_rankings') is null, 'rankings renamed to entries');
select codebox_test.ok((select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'activity' and column_name = 'entry_id'), 'activity references entry_id');
select codebox_test.ok(not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'activity_kind' and e.enumlabel = 'ranked'), 'activity kind ranked renamed to rated');
select codebox_test.ok(to_regtype('public.ranking_bucket') is null, 'ranking_bucket enum removed');

insert into auth.users(id, email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000001', now()),
 ('00000000-0000-0000-0000-000000000002', now()),
 ('00000000-0000-0000-0000-000000000003', now()),
 ('00000000-0000-0000-0000-000000000004', null);
select codebox_test.ok((select count(*) = 4 from public.lists where user_id <> '00000000-0000-0000-0000-000000000099'), 'signup trigger creates a watchlist for each new user');
insert into public.movies(tmdb_id, title, poster, year) values
 (693134, 'Dune: Part Two', '/test.jpg', 2024), (329865, 'Arrival', null, 2016), (550, 'Fight Club', null, 1999);

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
update public.users set username = '  Rotanak  ', profile = '{"display_name":"Rotanak","bio":"Movies"}' where id = auth.uid();
select codebox_test.ok((select username = 'rotanak' from public.users where id = auth.uid()), 'username is normalized');
select codebox_test.denied($q$update public.users set username = 'renamed' where id = auth.uid()$q$, '23514', 'username immutable after onboarding');
select codebox_test.denied($q$update public.users set profile = '{"role":"admin"}' where id = auth.uid()$q$, '23514', 'profile disallows arbitrary privileged fields');
select codebox_test.denied($q$update public.users set avatar = 'javascript:alert(1)' where id = auth.uid()$q$, '23514', 'avatar rejects executable URLs');
insert into public.list_items(list_id, movie_id) select id, 693134 from public.lists where user_id = auth.uid() and kind = 'watchlist';
insert into public.entries(id, movie_id, score, note, watched, watched_date)
 values ('10000000-0000-0000-0000-000000000001', 693134, 9.1, 'Beautiful film', true, '2026-01-10');
select codebox_test.ok((select count(*) = 0 from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = auth.uid()), 'watched save removes watchlist item atomically');
select codebox_test.ok((select count(*) = 1 from public.activity where entry_id = '10000000-0000-0000-0000-000000000001'), 'entry creates exactly one feed row');
select codebox_test.ok((select summary = 'rotanak rated Dune: Part Two 9.1/10' from public.activity_feed where entry_id = '10000000-0000-0000-0000-000000000001'), 'feed renders structured rating summary');
update public.entries set note = 'Updated review', score = 9.5 where id = '10000000-0000-0000-0000-000000000001';
select codebox_test.ok((select note = 'Updated review' and version = 2 from public.entries where id = '10000000-0000-0000-0000-000000000001'), 'owner can edit entry and increments version');
select codebox_test.ok((select count(*) = 1 from public.activity where entry_id = '10000000-0000-0000-0000-000000000001'), 'editing does not duplicate feed event');
select codebox_test.ok((select summary like '% 9.5/10' from public.activity_feed where entry_id = '10000000-0000-0000-0000-000000000001'), 'feed rating follows edits');
select codebox_test.ok((select a.created_at = r.created_at from public.activity a join public.entries r on r.id = a.entry_id where r.id = '10000000-0000-0000-0000-000000000001'), 'editing does not bump feed publication time');
select codebox_test.denied($q$update public.entries set user_id = '00000000-0000-0000-0000-000000000002'$q$, '42501', 'owner cannot transfer entry ownership');
select codebox_test.denied($q$insert into public.entries(movie_id, user_id, score) values (550, '00000000-0000-0000-0000-000000000002', 8.0)$q$, '42501', 'cannot insert an entry for someone else');
select codebox_test.denied($q$insert into public.entries(movie_id, score) values (550, 10.1)$q$, '23514', 'score above ten rejected');
select codebox_test.denied($q$insert into public.entries(movie_id, watched, note) values (550, false, '   ')$q$, '23514', 'empty unwatched unrated entry rejected including NULL check semantics');
select codebox_test.denied($q$insert into public.entries(movie_id, watched_date) values (550, current_date + 10)$q$, '23514', 'future watch dates rejected');
select codebox_test.denied($q$insert into public.entries(movie_id, watched, watched_date) values (550, false, current_date)$q$, '23514', 'unwatched entry cannot have watch date');
select codebox_test.denied($q$insert into public.entries(movie_id, watched_timezone) values (550, 'not/a/timezone')$q$, '23514', 'invalid watch timezone rejected');
select codebox_test.denied($q$insert into public.entries(movie_id, score) values (550, -0.5)$q$, '23514', 'negative score rejected');
select codebox_test.denied($q$insert into public.entries(movie_id, note) values (550, repeat('x', 5001))$q$, '23514', 'oversized review rejected');
select codebox_test.denied($q$insert into public.movies(tmdb_id, title) values (123, 'poison')$q$, '42501', 'clients cannot poison TMDB cache');
select codebox_test.denied($q$insert into public.activity(user_id,movie_id,entry_id,kind) values (auth.uid(),693134,'10000000-0000-0000-0000-000000000001','rated')$q$, '42501', 'clients cannot fabricate activity');
select codebox_test.denied($q$update public.activity set kind = 'watched'$q$, '42501', 'clients cannot change feed events');
select codebox_test.denied($q$delete from public.activity$q$, '42501', 'clients cannot delete feed independently');

-- Watchlist remains intact for a rating without a watch.
insert into public.list_items(list_id, movie_id) select id, 329865 from public.lists where user_id = auth.uid() and kind = 'watchlist';
insert into public.entries(id,movie_id,score,watched) values ('10000000-0000-0000-0000-000000000002',329865,8.5,false);
select codebox_test.ok((select count(*) = 1 from public.list_items where movie_id = 329865), 'unwatched rating keeps watchlist item');
insert into public.entries(id,movie_id,watched) values ('10000000-0000-0000-0000-000000000003',550,true);

-- Rewatch and old backfill; current opinion is date-based, not latest submission.
insert into public.entries(id,movie_id,score,watched_date) values
 ('10000000-0000-0000-0000-000000000004',693134,7.0,'2026-06-01'),
 ('10000000-0000-0000-0000-000000000005',693134,2.0,'2020-01-01'),
 ('10000000-0000-0000-0000-000000000006',693134,10.0,null);
select codebox_test.ok((select score = 7 from public.current_entries where user_id = auth.uid() and movie_id = 693134), 'dated latest opinion beats historical backfill and undated rating');
select codebox_test.ok((select count(*) = 1 from public.current_entries where user_id = auth.uid() and movie_id = 693134), 'current projection contributes once per movie');
insert into public.entries(id,movie_id,watched_date) values ('10000000-0000-0000-0000-000000000007',693134,'2026-07-01');
select codebox_test.ok((select score = 7 from public.current_entries where user_id = auth.uid() and movie_id = 693134), 'later unrated watch does not erase opinion');
delete from public.entries where id = '10000000-0000-0000-0000-000000000004';
select codebox_test.ok((select score = 9.5 from public.current_entries where user_id = auth.uid() and movie_id = 693134), 'deleting latest opinion restores previous rating');
select codebox_test.ok((select count(*) = 0 from public.activity where entry_id = '10000000-0000-0000-0000-000000000004'), 'entry delete cascades feed row');
insert into public.lists(id,name) values ('20000000-0000-0000-0000-000000000001','Favorites');
insert into public.list_items(list_id,movie_id,position) values ('20000000-0000-0000-0000-000000000001',693134,1);
select codebox_test.denied($q$insert into public.list_items(list_id,movie_id) values ('20000000-0000-0000-0000-000000000001',693134)$q$, '23505', 'duplicate list items rejected');

-- Another verified user: public reads do not imply write access.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
update public.users set username = 'alex' where id = auth.uid();
with touched as (update public.entries set score = 1.0 where user_id <> auth.uid() returning id)
  select codebox_test.ok((select count(*) = 0 from touched), 'other user cannot edit entries through direct SQL');
with touched as (delete from public.entries where user_id <> auth.uid() returning id)
  select codebox_test.ok((select count(*) = 0 from touched), 'other user cannot delete entries');
with touched as (update public.users set profile = '{"bio":"hacked"}' where id <> auth.uid() returning id)
  select codebox_test.ok((select count(*) = 0 from touched), 'other user cannot edit profiles');
select codebox_test.denied($q$insert into public.list_items(list_id,movie_id) values ('20000000-0000-0000-0000-000000000001',550)$q$, '42501', 'other user cannot add to someone elses list');
with touched as (update public.list_items set position = 4 where list_id = '20000000-0000-0000-0000-000000000001' returning movie_id)
  select codebox_test.ok((select count(*) = 0 from touched), 'other user cannot reorder someone elses list');
select codebox_test.denied($q$insert into public.follows(follower_id,following_id,status) values (auth.uid(),'00000000-0000-0000-0000-000000000001','accepted')$q$, '42501', 'direct follow insertion cannot bypass approval');
select codebox_test.ok(public.request_follow('00000000-0000-0000-0000-000000000001') = 'accepted', 'public profiles accept follow immediately');
select codebox_test.denied($q$select public.request_follow(auth.uid())$q$, '22023', 'self follow prohibited');

-- Unverified users may choose usernames but cannot publish.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
update public.users set username = 'unverified' where id = auth.uid();
select codebox_test.denied($q$insert into public.entries(movie_id,score) values (550,8.0)$q$, '42501', 'unverified user cannot publish entries');
select codebox_test.denied($q$select public.request_follow('00000000-0000-0000-0000-000000000001')$q$, '42501', 'unverified user cannot follow');

-- Followers-only and friends-only privacy, with approve/decline RPCs.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
update public.users set visibility = 'followers' where id = auth.uid();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
update public.users set username = 'sam' where id = auth.uid();
select codebox_test.ok(public.request_follow('00000000-0000-0000-0000-000000000001') = 'pending', 'restricted profile requires approval');
select codebox_test.ok((select count(*) = 0 from public.users where username = 'rotanak'), 'pending follower cannot read profile');
select codebox_test.ok((select count(*) = 0 from public.entries where user_id = '00000000-0000-0000-0000-000000000001'), 'pending follower cannot read private watch dates');
select codebox_test.denied($q$update public.follows set status = 'accepted'$q$, '42501', 'requester cannot approve with table write');
select codebox_test.denied($q$select public.respond_follow('00000000-0000-0000-0000-000000000003',true)$q$, '22023', 'requester cannot self approve via RPC');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select public.respond_follow('00000000-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select codebox_test.ok((select count(*) = 1 from public.users where username = 'rotanak'), 'approved follower sees followers-only profile');
select codebox_test.ok((select count(*) = 2 from public.lists where user_id = '00000000-0000-0000-0000-000000000001'), 'lists inherit followers privacy');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
update public.users set visibility = 'friends' where id = auth.uid();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select codebox_test.ok((select count(*) = 0 from public.users where username = 'rotanak'), 'one directional follow does not grant friends access');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select public.request_follow('00000000-0000-0000-0000-000000000003');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select codebox_test.ok((select count(*) = 1 from public.users where username = 'rotanak'), 'mutual accepted follows grant friends access');
select public.remove_follow('00000000-0000-0000-0000-000000000001');
select codebox_test.ok((select count(*) = 0 from public.users where username = 'rotanak'), 'unfollow immediately revokes friends access');
select public.request_follow('00000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select public.respond_follow('00000000-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select public.remove_follow('00000000-0000-0000-0000-000000000001');
select codebox_test.denied($q$select public.request_follow('00000000-0000-0000-0000-000000000001')$q$, '22023', 'decline cooldown cannot be bypassed by deleting request');

-- Blocking/unblocking cannot erase a decline cooldown.
insert into public.blocks(blocked_id) values ('00000000-0000-0000-0000-000000000001');
delete from public.blocks where blocked_id = '00000000-0000-0000-0000-000000000001';
select codebox_test.denied($q$select public.request_follow('00000000-0000-0000-0000-000000000001')$q$, '22023', 'decline cooldown survives block and unblock');

-- Private profile still has public identity and public reviews, not diary metadata.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
update public.users set visibility = 'private' where id = auth.uid();
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select codebox_test.ok((select count(*) = 0 from public.users where id = '00000000-0000-0000-0000-000000000001'), 'guest cannot read private profile');
select codebox_test.ok((select count(*) = 0 from public.entries where user_id = '00000000-0000-0000-0000-000000000001'), 'guest cannot read private diary');
select codebox_test.ok((select count(*) = 0 from public.lists where user_id = '00000000-0000-0000-0000-000000000001'), 'guest cannot read private lists');
select codebox_test.ok((select count(*) = 0 from public.list_items where list_id = '20000000-0000-0000-0000-000000000001'), 'guest cannot read private list contents');
select codebox_test.ok((select count(*) = 1 from public.user_identities where username = 'rotanak'), 'guest can read private author username and avatar projection');
select codebox_test.ok((select count(*) > 0 from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000001'), 'private authors reviews remain public');
select codebox_test.ok((select count(*) = 0 from public.activity where kind = 'watched'), 'private watched-only events do not leak to feed');
select codebox_test.ok((select count(*) > 0 from public.activity_feed where kind = 'rated'), 'private authors public rating activity remains visible');
select codebox_test.denied('select watched_date from public.public_reviews', '42703', 'public reviews do not expose watch date column');
select codebox_test.denied('select watched_date from public.public_current_ratings', '42703', 'public current ratings omit private dates');
select codebox_test.ok((select count(*) = 0 from public.current_entries where user_id = '00000000-0000-0000-0000-000000000001'), 'raw current collection respects private profile');
select codebox_test.denied('select watched from public.public_reviews', '42703', 'public reviews do not expose watched status');
select codebox_test.denied('select profile from public.user_identities', '42703', 'identity projection contains no private profile');
select codebox_test.denied('select note from public.activity_feed', '42703', 'feed never exposes spoiler text');
select codebox_test.denied($q$insert into public.entries(movie_id,score) values (550,8.0)$q$, '42501', 'guest cannot create an entry');
select codebox_test.denied('delete from public.public_reviews', '42501', 'public projection is not writable');

-- Bidirectional blocking also filters intentional public projections.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
insert into public.blocks(blocked_id) values ('00000000-0000-0000-0000-000000000001');
select codebox_test.ok((select count(*) = 0 from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000001'), 'blocker cannot read blocked reviews through public projection');
select codebox_test.ok((select count(*) = 0 from public.activity_feed where user_id = '00000000-0000-0000-0000-000000000001'), 'blocker cannot read blocked feed');
select codebox_test.ok((select count(*) = 0 from public.user_identities where username = 'rotanak'), 'blocked identities hidden while signed in');
select codebox_test.denied($q$select public.request_follow('00000000-0000-0000-0000-000000000001')$q$, '42501', 'block prevents new follow request');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select codebox_test.ok((select count(*) = 0 from public.user_identities where username = 'alex'), 'block hides accounts in both directions');
select codebox_test.ok((select count(*) = 0 from public.blocks), 'blocked person cannot inspect someone elses block list');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
delete from public.blocks where blocked_id = '00000000-0000-0000-0000-000000000001';
select codebox_test.ok((select count(*) = 0 from public.follows where follower_id = auth.uid() and following_id = '00000000-0000-0000-0000-000000000001'), 'unblocking does not restore relationships');
select codebox_test.ok((select count(*) > 0 from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000001'), 'unblocking restores public review access');

-- Trusted server role can refresh metadata and use read projections.
set role service_role;
select set_config('request.jwt.claim.sub', '', false);
update public.movies set cached_at = now() where tmdb_id = 550;
select codebox_test.ok((select count(*) > 0 from public.activity_feed), 'trusted backend can read feed projections');
set role authenticated;

-- Owner deletions and auth lifecycle cascades.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
delete from public.lists where id = '20000000-0000-0000-0000-000000000001';
select codebox_test.ok((select count(*) = 0 from public.list_items where list_id = '20000000-0000-0000-0000-000000000001'), 'custom list deletion cascades its items');
with touched as (delete from public.lists where user_id = auth.uid() and kind = 'watchlist' returning id)
  select codebox_test.ok((select count(*) = 0 from touched), 'default watchlist cannot be deleted by client');
select codebox_test.denied($q$delete from public.users where id = auth.uid()$q$, '42501', 'client cannot bypass account deletion by deleting profile');
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-000000000001';
select codebox_test.ok((select count(*) = 0 from public.users where username = 'rotanak'), 'auth deletion cascades profile');
select codebox_test.ok((select count(*) = 0 from public.entries where user_id = '00000000-0000-0000-0000-000000000001'), 'auth deletion cascades entries');
select codebox_test.ok((select count(*) = 0 from public.activity where user_id = '00000000-0000-0000-0000-000000000001'), 'auth deletion cascades feed');
select codebox_test.ok((select count(*) = 0 from public.lists where user_id = '00000000-0000-0000-0000-000000000001'), 'auth deletion cascades lists');
select codebox_test.ok((select count(*) = 3 from public.movies), 'user deletion preserves shared TMDB cache');


-- Persistent movie endpoint limits: server-only, atomic counters, expiration.
set role anon;
select codebox_test.denied($q$select public.consume_movie_request_limit('search', repeat('a',64))$q$, '42501', 'guest cannot manipulate request limits');
set role authenticated;
select codebox_test.denied($q$select public.consume_movie_request_limit('search', repeat('a',64))$q$, '42501', 'user cannot manipulate request limits');
set role service_role;
select codebox_test.denied($q$select * from codebox_private.movie_request_limits$q$, '42501', 'service access limited to counter RPC');
select codebox_test.denied($q$select public.consume_movie_request_limit('search', 'raw-IP')$q$, '22023', 'counter rejects raw identity values');
do $$
declare result jsonb;
begin
  for attempt in 1..60 loop
    result := public.consume_movie_request_limit('search', repeat('a',64));
    if (result ->> 'allowed')::boolean is not true then raise exception 'Search denied before limit'; end if;
  end loop;
  perform codebox_test.ok(not (public.consume_movie_request_limit('search', repeat('a',64)) ->> 'allowed')::boolean, 'search budget enforced at 60 requests');
  for attempt in 1..30 loop
    result := public.consume_movie_request_limit('selection', repeat('b',64));
    if (result ->> 'allowed')::boolean is not true then raise exception 'Selection denied before limit'; end if;
  end loop;
  perform codebox_test.ok(not (public.consume_movie_request_limit('selection', repeat('b',64)) ->> 'allowed')::boolean, 'selection budget enforced at 30 requests');
end;
$$;
select codebox_test.ok((public.consume_movie_request_limit('search',repeat('c',64)) ->> 'allowed')::boolean, 'separate identities have independent quotas');
reset role;
update codebox_private.movie_request_limits set window_started_at = now() - interval '2 minutes' where key_hash = repeat('a',64);
set role service_role;
select codebox_test.ok((public.consume_movie_request_limit('search',repeat('a',64)) ->> 'allowed')::boolean, 'expired counter resets');
reset role;
-- Stale-row cleanup is occasional (random() < 0.01), not on every call.
insert into codebox_private.movie_request_limits values ('search', repeat('d',64), now() - interval '2 days', 1);
do $$
begin
  perform setseed(0.5);
  if random() < 0.01 then raise exception 'Fixture seed must not trigger cleanup'; end if;
  perform setseed(0.5);
  perform public.consume_movie_request_limit('search', repeat('e',64));
end;
$$;
select codebox_test.ok((select count(*) = 1 from codebox_private.movie_request_limits where key_hash = repeat('d',64)), 'a single request does not always run cleanup');
do $$
begin
  -- 0.99^2000 < 1e-8: cleanup is effectively certain to run at least once.
  for attempt in 1..2000 loop
    perform public.consume_movie_request_limit('search', repeat('e',64));
  end loop;
end;
$$;
select codebox_test.ok((select count(*) = 0 from codebox_private.movie_request_limits where key_hash = repeat('d',64)), 'occasional cleanup removes day-old counters');

-- Onboarding: username rules and availability, owner-only preferences and favorites.
insert into auth.users(id, email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000005', now()),
 ('00000000-0000-0000-0000-000000000006', now());
insert into public.movies(tmdb_id, title) values
 (27205, 'Inception'), (157336, 'Interstellar'), (155, 'The Dark Knight'),
 (603, 'The Matrix'), (680, 'Pulp Fiction'), (13, 'Forrest Gump');
update public.users set visibility = 'private' where username = 'sam';
set role anon;
select codebox_test.denied($q$select public.username_status('someone')$q$, '42501', 'guest cannot probe username availability');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
select codebox_test.ok(not codebox_private.can_contribute(), 'user without a username cannot contribute');
select codebox_test.ok(public.username_status('  Cinephile_1 ') = 'available', 'availability normalizes case and spaces');
select codebox_test.ok(public.username_status('ab') = 'invalid', 'username shorter than 3 is invalid');
select codebox_test.ok(public.username_status(repeat('a', 25)) = 'invalid', 'username longer than 24 is invalid');
select codebox_test.ok(public.username_status('film-fan') = 'invalid', 'username with a dash is invalid');
select codebox_test.ok(public.username_status('Onboarding') = 'reserved', 'route names are reserved');
select codebox_test.ok(public.username_status('admin') = 'reserved', 'admin is reserved');
select codebox_test.ok(public.username_status('ALEX') = 'taken', 'existing username is taken case-insensitively');
select codebox_test.ok((select count(*) = 0 from public.users where username = 'sam'), 'private profile row is hidden by RLS');
select codebox_test.ok(public.username_status('sam') = 'taken', 'private profiles still count as taken');
select codebox_test.denied($q$update public.users set username = 'admin' where id = auth.uid()$q$, '23514', 'reserved username rejected on save');
select codebox_test.denied($q$update public.users set username = 'x' where id = auth.uid()$q$, '23514', 'malformed username rejected on save');
select codebox_test.denied($q$update public.users set username = 'ALEX' where id = auth.uid()$q$, '23505', 'duplicate username rejected on save, case-insensitively');
update public.users set username = 'Film_Fan' where id = auth.uid();
select codebox_test.ok((select username = 'film_fan' from public.users where id = auth.uid()), 'claimed username is stored lowercase');
select codebox_test.ok(codebox_private.can_contribute(), 'claiming a username enables contributions');
select codebox_test.ok(public.username_status('film_fan') = 'taken', 'own claimed username reads as taken');
select codebox_test.denied($q$update public.users set username = 'another_name' where id = auth.uid()$q$, '23514', 'claimed username is permanent');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
select codebox_test.denied($q$update public.users set username = 'film_fan' where id = auth.uid()$q$, '23505', 'second user cannot claim the same username');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
insert into public.user_preferences(favorite_genre_ids) values ('{878,18,878}');
select codebox_test.ok((select favorite_genre_ids = '{18,878}' from public.user_preferences where user_id = auth.uid()), 'favorite genres are deduplicated');
select codebox_test.denied($q$update public.user_preferences set favorite_genre_ids = '{999}'$q$, '23514', 'unknown genre IDs rejected');
select codebox_test.denied($q$insert into public.user_preferences(user_id) values ('00000000-0000-0000-0000-000000000006')$q$, '42501', 'cannot write another user preferences');
select public.set_favorite_movies('{157336,27205,155}');
select codebox_test.ok((select array_agg(movie_id order by added_at) = '{157336,27205,155}' from public.user_favorite_movies where user_id = auth.uid()), 'favorites keep the order they were picked in');
select public.set_favorite_movies('{27205,157336,155,603,680}');
select codebox_test.ok((select count(*) = 5 from public.user_favorite_movies where user_id = auth.uid()), 'five favorites allowed; saving replaces the previous set');
select codebox_test.denied($q$select public.set_favorite_movies('{27205,157336,155,603,680,13}')$q$, '22023', 'more than five favorites rejected');
select codebox_test.denied($q$select public.set_favorite_movies('{27205,27205}')$q$, '22023', 'duplicate favorites rejected');
select codebox_test.denied($q$insert into public.user_favorite_movies(movie_id) values (13)$q$, '23514', 'direct insert cannot exceed five favorites');
select codebox_test.denied($q$select public.set_favorite_movies('{424242}')$q$, '23503', 'favorites must reference cached movies');
select codebox_test.ok((select count(*) = 0 from public.entries where user_id = auth.uid()), 'favorites never create entries');
select codebox_test.ok((select count(*) = 0 from public.activity where user_id = auth.uid()), 'favorites never create feed activity');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
select codebox_test.ok((select count(*) = 0 from public.user_preferences), 'preferences are owner-only');
select codebox_test.ok((select count(*) = 0 from public.user_favorite_movies), 'favorites are owner-only');
with touched as (delete from public.user_favorite_movies returning movie_id)
  select codebox_test.ok((select count(*) = 0 from touched), 'other users cannot delete favorites');
set role anon;
select codebox_test.denied($q$select * from public.user_preferences$q$, '42501', 'guests cannot read preferences');
select codebox_test.denied($q$select public.set_favorite_movies('{13}')$q$, '42501', 'guests cannot save favorites');
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-000000000005';
select codebox_test.ok((select count(*) = 0 from public.user_favorite_movies where user_id = '00000000-0000-0000-0000-000000000005'), 'auth deletion cascades favorites');
select codebox_test.ok((select count(*) = 0 from public.user_preferences where user_id = '00000000-0000-0000-0000-000000000005'), 'auth deletion cascades preferences');

-- Entries: score precision, the four entry shapes, and atomic watchlist removal.
insert into auth.users(id, email_confirmed_at) values ('00000000-0000-0000-0000-000000000007', now());
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', false);
update public.users set username = 'logger' where id = auth.uid();
select codebox_test.denied($q$insert into public.entries(movie_id, score) values (27205, 9.55)$q$, '23514', 'score with two decimals rejected, not rounded');
select codebox_test.denied($q$insert into public.entries(movie_id, score) values (27205, 0.05)$q$, '23514', 'score 0.05 rejected');
select codebox_test.denied($q$insert into public.entries(movie_id, score) values (27205, 10.5)$q$, '23514', 'score 10.5 rejected');
select codebox_test.denied($q$insert into public.entries(movie_id, score) values (27205, -0.1)$q$, '23514', 'score -0.1 rejected');
insert into public.entries(id, movie_id, score, watched) values
 ('30000000-0000-0000-0000-000000000001', 27205, 0, false),
 ('30000000-0000-0000-0000-000000000002', 157336, 10, false),
 ('30000000-0000-0000-0000-000000000003', 155, 8, false);
select codebox_test.ok((select array_agg(score::text order by id) = '{0.0,10.0,8.0}' from public.entries where user_id = auth.uid()), 'boundary and whole scores stored with one decimal place');
select codebox_test.ok((select count(*) = 0 from public.entries where user_id = auth.uid() and watched), 'rating-only entries save unwatched');
insert into public.entries(id, movie_id, watched, watched_date) values ('30000000-0000-0000-0000-000000000004', 603, true, current_date);
select codebox_test.ok((select score is null and note is null and watched from public.entries where id = '30000000-0000-0000-0000-000000000004'), 'watched-only entry saves');
insert into public.entries(id, movie_id, watched, note) values ('30000000-0000-0000-0000-000000000005', 680, false, E'Line one\nLine two');
select codebox_test.ok((select note = E'Line one\nLine two' and not watched from public.entries where id = '30000000-0000-0000-0000-000000000005'), 'review-only entry saves and keeps line breaks');
insert into public.entries(id, movie_id, score, note, spoiler, watched, watched_date, watched_timezone) values
 ('30000000-0000-0000-0000-000000000006', 13, 9.5, 'Full entry', true, true, current_date - 3, 'America/New_York');
select codebox_test.ok((select score = 9.5 and spoiler and watched_date = current_date - 3 from public.entries where id = '30000000-0000-0000-0000-000000000006'), 'full entry saves');
select codebox_test.ok((select kind = 'rated' from public.activity where entry_id = '30000000-0000-0000-0000-000000000006'), 'rated entries create rated activity');
select codebox_test.denied($q$insert into public.entries(id, movie_id, score) values ('30000000-0000-0000-0000-000000000006', 13, 7)$q$, '23505', 'a retried client UUID cannot create a duplicate entry');
with touched as (
  update public.entries set note = 'Stale edit' where id = '30000000-0000-0000-0000-000000000006' and version = 99 returning id
) select codebox_test.ok((select count(*) = 0 from touched), 'stale version updates no rows');

-- Watchlist removal happens in the same transaction as the watched save.
insert into public.list_items(list_id, movie_id)
  select id, 27205 from public.lists where user_id = auth.uid() and kind = 'watchlist';
select codebox_test.denied($q$update public.entries set watched = true, score = 9.55 where id = '30000000-0000-0000-0000-000000000001'$q$, '23514', 'failed watched save is rejected');
select codebox_test.ok((select count(*) = 1 from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = auth.uid() and i.movie_id = 27205), 'failed watched save leaves the watchlist item');
update public.entries set note = 'Still unwatched' where id = '30000000-0000-0000-0000-000000000001';
select codebox_test.ok((select count(*) = 1 from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = auth.uid() and i.movie_id = 27205), 'unwatched edit keeps the watchlist item');
update public.entries set watched = true, watched_date = current_date where id = '30000000-0000-0000-0000-000000000001';
select codebox_test.ok((select count(*) = 0 from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = auth.uid() and i.movie_id = 27205), 'marking an entry watched removes the watchlist item atomically');
reset role;

-- Community average: one current score per author, viewer-independent.
insert into auth.users(id, email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000008', now()),
 ('00000000-0000-0000-0000-000000000009', now()),
 ('00000000-0000-0000-0000-000000000010', now());
update public.users set username = 'avg_a' where id = '00000000-0000-0000-0000-000000000008';
update public.users set username = 'avg_b', visibility = 'private' where id = '00000000-0000-0000-0000-000000000009';
update public.users set username = 'avg_c' where id = '00000000-0000-0000-0000-000000000010';
insert into public.movies(tmdb_id, title) values (999001, 'Aggregate Test'), (999002, 'Unrated Test');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', false);
insert into public.entries(movie_id, score, watched_date) values (999001, 4.0, '2026-01-01'), (999001, 8.0, '2026-06-01');
insert into public.entries(movie_id, score, watched_date) values (999001, 2.0, null);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000009', false);
insert into public.entries(movie_id, score, watched) values (999001, 6.5, false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000010', false);
insert into public.entries(movie_id, watched, watched_date) values (999001, true, current_date);
select codebox_test.ok((select average = 7.3 and raters = 2 from public.movie_rating_summary(999001)), 'average uses one current score per author, including private profiles, rounded to one decimal');
select codebox_test.ok((select average is null and raters = 0 from public.movie_rating_summary(999002)), 'unrated movie has no average and zero raters');
insert into public.blocks(blocked_id) values ('00000000-0000-0000-0000-000000000008');
select codebox_test.ok((select count(*) = 1 from public.public_current_ratings where movie_id = 999001), 'viewer-filtered projection hides the blocked author');
select codebox_test.ok((select average = 7.3 and raters = 2 from public.movie_rating_summary(999001)), 'blocking does not change the community average');
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select codebox_test.ok((select raters = 2 from public.movie_rating_summary(999001)), 'guests can read the community average');
select codebox_test.ok((select count(*) = 0 from public.entries where user_id = '00000000-0000-0000-0000-000000000009'), 'the aggregate does not expose the private author''s entry to guests');
reset role;
