-- [PTS-11] Penalties paid back through a goal (WP-122, D-154, D-158): a rule's "Paid back by" saved
-- and what save_penalty_rule() refuses; a won period pays back each of the rule's people it is for,
-- never more than is owed, once; paused while nothing is owed and while penalties are off; a win
-- undone takes its payback back once; a points rule's max counts what was paid back; who may read and
-- write; the board's snapshot; the points register. Goal evaluations are written by hand, as the
-- engine would send them (500_repeating_goals does the same).
begin;
select plan(44);

insert into auth.users (id, email) values
  ('67100000-0000-0000-0000-0000000000a1', 'alex@example.com'),
  ('67100000-0000-0000-0000-0000000000b1', 'other@example.com'),
  ('67100000-0000-0000-0000-0000000000d1', 'board@example.com');
insert into public.household (id, name, timezone, week_start) values
  ('67000000-0000-0000-0000-000000000001', 'Payback family', 'America/Chicago', 1),
  ('67000000-0000-0000-0000-000000000002', 'Another family', 'America/Chicago', 1);
insert into public.household_settings (household_id, penalties_on) values
  ('67000000-0000-0000-0000-000000000001', true), ('67000000-0000-0000-0000-000000000002', true);
insert into public.household_user (household_id, user_id, role) values
  ('67000000-0000-0000-0000-000000000001', '67100000-0000-0000-0000-0000000000a1', 'owner'),
  ('67000000-0000-0000-0000-000000000002', '67100000-0000-0000-0000-0000000000b1', 'owner');
insert into public.member (id, household_id, display_name, role, user_id, earns_rewards) values
  ('67110000-0000-0000-0000-0000000000a1', '67000000-0000-0000-0000-000000000001', 'Alex', 'adult', '67100000-0000-0000-0000-0000000000a1', false),
  ('67110000-0000-0000-0000-00000000000a', '67000000-0000-0000-0000-000000000001', 'Maya', 'child', null, true),
  ('67110000-0000-0000-0000-00000000000b', '67000000-0000-0000-0000-000000000001', 'Leo', 'child', null, true),
  ('67110000-0000-0000-0000-00000000000c', '67000000-0000-0000-0000-000000000002', 'Kim', 'child', null, true);
insert into public.device (id, household_id, name, auth_user_id) values
  ('67d00000-0000-4000-8000-000000000001', '67000000-0000-0000-0000-000000000001', 'Kitchen', '67100000-0000-0000-0000-0000000000d1');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('67000000-0000-0000-0000-000000000001') $$;
create function pg_temp.as_user(p_user text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true) $$;
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('67100000-0000-0000-0000-0000000000a1') $$;
create function pg_temp.as_board() returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', '67100000-0000-0000-0000-0000000000d1', 'role', 'authenticated',
           'app_metadata', json_build_object('role', 'device', 'device_id', '67d00000-0000-4000-8000-000000000001'))::text, true) $$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from ids where k = p_k $$;
create function pg_temp.member(p_k text) returns uuid language sql as $$
  select case p_k when 'maya' then '67110000-0000-0000-0000-00000000000a'::uuid
                  when 'leo' then '67110000-0000-0000-0000-00000000000b'::uuid end $$;
-- A rule as the form sends it, starting today, with its payback (or none).
create function pg_temp.rule(p_name text, p_reason text, p_members text[], p_amount int, p_max int,
                             p_goal uuid default null, p_back int default null, p_id uuid default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('id', p_id, 'name', p_name, 'reason_id', pg_temp.id(p_reason),
           'member_ids', to_jsonb(p_members), 'scope', 'all', 'start_date', pg_temp.today(),
           'end_date', pg_temp.today() + 60, 'amount', p_amount, 'max_amount', p_max,
           'payback_goal_id', p_goal, 'payback_amount', p_back)) $$;
-- A miss of rule p_rule by a person on the chore's day p_day (as day close adds it).
create function pg_temp.miss(p_rule text, p_who text, p_day int) returns int language sql as $$
  select private.add_rule_miss(r, pg_temp.member(p_who), o.id, o.due_date)
    from public.penalty_rule r, public.chore_occurrence o
   where r.id = pg_temp.id(p_rule) and o.due_date = pg_temp.today() + p_day
     and o.chore_id = case p_who when 'maya' then '67c00000-0000-0000-0000-000000000001'::uuid
                                 else '67c00000-0000-0000-0000-000000000002'::uuid end $$;
