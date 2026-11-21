-- [PTS-10] Penalty rules that build up on missed items (WP-121, D-154, D-157): save_penalty_rule() and
-- what it refuses; day close adds a rule's amount for each linked chore its person missed between its
-- dates, up to its max, and nothing for a day done, skipped, covered, off, outside the dates or while
-- penalties are off; Mark done on time takes a miss back and Uncheck adds it again; Record paid on a
-- rule; who may; the board's snapshot; the points register.
begin;
select plan(46);

insert into auth.users (id, email) values
  ('66100000-0000-0000-0000-0000000000a1', 'alex@example.com'),
  ('66100000-0000-0000-0000-0000000000b1', 'other@example.com'),
  ('66100000-0000-0000-0000-0000000000d1', 'board@example.com');
insert into public.household (id, name, timezone, week_start) values
  ('66000000-0000-0000-0000-000000000001', 'Rule family', 'America/Chicago', 1),
  ('66000000-0000-0000-0000-000000000002', 'Another family', 'America/Chicago', 1);
insert into public.household_settings (household_id, penalties_on) values
  ('66000000-0000-0000-0000-000000000001', true), ('66000000-0000-0000-0000-000000000002', true);
insert into public.household_user (household_id, user_id, role) values
  ('66000000-0000-0000-0000-000000000001', '66100000-0000-0000-0000-0000000000a1', 'owner'),
  ('66000000-0000-0000-0000-000000000002', '66100000-0000-0000-0000-0000000000b1', 'owner');
insert into public.member (id, household_id, display_name, role, user_id, earns_rewards) values
  ('66110000-0000-0000-0000-0000000000a1', '66000000-0000-0000-0000-000000000001', 'Alex', 'adult', '66100000-0000-0000-0000-0000000000a1', false),
  ('66110000-0000-0000-0000-00000000000a', '66000000-0000-0000-0000-000000000001', 'Maya', 'child', null, true),
  ('66110000-0000-0000-0000-00000000000b', '66000000-0000-0000-0000-000000000001', 'Leo', 'child', null, true),
  ('66110000-0000-0000-0000-00000000000c', '66000000-0000-0000-0000-000000000002', 'Kim', 'child', null, true);
insert into public.device (id, household_id, name, auth_user_id) values
  ('66d00000-0000-4000-8000-000000000001', '66000000-0000-0000-0000-000000000001', 'Kitchen', '66100000-0000-0000-0000-0000000000d1');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('66000000-0000-0000-0000-000000000001') $$;
create function pg_temp.as_user(p_user text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true) $$;
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('66100000-0000-0000-0000-0000000000a1') $$;
create function pg_temp.as_board() returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', '66100000-0000-0000-0000-0000000000d1', 'role', 'authenticated',
           'app_metadata', json_build_object('role', 'device', 'device_id', '66d00000-0000-4000-8000-000000000001'))::text, true) $$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from ids where k = p_k $$;
create function pg_temp.occ(p_chore int, p_day int) returns uuid language sql as $$
  select id from public.chore_occurrence
   where chore_id = ('66c00000-0000-0000-0000-00000000000' || p_chore)::uuid and due_date = pg_temp.today() + p_day $$;
-- A rule as the form sends it.
create function pg_temp.rule(p_name text, p_reason text, p_members text[], p_scope text, p_chores text[],
                             p_start int, p_end int, p_amount int, p_max int, p_tag uuid default null,
                             p_id uuid default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('id', p_id, 'name', p_name, 'reason_id', pg_temp.id(p_reason),
           'member_ids', to_jsonb(p_members), 'scope', p_scope, 'chore_ids', to_jsonb(p_chores), 'tag_id', p_tag,
           'start_date', pg_temp.today() + p_start, 'end_date', pg_temp.today() + p_end,
           'amount', p_amount, 'max_amount', p_max)) $$;
-- A parent's check-off change, through record_completions as the caller.
create function pg_temp.mark(p_occ uuid, p_type text, p_on_time boolean default false,
                             p_done_by text default '66110000-0000-0000-0000-00000000000b',
                             p_id uuid default gen_random_uuid()) returns text
language sql as $$
  select r ->> 'result' from jsonb_array_elements(public.record_completions(jsonb_build_array(
           jsonb_strip_nulls(jsonb_build_object('id', p_id, 'occurrence_id', p_occ, 'event_type', p_type,
             'occurred_at', now(), 'marked_on_time', p_on_time,
             'done_by', case when p_type = 'admin_complete' then jsonb_build_array(p_done_by) end))))) r $$;

