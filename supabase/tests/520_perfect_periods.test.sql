-- [RWD-19][RWD-20] Perfect periods, and a family goal every child meets (WP-82, D-103, D-126): the
-- counted goal and the every-child option saved and checked; the facts the engine reads carry the
-- counted goal's periods and the children; a period of the counted goal marks the goal counting it; a
-- reached counted goal pays its own payout once; an every-child period pays each child with something
-- due once, and only them, takes it back once, and follows a parent's fix; each child's week is kept
-- and is on the board. The evaluations are written by hand, as the engine would send them (500 and
-- 510 do the same).
begin;
select plan(38);

insert into auth.users (id, email) values
  ('52100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('52d00000-0000-0000-0000-00000000000d', 'board@example.com');
insert into public.household (id, name, timezone, week_start) values
  ('52000000-0000-0000-0000-000000000001', 'Perfect family', 'America/Chicago', 1);
insert into public.household_settings (household_id) values ('52000000-0000-0000-0000-000000000001');
insert into public.household_user (household_id, user_id, role) values
  ('52000000-0000-0000-0000-000000000001', '52100000-0000-0000-0000-000000000001', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('52110000-0000-0000-0000-00000000000a', '52000000-0000-0000-0000-000000000001', 'Maya', 'child'),
  ('52110000-0000-0000-0000-00000000000b', '52000000-0000-0000-0000-000000000001', 'Leo', 'child'),
  ('52110000-0000-0000-0000-00000000000c', '52000000-0000-0000-0000-000000000001', 'Alex', 'adult');
insert into public.device (id, household_id, name, auth_user_id) values
  ('52dd0000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000001', 'Kitchen',
   '52d00000-0000-0000-0000-00000000000d');
insert into public.reward_catalog_item (id, household_id, title, cost_points) values
  ('52f00000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000001', 'Ice cream trip', 40);

create function pg_temp.today() returns date language sql as $$
  select private.household_today('52000000-0000-0000-0000-000000000001')
$$;
create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('52100000-0000-0000-0000-000000000001')
$$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
create function pg_temp.g(p_n int) returns uuid language sql as $$
  select ('52e00000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::uuid
$$;
create function pg_temp.maya() returns uuid language sql as $$ select '52110000-0000-0000-0000-00000000000a'::uuid $$;
create function pg_temp.leo() returns uuid language sql as $$ select '52110000-0000-0000-0000-00000000000b'::uuid $$;
-- Goal n as the form sends it, starting 20 days ago: for p_member (null, the family).
create function pg_temp.goal(p_n int, p_member uuid, p_repeat text, p_rules jsonb, p_payout jsonb,
                             p_extra jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_object('id', pg_temp.g(p_n), 'household_id', '52000000-0000-0000-0000-000000000001',
                            'member_id', p_member, 'title', 'Goal ' || p_n, 'icon', 'trophy',
                            'start_date', pg_temp.today() - 20, 'end_date', null, 'rule_logic', 'all',
                            'repeat', p_repeat, 'rules', p_rules, 'payout', p_payout) || p_extra
$$;
create function pg_temp.days() returns jsonb language sql as $$
  select '[{"type": "DAYS_DUE", "scope": {"all": true}, "params": {}}]'::jsonb
$$;
create function pg_temp.won(p_goal int, p_target int, p_in_a_row boolean) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('type', 'PERIODS_WON', 'target', p_target,
                                              'params', jsonb_build_object('goal_id', pg_temp.g(p_goal),
                                                                           'in_a_row', p_in_a_row)))
$$;
create function pg_temp.points(p_amount int) returns jsonb language sql as $$
  select jsonb_build_object('type', 'points', 'amount', p_amount)
$$;
create function pg_temp.hint(p_sql text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute p_sql;
  return 'saved';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), sqlerrm);
end $$;
-- A child's week as the engine sends it: Maya's or Leo's, with something due or not, and how it went.
create function pg_temp.kid(p_member uuid, p_contributes boolean, p_outcome text) returns jsonb
language sql as $$
  select jsonb_build_object('member_id', p_member, 'contributes', p_contributes, 'outcome', p_outcome,
                            'pct', 100, 'days_due', 1, 'days_done', 1, 'days_missed', 0,
                            'days', jsonb_build_array(jsonb_build_object('date', pg_temp.today() - 7, 'mark', 'done'),
                                                      jsonb_build_object('date', pg_temp.today() - 6, 'mark', 'none')))
$$;
-- A period from p_from to p_to days from today, as the engine sends it.
create function pg_temp.per(p_from int, p_to int, p_outcome text, p_children jsonb default null) returns jsonb
language sql as $$
  select jsonb_build_object('start', pg_temp.today() + p_from, 'end', pg_temp.today() + p_to,
                            'outcome', p_outcome, 'next_start', pg_temp.today() + p_to + 1, 'pct', 100,
                            'days_due', null, 'days_done', null, 'days_missed', null, 'misses_allowed', 0,
                            'days', null, 'step', null, 'children', p_children)
$$;
create function pg_temp.save(p_n int, p_eval jsonb) returns jsonb language sql as $$
  select public.save_goal_evaluation(pg_temp.g(p_n), (select status from public.reward_goal where id = pg_temp.g(p_n)),
    (select rules_version from public.reward_goal where id = pg_temp.g(p_n)),
    jsonb_build_object('goal_id', pg_temp.g(p_n), 'pct', 50, 'is_achieved', false, 'rules', '[]'::jsonb,
                       'transitions', '[]'::jsonb, 'periods', '[]'::jsonb, 'step', null, 'children', null) || p_eval,
    4, clock_timestamp())
$$;
create function pg_temp.paid(p_n int) returns text language sql as $$
  select coalesce(string_agg(m.display_name || ' ' || l.amount || ' n' || l.goal_n, ', '
                             order by m.display_name, l.amount desc, l.id), '')
    from public.points_ledger l join public.member m on m.id = l.member_id where l.goal_id = pg_temp.g(p_n)
$$;
create function pg_temp.events(p_n int, p_type text) returns bigint language sql as $$
  select count(*) from public.reward_goal_event where goal_id = pg_temp.g(p_n) and type = p_type
$$;

-- The counted goal, saved and checked --------------------------------------------------------------
select pg_temp.parent();
-- 1: Maya's weekly homework; 2: the family's weekly homework; 3: Maya's one-off goal.
select public.save_goal(pg_temp.goal(1, pg_temp.maya(), 'week', pg_temp.days(), pg_temp.points(10)));
select public.save_goal(pg_temp.goal(2, null, 'week', pg_temp.days(), pg_temp.points(20)));
select public.save_goal(pg_temp.goal(3, pg_temp.maya(), 'none',
  '[{"type": "COUNT", "target": 5, "scope": {"all": true}}]', pg_temp.points(5)));

select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(10, pg_temp.maya(), 'none', pg_temp.won(1, 3, true),
            '{"type": "catalog_item", "item_id": "52f00000-0000-0000-0000-000000000001"}'))$$),
          'saved', '[RWD-19-f] Maya''s goal can count 3 weeks in a row of her weekly goal, paying a shop reward');