-- What a rule has on a person (read by the test as any role; rolled back).
grant execute on function private.penalty_rule_held(uuid, uuid) to authenticated;
create function pg_temp.held(p_rule text, p_who text) returns int language sql as $$
  select private.penalty_rule_held(pg_temp.id(p_rule), pg_temp.member(p_who)) $$;
-- A week of a goal as the engine sends it: week k (0 = the one going now, 1 = last week, …).
create function pg_temp.week(p_k int, p_outcome text) returns jsonb language sql as $$
  select jsonb_build_object('start', pg_temp.today() - 7 * p_k - 6, 'end', pg_temp.today() - 7 * p_k,
                            'outcome', p_outcome, 'next_start', pg_temp.today() - 7 * p_k + 1,
                            'pct', case when p_outcome = 'won' then 100 else 40 end,
                            'days_due', 5, 'days_done', case when p_outcome = 'won' then 5 else 2 end,
                            'days_missed', case when p_outcome = 'missed' then 1 else 0 end, 'misses_allowed', 0) $$;
-- An evaluation of goal p_goal with these weeks, saved as its parent (the Goals page does the same).
create function pg_temp.save(p_goal text, p_weeks jsonb) returns jsonb language sql as $$
  select public.save_goal_evaluation(pg_temp.id(p_goal), (select status from public.reward_goal where id = pg_temp.id(p_goal)),
    (select rules_version from public.reward_goal where id = pg_temp.id(p_goal)),
    jsonb_build_object('goal_id', pg_temp.id(p_goal), 'pct', 40, 'is_achieved', false, 'rules', '[]'::jsonb,
                       'transitions', '[]'::jsonb, 'periods', p_weeks), 2, clock_timestamp()) $$;
create function pg_temp.paybacks(p_rule text) returns text language sql as $$
  select coalesce(string_agg(m.display_name || ' ' || b.amount || ' n' || b.goal_n
                             || case when b.taken_back_at is not null then ' back' else '' end, ', '
                             order by b.goal_n, m.display_name), '')
    from public.penalty_payback b join public.member m on m.id = b.member_id where b.rule_id = pg_temp.id(p_rule) $$;

-- A daily chore each for Maya and Leo, from 20 days ago; weekly goals for Maya, Leo and the family.
insert into public.chore (id, household_id, title, kind, points, schedule, created_by, start_date, approval) values
  ('67c00000-0000-0000-0000-000000000001', '67000000-0000-0000-0000-000000000001', 'Homework folder home', 'chore', 5, '{"freq": "daily"}', null, pg_temp.today() - 20, 'none'),
  ('67c00000-0000-0000-0000-000000000002', '67000000-0000-0000-0000-000000000001', 'Bed by 8', 'chore', 2, '{"freq": "daily"}', null, pg_temp.today() - 20, 'none');
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('67000000-0000-0000-0000-000000000001', '67c00000-0000-0000-0000-000000000001', '67110000-0000-0000-0000-00000000000a'),
  ('67000000-0000-0000-0000-000000000001', '67c00000-0000-0000-0000-000000000002', '67110000-0000-0000-0000-00000000000b');
select private.generate_occurrences('67000000-0000-0000-0000-000000000001', pg_temp.today() - 20, pg_temp.today());
insert into ids values ('gm', '67e00000-0000-0000-0000-000000000001'), ('gl', '67e00000-0000-0000-0000-000000000002'),
  ('gf', '67e00000-0000-0000-0000-000000000003'), ('gx', '67e00000-0000-0000-0000-000000000004'),
  ('gk', '67e00000-0000-0000-0000-000000000005'), ('gold', '67e00000-0000-0000-0000-000000000006');
insert into public.reward_goal (id, household_id, member_id, title, start_date, status, repeats) values
  (pg_temp.id('gm'), '67000000-0000-0000-0000-000000000001', '67110000-0000-0000-0000-00000000000a', 'Folder home every school day', pg_temp.today() - 30, 'active', 'week'),
  (pg_temp.id('gl'), '67000000-0000-0000-0000-000000000001', '67110000-0000-0000-0000-00000000000b', 'Bed by 8 all week', pg_temp.today() - 30, 'active', 'week'),
  (pg_temp.id('gf'), '67000000-0000-0000-0000-000000000001', null, 'Kitchen clear', pg_temp.today() - 30, 'active', 'week'),
  (pg_temp.id('gx'), '67000000-0000-0000-0000-000000000001', '67110000-0000-0000-0000-00000000000a', 'Old goal', pg_temp.today() - 30, 'expired', 'none'),
  (pg_temp.id('gk'), '67000000-0000-0000-0000-000000000002', '67110000-0000-0000-0000-00000000000c', 'Their goal', pg_temp.today() - 30, 'active', 'week');

