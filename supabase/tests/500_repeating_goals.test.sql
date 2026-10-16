-- [RWD-15][RWD-16] Goals that repeat each week, month or school term (WP-80, D-101, D-123): the
-- repeat and "every day it's due" saved and checked; each period's outcome and achievement recorded
-- once, its payout paid once and taken back once; a won week kept when the rules change after it;
-- stopping after the period going now; each won period celebrated once; a week's days named by their
-- day type; a period only for its own family. The evaluations are written by hand, as the engine
-- would send them (200_goals and 320_goal_payouts do the same).
begin;
select plan(38);

insert into auth.users (id, email) values
  ('50100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('50300000-0000-0000-0000-000000000003', 'neighbour@example.com');
insert into public.household (id, name, timezone, week_start) values
  ('50000000-0000-0000-0000-000000000001', 'Repeat family', 'America/Chicago', 1),
  ('50000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago', 0);
insert into public.household_settings (household_id) values
  ('50000000-0000-0000-0000-000000000001'), ('50000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('50000000-0000-0000-0000-000000000001', '50100000-0000-0000-0000-000000000001', 'owner'),
  ('50000000-0000-0000-0000-000000000002', '50300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('50110000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', 'Maya', 'child');
insert into public.reward_catalog_item (id, household_id, title, cost_points) values
  ('50f00000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Tablet time', 20);

create function pg_temp.today() returns date language sql as $$
  select private.household_today('50000000-0000-0000-0000-000000000001')
$$;
create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('50100000-0000-0000-0000-000000000001')
$$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
create function pg_temp.g(p_n int) returns uuid language sql as $$
  select ('50e00000-0000-0000-0000-00000000000' || p_n)::uuid
$$;
-- Goal n for Maya as the form sends it, starting 20 days ago: `repeat`, its rules and its payout.
create function pg_temp.goal(p_n int, p_repeat text, p_rules jsonb,
                             p_payout jsonb default '{"type": "points", "amount": 10}') returns jsonb
language sql as $$
  select jsonb_build_object('id', pg_temp.g(p_n), 'household_id', '50000000-0000-0000-0000-000000000001',
                            'member_id', '50110000-0000-0000-0000-00000000000a', 'title', 'Homework home',
                            'icon', 'trophy', 'start_date', pg_temp.today() - 20, 'end_date', null,
                            'rule_logic', 'all', 'rules', p_rules, 'payout', p_payout)
         || case when p_repeat is null then '{}'::jsonb else jsonb_build_object('repeat', p_repeat) end
$$;
create function pg_temp.days(p_misses int default null) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('type', 'DAYS_DUE', 'scope', jsonb_build_object('all', true))
         || case when p_misses is null then '{}'::jsonb
                 else jsonb_build_object('params', jsonb_build_object('misses_allowed', p_misses)) end)
$$;
-- A period as the engine sends it: from p_from to p_to days from today, with its outcome.
create function pg_temp.per(p_from int, p_to int, p_outcome text, p_days jsonb default null) returns jsonb
language sql as $$
  select jsonb_build_object('start', pg_temp.today() + p_from, 'end', pg_temp.today() + p_to,
                            'outcome', p_outcome, 'next_start', pg_temp.today() + p_to + 1,
                            'pct', case when p_outcome = 'won' then 100 else 40 end,
                            'days_due', 5, 'days_done', case when p_outcome = 'won' then 5 else 2 end,
                            'days_missed', case when p_outcome = 'missed' then 1 else 0 end,
                            'misses_allowed', 0, 'days', p_days)
$$;
-- An evaluation of goal n with these periods, saved as its parent (the Goals page does the same).
create function pg_temp.save(p_n int, p_periods jsonb) returns jsonb language sql as $$
  select public.save_goal_evaluation(pg_temp.g(p_n), (select status from public.reward_goal where id = pg_temp.g(p_n)),
    (select rules_version from public.reward_goal where id = pg_temp.g(p_n)),
    jsonb_build_object('goal_id', pg_temp.g(p_n), 'pct', 40, 'is_achieved', false, 'rules', '[]'::jsonb,
                       'transitions', '[]'::jsonb, 'periods', p_periods),
    2, clock_timestamp())
$$;
create function pg_temp.outcomes(p_n int) returns text language sql as $$
  select coalesce(string_agg(outcome || coalesce(':n' || n, ''), ', ' order by start_date), '')
    from public.reward_goal_period where goal_id = pg_temp.g(p_n)
$$;
create function pg_temp.paid(p_n int) returns text language sql as $$
  select coalesce(string_agg(entry_type || ' ' || amount || ' n' || goal_n, ', ' order by created_at, id), '')
    from public.points_ledger where goal_id = pg_temp.g(p_n)
$$;
create function pg_temp.events(p_n int, p_type text) returns bigint language sql as $$
  select count(*) from public.reward_goal_event where goal_id = pg_temp.g(p_n) and type = p_type
$$;

select pg_temp.parent();

-- The repeat and the rule --------------------------------------------------------------------
select lives_ok($$ select public.save_goal(pg_temp.goal(1, 'week', pg_temp.days())) $$,
                '[RWD-15-e] a goal that repeats each week, every day it''s due, is saved');
select is((select repeats from public.reward_goal where id = pg_temp.g(1)), 'week', '... repeating each week');
select is((select jsonb_build_object('type', rule_type, 'target', target, 'params', params)
             from public.reward_rule where goal_id = pg_temp.g(1)),
          '{"type": "DAYS_DUE", "target": 1, "params": {"misses_allowed": 0}}'::jsonb,
          '[RWD-16-i] every day it''s due is stored with its misses allowed, 0 by default');
select lives_ok($$ select public.save_goal(pg_temp.goal(2, 'month', pg_temp.days(3))) $$,
                '[RWD-16-i] up to 3 misses allowed');
select throws_ok($$ select public.save_goal(pg_temp.goal(3, 'week', pg_temp.days(4))) $$, '22023',
                 'misses allowed: 0 to 3', '[RWD-16-i] not 4');
select throws_ok($$ select public.save_goal(pg_temp.goal(3, null, pg_temp.days())) $$, '22023',
                 'every day it''s due is for a goal that repeats',
                 '[RWD-16-i] every day it''s due is refused on a goal that doesn''t repeat');
select throws_ok($$ select public.save_goal(pg_temp.goal(3, 'year', pg_temp.days())) $$, '22023',
                 'repeats each week, month or term, or not at all', '[RWD-15-e] a repeat is a week, month or term');
select lives_ok($$ select public.save_goal(pg_temp.goal(3, null, '[{"type": "COUNT", "target": 4}]')) $$,
                '[RWD-15-e] a goal left without a repeat doesn''t repeat');
select is((select repeats from public.reward_goal where id = pg_temp.g(3)), 'none', '... stored as none');
select lives_ok($$ select public.save_goal(pg_temp.goal(2, 'term', pg_temp.days(3))) $$,
                '[RWD-15-e] a goal not yet started may change how it repeats');

select pg_temp.as_owner();
update public.reward_goal set status = 'active' where id in (pg_temp.g(1), pg_temp.g(2), pg_temp.g(3));
select pg_temp.parent();
select throws_ok($$ select public.save_goal(pg_temp.goal(1, 'month', pg_temp.days())) $$, '22023',
                 'a started goal keeps how it repeats', '[RWD-15-e] a started goal keeps how it repeats (D-123)');
select throws_ok($$ select public.save_goal(pg_temp.goal(3, 'week', '[{"type": "COUNT", "target": 4}]')) $$,
                 '22023', 'a started goal keeps how it repeats', '... a goal that didn''t repeat too');

-- Each period, paid and taken back once -------------------------------------------------------
-- Week 1 (14 to 8 days ago) won; week 2 (7 to 1 days ago) still open.
select lives_ok($$ select pg_temp.save(1, jsonb_build_array(pg_temp.per(-14, -8, 'won'), pg_temp.per(-7, -1, 'open'))) $$,
                '[RWD-15-f] an evaluation with its periods is saved');
select is(pg_temp.outcomes(1), 'won:n1, open', '[RWD-15-f] each period''s outcome is recorded, the won week as achievement 1');
select is(pg_temp.paid(1), 'bonus 10 n1', '[RWD-15-f] the won week pays its 10 points');
select pg_temp.save(1, jsonb_build_array(pg_temp.per(-14, -8, 'won'), pg_temp.per(-7, -1, 'open')));
select is(pg_temp.paid(1) || ' / ' || pg_temp.outcomes(1) || ' / ' || pg_temp.events(1, 'achieved'),
          'bonus 10 n1 / won:n1, open / 1', '[RWD-15-f] worked out again, it is recorded and paid once');
select is((select status || ':' || achievement_count from public.reward_goal where id = pg_temp.g(1)), 'active:1',
          '[RWD-15] the goal itself goes on, with one achievement');

-- A check-off it needed is undone: the week is missed, and its points come back off once.
select pg_temp.save(1, jsonb_build_array(pg_temp.per(-14, -8, 'missed'), pg_temp.per(-7, -1, 'open')));
select pg_temp.save(1, jsonb_build_array(pg_temp.per(-14, -8, 'missed'), pg_temp.per(-7, -1, 'open')));
select is(pg_temp.paid(1), 'bonus 10 n1, reversal -10 n1', '[RWD-15-f] a won week undone takes back its payout once');
select is(pg_temp.events(1, 'unachieved') || ':' || pg_temp.events(1, 'payout_reversed'), '1:1',
          '... logged once each, with the week');
select is((select payload ->> 'period_start' from public.reward_goal_event
            where goal_id = pg_temp.g(1) and type = 'unachieved'), (pg_temp.today() - 14)::text,
          '... the log names the week');
-- A parent's late tick wins it again: the next achievement, paid again.
select pg_temp.save(1, jsonb_build_array(pg_temp.per(-14, -8, 'won'), pg_temp.per(-7, -1, 'won')));
select is(pg_temp.outcomes(1), 'won:n2, won:n3', '[RWD-15-f] won again, each week is its own next achievement');
select is(pg_temp.paid(1), 'bonus 10 n1, reversal -10 n1, bonus 10 n2, bonus 10 n3',
          '... each paid once');

-- A shop reward: each won week puts it in To give once (D-123).
select pg_temp.as_owner();
update public.reward_goal set status = 'scheduled' where id = pg_temp.g(2);
select pg_temp.parent();
select public.save_goal(pg_temp.goal(2, 'week', pg_temp.days(),
                                     '{"type": "catalog_item", "item_id": "50f00000-0000-0000-0000-000000000001"}'));
select pg_temp.as_owner();
update public.reward_goal set status = 'active' where id = pg_temp.g(2);
select pg_temp.parent();
select pg_temp.save(2, jsonb_build_array(pg_temp.per(-14, -8, 'won'), pg_temp.per(-7, -1, 'won')));
select pg_temp.save(2, jsonb_build_array(pg_temp.per(-14, -8, 'won'), pg_temp.per(-7, -1, 'won')));
select is((select count(*)::int from public.redemption where goal_id = pg_temp.g(2) and status = 'approved'), 2,
          '[RWD-15-f] a shop reward goes to To give once for each won week');

-- Celebrated once each --------------------------------------------------------------------------
select ok(public.mark_goal_celebrated(pg_temp.g(1), 3), '[RWD-15-i] a won week is celebrated');
select ok(not public.mark_goal_celebrated(pg_temp.g(1), 3), '[RWD-15-i] ... once');
select ok(not public.mark_goal_celebrated(pg_temp.g(1), 7), '... and not an achievement that isn''t a won week');

-- A week's days named by their day type -------------------------------------------------------
select pg_temp.save(2, jsonb_build_array(pg_temp.per(-14, -8, 'won'), pg_temp.per(-7, -2, 'won'), pg_temp.per(-1, 5, 'open',
  jsonb_build_array(jsonb_build_object('date', '2026-10-16', 'mark', 'done'),
                    jsonb_build_object('date', '2026-10-17', 'mark', 'none')))));
select is((select days from public.reward_goal_period where goal_id = pg_temp.g(2) and start_date = pg_temp.today() - 1),
          '[{"date": "2026-10-16", "mark": "done"}, {"date": "2026-10-17", "mark": "none", "day_type": "weekend"}]'::jsonb,
          '[RWD-16] a day with nothing due says what kind of day it is');

-- A won week keeps its outcome when the rules change after it (D-115) ---------------------------
-- Goal 1's week going now (from yesterday to 5 days ahead) is won.
select pg_temp.save(1, jsonb_build_array(pg_temp.per(-14, -8, 'won'), pg_temp.per(-7, -2, 'won'),
                                         pg_temp.per(-1, 5, 'won')));
select lives_ok($$ select public.save_goal(pg_temp.goal(1, 'week', pg_temp.days(1))) $$,
                '[RWD-15-g] a started repeating goal''s rules change');
select is((select periods_from from public.reward_goal where id = pg_temp.g(1)), pg_temp.today() + 6,
          '[RWD-15-g] the change counts from the next week, this one being won');
select pg_temp.save(1, jsonb_build_array(pg_temp.per(-14, -8, 'missed'), pg_temp.per(-7, -2, 'missed'),
                                         pg_temp.per(-1, 5, 'missed')));
select is(pg_temp.outcomes(1), 'won:n2, won:n3, won:n4',
          '[RWD-15-g] the weeks before keep their outcome under the new rules');
select is((select count(*)::int from public.points_ledger where goal_id = pg_temp.g(1) and entry_type = 'reversal'), 1,
          '[RWD-15-g] ... and what they paid');

-- Stop after this week ----------------------------------------------------------------------------
select is(public.stop_goal_after_period(pg_temp.g(1)) ->> 'end_date', (pg_temp.today() + 5)::text,
          '[RWD-15-h] stop after this week ends it on the last day of the week going now');
select is((select end_date from public.reward_goal where id = pg_temp.g(1)), pg_temp.today() + 5,
          '... which is stored');
select is(public.stop_goal_after_period(pg_temp.g(1)) ->> 'duplicate', 'true', '[RWD-15-h] safe to send twice');
select is(pg_temp.events(1, 'stopped'), 1::bigint, '... logged once');
select pg_temp.as_owner();
insert into public.reward_goal (id, household_id, member_id, title, start_date, status)
values (pg_temp.g(4), '50000000-0000-0000-0000-000000000001', '50110000-0000-0000-0000-00000000000a',
        'Read', pg_temp.today() - 3, 'active');
select pg_temp.parent();
select throws_ok($$ select public.stop_goal_after_period(pg_temp.g(4)) $$, '22023',
                 'only a repeating goal stops after a period', '[RWD-15-h] only a repeating goal stops after a period');

-- Only its own family ---------------------------------------------------------------------------
select pg_temp.as_user('50300000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.reward_goal_period), 0, '[NFR-04] another family sees none of the periods');
select throws_ok($$ select public.stop_goal_after_period(pg_temp.g(2)) $$, '42501', 'not allowed',
                 '[NFR-04] nor stops the goal');

select * from finish();
rollback;