-- The household's chores, planned from 8 days ago. Each assignee's own (shared with one person) unless said.
--   1 Homework folder home (Maya)   2 Feed the fish (Leo)   3 Bed by 8 (Leo, tag Bedtime)   4 Call grandma (a task)
--   5 Dishes, once 2 days ago (Maya and Leo; Leo does it)   6 Dishes, once 3 days ago (Maya and Leo; nobody does)
--   7 Reading, once yesterday (Maya; yesterday becomes a day off for it)
insert into public.tag (id, household_id, name) values
  ('66e00000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001', 'Bedtime'),
  ('66e00000-0000-0000-0000-000000000002', '66000000-0000-0000-0000-000000000002', 'Theirs');
insert into public.chore (id, household_id, title, kind, points, schedule, created_by, start_date, approval) values
  ('66c00000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001', 'Homework folder home', 'chore', 5, '{"freq": "daily"}', null, pg_temp.today() - 8, 'none'),
  ('66c00000-0000-0000-0000-000000000002', '66000000-0000-0000-0000-000000000001', 'Feed the fish', 'chore', 2, '{"freq": "daily"}', null, pg_temp.today() - 8, 'none'),
  ('66c00000-0000-0000-0000-000000000003', '66000000-0000-0000-0000-000000000001', 'Bed by 8', 'chore', 2, '{"freq": "daily"}', null, pg_temp.today() - 8, 'none'),
  ('66c00000-0000-0000-0000-000000000004', '66000000-0000-0000-0000-000000000001', 'Call grandma', 'task', 0, '{"freq": "daily"}', null, pg_temp.today() - 8, 'none'),
  ('66c00000-0000-0000-0000-000000000005', '66000000-0000-0000-0000-000000000001', 'Dishes', 'chore', 2, jsonb_build_object('freq', 'once', 'on_date', pg_temp.today() - 2), null, pg_temp.today() - 2, 'none'),
  ('66c00000-0000-0000-0000-000000000006', '66000000-0000-0000-0000-000000000001', 'Dishes too', 'chore', 2, jsonb_build_object('freq', 'once', 'on_date', pg_temp.today() - 3), null, pg_temp.today() - 3, 'none'),
  ('66c00000-0000-0000-0000-000000000007', '66000000-0000-0000-0000-000000000001', 'Reading', 'chore', 2, jsonb_build_object('freq', 'once', 'on_date', pg_temp.today() - 1), null, pg_temp.today() - 1, 'none'),
  ('66c00000-0000-0000-0000-000000000009', '66000000-0000-0000-0000-000000000002', 'Their chore', 'chore', 2, '{"freq": "daily"}', null, pg_temp.today() - 8, 'none');
insert into public.chore_tag (household_id, chore_id, tag_id) values
  ('66000000-0000-0000-0000-000000000001', '66c00000-0000-0000-0000-000000000003', '66e00000-0000-0000-0000-000000000001');
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('66000000-0000-0000-0000-000000000001', '66c00000-0000-0000-0000-000000000001', '66110000-0000-0000-0000-00000000000a'),
  ('66000000-0000-0000-0000-000000000001', '66c00000-0000-0000-0000-000000000002', '66110000-0000-0000-0000-00000000000b'),
  ('66000000-0000-0000-0000-000000000001', '66c00000-0000-0000-0000-000000000003', '66110000-0000-0000-0000-00000000000b'),
  ('66000000-0000-0000-0000-000000000001', '66c00000-0000-0000-0000-000000000004', '66110000-0000-0000-0000-00000000000a'),
  ('66000000-0000-0000-0000-000000000001', '66c00000-0000-0000-0000-000000000005', '66110000-0000-0000-0000-00000000000a'),
  ('66000000-0000-0000-0000-000000000001', '66c00000-0000-0000-0000-000000000005', '66110000-0000-0000-0000-00000000000b'),
  ('66000000-0000-0000-0000-000000000001', '66c00000-0000-0000-0000-000000000006', '66110000-0000-0000-0000-00000000000a'),
  ('66000000-0000-0000-0000-000000000001', '66c00000-0000-0000-0000-000000000006', '66110000-0000-0000-0000-00000000000b'),
  ('66000000-0000-0000-0000-000000000001', '66c00000-0000-0000-0000-000000000007', '66110000-0000-0000-0000-00000000000a'),
  ('66000000-0000-0000-0000-000000000002', '66c00000-0000-0000-0000-000000000009', '66110000-0000-0000-0000-00000000000c');