-- PTS-11-a: Paid back by ---------------------------------------------------------------------------
select pg_temp.parent();
insert into ids values
  ('folder', public.add_penalty_reason('67000000-0000-0000-0000-000000000001', 'Homework folder not home', 'money', 100)),
  ('bed', public.add_penalty_reason('67000000-0000-0000-0000-000000000001', 'Up after bedtime', 'points', 5));
insert into ids values ('r1', public.save_penalty_rule('67000000-0000-0000-0000-000000000001',
  pg_temp.rule('Folder home', 'folder', array[pg_temp.member('maya')::text], 100, 1000, pg_temp.id('gm'), 100)));
select is((select payback_goal_id = pg_temp.id('gm') and payback_amount = 100 from public.penalty_rule where id = pg_temp.id('r1')),
  true, '[PTS-11-a] a parent links a rule to a goal of its person and what each win pays back');
insert into ids values ('r2', public.save_penalty_rule('67000000-0000-0000-0000-000000000001',
  pg_temp.rule('Bed by 8', 'bed', array[pg_temp.member('leo')::text], 5, 10, pg_temp.id('gl'), 5)));
insert into ids values ('r3', public.save_penalty_rule('67000000-0000-0000-0000-000000000001',
  pg_temp.rule('Kitchen', 'folder', array[pg_temp.member('maya')::text, pg_temp.member('leo')::text], 100, 1000,
               pg_temp.id('gf'), 50)));
select is((select count(*)::int from public.penalty_rule where id = pg_temp.id('r3') and payback_goal_id = pg_temp.id('gf')),
  1, '[PTS-11-a] or to a family goal');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '67000000-0000-0000-0000-000000000001',
  pg_temp.rule('X', 'folder', array[pg_temp.member('maya')::text], 100, 100, pg_temp.id('gk'), 100)),
  '22023', 'choose a goal of this rule''s people or the family', '[PTS-11-a] another household''s goal is refused');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '67000000-0000-0000-0000-000000000001',
  pg_temp.rule('X', 'folder', array[pg_temp.member('maya')::text], 100, 100, pg_temp.id('gl'), 100)),
  '22023', 'choose a goal of this rule''s people or the family', '[PTS-11-a] another person''s goal is refused');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '67000000-0000-0000-0000-000000000001',
  pg_temp.rule('X', 'folder', array[pg_temp.member('maya')::text], 100, 100, pg_temp.id('gx'), 100)),
  '22023', 'choose a goal of this rule''s people or the family', '[PTS-11-a] a goal that has ended is refused');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '67000000-0000-0000-0000-000000000001',
  pg_temp.rule('X', 'folder', array[pg_temp.member('maya')::text], 100, 100, pg_temp.id('gm'), 0)),
  '22023', 'what a win pays back, from 1', '[PTS-11-a] an amount out of range is refused');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '67000000-0000-0000-0000-000000000001',
  pg_temp.rule('X', 'bed', array[pg_temp.member('maya')::text], 5, 10, pg_temp.id('gm'), 10001)),
  '22023', 'what a win pays back, from 1', '[PTS-11-a] points over 10,000 are refused');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '67000000-0000-0000-0000-000000000001',
  pg_temp.rule('X', 'folder', array[pg_temp.member('maya')::text], 100, 100, pg_temp.id('gm'), null)),
  '22023', 'what a win pays back, from 1', '[PTS-11-a] a goal without an amount is refused');
insert into ids values ('r4', public.save_penalty_rule('67000000-0000-0000-0000-000000000001',
  pg_temp.rule('Spare', 'folder', array[pg_temp.member('maya')::text], 100, 100, pg_temp.id('gm'), 100)));
select public.save_penalty_rule('67000000-0000-0000-0000-000000000001',
  pg_temp.rule('Spare', 'folder', array[pg_temp.member('maya')::text], 100, 100, null, 100, pg_temp.id('r4')));
select is((select coalesce(payback_goal_id::text, 'none') || ' ' || coalesce(payback_amount::text, 'none')
             from public.penalty_rule where id = pg_temp.id('r4')),
  'none none', '[PTS-11-a] no goal clears the payback');
