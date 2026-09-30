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
select codebox_test.ok((select count(*) = 11 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity), 'all eleven public tables have RLS');
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

-- Privacy matrix: every viewer type against every profile mode, with direct queries.
insert into auth.users(id, email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000011', now()),
 ('00000000-0000-0000-0000-000000000012', now()),
 ('00000000-0000-0000-0000-000000000013', now()),
 ('00000000-0000-0000-0000-000000000014', now()),
 ('00000000-0000-0000-0000-000000000015', now()),
 ('00000000-0000-0000-0000-000000000016', now());
update public.users set username = 'pm_owner' where id = '00000000-0000-0000-0000-000000000011';
update public.users set username = 'pm_unrelated' where id = '00000000-0000-0000-0000-000000000012';
update public.users set username = 'pm_pending' where id = '00000000-0000-0000-0000-000000000013';
update public.users set username = 'pm_follower' where id = '00000000-0000-0000-0000-000000000014';
update public.users set username = 'pm_friend' where id = '00000000-0000-0000-0000-000000000015';
update public.users set username = 'pm_blocked' where id = '00000000-0000-0000-0000-000000000016';
insert into public.movies(tmdb_id, title) values (999101, 'Privacy Rated'), (999102, 'Privacy Watched'), (999103, 'Privacy Listed');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', false);
insert into public.entries(movie_id, score, note, watched) values (999101, 8.5, 'Public review text', false);
insert into public.entries(movie_id, watched, watched_date) values (999102, true, '2026-01-02');
insert into public.lists(id, name) values ('40000000-0000-0000-0000-000000000001', 'Owner custom list');
insert into public.list_items(list_id, movie_id) values ('40000000-0000-0000-0000-000000000001', 999103);
insert into public.list_items(list_id, movie_id) select id, 999103 from public.lists where user_id = auth.uid() and kind = 'watchlist';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000013', false);
reset role; update public.users set visibility = 'followers' where id = '00000000-0000-0000-0000-000000000011'; set role authenticated;
select public.request_follow('00000000-0000-0000-0000-000000000011');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000014', false);
reset role; update public.users set visibility = 'followers' where id = '00000000-0000-0000-0000-000000000011'; set role authenticated;
select public.request_follow('00000000-0000-0000-0000-000000000011');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000015', false);
reset role; update public.users set visibility = 'followers' where id = '00000000-0000-0000-0000-000000000011'; set role authenticated;
select public.request_follow('00000000-0000-0000-0000-000000000011');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000016', false);
reset role; update public.users set visibility = 'followers' where id = '00000000-0000-0000-0000-000000000011'; set role authenticated;
select public.request_follow('00000000-0000-0000-0000-000000000011');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', false);
select public.respond_follow('00000000-0000-0000-0000-000000000014', true);
select public.respond_follow('00000000-0000-0000-0000-000000000015', true);
select public.respond_follow('00000000-0000-0000-0000-000000000016', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000015', false);
reset role; update public.users set visibility = 'public' where id = '00000000-0000-0000-0000-000000000015'; set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', false);
select public.request_follow('00000000-0000-0000-0000-000000000015');
insert into public.blocks(blocked_id) values ('00000000-0000-0000-0000-000000000016');
select codebox_test.ok((select count(*) = 0 from public.follows where follower_id = '00000000-0000-0000-0000-000000000016' and following_id = auth.uid()), 'blocking removes the blocked user''s follow');
select codebox_test.ok((select status = 'pending' from public.follows where follower_id = '00000000-0000-0000-0000-000000000013' and following_id = auth.uid()), 'pending follower stays pending');
select codebox_test.ok((select count(*) = 2 from public.follows where status = 'accepted' and ((follower_id = auth.uid() and following_id = '00000000-0000-0000-0000-000000000015') or (follower_id = '00000000-0000-0000-0000-000000000015' and following_id = auth.uid()))), 'friend follows are mutual and accepted');
reset role;

update public.users set visibility = 'public' where id = '00000000-0000-0000-0000-000000000011';
set role anon; select set_config('request.jwt.claim.sub', '', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 1, 'public profile, guest: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, guest: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 1, 'public profile, guest: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, guest: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, guest: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, guest: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000011') >= 1, 'public profile, guest: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = true, 'public profile, guest: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'public profile, guest: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 1, 'public profile, unrelated: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, unrelated: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 1, 'public profile, unrelated: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, unrelated: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, unrelated: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, unrelated: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000012') >= 1, 'public profile, unrelated: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = true, 'public profile, unrelated: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'public profile, unrelated: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000013', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 1, 'public profile, pending: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, pending: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 1, 'public profile, pending: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, pending: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, pending: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, pending: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000013') >= 1, 'public profile, pending: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = true, 'public profile, pending: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'public profile, pending: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000014', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 1, 'public profile, follower: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, follower: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 1, 'public profile, follower: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, follower: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, follower: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, follower: list items');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = true, 'public profile, follower: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'public profile, follower: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000015', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 1, 'public profile, friend: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, friend: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 1, 'public profile, friend: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, friend: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, friend: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, friend: list items');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = true, 'public profile, friend: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'public profile, friend: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 1, 'public profile, owner: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, owner: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 1, 'public profile, owner: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, owner: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, owner: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 2, 'public profile, owner: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000011') >= 1, 'public profile, owner: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = true, 'public profile, owner: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'public profile, owner: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000016', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'public profile, blocked: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'public profile, blocked: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'public profile, blocked: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'public profile, blocked: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'public profile, blocked: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'public profile, blocked: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000016') = 0, 'public profile, blocked: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'public profile, blocked: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'public profile, blocked: public review (independent of profile mode)');
reset role;