select private.generate_occurrences('66000000-0000-0000-0000-000000000001', pg_temp.today() - 8, pg_temp.today());
-- Yesterday is no longer a day Reading is due for Maya (a day off, a no-school day).
update public.chore set day_types = array(select t from unnest(array['school_day', 'no_school', 'break', 'weekend', 'summer']) t
                                           where t <> public.resolve_day_type('66110000-0000-0000-0000-00000000000a', pg_temp.today() - 1))
 where id = '66c00000-0000-0000-0000-000000000007';
-- Done 5 days ago, skipped 4 days ago; Leo does the Dishes 2 days ago (covered for Maya).
insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at) values
  (gen_random_uuid(), pg_temp.occ(1, -5), 'admin_complete', array['66110000-0000-0000-0000-00000000000a'::uuid], now()),
  (gen_random_uuid(), pg_temp.occ(1, -4), 'skip', '{}', now()),
  (gen_random_uuid(), pg_temp.occ(5, -2), 'admin_complete', array['66110000-0000-0000-0000-00000000000b'::uuid], now());

-- PTS-10-a: adding and changing a rule ------------------------------------------------------------
select pg_temp.parent();
insert into ids values
  ('folder', public.add_penalty_reason('66000000-0000-0000-0000-000000000001', 'Homework folder not home', 'money', 100)),
  ('bed', public.add_penalty_reason('66000000-0000-0000-0000-000000000001', 'Up after bedtime', 'points', 5));
insert into ids values ('r1', public.save_penalty_rule('66000000-0000-0000-0000-000000000001',
  pg_temp.rule('Folder', 'folder', array['66110000-0000-0000-0000-00000000000a'], 'items',
               array['66c00000-0000-0000-0000-000000000001'], 0, 60, 100, 1000)));
select is((select name || ' ' || unit || ' ' || amount || ' ' || max_amount || ' ' || scope || ' ' || (accrued_through = start_date - 1)
             from public.penalty_rule where id = pg_temp.id('r1')),
  'Folder money 100 1000 items true', '[PTS-10-a] a parent adds a rule in its reason''s unit, worked out from its start');
select is(public.save_penalty_rule('66000000-0000-0000-0000-000000000001',
  pg_temp.rule('Folder home', 'folder', array['66110000-0000-0000-0000-00000000000a'], 'items',
               array['66c00000-0000-0000-0000-000000000001', '66c00000-0000-0000-0000-000000000002',
                     '66c00000-0000-0000-0000-000000000006', '66c00000-0000-0000-0000-000000000005',
                     '66c00000-0000-0000-0000-000000000007'], 0, 60, 100, 450, null, pg_temp.id('r1'))),
  pg_temp.id('r1'), '[PTS-10-a] and changes it');
select is((select name || ' ' || max_amount || ' ' || (select count(*) from public.penalty_rule_chore c where c.rule_id = r.id)
             from public.penalty_rule r where id = pg_temp.id('r1')),
  'Folder home 450 5', '[PTS-10-a] the change is kept, with its chores');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '66000000-0000-0000-0000-000000000001',
  pg_temp.rule('X', 'folder', array['66110000-0000-0000-0000-00000000000a'], 'all', null, 5, 4, 100, 100)),
  '22023', 'an end on or after the start', '[PTS-10-a] an end before the start is refused');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '66000000-0000-0000-0000-000000000001',
  pg_temp.rule('X', 'folder', array['66110000-0000-0000-0000-00000000000a'], 'all', null, -1, 4, 100, 100)),
  '22023', 'a rule starts today or later', '[PTS-10-a] a new rule starting before today is refused');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '66000000-0000-0000-0000-000000000001',
  pg_temp.rule('X', 'folder', array['66110000-0000-0000-0000-00000000000a'], 'all', null, 0, 4, 100, 99)),
  '22023', 'a max no less than the amount', '[PTS-10-a] a max below the amount is refused');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '66000000-0000-0000-0000-000000000001',
  pg_temp.rule(' ', 'folder', array['66110000-0000-0000-0000-00000000000a'], 'all', null, 0, 4, 100, 100)),
  '22023', 'name the rule, in up to 80 characters', '[PTS-10-a] a rule without a name is refused');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '66000000-0000-0000-0000-000000000001',
  pg_temp.rule('X', 'folder', array['66110000-0000-0000-0000-00000000000a'], 'items',
               array['66c00000-0000-0000-0000-000000000009'], 0, 4, 100, 100)),
  '22023', 'choose chores of this household', '[PTS-10-a] another household''s chore is refused');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '66000000-0000-0000-0000-000000000001',
  pg_temp.rule('X', 'folder', array['66110000-0000-0000-0000-00000000000a'], 'items',
               array['66c00000-0000-0000-0000-000000000004'], 0, 4, 100, 100)),
  '22023', 'choose chores of this household', '[PTS-10-a] a task is refused (a task is never missed)');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '66000000-0000-0000-0000-000000000001',
  pg_temp.rule('X', 'folder', array['66110000-0000-0000-0000-00000000000a'], 'tag', null, 0, 4, 100, 100,
               '66e00000-0000-0000-0000-000000000002')),
  '22023', 'choose a tag of this household', '[PTS-10-a] another household''s tag is refused');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '66000000-0000-0000-0000-000000000001',
  pg_temp.rule('X', 'folder', array['66110000-0000-0000-0000-00000000000c'], 'all', null, 0, 4, 100, 100)),
  '22023', 'choose people who earn rewards', '[PTS-10-a] another household''s child is refused');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '66000000-0000-0000-0000-000000000001',
  pg_temp.rule('X', 'folder', array['66110000-0000-0000-0000-0000000000a1'], 'all', null, 0, 4, 100, 100)),
  '22023', 'choose people who earn rewards', '[PTS-10-a] someone who doesn''t earn rewards is refused');
