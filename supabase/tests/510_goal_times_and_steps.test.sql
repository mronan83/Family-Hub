-- [RWD-17][RWD-18] A goal done by a time, and goals that pay in steps (WP-81, D-102, D-124): the time
-- and the steps saved and checked; the facts the engine reads carry each tick's own time (offline
-- included, the child's tick for an approved chore, a parent's tick at its own time) and each
-- chore's due time; each step's payout paid once, taken back once, and a step changed by a parent's
-- fix settled by the difference. The evaluations are written by hand, as the engine would send
-- them (500_repeating_goals does the same).
begin;
select plan(33);

insert into auth.users (id, email) values
  ('51100000-0000-0000-0000-000000000001', 'parent@example.com');
insert into public.household (id, name, timezone, week_start) values
  ('51000000-0000-0000-0000-000000000001', 'Steps family', 'America/Chicago', 1);
insert into public.household_settings (household_id) values ('51000000-0000-0000-0000-000000000001');
insert into public.household_user (household_id, user_id, role) values
  ('51000000-0000-0000-0000-000000000001', '51100000-0000-0000-0000-000000000001', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('51110000-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-000000000001', 'Maya', 'child');
insert into public.reward_catalog_item (id, household_id, title, cost_points) values
  ('51f00000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'Tablet time', 20);

create function pg_temp.today() returns date language sql as $$
  select private.household_today('51000000-0000-0000-0000-000000000001')
$$;
create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('51100000-0000-0000-0000-000000000001')
$$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
create function pg_temp.g(p_n int) returns uuid language sql as $$
  select ('51e00000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::uuid
$$;
-- Goal n for Maya as the form sends it, starting 20 days ago.
create function pg_temp.goal(p_n int, p_repeat text, p_rules jsonb, p_payout jsonb,
                             p_end int default null) returns jsonb
language sql as $$
  select jsonb_build_object('id', pg_temp.g(p_n), 'household_id', '51000000-0000-0000-0000-000000000001',
                            'member_id', '51110000-0000-0000-0000-00000000000a', 'title', 'Homework before 6 pm',
                            'icon', 'trophy', 'start_date', pg_temp.today() - 20,
                            'end_date', case when p_end is null then null else pg_temp.today() + p_end end,
                            'rule_logic', 'all', 'repeat', p_repeat, 'rules', p_rules, 'payout', p_payout)
$$;
create function pg_temp.days(p_params jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('type', 'DAYS_DUE', 'scope', jsonb_build_object('all', true),
                                              'params', p_params))
$$;
create function pg_temp.count(p_target int, p_params jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('type', 'COUNT', 'target', p_target,
                                              'scope', jsonb_build_object('all', true), 'params', p_params))
$$;
create function pg_temp.points(p_amount int, p_steps jsonb) returns jsonb language sql as $$
  select jsonb_build_object('type', 'points', 'amount', p_amount, 'steps', p_steps)
$$;
create function pg_temp.hint(p_sql text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute p_sql;
  return 'saved';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return v_hint;
end $$;
-- A period as the engine sends it, from p_from to p_to days from today, won or missed at a step.
create function pg_temp.per(p_from int, p_to int, p_outcome text, p_step int) returns jsonb language sql as $$
  select jsonb_build_object('start', pg_temp.today() + p_from, 'end', pg_temp.today() + p_to,
                            'outcome', p_outcome, 'next_start', pg_temp.today() + p_to + 1, 'pct', 100,
                            'days_due', 5, 'days_done', 4, 'days_missed', 1, 'misses_allowed', 2, 'days', null,
                            'step', jsonb_build_object('reached', p_step, 'best', p_step, 'final', true,
                                                       'amount', null, 'value', 1))
$$;
create function pg_temp.save(p_n int, p_eval jsonb) returns jsonb language sql as $$
  select public.save_goal_evaluation(pg_temp.g(p_n), (select status from public.reward_goal where id = pg_temp.g(p_n)),
    (select rules_version from public.reward_goal where id = pg_temp.g(p_n)),
    jsonb_build_object('goal_id', pg_temp.g(p_n), 'pct', 80, 'is_achieved', false, 'rules', '[]'::jsonb,
                       'transitions', '[]'::jsonb, 'periods', '[]'::jsonb, 'step', null) || p_eval,
    3, clock_timestamp())
$$;
create function pg_temp.paid(p_n int) returns text language sql as $$
  select coalesce(string_agg(entry_type || ' ' || amount || ' n' || goal_n, ', ' order by created_at, id), '')
    from public.points_ledger where goal_id = pg_temp.g(p_n)
$$;
create function pg_temp.events(p_n int, p_type text) returns bigint language sql as $$
  select count(*) from public.reward_goal_event where goal_id = pg_temp.g(p_n) and type = p_type
$$;

-- The facts: each tick's own time, each chore's due time ------------------------------------------
-- Homework is due at 6 pm; Reading has no due time and needs a parent's OK.
insert into public.chore (id, household_id, title, kind, points, schedule, created_by, start_date, due_time, approval)
values
  ('51c00000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'Homework home', 'chore', 2,
   '{"freq": "daily"}', '51100000-0000-0000-0000-000000000001', pg_temp.today() - 20, '18:00', 'none'),
  ('51c00000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000001', 'Reading', 'chore', 2,
   '{"freq": "daily"}', '51100000-0000-0000-0000-000000000001', pg_temp.today() - 20, null, 'required');
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('51000000-0000-0000-0000-000000000001', '51c00000-0000-0000-0000-000000000001', '51110000-0000-0000-0000-00000000000a'),
  ('51000000-0000-0000-0000-000000000001', '51c00000-0000-0000-0000-000000000002', '51110000-0000-0000-0000-00000000000a');
select private.generate_occurrences('51000000-0000-0000-0000-000000000001', pg_temp.today() - 5, pg_temp.today());

create function pg_temp.occ(p_chore int, p_day int) returns uuid language sql as $$
  select id from public.chore_occurrence
   where chore_id = ('51c00000-0000-0000-0000-00000000000' || p_chore)::uuid and due_date = pg_temp.today() + p_day
$$;
-- An event at a time on a day (household clock), received now.
create function pg_temp.tick(p_occ uuid, p_type text, p_day int, p_time text) returns void language sql as $$
  insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
  values (gen_random_uuid(), p_occ, p_type,
          case when p_type in ('complete', 'admin_complete', 'approve')
               then array['51110000-0000-0000-0000-00000000000a'::uuid] else '{}' end,
          ((pg_temp.today() + p_day) + p_time::time) at time zone 'America/Chicago')
$$;
-- Two days ago: a board offline ticked Homework at 5:59 pm (the server got it now); Maya ticked Reading
-- at 5:50 pm and a parent approved it at 8 pm. Three days ago: a parent ticked Homework the next morning.
select pg_temp.tick(pg_temp.occ(1, -2), 'complete', -2, '17:59');
select pg_temp.tick(pg_temp.occ(2, -2), 'complete', -2, '17:50');
select pg_temp.tick(pg_temp.occ(2, -2), 'approve', -2, '20:00');
select pg_temp.tick(pg_temp.occ(1, -3), 'admin_complete', -2, '07:30');

select pg_temp.parent();
select public.save_goal(pg_temp.goal(1, 'week', pg_temp.days('{"on_time": "18:00"}'), '{"type": "points", "amount": 10}'));
create function pg_temp.fact(p_occ uuid) returns jsonb language sql as $$
  select f from jsonb_array_elements(public.goal_facts(pg_temp.g(1)) -> 'facts') f
   where (f ->> 'id')::uuid = p_occ
$$;
select is(pg_temp.fact(pg_temp.occ(1, -2)) ->> 'due_time', '18:00',
          '[RWD-17-h] a fact carries its chore''s due time');
select is(pg_temp.fact(pg_temp.occ(1, -2)) ->> 'done_at', (pg_temp.today() - 2)::text || 'T17:59',
          '[RWD-17-h][RWD-17-d] and its tick''s own time on the household''s clock, though it reached the server later');
select is(pg_temp.fact(pg_temp.occ(2, -2)) ->> 'done_at', (pg_temp.today() - 2)::text || 'T17:50',
          '[RWD-17-f] an approved chore keeps the child''s tick, not the approval''s time');
select is(pg_temp.fact(pg_temp.occ(2, -2)) ->> 'due_time', null, '[RWD-17-h] a chore without a due time has none');
select is(pg_temp.fact(pg_temp.occ(1, -3)) ->> 'done_at', (pg_temp.today() - 2)::text || 'T07:30',
          '[RWD-17-f] a parent''s tick carries its own time');
select is(pg_temp.fact(pg_temp.occ(1, -1)) ->> 'done_at', null, '[RWD-17-h] a chore not ticked has no time');
select is(public.goal_facts(pg_temp.g(1)) -> 'goal' -> 'payout', '{"type": "points", "amount": 10}'::jsonb,
          '[RWD-18] the engine reads the goal''s payout');

-- The time, saved and checked --------------------------------------------------------------------
select is((select params from public.reward_rule where goal_id = pg_temp.g(1)),
          '{"on_time": "18:00", "misses_allowed": 0}'::jsonb, '[RWD-17-g] a time of day is stored on the rule');
select public.save_goal(pg_temp.goal(2, 'none', pg_temp.count(3, '{"on_time": "due_time"}'),
                                     '{"type": "custom"}'));
select is((select params ->> 'on_time' from public.reward_rule where goal_id = pg_temp.g(2)), 'due_time',
          '[RWD-17-g] so is each chore''s due time');
select is(pg_temp.hint($$ select public.save_goal(pg_temp.goal(3, 'none', pg_temp.count(3, '{"on_time": "6 pm"}'),
                                                 '{"type": "custom"}')) $$), 'rule_on_time',
          '[RWD-17-g] anything else is refused');
select is(pg_temp.hint($$ select public.save_goal(pg_temp.goal(3, 'none', pg_temp.count(3, '{"on_time": "24:00"}'),
                                                 '{"type": "custom"}')) $$), 'rule_on_time',
          '[RWD-17-g] ... a time that isn''t one too');

-- Steps and weights, saved and checked -----------------------------------------------------------
select is(pg_temp.hint($$ select public.save_goal(pg_temp.goal(4, 'week', pg_temp.days('{"on_time": "18:00"}'),
            pg_temp.points(20, '[{"misses": 1, "amount": 10}, {"misses": 2, "amount": 5}]'))) $$), 'saved',
          '[RWD-18-h] a weekly goal pays in steps by days missed');
select is((select payout from public.reward_goal where id = pg_temp.g(4)),
          '{"type": "points", "amount": 20, "steps": [{"misses": 1, "amount": 10}, {"misses": 2, "amount": 5}]}'::jsonb,
          '... stored with its steps');
select is((select (params ->> 'misses_allowed')::int from public.reward_rule where goal_id = pg_temp.g(4)), 2,
          '[RWD-18-h] the lowest step sets the misses allowed');
select is(pg_temp.hint($$ select public.save_goal(pg_temp.goal(5, 'week', pg_temp.days(),
            '{"type": "catalog_item", "item_id": "51f00000-0000-0000-0000-000000000001", "steps": [{"misses": 1, "amount": 10}]}')) $$),
          'payout_steps_points', '[RWD-18-h] steps pay points only');
select is(pg_temp.hint($$ select public.save_goal(pg_temp.goal(5, 'week', pg_temp.days(),
            pg_temp.points(20, '[{"misses": 1, "amount": 20}]'))) $$), 'payout_steps',
          '[RWD-18-h] each step pays fewer points than the one above');
select is(pg_temp.hint($$ select public.save_goal(pg_temp.goal(5, 'week', pg_temp.days(),
            pg_temp.points(20, '[{"misses": 2, "amount": 10}, {"misses": 1, "amount": 5}]'))) $$), 'payout_steps',
          '[RWD-18-h] days missed rise step by step');
select is(pg_temp.hint($$ select public.save_goal(pg_temp.goal(5, 'week', pg_temp.days(),
            pg_temp.points(20, '[{"misses": 4, "amount": 10}]'))) $$), 'payout_steps',
          '[RWD-18-h] up to 3 days missed');
select is(pg_temp.hint($$ select public.save_goal(pg_temp.goal(5, 'week', pg_temp.days(),
            pg_temp.points(20, '[{"misses": 1, "amount": 9}, {"misses": 2, "amount": 8}, {"misses": 3, "amount": 7},
                                 {"misses": 3, "amount": 6}]'))) $$), 'payout_steps',
          '[RWD-18-h] up to 3 lower steps');
select is(pg_temp.hint($$ select public.save_goal(pg_temp.goal(5, 'none', pg_temp.count(20),
            pg_temp.points(20, '[{"at": 15, "amount": 10}]'))) $$), 'steps_end_date',
          '[RWD-18-h] a one-off goal in steps needs an end date');
select is(pg_temp.hint($$ select public.save_goal(pg_temp.goal(5, 'none', pg_temp.count(20),
            pg_temp.points(20, '[{"at": 20, "amount": 10}]'), 30)) $$), 'payout_steps',
          '[RWD-18-h] a step by number is under the target');
select is(pg_temp.hint($$ select public.save_goal(pg_temp.goal(5, 'none', pg_temp.count(20),
            pg_temp.points(20, '[{"at": 15, "amount": 10}, {"at": 10, "amount": 5}]'), 30)) $$), 'saved',
          '[RWD-18-h] a one-off goal with an end date pays in steps by number');
create function pg_temp.two(p_w1 int, p_w2 int) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('type', 'DAYS_DUE', 'scope', jsonb_build_object('all', true), 'weight', p_w1),
    jsonb_build_object('type', 'COUNT', 'target', 5, 'scope', jsonb_build_object('all', true), 'weight', p_w2))
$$;
select is(pg_temp.hint($$ select public.save_goal(pg_temp.goal(6, 'week', pg_temp.two(60, 30),
            pg_temp.points(20, '[{"at": 75, "amount": 10}]'))) $$), 'rule_weights',
          '[RWD-18-h] weights total 100');
select is(pg_temp.hint($$ select public.save_goal(pg_temp.goal(6, 'week', pg_temp.two(0, 100),
            pg_temp.points(20, '[{"at": 75, "amount": 10}]'))) $$), 'rule_weight',
          '[RWD-18-h] a weight is 1 to 100');
select is(pg_temp.hint($$ select public.save_goal(pg_temp.goal(6, 'week', pg_temp.two(60, 40),
            pg_temp.points(20, '[{"at": 75, "amount": 10}, {"at": 50, "amount": 5}]'))) $$), 'saved',
          '[RWD-18-h] two weighted rules pay in steps by the goal''s %');
select is((select string_agg(weight::text, ',' order by sort_order) from public.reward_rule where goal_id = pg_temp.g(6)),
          '60,40', '... each rule stored with its weight');

-- Each step paid once, taken back once ------------------------------------------------------------
select pg_temp.as_owner();
update public.reward_goal set status = 'active' where id in (pg_temp.g(4), pg_temp.g(5));
select pg_temp.parent();
-- Last week won at 1 missed: 10 points.
select pg_temp.save(4, jsonb_build_object('periods', jsonb_build_array(pg_temp.per(-7, -1, 'won', 1))));
select pg_temp.save(4, jsonb_build_object('periods', jsonb_build_array(pg_temp.per(-7, -1, 'won', 1))));
select is(pg_temp.paid(4), 'bonus 10 n1', '[RWD-18-i] a week won at a lower step pays that step, once');
select is((select step from public.reward_goal_period where goal_id = pg_temp.g(4)), 1, '... and keeps the step');
-- A parent's late fix: all days. The difference, 10 more.
select pg_temp.save(4, jsonb_build_object('periods', jsonb_build_array(pg_temp.per(-7, -1, 'won', 0))));
select pg_temp.save(4, jsonb_build_object('periods', jsonb_build_array(pg_temp.per(-7, -1, 'won', 0))));
select is(pg_temp.paid(4), 'bonus 10 n1, bonus 10 n1',
          '[RWD-18-i] a fix that lifts a won week to the top step pays the difference, once');
select is(pg_temp.events(4, 'step_changed'), 1::bigint, '... logged once');
-- Undone: the week is lost, and all 20 come back off, once.
select pg_temp.save(4, jsonb_build_object('periods', jsonb_build_array(pg_temp.per(-7, -1, 'missed', null))));
select pg_temp.save(4, jsonb_build_object('periods', jsonb_build_array(pg_temp.per(-7, -1, 'missed', null))));
select is(pg_temp.paid(4), 'bonus 10 n1, bonus 10 n1, reversal -20 n1',
          '[RWD-18-i] a won week undone takes back what its step paid, once');

-- A one-off goal reached at a lower step when it ends, then lifted to the top by a fix.
create function pg_temp.reached(p_step int) returns jsonb language sql as $$
  select jsonb_build_object('is_achieved', true,
                            'transitions', jsonb_build_array(jsonb_build_object('type', 'achieved', 'from', 'active',
                                                                                'to', 'achieved')),
                            'step', jsonb_build_object('reached', p_step, 'best', p_step, 'final', true))
$$;
select pg_temp.save(5, pg_temp.reached(1));
select is(pg_temp.paid(5) || ' / ' || (select status || ':' || paid_step from public.reward_goal where id = pg_temp.g(5)),
          'bonus 10 n1 / achieved:1', '[RWD-18-i] a one-off goal reached at a lower step pays that step');
select pg_temp.save(5, pg_temp.reached(0) - 'transitions');
select pg_temp.save(5, pg_temp.reached(0) - 'transitions');
select is(pg_temp.paid(5) || ' / ' || (select paid_step from public.reward_goal where id = pg_temp.g(5)),
          'bonus 10 n1, bonus 10 n1 / 0', '[RWD-18-i] lifted to the top step, it pays the difference once');

select * from finish();
rollback;