select is((select jsonb_build_object('type', rule_type, 'target', target, 'scope', scope, 'params', params)
             from public.reward_rule where goal_id = pg_temp.g(10)),
          jsonb_build_object('type', 'PERIODS_WON', 'target', 3, 'scope', '{"all": true}'::jsonb,
                             'params', jsonb_build_object('goal_id', pg_temp.g(1)::text, 'in_a_row', true)),
          '[RWD-19-f] the rule keeps the goal it counts and in a row; it counts no items of its own');
select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(11, pg_temp.maya(), 'none', pg_temp.won(3, 3, false),
            pg_temp.points(5)))$$),
          'rule_source', '[RWD-19-f] a goal that doesn''t repeat can''t be counted');
select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(11, pg_temp.leo(), 'none', pg_temp.won(1, 3, false),
            pg_temp.points(5)))$$),
          'rule_source', '[RWD-19-f] Leo''s goal can''t count Maya''s weeks');
select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(11, null, 'none', pg_temp.won(1, 3, false),
            pg_temp.points(5)))$$),
          'rule_source', '[RWD-19-f] a family goal can''t count Maya''s weeks');
select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(11, pg_temp.maya(), 'week', pg_temp.won(11, 3, false),
            pg_temp.points(5)))$$),
          'rule_source', '[RWD-19-f] a goal can''t count its own weeks');