update public.users set visibility = 'followers' where id = '00000000-0000-0000-0000-000000000011';
set role anon; select set_config('request.jwt.claim.sub', '', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, guest: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, guest: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'followers profile, guest: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, guest: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, guest: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, guest: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, guest: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'followers profile, guest: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'followers profile, guest: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, unrelated: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, unrelated: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'followers profile, unrelated: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, unrelated: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, unrelated: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, unrelated: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000012') = 0, 'followers profile, unrelated: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'followers profile, unrelated: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'followers profile, unrelated: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000013', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, pending: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, pending: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'followers profile, pending: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, pending: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, pending: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, pending: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000013') = 0, 'followers profile, pending: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'followers profile, pending: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'followers profile, pending: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000014', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 1, 'followers profile, follower: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'followers profile, follower: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 1, 'followers profile, follower: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'followers profile, follower: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'followers profile, follower: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 2, 'followers profile, follower: list items');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = true, 'followers profile, follower: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'followers profile, follower: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000015', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 1, 'followers profile, friend: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'followers profile, friend: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 1, 'followers profile, friend: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'followers profile, friend: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'followers profile, friend: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 2, 'followers profile, friend: list items');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = true, 'followers profile, friend: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'followers profile, friend: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 1, 'followers profile, owner: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'followers profile, owner: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 1, 'followers profile, owner: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'followers profile, owner: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'followers profile, owner: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 2, 'followers profile, owner: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000011') >= 1, 'followers profile, owner: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = true, 'followers profile, owner: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'followers profile, owner: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000016', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, blocked: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, blocked: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'followers profile, blocked: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, blocked: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, blocked: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, blocked: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000016') = 0, 'followers profile, blocked: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'followers profile, blocked: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'followers profile, blocked: public review (independent of profile mode)');
reset role;

update public.users set visibility = 'friends' where id = '00000000-0000-0000-0000-000000000011';
set role anon; select set_config('request.jwt.claim.sub', '', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, guest: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, guest: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'friends profile, guest: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, guest: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, guest: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, guest: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, guest: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'friends profile, guest: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'friends profile, guest: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, unrelated: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, unrelated: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'friends profile, unrelated: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, unrelated: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, unrelated: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, unrelated: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000012') = 0, 'friends profile, unrelated: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'friends profile, unrelated: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'friends profile, unrelated: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000013', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, pending: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, pending: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'friends profile, pending: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, pending: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, pending: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, pending: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000013') = 0, 'friends profile, pending: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'friends profile, pending: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'friends profile, pending: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000014', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, follower: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, follower: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'friends profile, follower: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, follower: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, follower: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, follower: list items');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'friends profile, follower: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'friends profile, follower: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000015', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 1, 'friends profile, friend: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'friends profile, friend: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 1, 'friends profile, friend: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'friends profile, friend: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'friends profile, friend: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 2, 'friends profile, friend: list items');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = true, 'friends profile, friend: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'friends profile, friend: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 1, 'friends profile, owner: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'friends profile, owner: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 1, 'friends profile, owner: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'friends profile, owner: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'friends profile, owner: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 2, 'friends profile, owner: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000011') >= 1, 'friends profile, owner: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = true, 'friends profile, owner: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'friends profile, owner: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000016', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, blocked: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, blocked: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'friends profile, blocked: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, blocked: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, blocked: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, blocked: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000016') = 0, 'friends profile, blocked: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'friends profile, blocked: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'friends profile, blocked: public review (independent of profile mode)');
reset role;

