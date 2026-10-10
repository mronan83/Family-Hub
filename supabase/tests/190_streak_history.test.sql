-- [RWD-11][RWD-12] Streak history and insights (WP-17, D-55): 14 days of a child's three routines, made
-- with completion events as the board and a parent would, then closed. The facts the engine reads,
-- the history it makes (the hand-computed table below, which lib/history.test.ts gets from the engine
-- for the same days), a rebuild leaving every row identical, the marks that make a member's history
-- stale, a parent's insights, the board's flame, and who may do what.
--
-- Days d1..d14 (d14 is yesterday). Make bed (Morning, 5), Brush teeth (Morning, 2) and Set the table
-- (Kitchen, 5, needs a parent) are Kid's:
--   d1 d2 d4 d8 d9 d10 d12 d14  all three done                      good
--   d3   teeth checked off, then unchecked by a parent (missed)    bad
--   d5   the table skipped                                         good
--   d6   bed and teeth not done; the table sent back (all missed)  bad
--   d7   bed not done                                              bad
--   d11  all three skipped                                         neutral
--   d13  Sib set the table (covered for Kid)                       good
-- Runs: good d1-d2 (2), bad d3 (1), good d4-d5 (2), bad d6-d7 (2), good d8-d14 (6, going; d11 passes).
begin;
select plan(27);