insert into ids values ('r2', public.save_penalty_rule('66000000-0000-0000-0000-000000000001',
  pg_temp.rule('Bed by 8', 'bed', array['66110000-0000-0000-0000-00000000000b'], 'tag', null, 0, 60, 5, 12,
               '66e00000-0000-0000-0000-000000000001')));
select pg_temp.as_user('66100000-0000-0000-0000-0000000000b1');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '66000000-0000-0000-0000-000000000001',
  pg_temp.rule('X', 'folder', array['66110000-0000-0000-0000-00000000000a'], 'all', null, 0, 4, 100, 100)),
  '42501', 'not allowed', '[PTS-10-a] another household''s parent cannot add a rule');

-- The rules started 6 days ago (as if made then); Bed by 8 ended 2 days ago.
select pg_temp.as_owner();
update public.penalty_rule set start_date = pg_temp.today() - 6, accrued_through = pg_temp.today() - 7;
update public.penalty_rule set end_date = pg_temp.today() - 2 where id = pg_temp.id('r2');

-- PTS-10-c: nothing while penalties are off, and those days aren't worked out again -------------
update public.household_settings set penalties_on = false where household_id = '66000000-0000-0000-0000-000000000001';
select is((public.close_household_day('66000000-0000-0000-0000-000000000001') ->> 'penalties')::integer, 0,
  '[PTS-10-c] day close adds nothing while penalties are off');
select is((select array_agg(accrued_through - pg_temp.today() order by name) from public.penalty_rule),
  array[-2, -1], '[PTS-10-c] and those days are worked out, not added later');
update public.household_settings set penalties_on = true where household_id = '66000000-0000-0000-0000-000000000001';
update public.penalty_rule set accrued_through = pg_temp.today() - 7;

-- PTS-10-b: day close adds each miss --------------------------------------------------------------
select is((public.close_household_day('66000000-0000-0000-0000-000000000001') ->> 'penalties')::integer, 8,
  '[PTS-10-b] day close adds a penalty for each miss it counts');
select is((select array_agg((missed_on - pg_temp.today()) || ':' || amount order by missed_on, amount)
             from public.penalty where rule_id = pg_temp.id('r1')),
  array['-6:100', '-3:100', '-3:100', '-2:100', '-1:50'],
  '[PTS-10-b] Maya''s missed folder days and the Dishes nobody did, $1 each, the last only to the max');
select is((select count(*) from public.penalty where rule_id = pg_temp.id('r1')
             and (given_by is not null or reason <> 'Folder home' or unit <> 'money')), 0::bigint,
  '[PTS-10-b] each with the rule''s name, in money, given by nobody (the system)');
select is((select array_agg(amount || ' ' || reason || ' ' || created_by_type order by created_at, amount)
             from public.points_ledger where member_id = '66110000-0000-0000-0000-00000000000b' and entry_type = 'penalty'),
  array['-5 Bed by 8, missed ' || trim(to_char(pg_temp.today() - 6, 'FMDay')) || ' system',
        '-5 Bed by 8, missed ' || trim(to_char(pg_temp.today() - 5, 'FMDay')) || ' system',
        '-2 Bed by 8, missed ' || trim(to_char(pg_temp.today() - 4, 'FMDay')) || ' system'],
  '[PTS-10-b][PTS-10-d] a points miss is a penalty entry "Bed by 8, missed Tuesday", by the system, up to the max of 12');
