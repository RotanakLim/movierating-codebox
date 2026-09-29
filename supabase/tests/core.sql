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
select codebox_test.ok((select count(*) = 8 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity), 'all eight public tables have RLS');
select codebox_test.ok(not has_function_privilege('anon', 'public.request_follow(uuid)', 'EXECUTE'), 'guest has no follow RPC grant');
select codebox_test.ok(not has_function_privilege('authenticated', 'codebox_private.handle_auth_signup()', 'EXECUTE'), 'clients cannot invoke privileged trigger function');
select codebox_test.ok((select count(*) = 5 from information_schema.columns where table_schema = 'public' and table_name = 'movies'), 'TMDB cache is minimal');

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
insert into public.rankings(id, movie_id, bucket, position, score, star_half_units, note, watched, watched_date)
 values ('10000000-0000-0000-0000-000000000001', 693134, 'liked', 1, 9.1, 8, 'Beautiful film', true, '2026-01-10');
select codebox_test.ok((select count(*) = 0 from public.list_items i join public.lists l on l.id = i.list_id where l.user_id = auth.uid()), 'watched save removes watchlist item atomically');
select codebox_test.ok((select count(*) = 1 from public.activity where ranking_id = '10000000-0000-0000-0000-000000000001'), 'ranking creates exactly one feed row');
select codebox_test.ok((select summary = 'rotanak ranked Dune: Part Two at 9.1' from public.activity_feed where ranking_id = '10000000-0000-0000-0000-000000000001'), 'feed renders structured ranking summary');
update public.rankings set note = 'Updated review', score = 9.2 where id = '10000000-0000-0000-0000-000000000001';
select codebox_test.ok((select note = 'Updated review' and version = 2 from public.rankings where id = '10000000-0000-0000-0000-000000000001'), 'owner can edit ranking and increments version');
select codebox_test.ok((select count(*) = 1 from public.activity where ranking_id = '10000000-0000-0000-0000-000000000001'), 'editing does not duplicate feed event');
select codebox_test.ok((select summary like '%9.2' from public.activity_feed where ranking_id = '10000000-0000-0000-0000-000000000001'), 'feed score follows edits');
select codebox_test.ok((select a.created_at = r.created_at from public.activity a join public.rankings r on r.id = a.ranking_id where r.id = '10000000-0000-0000-0000-000000000001'), 'editing does not bump feed publication time');
select codebox_test.denied($q$update public.rankings set user_id = '00000000-0000-0000-0000-000000000002'$q$, '42501', 'owner cannot transfer ranking ownership');
select codebox_test.denied($q$insert into public.rankings(movie_id, user_id, score, bucket) values (550, '00000000-0000-0000-0000-000000000002', 8.0, 'liked')$q$, '42501', 'cannot insert a ranking for someone else');
select codebox_test.denied($q$insert into public.rankings(movie_id, score, bucket) values (550, 10.1, 'liked')$q$, '23514', 'score above ten rejected');
select codebox_test.denied($q$insert into public.rankings(movie_id, score, bucket) values (550, 3, 'bad')$q$, '22P02', 'invalid bucket rejected');
select codebox_test.denied($q$insert into public.rankings(movie_id, score, bucket, position) values (550, 3, 'fine', 0)$q$, '23514', 'nonpositive position rejected');
select codebox_test.denied($q$insert into public.rankings(movie_id, watched, note) values (550, false, '   ')$q$, '23514', 'empty unwatched unrated entry rejected including NULL check semantics');
select codebox_test.denied($q$insert into public.rankings(movie_id, watched_date) values (550, current_date + 10)$q$, '23514', 'future watch dates rejected');
select codebox_test.denied($q$insert into public.rankings(movie_id, watched, watched_date) values (550, false, current_date)$q$, '23514', 'unwatched entry cannot have watch date');
select codebox_test.denied($q$insert into public.rankings(movie_id, watched_timezone) values (550, 'not/a/timezone')$q$, '23514', 'invalid watch timezone rejected');
select codebox_test.denied($q$insert into public.rankings(movie_id, star_half_units) values (550, 1)$q$, '23514', 'half-star range matches SPEC');
select codebox_test.denied($q$insert into public.rankings(movie_id, note) values (550, repeat('x', 5001))$q$, '23514', 'oversized review rejected');
select codebox_test.denied($q$insert into public.movies(tmdb_id, title) values (123, 'poison')$q$, '42501', 'clients cannot poison TMDB cache');
select codebox_test.denied($q$insert into public.activity(user_id,movie_id,ranking_id,kind) values (auth.uid(),693134,'10000000-0000-0000-0000-000000000001','ranked')$q$, '42501', 'clients cannot fabricate activity');
select codebox_test.denied($q$update public.activity set kind = 'watched'$q$, '42501', 'clients cannot change feed events');
select codebox_test.denied($q$delete from public.activity$q$, '42501', 'clients cannot delete feed independently');

-- Watchlist remains intact for a rating without a watch.
insert into public.list_items(list_id, movie_id) select id, 329865 from public.lists where user_id = auth.uid() and kind = 'watchlist';
insert into public.rankings(id,movie_id,score,bucket,watched) values ('10000000-0000-0000-0000-000000000002',329865,8.5,'liked',false);
select codebox_test.ok((select count(*) = 1 from public.list_items where movie_id = 329865), 'unwatched rating keeps watchlist item');
insert into public.rankings(id,movie_id,watched) values ('10000000-0000-0000-0000-000000000003',550,true);