select pg_temp.as_user('67100000-0000-0000-0000-0000000000b1');
select throws_ok(format('select public.save_penalty_rule(%L, %L)', '67000000-0000-0000-0000-000000000001',
  pg_temp.rule('Folder home', 'folder', array[pg_temp.member('maya')::text], 100, 1000, pg_temp.id('gm'), 100,
               pg_temp.id('r1'))),
  '42501', 'not allowed', '[PTS-11-a] another household''s parent can''t');

-- Misses: Maya 3 × $1 on Folder home; Leo 2 × 5 points on Bed by 8 (its max, 10); $1 each on Kitchen.
select pg_temp.as_owner();
select pg_temp.miss('r1', 'maya', -10), pg_temp.miss('r1', 'maya', -9), pg_temp.miss('r1', 'maya', -8),
       pg_temp.miss('r2', 'leo', -10), pg_temp.miss('r2', 'leo', -9),
       pg_temp.miss('r3', 'maya', -10), pg_temp.miss('r3', 'leo', -10);
select is(pg_temp.held('r1', 'maya') || ' ' || pg_temp.held('r2', 'leo'), '300 10', 'the misses are owed');

-- PTS-11-b: a won week pays back ---------------------------------------------------------------------
select pg_temp.parent();
select pg_temp.save('gm', jsonb_build_array(pg_temp.week(2, 'won'), pg_temp.week(1, 'open')));
select is(pg_temp.paybacks('r1'), 'Maya 100 n1', '[PTS-11-b] a won week pays back the rule''s person once');
select is((select string_agg(x.amount::text, ',' order by p.missed_on)
             from public.penalty p left join public.penalty_payment x on x.penalty_id = p.id
            where p.rule_id = pg_temp.id('r1')), '100',
  '[PTS-11-b] in money, as a payment on the oldest miss');
select is((select recorded_by is null and payback_id is not null from public.penalty_payment
            where penalty_id in (select id from public.penalty where rule_id = pg_temp.id('r1'))),
  true, '[PTS-11-b] recorded by nobody, tied to the payback');
select is(pg_temp.held('r1', 'maya'), 200, '[PTS-11-b] what Maya owes on the rule drops by it');
select pg_temp.save('gm', jsonb_build_array(pg_temp.week(2, 'won'), pg_temp.week(1, 'open')));
select is(pg_temp.paybacks('r1') || ' / ' || pg_temp.held('r1', 'maya'), 'Maya 100 n1 / 200',
  '[PTS-11-b] worked out again, it pays back once');
select pg_temp.save('gl', jsonb_build_array(pg_temp.week(2, 'won'), pg_temp.week(1, 'open')));
select is((select string_agg(entry_type || ' ' || amount || ' ' || reason, ', ')
             from public.points_ledger where member_id = pg_temp.member('leo') and entry_type = 'penalty_payback'),
  'penalty_payback 5 Week won: Bed by 8 all week', '[PTS-11-b] in points, a penalty_payback entry with the win');
select pg_temp.save('gf', jsonb_build_array(pg_temp.week(2, 'won'), pg_temp.week(1, 'open')));
select is(pg_temp.paybacks('r3'), 'Leo 50 n1, Maya 50 n1', '[PTS-11-b] a family goal pays back each of the rule''s people');

-- PTS-11-f: a points rule's max counts what was paid back ---------------------------------------------
select pg_temp.as_owner();
select is(pg_temp.held('r2', 'leo'), 5, '[PTS-11-f] a points rule has the points its misses took less paid back');
select is(pg_temp.miss('r2', 'leo', -8), 5, '[PTS-11-f] so a miss adds again under the max');
select is(pg_temp.miss('r2', 'leo', -7), 0, '[PTS-11-f] up to the max');

-- PTS-11-c: never more than is owed; paused at 0 -------------------------------------------------------
select pg_temp.parent();
select pg_temp.save('gl', jsonb_build_array(pg_temp.week(3, 'won'), pg_temp.week(2, 'won'), pg_temp.week(1, 'won'),
                                            pg_temp.week(0, 'open')));
select is(pg_temp.paybacks('r2') || ' / ' || pg_temp.held('r2', 'leo'), 'Leo 5 n1, Leo 5 n2, Leo 5 n3 / 0',
  '[PTS-11-c] wins pay back until nothing is owed');