select is((public.close_household_day('66000000-0000-0000-0000-000000000001') ->> 'penalties')::integer, 0,
  '[PTS-10-b] closing again adds nothing');
select is((select count(*) from public.penalty), 8::bigint, '[PTS-10-b] and nothing is added twice');

-- PTS-10-c: what never adds ----------------------------------------------------------------------
select is((select count(*) from public.penalty where occurrence_id in (pg_temp.occ(1, -5), pg_temp.occ(1, -4))), 0::bigint,
  '[PTS-10-c] a day done or skipped adds nothing');
select is((select count(*) from public.penalty where occurrence_id = pg_temp.occ(5, -2)), 0::bigint,
  '[PTS-10-c] a day covered (someone else did it) adds nothing');
select is((select count(*) from public.penalty where occurrence_id = pg_temp.occ(7, -1)), 0::bigint,
  '[PTS-10-c] a day the item isn''t due for them (a day off) adds nothing');
select is((select count(*) from public.penalty where missed_on < pg_temp.today() - 6
              or (rule_id = pg_temp.id('r2') and missed_on > pg_temp.today() - 2)), 0::bigint,
  '[PTS-10-c] a day before the start or after the end adds nothing');
select is((select count(*) from public.penalty where member_id = '66110000-0000-0000-0000-00000000000b'
              and rule_id = pg_temp.id('r1')), 0::bigint,
  '[PTS-10-c] someone the rule isn''t for (Leo''s fish, Leo''s Dishes) adds nothing');
select is((select count(*) from public.penalty p join public.chore_occurrence o on o.id = p.occurrence_id
            where o.chore_id = '66c00000-0000-0000-0000-000000000004'), 0::bigint,
  '[PTS-10-c] a task adds nothing');

-- PTS-10-f: Record paid on a rule ----------------------------------------------------------------
select pg_temp.parent();
select is((public.record_penalty_rule_paid(pg_temp.id('r1'), '66110000-0000-0000-0000-00000000000a', 150,
             '66f00000-0000-0000-0000-000000000001') ->> 'owed')::integer, 300,
  '[PTS-10-f] Record paid on a rule lowers what is owed on it');
select is((select array_agg(x.amount || '@' || (p.missed_on - pg_temp.today()) order by p.missed_on, x.amount desc)
             from public.penalty_payment x join public.penalty p on p.id = x.penalty_id where p.rule_id = pg_temp.id('r1')),
  array['100@-6', '50@-3'], '[PTS-10-f] spread over its misses, oldest first');
select is((public.record_penalty_rule_paid(pg_temp.id('r1'), '66110000-0000-0000-0000-00000000000a', 150,
             '66f00000-0000-0000-0000-000000000001') ->> 'owed')::integer, 300,
  '[PTS-10-f] a resend records it once');
select throws_ok($$ select public.record_penalty_rule_paid(pg_temp.id('r1'), '66110000-0000-0000-0000-00000000000a', 301,
                   '66f00000-0000-0000-0000-000000000002') $$,
  '22023', 'up to what is owed', '[PTS-10-f] more than is owed is refused');
select throws_ok($$ select public.record_penalty_rule_paid(pg_temp.id('r2'), '66110000-0000-0000-0000-00000000000b', 1,
                   '66f00000-0000-0000-0000-000000000003') $$,
  '22023', 'a points penalty is settled when it is taken', '[PTS-10-f] a points rule has nothing to pay');

-- PTS-10-d: paid down, a later miss adds again -----------------------------------------------------
select pg_temp.as_owner();
insert into public.chore (id, household_id, title, kind, points, schedule, start_date, approval) values
  ('66c00000-0000-0000-0000-000000000008', '66000000-0000-0000-0000-000000000001', 'Pack bag', 'chore', 2, jsonb_build_object('freq', 'once', 'on_date', pg_temp.today() - 1), pg_temp.today() - 1, 'none');
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('66000000-0000-0000-0000-000000000001', '66c00000-0000-0000-0000-000000000008', '66110000-0000-0000-0000-00000000000a');
insert into public.penalty_rule_chore (household_id, rule_id, chore_id) values
  ('66000000-0000-0000-0000-000000000001', pg_temp.id('r1'), '66c00000-0000-0000-0000-000000000008');