update public.users set visibility = 'private' where id = '00000000-0000-0000-0000-000000000011';
set role anon; select set_config('request.jwt.claim.sub', '', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, guest: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, guest: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'private profile, guest: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, guest: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, guest: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, guest: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000011') = 0, 'private profile, guest: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'private profile, guest: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'private profile, guest: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, unrelated: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, unrelated: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'private profile, unrelated: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, unrelated: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, unrelated: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, unrelated: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000012') = 0, 'private profile, unrelated: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'private profile, unrelated: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'private profile, unrelated: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000013', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, pending: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, pending: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'private profile, pending: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, pending: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, pending: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, pending: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000013') = 0, 'private profile, pending: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'private profile, pending: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'private profile, pending: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000014', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, follower: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, follower: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'private profile, follower: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, follower: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, follower: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, follower: list items');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'private profile, follower: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'private profile, follower: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000015', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, friend: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, friend: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'private profile, friend: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, friend: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, friend: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, friend: list items');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'private profile, friend: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'private profile, friend: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 1, 'private profile, owner: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'private profile, owner: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 1, 'private profile, owner: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'private profile, owner: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 2, 'private profile, owner: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 2, 'private profile, owner: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000011') >= 1, 'private profile, owner: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = true, 'private profile, owner: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 1, 'private profile, owner: public review (independent of profile mode)');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000016', false);
select codebox_test.ok((select count(*) from public.users where id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, blocked: profile row');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, blocked: raw entries (collection and diary)');
select codebox_test.ok((select count(*) from public.entries where user_id = '00000000-0000-0000-0000-000000000011' and watched and score is null) = 0, 'private profile, blocked: watched-only entry');
select codebox_test.ok((select count(*) from public.user_movie_collection where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, blocked: collection rows');
select codebox_test.ok((select count(*) from public.lists where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, blocked: watchlist and custom list');
select codebox_test.ok((select count(*) from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, blocked: list items');
select codebox_test.ok((select count(*) from public.follows where following_id = '00000000-0000-0000-0000-000000000011' and status = 'accepted' and follower_id <> '00000000-0000-0000-0000-000000000016') = 0, 'private profile, blocked: social graph');
select codebox_test.ok((select coalesce(bool_and(can_view), false) from public.profile_card('pm_owner')) = false, 'private profile, blocked: profile_card access flag');
select codebox_test.ok((select count(*) from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000011') = 0, 'private profile, blocked: public review (independent of profile mode)');
reset role;

set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', false);
select codebox_test.ok((select username = 'pm_owner' and visibility = 'private' and not can_view and relationship = 'none' from public.profile_card('pm_owner')), 'restricted shell still gets username and mode');
select codebox_test.ok((select count(*) = 0 from public.users where username = 'pm_owner'), 'restricted shell data does not come from the profile row');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000016', false);
select codebox_test.ok((select relationship = 'unavailable' and avatar is null and visibility is null from public.profile_card('pm_owner')), 'a blocked viewer learns nothing but unavailable');
select codebox_test.ok((select count(*) = 0 from public.my_blocked_users()), 'the blocked user cannot see the blocker''s list');
select codebox_test.denied($q$select public.request_follow('00000000-0000-0000-0000-000000000011')$q$, '42501', 'a blocked viewer cannot request to follow');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', false);
select codebox_test.ok((select relationship = 'blocked' from public.profile_card('pm_blocked')), 'the blocker sees their own block');
select codebox_test.ok((select array_agg(username) = '{pm_blocked}' from public.my_blocked_users()), 'the blocker can list whom they blocked');
select codebox_test.ok((select count(*) = 0 from public.user_identities where username = 'pm_blocked'), 'blocked accounts stay hidden from public identities');
select codebox_test.ok((select relationship = 'self' and can_view from public.profile_card('pm_owner')), 'owner sees their own profile');
select codebox_test.ok((select count(*) = 0 from public.profile_card('nobody_here')), 'unknown usernames return no card');
reset role;

-- Reports: verified users only, one open report per target, never readable by clients.
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', false);
insert into public.reports(target_user_id, reason, details) values ('00000000-0000-0000-0000-000000000011', 'spam', 'Posts ads');
select codebox_test.denied($q$insert into public.reports(target_user_id, reason) values ('00000000-0000-0000-0000-000000000011', 'harassment')$q$, '23505', 'one open report per reporter and target');
select codebox_test.denied($q$insert into public.reports(target_user_id, reason) values ('00000000-0000-0000-0000-000000000012', 'spam')$q$, '23514', 'users cannot report themselves');
select codebox_test.denied($q$insert into public.reports(target_user_id, reason, details) values ('00000000-0000-0000-0000-000000000013', 'other', repeat('x', 1001))$q$, '23514', 'report details are limited to 1,000 characters');
select codebox_test.denied($q$insert into public.reports(target_user_id, reason, status) values ('00000000-0000-0000-0000-000000000013', 'spam', 'resolved')$q$, '42501', 'reporters cannot set a report status');
select codebox_test.denied($q$select * from public.reports$q$, '42501', 'reporters cannot read reports');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', false);
select codebox_test.denied($q$select * from public.reports$q$, '42501', 'reported users cannot read reports about them');
reset role;


-- Settings: avatar storage policies, account theme, and account deletion.
insert into auth.users(id, email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000020', now()),
 ('00000000-0000-0000-0000-000000000021', now());
update public.users set username = 'leaving' where id = '00000000-0000-0000-0000-000000000020';
update public.users set username = 'staying' where id = '00000000-0000-0000-0000-000000000021';
insert into auth.sessions(user_id) values ('00000000-0000-0000-0000-000000000020'), ('00000000-0000-0000-0000-000000000020'), ('00000000-0000-0000-0000-000000000021');
select codebox_test.ok((select public and file_size_limit = 2097152 and allowed_mime_types = '{image/webp}' from storage.buckets where id = 'avatars'), 'avatars bucket is public, 2 MB, stores only the server''s WebP output');
insert into auth.users(id, email_confirmed_at) values ('00000000-0000-0000-0000-000000000022', now());

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000020', false);
insert into storage.objects(bucket_id, name) values ('avatars', '00000000-0000-0000-0000-000000000020/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp');
select codebox_test.ok((select count(*) = 1 from storage.objects where bucket_id = 'avatars'), 'owner can upload to and see their own avatar folder');
select codebox_test.denied($q$insert into storage.objects(bucket_id, name) values ('avatars', '00000000-0000-0000-0000-000000000021/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp')$q$, '42501', 'cannot upload into another user''s avatar folder');
select codebox_test.denied($q$insert into storage.objects(bucket_id, name) values ('avatars', '00000000-0000-0000-0000-000000000020/nested/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp')$q$, '42501', 'avatar uploads cannot use nested folders');
select codebox_test.denied($q$insert into storage.objects(bucket_id, name) values ('avatars', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp')$q$, '42501', 'avatar uploads must be inside the owner folder');
select codebox_test.denied($q$insert into storage.objects(bucket_id, name) values ('avatars', '00000000-0000-0000-0000-000000000020/face.webp')$q$, '42501', 'avatar file names must be the server''s random UUID');
select codebox_test.denied($q$insert into storage.objects(bucket_id, name) values ('avatars', '00000000-0000-0000-0000-000000000020/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png')$q$, '42501', 'avatar files must be WebP');
insert into storage.objects(bucket_id, name) values
 ('avatars', '00000000-0000-0000-0000-000000000020/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp'),
 ('avatars', '00000000-0000-0000-0000-000000000020/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp');
select codebox_test.denied($q$insert into storage.objects(bucket_id, name) values ('avatars', '00000000-0000-0000-0000-000000000020/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp')$q$, '42501', 'at most three avatar files per user');
delete from storage.objects where name like '00000000-0000-0000-0000-000000000020/bbbb%' or name like '00000000-0000-0000-0000-000000000020/cccc%';
select codebox_test.ok((select count(*) = 1 from storage.objects where bucket_id = 'avatars'), 'owners can remove their own avatar files');
update public.users set avatar = '00000000-0000-0000-0000-000000000020/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp' where id = auth.uid();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000022', false);
select codebox_test.denied($q$insert into storage.objects(bucket_id, name) values ('avatars', '00000000-0000-0000-0000-000000000022/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp')$q$, '42501', 'accounts without a username cannot upload avatars');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000020', false);
select codebox_test.denied($q$update public.users set avatar = '00000000-0000-0000-0000-000000000021/face.webp' where id = auth.uid()$q$, '23514', 'profile avatar must point into the owner folder');
insert into public.user_preferences(theme) values ('dark');
select codebox_test.denied($q$update public.user_preferences set theme = 'neon'$q$, '23514', 'theme must be system, light or dark');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000021', false);
select codebox_test.ok((select count(*) = 0 from storage.objects where bucket_id = 'avatars'), 'other users cannot list someone''s avatar files');
with touched as (delete from storage.objects where bucket_id = 'avatars' returning id)
  select codebox_test.ok((select count(*) = 0 from touched), 'other users cannot delete someone''s avatar');
select codebox_test.ok((select count(*) = 0 from public.user_preferences where user_id = '00000000-0000-0000-0000-000000000020'), 'account theme is private');
insert into public.reports(target_user_id, reason, details) values ('00000000-0000-0000-0000-000000000020', 'spam', 'Names leaving');
set role anon;
select codebox_test.denied($q$insert into storage.objects(bucket_id, name) values ('avatars', 'x/face.webp')$q$, '42501', 'guests cannot upload avatars');
select codebox_test.denied($q$select public.request_account_deletion('leaving')$q$, '42501', 'guests cannot request account deletion');

-- The leaving user has content everywhere, then deletes their account.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000020', false);
insert into public.entries(movie_id, score, note, watched) values (27205, 7.5, 'Goodbye review', false);
insert into public.lists(name) values ('Leaving list');
insert into public.list_items(list_id, movie_id) select id, 157336 from public.lists where user_id = auth.uid() and kind = 'custom';
select public.request_follow('00000000-0000-0000-0000-000000000021');
insert into public.reports(target_user_id, reason, details) values ('00000000-0000-0000-0000-000000000021', 'other', 'Details about staying');
select codebox_test.denied($q$select * from public.pending_account_deletions()$q$, '42501', 'users cannot read the deletion queue');
select codebox_test.denied($q$select public.request_account_deletion('leaving')$q$, '42501', 'deletion needs a sign-in time in the token');
select set_config('request.jwt.claims', jsonb_build_object('sub', auth.uid(), 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 3600)))::text, false);
select codebox_test.denied($q$select public.request_account_deletion('leaving')$q$, '42501', 'deletion needs a sign-in within the last 10 minutes, even when called directly');
select set_config('request.jwt.claims', jsonb_build_object('sub', auth.uid(), 'amr', jsonb_build_array('password', null, jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 60)))::text, false);
select codebox_test.denied($q$select public.request_account_deletion('staying')$q$, '22023', 'deletion needs the account''s own username typed, even when called directly');
select codebox_test.denied($q$select public.request_account_deletion(null)$q$, '22023', 'deletion refuses a missing confirmation');
select codebox_test.ok((select count(*) = 1 from public.users where id = auth.uid()), 'refused deletion requests change nothing');
select public.request_account_deletion(' Leaving ');
select set_config('request.jwt.claims', '', false);
select public.request_account_deletion('leaving');
select codebox_test.ok(true, 'repeating the deletion request is harmless');
select codebox_test.denied($q$insert into public.entries(movie_id, score) values (27205, 5.0)$q$, '42501', 'a deleted account can no longer contribute, even with a live token');
reset role;
select codebox_test.ok((select banned_until > now() + interval '50 years' from auth.users where id = '00000000-0000-0000-0000-000000000020'), 'sign-in is disabled immediately');
select codebox_test.ok((select count(*) = 0 from auth.sessions where user_id = '00000000-0000-0000-0000-000000000020'), 'every session is ended immediately');
select codebox_test.ok((select count(*) = 1 from auth.sessions where user_id = '00000000-0000-0000-0000-000000000021'), 'other people keep their sessions');
select codebox_test.ok((select count(*) = 0 from public.users where id = '00000000-0000-0000-0000-000000000020'), 'profile is removed immediately');
select codebox_test.ok((select count(*) = 0 from public.entries where user_id = '00000000-0000-0000-0000-000000000020'), 'ratings and reviews are removed immediately');
select codebox_test.ok((select count(*) = 0 from public.activity where user_id = '00000000-0000-0000-0000-000000000020'), 'feed events are removed immediately');
select codebox_test.ok((select count(*) = 0 from public.lists where user_id = '00000000-0000-0000-0000-000000000020'), 'watchlist and lists are removed immediately');
select codebox_test.ok((select count(*) = 0 from public.follows where follower_id = '00000000-0000-0000-0000-000000000020' or following_id = '00000000-0000-0000-0000-000000000020'), 'relationships are removed immediately');
select codebox_test.ok((select count(*) = 0 from public.user_preferences where user_id = '00000000-0000-0000-0000-000000000020'), 'preferences are removed immediately');
select codebox_test.ok((select count(*) = 2 and bool_and(details is null) from public.reports where reporter_id is null or target_user_id is null), 'reports involving the account remain, anonymised and redacted');
select codebox_test.ok((select count(*) = 1 from public.reports where reporter_id is null and target_user_id = '00000000-0000-0000-0000-000000000021'), 'a report filed by the deleted user keeps only the non-identifying target');
set role service_role;
select codebox_test.ok((select count(*) = 1 from public.pending_account_deletions() where user_id = '00000000-0000-0000-0000-000000000020'), 'cleanup is queued for the server');
select public.record_account_deletion_attempt('00000000-0000-0000-0000-000000000020', 'storage timeout');
select codebox_test.ok((select attempts = 1 from public.pending_account_deletions() where user_id = '00000000-0000-0000-0000-000000000020'), 'a failed cleanup attempt stays queued for retry');
select public.record_account_deletion_attempt('00000000-0000-0000-0000-000000000020');
select codebox_test.ok((select count(*) = 0 from public.pending_account_deletions() where user_id = '00000000-0000-0000-0000-000000000020'), 'a successful cleanup leaves the queue');
reset role;
select codebox_test.ok((select completed_at is not null and last_error is null and attempts = 2 from codebox_private.account_deletions where user_id = '00000000-0000-0000-0000-000000000020'), 'the queue keeps a minimal completion record');
delete from auth.users where id = '00000000-0000-0000-0000-000000000020';
select codebox_test.ok((select count(*) = 0 from public.users where id = '00000000-0000-0000-0000-000000000020'), 'deleting the auth identity never restores the profile');
set role service_role;
do $$
begin
  for attempt in 1..10 loop
    if (public.consume_movie_request_limit('avatar', repeat('d',64)) ->> 'allowed')::boolean is not true then raise exception 'Avatar upload denied before limit'; end if;
  end loop;
  perform codebox_test.ok(not (public.consume_movie_request_limit('avatar', repeat('d',64)) ->> 'allowed')::boolean, 'avatar uploads are limited to 10 per hour');
  perform codebox_test.ok((public.consume_movie_request_limit('avatar', repeat('d',64)) ->> 'retry_after')::integer > 600, 'the avatar limit window is an hour');
  for attempt in 1..5 loop
    if (public.consume_movie_request_limit('reauth', repeat('e',64)) ->> 'allowed')::boolean is not true then raise exception 'Re-check denied before limit'; end if;
  end loop;
  perform codebox_test.ok(not (public.consume_movie_request_limit('reauth', repeat('e',64)) ->> 'allowed')::boolean, 'password re-checks are limited to 5 per 15 minutes');
end;
$$;
reset role;

-- The retry queue serves the least-attempted rows first, so failures can't starve newer work.
insert into codebox_private.account_deletions(user_id, requested_at, attempts) values
 ('00000000-0000-0000-0000-0000000000f1', now() - interval '3 days', 9),
 ('00000000-0000-0000-0000-0000000000f2', now() - interval '1 hour', 0);
set role service_role;
select codebox_test.ok((select user_id = '00000000-0000-0000-0000-0000000000f2' from public.pending_account_deletions(1)), 'retries prefer rows with fewer failed attempts');
select codebox_test.ok((select count(*) = 1 from public.pending_account_deletions(0)), 'the queue always returns at least one row per call');
select public.record_account_deletion_attempt('00000000-0000-0000-0000-0000000000f1');
select public.record_account_deletion_attempt('00000000-0000-0000-0000-0000000000f1', 'late failure');
reset role;
select codebox_test.ok((select attempts = 10 and last_error is null and completed_at is not null from codebox_private.account_deletions where user_id = '00000000-0000-0000-0000-0000000000f1'), 'a completed cleanup is never reopened by a later attempt record');
delete from codebox_private.account_deletions where user_id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2');

-- Deletion queue invariants, function privileges, theme values and avatar file management.
reset role;

-- Queue fixtures: 105 unfinished rows with increasing request times, plus one done row.
insert into codebox_private.account_deletions(user_id, requested_at)
select ('00000000-0000-0000-0001-' || lpad(i::text, 12, '0'))::uuid,
       timestamptz '2026-01-01' + (i || ' minutes')::interval
from generate_series(1, 105) i;
insert into codebox_private.account_deletions(user_id, requested_at, attempts, completed_at)
values ('00000000-0000-0000-0002-000000000001', timestamptz '2025-01-01', 3, now());

set role service_role;
select codebox_test.ok((select count(*) = 1 from public.pending_account_deletions(0)), 'pending_account_deletions clamps max_rows 0 up to 1');
select codebox_test.ok((select count(*) = 1 from public.pending_account_deletions(-5)), 'pending_account_deletions clamps negative max_rows up to 1');
select codebox_test.ok((select count(*) = 100 from public.pending_account_deletions(1000)), 'pending_account_deletions clamps max_rows down to 100');
select codebox_test.ok((select count(*) = 100 from public.pending_account_deletions(null)), 'pending_account_deletions treats NULL max_rows as the 100 cap');
select codebox_test.ok((select count(*) = 20 from public.pending_account_deletions()), 'pending_account_deletions defaults to 20 rows');
select codebox_test.ok((select user_id = '00000000-0000-0000-0001-000000000001' from public.pending_account_deletions(1)), 'among equal attempts, the oldest request comes first');
select codebox_test.ok((select count(*) = 0 from public.pending_account_deletions(100) where user_id = '00000000-0000-0000-0002-000000000001'), 'completed rows are never pending, even if older');

-- record_account_deletion_attempt must not touch completed rows.
select public.record_account_deletion_attempt('00000000-0000-0000-0002-000000000001', 'late failure');
select public.record_account_deletion_attempt('00000000-0000-0000-0002-000000000001');
reset role;
select codebox_test.ok((select attempts = 3 and last_error is null and completed_at is not null from codebox_private.account_deletions where user_id = '00000000-0000-0000-0002-000000000001'), 'recording an attempt never reopens or changes a completed row');
set role service_role;

-- Failure text is truncated; a success clears a previous error.
select public.record_account_deletion_attempt('00000000-0000-0000-0001-000000000002', repeat('x', 900));
reset role;
select codebox_test.ok((select length(last_error) = 500 and attempts = 1 and completed_at is null from codebox_private.account_deletions where user_id = '00000000-0000-0000-0001-000000000002'), 'failure reasons are truncated to 500 characters');
set role service_role;
select public.record_account_deletion_attempt('00000000-0000-0000-0001-000000000002');
reset role;
select codebox_test.ok((select last_error is null and attempts = 2 and completed_at is not null from codebox_private.account_deletions where user_id = '00000000-0000-0000-0001-000000000002'), 'a later success clears the previous error');
set role service_role;
select public.record_account_deletion_attempt('00000000-0000-0000-0003-000000000001', 'unknown');
reset role;
select codebox_test.ok((select count(*) = 0 from codebox_private.account_deletions where user_id = '00000000-0000-0000-0003-000000000001'), 'recording an attempt for an unknown user creates nothing');

-- Function privileges.
select codebox_test.ok(not has_function_privilege('authenticated', 'public.record_account_deletion_attempt(uuid, text)', 'EXECUTE'), 'users cannot record deletion attempts');
select codebox_test.ok(not has_function_privilege('anon', 'public.record_account_deletion_attempt(uuid, text)', 'EXECUTE'), 'guests cannot record deletion attempts');
select codebox_test.ok(not has_function_privilege('anon', 'public.pending_account_deletions(integer)', 'EXECUTE'), 'guests cannot read the deletion queue');
select codebox_test.ok(not has_function_privilege('anon', 'public.request_account_deletion(text)', 'EXECUTE'), 'guests have no request_account_deletion grant');
select codebox_test.ok(has_function_privilege('authenticated', 'public.request_account_deletion(text)', 'EXECUTE'), 'users can request their own deletion');
select codebox_test.ok(not has_table_privilege('service_role', 'codebox_private.account_deletions', 'SELECT'), 'even the service role reads the queue only through the functions');
select codebox_test.ok(not has_table_privilege('authenticated', 'codebox_private.account_deletions', 'SELECT'), 'users cannot read the deletion queue table');

-- Avatar request limit scope still rejects unknown scopes.
set role service_role;
select codebox_test.denied($q$select public.consume_movie_request_limit('upload', repeat('e', 64))$q$, '22023', 'unknown request limit scopes are still rejected');
select codebox_test.denied($q$select public.consume_movie_request_limit('avatar', 'not-a-hash')$q$, '22023', 'avatar limit keys must be hashes');
select codebox_test.ok(((public.consume_movie_request_limit('avatar', repeat('f', 64)) ->> 'allowed')::boolean), 'avatar limit buckets are separate per key');
reset role;
select codebox_test.ok(not has_function_privilege('authenticated', 'public.consume_movie_request_limit(text, text)', 'EXECUTE'), 'users cannot consume request limits directly');

-- Theme column behaviour and avatar self-management.
insert into auth.users(id, email_confirmed_at) values ('00000000-0000-0000-0000-000000000030', now()), ('00000000-0000-0000-0000-000000000031', now());
update public.users set username = 'themer' where id = '00000000-0000-0000-0000-000000000030';
update public.users set username = 'other_themer' where id = '00000000-0000-0000-0000-000000000031';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000031', false);
insert into public.user_preferences(theme) values ('light');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000030', false);
insert into public.user_preferences(theme) values ('system');
select codebox_test.ok((select theme = 'system' from public.user_preferences where user_id = auth.uid()), 'system is a valid stored theme');
update public.user_preferences set theme = null where user_id = auth.uid();
select codebox_test.ok((select theme is null from public.user_preferences where user_id = auth.uid()), 'theme can be reset to never-chosen (NULL)');
with touched as (update public.user_preferences set theme = 'dark' where user_id = '00000000-0000-0000-0000-000000000031' returning 1)
  select codebox_test.ok((select count(*) = 0 from touched), 'users cannot change someone else''s theme');
select codebox_test.denied($q$update public.user_preferences set user_id = '00000000-0000-0000-0000-000000000031' where user_id = auth.uid()$q$, '42501', 'users cannot move their preferences row to another user');
insert into storage.objects(bucket_id, name) values ('avatars', '00000000-0000-0000-0000-000000000030/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.webp');
with touched as (update storage.objects set name = '00000000-0000-0000-0000-000000000031/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.webp' where bucket_id = 'avatars' returning 1)
  select codebox_test.ok((select count(*) = 0 from touched), 'avatar files cannot be moved into another folder (no update policy)');
with touched as (delete from storage.objects where bucket_id = 'avatars' and name = '00000000-0000-0000-0000-000000000030/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.webp' returning 1)
  select codebox_test.ok((select count(*) = 1 from touched), 'owners can delete their own avatar files');
select codebox_test.denied($q$insert into storage.objects(bucket_id, name) values ('other-bucket', '00000000-0000-0000-0000-000000000030/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.webp')$q$, '42501', 'the avatar policies do not open other buckets');
reset role;
select set_config('request.jwt.claim.sub', '', false);