select pg_temp.save('gl', jsonb_build_array(pg_temp.week(3, 'won'), pg_temp.week(2, 'won'), pg_temp.week(1, 'won'),
                                            pg_temp.week(0, 'won')));
select is(pg_temp.paybacks('r2') || ' / ' || pg_temp.held('r2', 'leo'), 'Leo 5 n1, Leo 5 n2, Leo 5 n3 / 0',
  '[PTS-11-c] with nothing owed, a win pays back nothing (paused)');
select pg_temp.as_owner();
update public.penalty_rule set payback_amount = 50 where id = pg_temp.id('r1');
select pg_temp.parent();
select pg_temp.save('gm', jsonb_build_array(pg_temp.week(3, 'won'), pg_temp.week(2, 'won'), pg_temp.week(1, 'open')));
select pg_temp.as_owner();
update public.penalty_rule set payback_amount = 500 where id = pg_temp.id('r1');
select pg_temp.parent();
select pg_temp.save('gm', jsonb_build_array(pg_temp.week(3, 'won'), pg_temp.week(2, 'won'), pg_temp.week(1, 'won')));
select is(pg_temp.paybacks('r1') || ' / ' || pg_temp.held('r1', 'maya'), 'Maya 100 n1, Maya 50 n2, Maya 150 n3 / 0',
  '[PTS-11-c] a win pays back only what is left');
select pg_temp.as_owner();
select pg_temp.miss('r1', 'maya', -6);
select pg_temp.parent();
select pg_temp.save('gm', jsonb_build_array(pg_temp.week(3, 'won'), pg_temp.week(2, 'won'), pg_temp.week(1, 'won'),
                                            pg_temp.week(0, 'won')));
select is(pg_temp.paybacks('r1') || ' / ' || pg_temp.held('r1', 'maya'),
  'Maya 100 n1, Maya 50 n2, Maya 150 n3, Maya 100 n4 / 0', '[PTS-11-c] a new miss makes it owed, and the next win pays back');

-- PTS-11-e: a win undone -------------------------------------------------------------------------------
select pg_temp.save('gm', jsonb_build_array(pg_temp.week(3, 'won'), pg_temp.week(2, 'won'), pg_temp.week(1, 'won'),
                                            pg_temp.week(0, 'missed')));
select pg_temp.save('gm', jsonb_build_array(pg_temp.week(3, 'won'), pg_temp.week(2, 'won'), pg_temp.week(1, 'won'),
                                            pg_temp.week(0, 'missed')));
select is(pg_temp.paybacks('r1') || ' / ' || pg_temp.held('r1', 'maya'),
  'Maya 100 n1, Maya 50 n2, Maya 150 n3, Maya 100 n4 back / 100', '[PTS-11-e] a win undone takes its payback back once: owed again');
select is((select count(*)::int || ':' || sum(amount) from public.penalty_payment
            where payback_id = (select id from public.penalty_payback where rule_id = pg_temp.id('r1') and goal_n = 4)),
  '2:0', '[PTS-11-e] its payment posted again negative, nothing edited');
select pg_temp.save('gm', jsonb_build_array(pg_temp.week(3, 'won'), pg_temp.week(2, 'won'), pg_temp.week(1, 'won'),
                                            pg_temp.week(0, 'won')));
select is(pg_temp.held('r1', 'maya'), 0, '[PTS-11-e] won again, it pays back again');
select pg_temp.save('gl', jsonb_build_array(pg_temp.week(3, 'won'), pg_temp.week(2, 'missed'), pg_temp.week(1, 'won'),
                                            pg_temp.week(0, 'won')));
select is((select string_agg(amount::text, ',' order by created_at, id) from public.points_ledger
            where member_id = pg_temp.member('leo') and entry_type = 'penalty_payback'),
  '5,5,5,-5', '[PTS-11-e] in points, an entry of −amount');
select is(pg_temp.held('r2', 'leo'), 5, '[PTS-11-e] what was paid back is to earn back again');

-- PTS-11-d: paused while penalties are off; a stopped rule still pays back ------------------------------
select public.set_penalties_on('67000000-0000-0000-0000-000000000001', false);
select pg_temp.save('gl', jsonb_build_array(pg_temp.week(3, 'won'), pg_temp.week(2, 'won'), pg_temp.week(1, 'won'),
                                            pg_temp.week(0, 'won')));