select private.generate_occurrences('66000000-0000-0000-0000-000000000001', pg_temp.today() - 1, pg_temp.today() - 1);
update public.penalty_rule set accrued_through = pg_temp.today() - 2 where id = pg_temp.id('r1');
select is((public.close_household_day('66000000-0000-0000-0000-000000000001') ->> 'penalties')::integer, 1,
  '[PTS-10-d] once paid down, a new miss adds again (and a day already added is not added twice)');
select is(private.penalty_rule_held(pg_temp.id('r1'), '66110000-0000-0000-0000-00000000000a'), 400,
  '[PTS-10-d] up to the max again: $4 owed');

-- PTS-10-e: Mark done on time takes a miss back; Uncheck adds it again ----------------------------
select pg_temp.parent();
select is(pg_temp.mark(pg_temp.occ(3, -6), 'admin_complete', true), 'recorded', '[PTS-10-e] a parent marks Leo''s Bed by 8 done on time');
select is((select taken_back_on_time::text || ' ' || (taken_back_by = '66100000-0000-0000-0000-0000000000a1')
             from public.penalty where occurrence_id = pg_temp.occ(3, -6)),
  'true true', '[PTS-10-e] what that miss added is taken back, by the parent who marked it');
select is((select amount || ' ' || reason from public.points_ledger
            where member_id = '66110000-0000-0000-0000-00000000000b' and entry_type = 'penalty' and amount > 0),
  '5 Bed by 8, missed ' || trim(to_char(pg_temp.today() - 6, 'FMDay')) || ', marked on time',
  '[PTS-10-e] its points are given back once');
select is(pg_temp.mark(pg_temp.occ(3, -5), 'admin_complete'), 'recorded', '[PTS-10-e] an ordinary late Mark done');
select is((select taken_back_at from public.penalty where occurrence_id = pg_temp.occ(3, -5)), null,
  '[PTS-10-e] takes nothing back');
-- In one transaction every event has the same time, so the uncheck's id breaks the tie as the later.
select is(pg_temp.mark(pg_temp.occ(3, -6), 'admin_uncomplete', false, null, 'ffffffff-0000-0000-0000-000000000001'), 'recorded', '[PTS-10-e] Uncheck after Mark done on time');
select is((select array_agg(amount || ' ' || (taken_back_at is null) order by given_at, taken_back_at nulls last)
             from public.penalty where occurrence_id = pg_temp.occ(3, -6)),
  array['5 false', '5 true'], '[PTS-10-e] adds the miss again, up to the max');

-- PTS-10-g: who may --------------------------------------------------------------------------------
select throws_ok($$ insert into public.penalty_rule (household_id, name, reason_id, unit, amount, max_amount, scope,
                                                     start_date, end_date)
                    values ('66000000-0000-0000-0000-000000000001', 'X', pg_temp.id('folder'), 'money', 1, 1, 'all',
                            current_date, current_date) $$,
  '42501', null, '[PTS-10-g] nobody adds a rule but through save_penalty_rule()');
select pg_temp.as_user('66100000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.penalty_rule), 0::bigint, '[PTS-10-g] another household''s parent reads no rules');
select pg_temp.as_board();
select is((select (select count(*) from public.penalty_rule) || ' ' || (select count(*) > 0 from public.penalty where rule_id is not null)),
  '0 true', '[PTS-10-g] a board reads the misses a rule added, not the rule');

-- PTS-10-h: the board's snapshot -------------------------------------------------------------------
select is((select o - 'id' from jsonb_array_elements(public.board_snapshot() -> 'members') m,
                  jsonb_array_elements(m -> 'owes') o
            where m ->> 'display_name' = 'Maya' and (o ->> 'rule')::boolean),
  jsonb_build_object('reason', 'Folder home', 'owed', 400, 'rule', true,
                     'missed', jsonb_build_array(pg_temp.today() - 3, pg_temp.today() - 2, pg_temp.today() - 1)),
  '[PTS-10-h] a rule''s misses are one line of what Maya owes: its name, what is owed and the days still owed');

-- PTS-10-i: the points register --------------------------------------------------------------------
select pg_temp.parent();
select is((select array_agg(distinct penalty_rule) from public.points_register('66000000-0000-0000-0000-000000000001',
             array['66110000-0000-0000-0000-00000000000b']::uuid[], array['penalty'])),
  array['Bed by 8'], '[PTS-10-i] the register lists a rule''s misses as Penalty, naming the rule');

select * from finish();
rollback;