select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(11, pg_temp.maya(), 'none', pg_temp.won(10, 3, false),
            pg_temp.points(5)))$$),
          'rule_source', '[RWD-19-f] a goal can''t count a goal that counts weeks itself');
select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(11, pg_temp.maya(), 'none',
            '[{"type": "PERIODS_WON", "target": 3, "params": {"goal_id": "nope"}}]', pg_temp.points(5)))$$),
          'rule_source', '[RWD-19-f] the rule names a goal by its id');
select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(11, pg_temp.maya(), 'none',
            jsonb_build_array(jsonb_build_object('type', 'PERIODS_WON', 'target', 3,
              'params', jsonb_build_object('goal_id', pg_temp.g(1), 'in_a_row', 'yes'))), pg_temp.points(5)))$$),
          'rule_source', '[RWD-19-f] in a row is true or false');
select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(12, pg_temp.maya(), 'none', pg_temp.won(1, 4, false),
            pg_temp.points(15)))$$),
          'saved', '[RWD-19-f] another goal can count the same weeks in total');
select is((select params ->> 'in_a_row' from public.reward_rule where goal_id = pg_temp.g(12)), 'false',
          '[RWD-19-f] in total is in_a_row false');

-- The every-child option, saved and checked -----------------------------------------------------------
select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(20, null, 'week', pg_temp.days(), pg_temp.points(20),
            '{"each_child": true}'))$$),
          'saved', '[RWD-20-e] a family goal can need every child to meet it');
select ok((select each_child from public.reward_goal where id = pg_temp.g(20)), '[RWD-20-e] it is kept');
select ok(not (select each_child from public.reward_goal where id = pg_temp.g(2)),
          '[RWD-20-e] a family goal counts each check-off once unless asked');
select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(21, pg_temp.maya(), 'week', pg_temp.days(),
            pg_temp.points(20), '{"each_child": true}'))$$),
          'each_child_family', '[RWD-20-e] every child meets it is for a family goal');
select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(21, null, 'week', pg_temp.days(),
            pg_temp.points(20) || '{"steps": [{"misses": 1, "amount": 10}]}', '{"each_child": true}'))$$),
          'each_child_steps', '[RWD-20-e] every child meets it doesn''t pay in steps (D-126)');
select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(21, null, 'none', pg_temp.won(2, 3, false),
            pg_temp.points(20), '{"each_child": true}'))$$),
          'each_child_counted', '[RWD-20-e] every child meets it doesn''t count another goal''s weeks');
select pg_temp.as_owner();
update public.reward_goal set status = 'active' where id in (pg_temp.g(1), pg_temp.g(2), pg_temp.g(10), pg_temp.g(20));
select pg_temp.parent();
select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(20, null, 'week', pg_temp.days(), pg_temp.points(20),
            '{"each_child": false}'))$$),
          'each_child_fixed', '[RWD-20-e] a started goal keeps every child meets it (D-126)');
select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(2, null, 'week', pg_temp.days(), pg_temp.points(20),
            '{"each_child": true}'))$$),
          'each_child_fixed', '[RWD-20-e] a started family goal can''t take it on');
select pg_temp.as_owner();
select throws_ok($$update public.reward_goal set each_child = true where id = pg_temp.g(1)$$, '23514', null,
                 '[RWD-20-e] the table refuses it on a goal for one person');