select is(pg_temp.held('r2', 'leo'), 5, '[PTS-11-d] while penalties are off a win pays back nothing');
select public.set_penalties_on('67000000-0000-0000-0000-000000000001', true);
select public.stop_penalty_rule(pg_temp.id('r3'));
select pg_temp.save('gf', jsonb_build_array(pg_temp.week(2, 'won'), pg_temp.week(1, 'won')));
select is(pg_temp.paybacks('r3'), 'Leo 50 n1, Maya 50 n1, Leo 50 n2, Maya 50 n2',
  '[PTS-11-d] a stopped rule still pays back what is owed on it');

-- PTS-11-g: who may ------------------------------------------------------------------------------------
select throws_ok($$ insert into public.penalty_payback (household_id, rule_id, member_id, goal_id, goal_n, unit, amount)
                    values ('67000000-0000-0000-0000-000000000001', pg_temp.id('r1'), pg_temp.member('maya'),
                            pg_temp.id('gm'), 99, 'money', 1) $$,
  '42501', null, '[PTS-11-g] nobody writes a payback');
select is((select count(*)::int from public.penalty_payback), 12, '[PTS-11-g] the household''s parents read its paybacks');
select pg_temp.as_owner();
select throws_ok($$ update public.penalty_payback set amount = 1 where rule_id = pg_temp.id('r1') and goal_n = 1 $$,
  '42501', 'paybacks are append-only', '[PTS-11-g] a payback changes only when it is taken back');
select throws_ok($$ update public.penalty_payback set taken_back_at = null where taken_back_at is not null $$,
  '42501', 'paybacks are append-only', '[PTS-11-g] and once');
select pg_temp.as_board();
select is((select count(*)::int from public.penalty_payback), 12, '[PTS-11-g] its boards read them');
select is((select count(*)::int from public.penalty_rule), 0, '[PTS-11-g] boards still don''t read the rule');
select pg_temp.as_user('67100000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.penalty_payback), 0, '[PTS-11-g] another household''s parent reads none');
select throws_ok($$ select private.board_paybacks('67000000-0000-0000-0000-000000000001') $$,
  '42501', 'not allowed', '[PTS-11-g] nor what the rules pay back');

-- PTS-11-h: the board's snapshot -------------------------------------------------------------------------
select pg_temp.as_owner();
select pg_temp.miss('r1', 'maya', -5);
select pg_temp.as_board();
select is((select jsonb_agg(p - 'rule_id' - 'goal_id' order by p ->> 'rule', p ->> 'member_id')
             from jsonb_array_elements(public.board_snapshot() -> 'paybacks') p),
  jsonb_build_array(
    jsonb_build_object('rule', 'Bed by 8', 'member_id', pg_temp.member('leo'), 'unit', 'points', 'amount', 5, 'owed', 5,
                       'goal', 'Bed by 8 all week', 'repeat', 'week'),
    jsonb_build_object('rule', 'Folder home', 'member_id', pg_temp.member('maya'), 'unit', 'money', 'amount', 500,
                       'owed', 100, 'goal', 'Folder home every school day', 'repeat', 'week')),
  '[PTS-11-h] the snapshot has each rule''s payback per person: the goal, what a win pays back, what is owed');
select is((select count(*)::int from jsonb_array_elements(public.board_snapshot() -> 'paybacks') p
            where p ->> 'rule' = 'Kitchen'), 0, '[PTS-11-h] a stopped rule with nothing owed is left out');
select pg_temp.parent();
select public.set_penalties_on('67000000-0000-0000-0000-000000000001', false);
select pg_temp.as_board();
select is(public.board_snapshot() -> 'paybacks', '[]'::jsonb, '[PTS-11-h] nothing while penalties are off');
select pg_temp.parent();
select public.set_penalties_on('67000000-0000-0000-0000-000000000001', true);

-- PTS-11-i: the points register ---------------------------------------------------------------------------
select is((select string_agg(kind || ' ' || amount || ' ' || goal_title || ' ' || penalty_rule, ', ' order by created_at, id)
             from public.points_register('67000000-0000-0000-0000-000000000001', p_kinds => array['penalty_payback'])),
  'penalty_payback 5 Bed by 8 all week Bed by 8, penalty_payback 5 Bed by 8 all week Bed by 8, penalty_payback 5 Bed by 8 all week Bed by 8, penalty_payback -5 Bed by 8 all week Bed by 8',
  '[PTS-11-i] the register lists paybacks as their own type, with the goal and the rule, an undo included');

select * from finish();
rollback;