insert into auth.users (id, email) values
  ('19100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('19300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('19d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('19000000-0000-0000-0000-000000000001', 'History family', 'America/Chicago'),
  ('19000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('19000000-0000-0000-0000-000000000001'), ('19000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('19000000-0000-0000-0000-000000000001', '19100000-0000-0000-0000-000000000001', 'owner'),
  ('19000000-0000-0000-0000-000000000002', '19300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('19110000-0000-0000-0000-00000000000a', '19000000-0000-0000-0000-000000000001', 'Kid', 'child'),
  ('19110000-0000-0000-0000-00000000000b', '19000000-0000-0000-0000-000000000001', 'Sib', 'child');
insert into public.device (id, household_id, name, auth_user_id) values
  ('19dd0000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 'Kitchen', '19d00000-0000-0000-0000-00000000000d');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('19000000-0000-0000-0000-000000000001')
$$;
create function pg_temp.d(k int) returns date language sql as $$ select pg_temp.today() - 15 + k $$;
create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_job() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
end $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;

insert into public.tag (id, household_id, name) values
  ('19a00000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 'Morning'),
  ('19a00000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000001', 'Kitchen');
insert into public.chore (id, household_id, title, kind, points, schedule, created_by, start_date, approval) values
  ('19c00000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 'Make bed', 'chore', 5,
   '{"freq": "daily"}', '19100000-0000-0000-0000-000000000001', pg_temp.today() - 20, 'inherit'),
  ('19c00000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000001', 'Brush teeth', 'chore', 2,
   '{"freq": "daily"}', '19100000-0000-0000-0000-000000000001', pg_temp.today() - 20, 'inherit'),
  ('19c00000-0000-0000-0000-000000000003', '19000000-0000-0000-0000-000000000001', 'Set the table', 'chore', 5,
   '{"freq": "daily"}', '19100000-0000-0000-0000-000000000001', pg_temp.today() - 20, 'required');
insert into public.chore_tag (household_id, chore_id, tag_id) values
  ('19000000-0000-0000-0000-000000000001', '19c00000-0000-0000-0000-000000000001', '19a00000-0000-0000-0000-000000000001'),
  ('19000000-0000-0000-0000-000000000001', '19c00000-0000-0000-0000-000000000002', '19a00000-0000-0000-0000-000000000001'),
  ('19000000-0000-0000-0000-000000000001', '19c00000-0000-0000-0000-000000000003', '19a00000-0000-0000-0000-000000000002');
insert into public.chore_assignee (household_id, chore_id, member_id)
select '19000000-0000-0000-0000-000000000001', c, '19110000-0000-0000-0000-00000000000a'
  from unnest(array['19c00000-0000-0000-0000-000000000001', '19c00000-0000-0000-0000-000000000002',
                    '19c00000-0000-0000-0000-000000000003']::uuid[]) c;
select private.generate_occurrences('19000000-0000-0000-0000-000000000001', pg_temp.d(1), pg_temp.d(14));

create function pg_temp.occ(p_chore int, p_k int) returns uuid language sql as $$
  select id from public.chore_occurrence
   where chore_id = ('19c00000-0000-0000-0000-00000000000' || p_chore)::uuid and due_date = pg_temp.d(p_k)
$$;
-- An event at a time on day k (household-local), recorded as the database would.
create function pg_temp.ev(p_chore int, p_k int, p_type text, p_at time, p_by uuid default null) returns void
language sql as $$
  insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
  values (gen_random_uuid(), pg_temp.occ(p_chore, p_k), p_type,
          case when p_by is null then '{}'::uuid[] else array[p_by] end,
          (pg_temp.d(p_k) + p_at) at time zone 'America/Chicago')
$$;

do $$
declare
  kid constant uuid := '19110000-0000-0000-0000-00000000000a';
  sib constant uuid := '19110000-0000-0000-0000-00000000000b';
  k int;
begin
  for k in 1..14 loop
    if k = 11 then
      perform pg_temp.ev(1, k, 'skip', '07:00'); perform pg_temp.ev(2, k, 'skip', '07:00');
      perform pg_temp.ev(3, k, 'skip', '07:00');
      continue;
    end if;
    if k not in (6, 7) then perform pg_temp.ev(1, k, 'complete', '07:30', kid); end if;      -- Make bed
    if k <> 6 then perform pg_temp.ev(2, k, 'complete', '07:45', kid); end if;               -- Brush teeth
    if k = 3 then perform pg_temp.ev(2, k, 'admin_uncomplete', '08:15'); end if;             -- ... unchecked
    if k = 5 then perform pg_temp.ev(3, k, 'skip', '17:00');                                 -- Set the table
    elsif k = 6 then perform pg_temp.ev(3, k, 'complete', '17:30', kid); perform pg_temp.ev(3, k, 'reject', '18:30');
    elsif k = 13 then perform pg_temp.ev(3, k, 'complete', '17:30', sib); perform pg_temp.ev(3, k, 'approve', '19:30');
    else perform pg_temp.ev(3, k, 'complete', '17:30', kid); perform pg_temp.ev(3, k, 'approve', '19:30');
    end if;
  end loop;
end $$;
select private.close_past_due('19000000-0000-0000-0000-000000000001');

-- The facts ---------------------------------------------------------------------------------------
select pg_temp.as_user('19100000-0000-0000-0000-000000000001');
create temp table facts as
select f from jsonb_array_elements(
  public.member_history_facts('19110000-0000-0000-0000-00000000000a', pg_temp.d(14)) -> 'facts') f;
select pg_temp.as_owner();
select results_eq(
  $$ select f ->> 'status', count(*)::int from facts group by 1 order by 1 $$,
  $$ values ('approved', 10), ('completed', 22), ('covered', 1), ('missed', 5), ('skipped', 4) $$,
  '[RWD-11] the engine reads each of the 42 routines as it stands for Kid: done, missed, skipped, covered');
select ok((select bool_and(f ->> 'credit_date' = f ->> 'due_date') and bool_and(jsonb_array_length(f -> 'tag_ids') = 1)
             from facts),
          '... with a routine''s credit date (its due date) and its tags');
select is((select f from facts where f ->> 'id' = pg_temp.occ(3, 13)::text),
          jsonb_build_object('id', pg_temp.occ(3, 13), 'chore_id', '19c00000-0000-0000-0000-000000000003',
                             'member_id', '19110000-0000-0000-0000-00000000000a', 'kind', 'chore',
                             'tag_ids', jsonb_build_array('19a00000-0000-0000-0000-000000000002'),
                             'due_date', pg_temp.d(13), 'credit_date', pg_temp.d(13), 'status', 'covered',
                             'credited', false, 'points', 5),
          '... a routine someone else did is covered, not credited (the fact''s whole shape)');

-- Marks -------------------------------------------------------------------------------------------
select pg_temp.as_job();
select is((select array_agg(m order by m) from public.history_dirty_members('19000000-0000-0000-0000-000000000001', 1) m),
          array['19110000-0000-0000-0000-00000000000a', '19110000-0000-0000-0000-00000000000b']::uuid[],
          'both children are marked: their occurrences changed');

-- Save the history (what lib/history.ts makes of the facts: the table above) ----------------------
create function pg_temp.days() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('date', pg_temp.d(k), 'scheduled', 3, 'done', done, 'missed', missed,
                                      'skipped', skipped, 'covered', covered, 'points', points, 'dayClass', cls)
                   order by k)
    from (values (1, 3, 0, 0, 0, 12, 'good'), (2, 3, 0, 0, 0, 12, 'good'), (3, 2, 1, 0, 0, 10, 'bad'),
                 (4, 3, 0, 0, 0, 12, 'good'), (5, 2, 0, 1, 0, 7, 'good'), (6, 0, 3, 0, 0, 0, 'bad'),
                 (7, 2, 1, 0, 0, 7, 'bad'), (8, 3, 0, 0, 0, 12, 'good'), (9, 3, 0, 0, 0, 12, 'good'),
                 (10, 3, 0, 0, 0, 12, 'good'), (11, 0, 0, 3, 0, 0, 'neutral'), (12, 3, 0, 0, 0, 12, 'good'),
                 (13, 2, 0, 0, 1, 7, 'good'), (14, 3, 0, 0, 0, 12, 'good'))
         t (k, done, missed, skipped, covered, points, cls)
$$;
create function pg_temp.runs() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('kind', 'good', 'start', pg_temp.d(1), 'end', pg_temp.d(2), 'length', 2),
    jsonb_build_object('kind', 'bad', 'start', pg_temp.d(3), 'end', pg_temp.d(3), 'length', 1),
    jsonb_build_object('kind', 'good', 'start', pg_temp.d(4), 'end', pg_temp.d(5), 'length', 2),
    jsonb_build_object('kind', 'bad', 'start', pg_temp.d(6), 'end', pg_temp.d(7), 'length', 2),
    jsonb_build_object('kind', 'good', 'start', pg_temp.d(8), 'end', null, 'length', 6))
$$;
create function pg_temp.rows() returns text language sql as $$
  select md5(string_agg(x::text, ',' order by x::text)) from (
    select to_jsonb(s) as x from public.member_daily_summary s where s.member_id = '19110000-0000-0000-0000-00000000000a'
    union all
    select to_jsonb(r) from public.streak_segment r where r.member_id = '19110000-0000-0000-0000-00000000000a') y
$$;

select pg_temp.as_user('19100000-0000-0000-0000-000000000001');
select is(public.save_member_history('19110000-0000-0000-0000-00000000000a', pg_temp.d(14), pg_temp.days(),
                                     pg_temp.runs(), 1, clock_timestamp()),
          '{"days": 14, "segments": 5}'::jsonb, '[RWD-11] a parent''s page saves 14 days and 5 runs');
select pg_temp.as_owner();
select results_eq(
  $$ select summary_date - pg_temp.d(0), done_count, missed_count, day_class from public.member_daily_summary
      where member_id = '19110000-0000-0000-0000-00000000000a' and summary_date in (pg_temp.d(3), pg_temp.d(11), pg_temp.d(13))
      order by 1 $$,
  $$ values (3, 2, 1, 'bad'), (11, 0, 0, 'neutral'), (13, 2, 0, 'good') $$,
  '... one row a day, as the table says');
select is((select string_agg(kind || ':' || length_days || ':' || coalesce((end_date - pg_temp.d(0))::text, 'going'), ','
                             order by start_date)
             from public.streak_segment where member_id = '19110000-0000-0000-0000-00000000000a'),
          'good:2:2,bad:1:3,good:2:5,bad:2:7,good:6:going', '... and the runs, the last still going');
select is((select count(*)::int from private.member_history_dirty where member_id = '19110000-0000-0000-0000-00000000000a'),
          0, '... which clears Kid''s mark');

select pg_temp.rows() as before \gset
select pg_temp.as_user('19100000-0000-0000-0000-000000000001');
select public.save_member_history('19110000-0000-0000-0000-00000000000a', pg_temp.d(14), pg_temp.days(),
                                  pg_temp.runs(), 1, clock_timestamp());
select pg_temp.as_owner();
select is(pg_temp.rows(), :'before', '[RWD-11] a rebuild from the same facts leaves every row identical');

-- A shorter history replaces a longer one; a stale mark made after the read survives the save.
select pg_temp.as_job();
select is(public.save_member_history('19110000-0000-0000-0000-00000000000a', pg_temp.d(14),
                                     (select jsonb_agg(d) from jsonb_array_elements(pg_temp.days()) d
                                       where (d ->> 'date')::date >= pg_temp.d(8)),
                                     jsonb_build_array(jsonb_build_object('kind', 'good', 'start', pg_temp.d(8), 'end', null, 'length', 6)),
                                     1, clock_timestamp() - interval '1 hour'),
          '{"days": 7, "segments": 1}'::jsonb, 'the job may save too');
select pg_temp.as_owner();
select is((select count(*)::int from public.member_daily_summary where member_id = '19110000-0000-0000-0000-00000000000a')
          + (select count(*)::int from public.streak_segment where member_id = '19110000-0000-0000-0000-00000000000a'),
          8, '... and days and runs no longer in the history go');
select pg_temp.as_user('19100000-0000-0000-0000-000000000001');
select public.save_member_history('19110000-0000-0000-0000-00000000000a', pg_temp.d(14), pg_temp.days(),
                                  pg_temp.runs(), 1, clock_timestamp());

-- [RWD-11] A late change to a past day marks the history stale again.
select pg_temp.as_user('19100000-0000-0000-0000-000000000001');
select ok(not public.member_history_stale('19110000-0000-0000-0000-00000000000a', 1), 'saved: not stale');
select ok(public.member_history_stale('19110000-0000-0000-0000-00000000000a', 2), '... but stale for a newer engine');
select pg_temp.as_owner();
select pg_temp.ev(1, 7, 'admin_complete', '20:00', '19110000-0000-0000-0000-00000000000a');
select pg_temp.as_user('19100000-0000-0000-0000-000000000001');
select ok(public.member_history_stale('19110000-0000-0000-0000-00000000000a', 1),
          'a parent''s late credit for d7 marks Kid''s history stale');
-- Put back as it was, for the insights below (an uncheck of a closed day is missed again).
select pg_temp.as_owner();
select pg_temp.ev(1, 7, 'admin_uncomplete', '20:30');

-- Insights (hand-computed) ------------------------------------------------------------------------
select pg_temp.as_user('19100000-0000-0000-0000-000000000001');
create temp table ins as select public.member_insights('19110000-0000-0000-0000-00000000000a', pg_temp.d(1), pg_temp.d(14)) as j;
select pg_temp.as_owner();
select is((select (j -> 'streaks') - 'through'::text from ins),
          '{"current_kind": "good", "current_length": 6, "best_good": 6, "longest_bad": 2}'::jsonb,
          '[RWD-12] streaks: a good run of 6 going, the best 6, the longest bad 2');
select is((select (j -> 'streaks' ->> 'through')::date from ins), pg_temp.d(14), '... through yesterday');
select is((select j -> 'rate' from ins), '{"done": 32, "counted": 37}'::jsonb,
          '[RWD-12] completion: 32 of the 37 routines that counted (4 skipped and 1 covered left out)');
select is((select jsonb_agg(jsonb_build_array(x ->> 'title', (x ->> 'missed')::int)) from ins, jsonb_array_elements(j -> 'most_missed') x),
          '[["Brush teeth", 2], ["Make bed", 2], ["Set the table", 1]]'::jsonb, '[RWD-12] most missed');
select is((select jsonb_agg(jsonb_build_array(x ->> 'name', (x ->> 'done')::int, (x ->> 'counted')::int)) from ins, jsonb_array_elements(j -> 'by_tag') x),
          '[["Kitchen", 10, 11], ["Morning", 22, 26]]'::jsonb, '[RWD-12] completion by tag');
select is((select j -> 'trust' from ins),
          '{"checkoffs": 34, "unchecked": 1, "approved": 10, "sent_back": 1, "median_verify_seconds": 7200}'::jsonb,
          '[RWD-12] trust: 34 check-offs; 1 unchecked, 10 approved, 1 sent back; verified in a median 2 hours');
select is((select jsonb_array_length(j -> 'days') from ins), 14, '[RWD-12] the heatmap has each day');

-- Who may ----------------------------------------------------------------------------------------
select pg_temp.as_user('19300000-0000-0000-0000-000000000003');
select throws_ok($$ select public.member_history_facts('19110000-0000-0000-0000-00000000000a', pg_temp.d(14)) $$,
                 '42501', null, 'another household''s parent cannot read the facts');
select throws_ok($$ select public.save_member_history('19110000-0000-0000-0000-00000000000a', pg_temp.d(14), '[]', '[]', 1, now()) $$,
                 '42501', null, '... nor save a history');
select throws_ok($$ select public.member_insights('19110000-0000-0000-0000-00000000000a', pg_temp.d(1), pg_temp.d(14)) $$,
                 '42501', null, '... nor see insights');
select pg_temp.as_user('19d00000-0000-0000-0000-00000000000d');
select throws_ok($$ select public.member_history_facts('19110000-0000-0000-0000-00000000000a', pg_temp.d(14)) $$,
                 '42501', null, 'a board cannot read the facts');
select pg_temp.as_owner();
select ok(not has_function_privilege('authenticated', 'public.history_dirty_members(uuid, integer)', 'execute')
          and not has_function_privilege('anon', 'public.member_insights(uuid, date, date)', 'execute'),
          'only the job lists marked members; signed-out callers get nothing');

-- [RWD-05] The board's flame: the run as of yesterday, for members who earn rewards.
select pg_temp.as_user('19d00000-0000-0000-0000-00000000000d');
select is((select m -> 'streak' from jsonb_array_elements(public.board_snapshot() -> 'members') m
            where m ->> 'display_name' = 'Kid'),
          '{"kind": "good", "length": 6, "best": 6}'::jsonb, '[RWD-05] the board sees Kid''s run and best');

select * from finish();
rollback;