-- What the engine reads ----------------------------------------------------------------------------
select pg_temp.parent();
select pg_temp.save(1, jsonb_build_object('periods', jsonb_build_array(pg_temp.per(-21, -15, 'won'),
                                                                       pg_temp.per(-14, -8, 'missed'),
                                                                       pg_temp.per(-7, -1, 'won'))));
select is((public.goal_facts(pg_temp.g(10)) -> 'sources' -> pg_temp.g(1)::text),
          jsonb_build_array(
            jsonb_build_object('start', pg_temp.today() - 21, 'end', pg_temp.today() - 15, 'outcome', 'won'),
            jsonb_build_object('start', pg_temp.today() - 14, 'end', pg_temp.today() - 8, 'outcome', 'missed'),
            jsonb_build_object('start', pg_temp.today() - 7, 'end', pg_temp.today() - 1, 'outcome', 'won')),
          '[RWD-19-g] the counting goal''s facts carry the counted goal''s weeks');
select is(public.goal_facts(pg_temp.g(20)) -> 'members',
          (select jsonb_agg(id order by id) from public.member
            where household_id = '52000000-0000-0000-0000-000000000001' and role = 'child'),
          '[RWD-20-g] an every-child goal''s facts carry the children who earn rewards');
select is((public.goal_facts(pg_temp.g(20)) -> 'goal' ->> 'each_child'), 'true',
          '[RWD-20-g] and the option');
select pg_temp.save(10, '{}');
select pg_temp.save(12, '{}');
select pg_temp.save(1, jsonb_build_object('periods', jsonb_build_array(pg_temp.per(-21, -15, 'won'),
                                                                       pg_temp.per(-14, -8, 'won'),
                                                                       pg_temp.per(-7, -1, 'won'))));
select is((select array_agg(goal_id order by goal_id) from public.reward_goal_progress
            where goal_id in (pg_temp.g(10), pg_temp.g(12)) and dirty),
          array[pg_temp.g(10), pg_temp.g(12)],
          '[RWD-19-g] a week of the counted goal won marks the goals counting it');
select pg_temp.as_owner();
update public.reward_goal_progress set dirty = true where goal_id = pg_temp.g(1);
select pg_temp.parent();
select is((select array_agg(x) from public.goals_to_evaluate('52000000-0000-0000-0000-000000000001', 4) x
            where x in (pg_temp.g(1), pg_temp.g(10))),
          array[pg_temp.g(1), pg_temp.g(10)],
          '[RWD-19-g] a goal counting weeks is worked out after the goal it counts');

-- A reached counted goal pays its own payout once, and is undone once -------------------------------
select pg_temp.save(12, jsonb_build_object('pct', 100, 'is_achieved', true,
  'transitions', '[{"type": "started", "from": "scheduled", "to": "active"}, {"type": "achieved", "from": "active", "to": "achieved"}]'::jsonb));
select pg_temp.save(12, jsonb_build_object('pct', 100, 'is_achieved', true));
select is(pg_temp.paid(12), 'Maya 15 n1', '[RWD-19-g] reached, it pays its own 15 points once');
select pg_temp.save(12, jsonb_build_object('pct', 75, 'is_achieved', false,
  'transitions', '[{"type": "unachieved", "from": "achieved", "to": "active"}]'::jsonb));
select pg_temp.save(12, jsonb_build_object('pct', 75, 'is_achieved', false));
select is(pg_temp.paid(12), 'Maya 15 n1, Maya -15 n1',
          '[RWD-19-e] a week undone takes it below its target: its payout is taken back once');
select pg_temp.as_owner();
update public.reward_goal set status = 'active' where id = pg_temp.g(12);
select pg_temp.parent();
select is(pg_temp.hint($$select public.save_goal(pg_temp.goal(1, pg_temp.maya(), 'none',
            '[{"type": "COUNT", "target": 5, "scope": {"all": true}}]', pg_temp.points(10)))$$),
          'rule_source', '[RWD-19-f] a goal another goal counts keeps repeating');