-- Rewatch and old backfill; current opinion is date-based, not latest submission.
insert into public.rankings(id,movie_id,score,bucket,watched_date) values
 ('10000000-0000-0000-0000-000000000004',693134,7.0,'fine','2026-06-01'),
 ('10000000-0000-0000-0000-000000000005',693134,2.0,'disliked','2020-01-01'),
 ('10000000-0000-0000-0000-000000000006',693134,10.0,'liked',null);
select codebox_test.ok((select score = 7 from public.current_rankings where user_id = auth.uid() and movie_id = 693134), 'dated latest opinion beats historical backfill and undated rating');
select codebox_test.ok((select count(*) = 1 from public.current_rankings where user_id = auth.uid() and movie_id = 693134), 'current projection contributes once per movie');
insert into public.rankings(id,movie_id,watched_date) values ('10000000-0000-0000-0000-000000000007',693134,'2026-07-01');
select codebox_test.ok((select score = 7 from public.current_rankings where user_id = auth.uid() and movie_id = 693134), 'later unrated watch does not erase opinion');
delete from public.rankings where id = '10000000-0000-0000-0000-000000000004';
select codebox_test.ok((select score = 9.2 from public.current_rankings where user_id = auth.uid() and movie_id = 693134), 'deleting latest opinion restores previous rating');
select codebox_test.ok((select count(*) = 0 from public.activity where ranking_id = '10000000-0000-0000-0000-000000000004'), 'ranking delete cascades feed row');
insert into public.lists(id,name) values ('20000000-0000-0000-0000-000000000001','Favorites');
insert into public.list_items(list_id,movie_id,position) values ('20000000-0000-0000-0000-000000000001',693134,1);
select codebox_test.denied($q$insert into public.list_items(list_id,movie_id) values ('20000000-0000-0000-0000-000000000001',693134)$q$, '23505', 'duplicate list items rejected');

-- Another verified user: public reads do not imply write access.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
update public.users set username = 'alex' where id = auth.uid();
with touched as (update public.rankings set score = 1 where user_id <> auth.uid() returning id)
  select codebox_test.ok((select count(*) = 0 from touched), 'other user cannot edit rankings through direct SQL');
with touched as (delete from public.rankings where user_id <> auth.uid() returning id)
  select codebox_test.ok((select count(*) = 0 from touched), 'other user cannot delete rankings');
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
select codebox_test.denied($q$insert into public.rankings(movie_id,score,bucket) values (550,8,'liked')$q$, '42501', 'unverified user cannot publish rankings');
select codebox_test.denied($q$select public.request_follow('00000000-0000-0000-0000-000000000001')$q$, '42501', 'unverified user cannot follow');

-- Followers-only and friends-only privacy, with approve/decline RPCs.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
update public.users set visibility = 'followers' where id = auth.uid();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
update public.users set username = 'sam' where id = auth.uid();
select codebox_test.ok(public.request_follow('00000000-0000-0000-0000-000000000001') = 'pending', 'restricted profile requires approval');
select codebox_test.ok((select count(*) = 0 from public.users where username = 'rotanak'), 'pending follower cannot read profile');
select codebox_test.ok((select count(*) = 0 from public.rankings where user_id = '00000000-0000-0000-0000-000000000001'), 'pending follower cannot read private watch dates');
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
select codebox_test.ok((select count(*) = 0 from public.rankings where user_id = '00000000-0000-0000-0000-000000000001'), 'guest cannot read private diary');
select codebox_test.ok((select count(*) = 0 from public.lists where user_id = '00000000-0000-0000-0000-000000000001'), 'guest cannot read private lists');
select codebox_test.ok((select count(*) = 0 from public.list_items where list_id = '20000000-0000-0000-0000-000000000001'), 'guest cannot read private list contents');
select codebox_test.ok((select count(*) = 1 from public.user_identities where username = 'rotanak'), 'guest can read private author username and avatar projection');
select codebox_test.ok((select count(*) > 0 from public.public_reviews where user_id = '00000000-0000-0000-0000-000000000001'), 'private authors reviews remain public');
select codebox_test.ok((select count(*) = 0 from public.activity where kind = 'watched'), 'private watched-only events do not leak to feed');
select codebox_test.ok((select count(*) > 0 from public.activity_feed where kind = 'ranked'), 'private authors public ranking activity remains visible');
select codebox_test.denied('select watched_date from public.public_reviews', '42703', 'public reviews do not expose watch date column');
select codebox_test.denied('select watched_date from public.public_current_ratings', '42703', 'public current ratings omit private dates');
select codebox_test.ok((select count(*) = 0 from public.current_rankings where user_id = '00000000-0000-0000-0000-000000000001'), 'raw current collection respects private profile');
select codebox_test.denied('select watched from public.public_reviews', '42703', 'public reviews do not expose watched status');
select codebox_test.denied('select profile from public.user_identities', '42703', 'identity projection contains no private profile');
select codebox_test.denied('select note from public.activity_feed', '42703', 'feed never exposes spoiler text');
select codebox_test.denied($q$insert into public.rankings(movie_id,score,bucket) values (550,8,'liked')$q$, '42501', 'guest cannot create ranking');
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
select codebox_test.ok((select count(*) = 0 from public.rankings where user_id = '00000000-0000-0000-0000-000000000001'), 'auth deletion cascades rankings');
select codebox_test.ok((select count(*) = 0 from public.activity where user_id = '00000000-0000-0000-0000-000000000001'), 'auth deletion cascades feed');
select codebox_test.ok((select count(*) = 0 from public.lists where user_id = '00000000-0000-0000-0000-000000000001'), 'auth deletion cascades lists');
select codebox_test.ok((select count(*) = 3 from public.movies), 'user deletion preserves shared TMDB cache');