-- An every-child week pays each child with something due, once ---------------------------------------
select pg_temp.parent();
select pg_temp.save(20, jsonb_build_object('periods', jsonb_build_array(
  pg_temp.per(-7, -1, 'won', jsonb_build_array(pg_temp.kid(pg_temp.leo(), false, 'neutral'),
                                               pg_temp.kid(pg_temp.maya(), true, 'won'))))));
select pg_temp.save(20, jsonb_build_object('periods', jsonb_build_array(
  pg_temp.per(-7, -1, 'won', jsonb_build_array(pg_temp.kid(pg_temp.leo(), false, 'neutral'),
                                               pg_temp.kid(pg_temp.maya(), true, 'won'))))));
select is(pg_temp.paid(20), 'Maya 20 n1',
          '[RWD-20-f] a won week pays the child with something due, once; Leo had nothing due (D-126)');
select pg_temp.save(20, jsonb_build_object('periods', jsonb_build_array(
  pg_temp.per(-7, -1, 'won', jsonb_build_array(pg_temp.kid(pg_temp.leo(), true, 'won'),
                                               pg_temp.kid(pg_temp.maya(), true, 'won'))))));
select is(pg_temp.paid(20), 'Leo 20 n1, Maya 20 n1',
          '[RWD-20-f] a parent''s fix that gives Leo something due, done, pays him too');
select is(pg_temp.events(20, 'payees_changed'), 1::bigint, '[RWD-20-f] once, in What happened');
select pg_temp.save(20, jsonb_build_object('periods', jsonb_build_array(
  pg_temp.per(-7, -1, 'missed', jsonb_build_array(pg_temp.kid(pg_temp.leo(), true, 'missed'),
                                                  pg_temp.kid(pg_temp.maya(), true, 'won'))))));
select pg_temp.save(20, jsonb_build_object('periods', jsonb_build_array(
  pg_temp.per(-7, -1, 'missed', jsonb_build_array(pg_temp.kid(pg_temp.leo(), true, 'missed'),
                                                  pg_temp.kid(pg_temp.maya(), true, 'won'))))));
select is((select sum(amount)::int from public.points_ledger where goal_id = pg_temp.g(20)), 0,
          '[RWD-20-f] undone, each child''s points are taken back, once');
select is((select count(*)::int from public.points_ledger where goal_id = pg_temp.g(20) and amount < 0), 2,
          '[RWD-20-f] one reversal each');

-- Each child's week, kept and on the board -------------------------------------------------------------
select is((select jsonb_path_query_array(children, '$[*].member_id') from public.reward_goal_period
            where goal_id = pg_temp.g(20)),
          jsonb_build_array(pg_temp.leo(), pg_temp.maya()), '[RWD-20-g] each child''s week is kept with the period');
select ok((select children -> 0 -> 'days' -> 1 ? 'day_type' from public.reward_goal_period
            where goal_id = pg_temp.g(20)),
          '[RWD-20-g] a day with nothing due is named by the child''s day type');
select pg_temp.as_user('52d00000-0000-0000-0000-00000000000d');
select is((select jsonb_build_object('each_child', x -> 'each_child', 'kids', jsonb_array_length(x -> 'period' -> 'children'))
             from jsonb_array_elements(public.board_snapshot() -> 'goals') x where x ->> 'id' = pg_temp.g(20)::text),
          '{"each_child": true, "kids": 2}'::jsonb, '[RWD-20-g] the board has the option and each child''s week');
select is((select x -> 'rules' -> 0 -> 'source' ->> 'id'
             from jsonb_array_elements(public.board_snapshot() -> 'goals') x where x ->> 'id' = pg_temp.g(10)::text),
          pg_temp.g(1)::text, '[RWD-19-g] the board has the goal a rule counts');
select is((select jsonb_array_length(x -> 'rules' -> 0 -> 'source' -> 'history')
             from jsonb_array_elements(public.board_snapshot() -> 'goals') x where x ->> 'id' = pg_temp.g(10)::text),
          2, '[RWD-19-g] with its weeks that started on or after this goal''s start date (D-126)');

select * from finish();
rollback;
