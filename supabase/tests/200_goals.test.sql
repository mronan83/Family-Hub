-- [RWD-01][RWD-04][RWD-06][RWD-09][CHR-10] Goals (WP-19, D-56): a parent sets goals with rules (checked
-- and stored in one shape, so saving the same goal twice changes nothing); who may read and change
-- them; the facts the engine reads; the marks that make a goal dirty; and the save of an evaluation,
-- which applies each status change once and refuses an evaluation that read the goal before it
-- changed. The engine's own results are lib/goals.test.ts's and packages/rules-engine's; here the
-- evaluations are written by hand, as the engine would send them.
begin;
select plan(52);

insert into auth.users (id, email) values
  ('20100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('20300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('20d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone, week_start) values
  ('20000000-0000-0000-0000-000000000001', 'Goal family', 'America/Chicago', 1),
  ('20000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago', 0);
insert into public.household_settings (household_id) values
  ('20000000-0000-0000-0000-000000000001'), ('20000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('20000000-0000-0000-0000-000000000001', '20100000-0000-0000-0000-000000000001', 'owner'),
  ('20000000-0000-0000-0000-000000000002', '20300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('20110000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('20110000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000001', 'Leo', 'child', null),
  ('20110000-0000-0000-0000-00000000000c', '20000000-0000-0000-0000-000000000001', 'Pat', 'adult',
   '20100000-0000-0000-0000-000000000001'),
  ('20110000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000002', 'Dee', 'child', null);
insert into public.device (id, household_id, name, auth_user_id) values
  ('20dd0000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Kitchen',
   '20d00000-0000-0000-0000-00000000000d');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('20000000-0000-0000-0000-000000000001')
$$;
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
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('20100000-0000-0000-0000-000000000001')
$$;

insert into public.tag (id, household_id, name) values
  ('20a00000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Morning'),
  ('20a00000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000002', 'Garden');
insert into public.chore (id, household_id, title, kind, points, schedule, created_by, start_date) values
  ('20c00000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Make bed', 'chore', 5,
   '{"freq": "daily"}', '20100000-0000-0000-0000-000000000001', pg_temp.today() - 20),
  ('20c00000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Feed the fish', 'chore', 2,
   '{"freq": "daily"}', '20100000-0000-0000-0000-000000000001', pg_temp.today() - 20);
insert into public.chore_tag (household_id, chore_id, tag_id) values
  ('20000000-0000-0000-0000-000000000001', '20c00000-0000-0000-0000-000000000001', '20a00000-0000-0000-0000-000000000001');
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('20000000-0000-0000-0000-000000000001', '20c00000-0000-0000-0000-000000000001', '20110000-0000-0000-0000-00000000000a'),
  ('20000000-0000-0000-0000-000000000001', '20c00000-0000-0000-0000-000000000002', '20110000-0000-0000-0000-00000000000b');
select private.generate_occurrences('20000000-0000-0000-0000-000000000001', pg_temp.today() - 5, pg_temp.today());

-- A goal as the form sends it. G1 Maya (Morning things), G2 Leo, G3 the family, G4 Maya, starting later.
create function pg_temp.goal(p_n int, p_member text, p_start int, p_end int, p_rules jsonb,
                             p_title text default 'A goal') returns jsonb language sql as $$
  select jsonb_build_object('id', '20e00000-0000-0000-0000-00000000000' || p_n,
                            'household_id', '20000000-0000-0000-0000-000000000001',
                            'member_id', case when p_member is null then null
                                              else '20110000-0000-0000-0000-00000000000' || p_member end,
                            'title', p_title, 'icon', 'trophy',
                            'start_date', pg_temp.today() + p_start,
                            'end_date', case when p_end is null then null else pg_temp.today() + p_end end,
                            'rule_logic', 'all', 'rules', p_rules)
$$;
create function pg_temp.g(p_n int) returns uuid language sql as $$
  select ('20e00000-0000-0000-0000-00000000000' || p_n)::uuid
$$;
create function pg_temp.events(p_n int) returns text language sql as $$
  select string_agg(type, ',' order by id) from public.reward_goal_event where goal_id = pg_temp.g(p_n)
$$;
-- An evaluation of a goal's first rule as the engine sends it, saved as the job.
create function pg_temp.save(p_n int, p_status text, p_version int, p_value int, p_pct numeric, p_met boolean,
                             p_transitions jsonb default '[]', p_read_at timestamptz default clock_timestamp())
returns jsonb language sql as $$
  select public.save_goal_evaluation(pg_temp.g(p_n), p_status, p_version,
    jsonb_build_object('goal_id', pg_temp.g(p_n), 'pct', p_pct, 'is_achieved', p_met,
      'rules', (select jsonb_agg(jsonb_build_object('rule_id', r.id, 'current_value', p_value,
                                   'target_value', r.target, 'pct', p_pct, 'current_streak', null,
                                   'best_streak', null, 'last_qualifying_date', null, 'is_met', p_met))
                  from public.reward_rule r where r.goal_id = pg_temp.g(p_n)),
      'transitions', p_transitions),
    1, p_read_at)
$$;
create function pg_temp.t(p_type text, p_from text, p_to text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('type', p_type, 'from', p_from, 'to', p_to))
$$;

-- [RWD-01][CHR-10] A parent sets Maya a goal: 3 things tagged Morning.
select pg_temp.parent();
select lives_ok($$ select public.save_goal(pg_temp.goal(1, 'a', -5, 5,
                  '[{"type": "COUNT", "target": 3, "scope": {"tag_ids": ["20a00000-0000-0000-0000-000000000001",
                                                                       "20a00000-0000-0000-0000-000000000001"]}}]')) $$,
                '[RWD-01] a parent sets a child a goal with a rule');
select is((select status || ':' || rules_version || ':' || created_by from public.reward_goal where id = pg_temp.g(1)),
          'scheduled:1:20100000-0000-0000-0000-000000000001', '... scheduled (the engine starts it), rules version 1');
select is((select rule_type || ':' || target || ':' || scope::text || ':' || params::text from public.reward_rule
            where goal_id = pg_temp.g(1)),
          'COUNT:3:{"tag_ids": ["20a00000-0000-0000-0000-000000000001"]}:{}',
          '[CHR-10] its rule counts the tag by id, once');
select is((select p.dirty::text || ':' || pg_temp.events(1) from public.reward_goal_progress p where p.goal_id = pg_temp.g(1)),
          'true:created', '... waiting to be evaluated, and logged as created');
select public.save_goal(pg_temp.goal(1, 'a', -5, 5,
         '[{"type": "COUNT", "target": 3, "scope": {"tag_ids": ["20a00000-0000-0000-0000-000000000001"]}}]'));
select is(pg_temp.events(1), 'created', 'saving the same goal again changes nothing');

-- What a goal may be.
select throws_ok($$ select public.save_goal(pg_temp.goal(5, 'c', 0, null, '[{"type": "COUNT", "target": 3}]')) $$,
                 '22023', 'goals are for someone who earns rewards, or the whole family',
                 'a goal is for someone who earns rewards, or the family');
select throws_ok($$ select public.save_goal(pg_temp.goal(5, 'a', 0, null,
                   '[{"type": "COUNT", "target": 3, "scope": {"tag_ids": ["20a00000-0000-0000-0000-000000000009"]}}]')) $$,
                 '22023', 'a tag or item is not this family''s', '[CHR-10] its rules count only this family''s tags');
select throws_ok($$ select public.save_goal(pg_temp.goal(5, 'a', 0, null, '[]')) $$,
                 '22023', 'a goal has 1 to 5 rules', 'it has at least one rule');
select throws_ok($$ select public.save_goal(pg_temp.goal(5, 'a', 0, null, '[{"type": "COUNT", "target": 0}]')) $$,
                 '22023', 'a target is a whole number from 1 to 100000', 'a target is at least 1');
select throws_ok($$ select public.save_goal(pg_temp.goal(5, 'a', 0, null,
                   '[{"type": "STREAK", "target": 5, "params": {"grace_per_week": 5}}]')) $$,
                 '22023', 'misses forgiven a week: 0 to 3', 'a streak forgives 0 to 3 misses a week');
select throws_ok($$ select public.save_goal(pg_temp.goal(5, 'a', 0, -1, '[{"type": "COUNT", "target": 3}]')) $$,
                 '22023', 'it ends before it starts', 'it ends on or after its start');

select pg_temp.as_user('20300000-0000-0000-0000-000000000003');
select throws_ok($$ select public.save_goal(pg_temp.goal(5, 'a', 0, null, '[{"type": "COUNT", "target": 3}]')) $$,
                 '42501', null, 'another household cannot set this family a goal');
select pg_temp.as_user('20d00000-0000-0000-0000-00000000000d');
select throws_ok($$ select public.save_goal(pg_temp.goal(5, 'a', 0, null, '[{"type": "COUNT", "target": 3}]')) $$,
                 '42501', null, 'neither can a board');

-- Leo's goal (a streak with no params takes the default grace), the family's, and one starting later.
select pg_temp.parent();
select public.save_goal(pg_temp.goal(2, 'b', -5, null,
         '[{"type": "COUNT", "target": 5}, {"type": "STREAK", "target": 2}]'));
select public.save_goal(pg_temp.goal(3, null, -5, null, '[{"type": "DAILY_ALL_DONE", "target": 2}]'));
select public.save_goal(pg_temp.goal(4, 'a', 3, 10, '[{"type": "COUNT", "target": 3}]'));
select is((select coalesce(member_id::text, 'family') || ':' || (select params::text from public.reward_rule
            where goal_id = pg_temp.g(2) and rule_type = 'STREAK') from public.reward_goal where id = pg_temp.g(3)),
          'family:{"grace_per_week": 1}', '[RWD-05] a family goal; a streak forgives a miss a week unless told otherwise');

-- Editing: a name changes nothing that counts; new rules start a new rules version.
select public.save_goal(pg_temp.goal(1, 'a', -5, 5,
         '[{"type": "COUNT", "target": 3, "scope": {"tag_ids": ["20a00000-0000-0000-0000-000000000001"]}}]', 'Movie night'));
select is((select title || ':' || rules_version || ':' || pg_temp.events(1) from public.reward_goal where id = pg_temp.g(1)),
          'Movie night:1:created,edited', 'renaming a goal keeps its rules version');
select public.save_goal(pg_temp.goal(1, 'a', -5, 5,
         '[{"type": "COUNT", "target": 4, "scope": {"tag_ids": ["20a00000-0000-0000-0000-000000000001"]}}]', 'Movie night'));
select is((select rules_version || ':' || pg_temp.events(1) || ':' ||
                  (select (payload #>> '{from,rules,0,target}') || '>' || (payload #>> '{to,rules,0,target}')
                     from public.reward_goal_event where goal_id = pg_temp.g(1) and type = 'rules_changed')
             from public.reward_goal where id = pg_temp.g(1)),
          '2:created,edited,rules_changed:3>4', '[RWD-10] new rules: rules version 2, logged with before and after');

-- [NFR-04] Who reads and writes.
select is((select count(*)::int from public.reward_goal), 4, 'the parent reads the family''s goals');
select throws_ok($$ update public.reward_goal set title = 'Changed' where id = pg_temp.g(1) $$,
                 '42501', null, '... and changes them only through save_goal');
select pg_temp.as_user('20300000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.reward_goal) + (select count(*)::int from public.reward_goal_event), 0,
          'another household sees none of them');
select pg_temp.as_user('20d00000-0000-0000-0000-00000000000d');
select is((select count(*)::int || ':' || (select count(*) from public.reward_rule) || ':' ||
                  (select count(*) from public.reward_goal_progress) || ':' || (select count(*) from public.reward_goal_event)
             from public.reward_goal),
          '4:5:4:0', 'its board reads the goals, rules and progress (not the log)');
select throws_ok($$ select public.goal_facts(pg_temp.g(1)) $$, '42501', null, '... but not the facts behind them');
select throws_ok($$ select public.save_goal_evaluation(pg_temp.g(1), 'scheduled', 2, '{}', 1, now()) $$,
                 '42501', null, '... nor saves an evaluation');
select pg_temp.as_user('20300000-0000-0000-0000-000000000003');
select throws_ok($$ select public.goal_facts(pg_temp.g(1)) $$, '42501', null, 'another household cannot read the facts');

-- [RWD-04] The facts the engine reads: the member's inside the goal's dates up to today, or the family's.
select pg_temp.parent();
select is((select (f -> 'as_of')::text || ':' || (f ->> 'rules_version') || ':' || jsonb_array_length(f -> 'facts') || ':' ||
                  (select count(*) from jsonb_array_elements(f -> 'facts') x
                    where x ->> 'member_id' <> '20110000-0000-0000-0000-00000000000a')
             from (select public.goal_facts(pg_temp.g(1)) f) s),
          to_jsonb(pg_temp.today())::text || ':2:6:0', '[RWD-04] a child''s goal reads their 6 days to today, as of today');
select is((select jsonb_array_length(public.goal_facts(pg_temp.g(3)) -> 'facts')), 12,
          '... a family goal reads everyone''s');
select is((select jsonb_array_length(public.goal_facts(pg_temp.g(4)) -> 'facts')), 0,
          '... and a goal starting later reads nothing yet');

-- [RWD-04][RWD-06] Saving an evaluation, as the job.
select pg_temp.as_job();
select is((select count(*)::int from public.goals_to_evaluate('20000000-0000-0000-0000-000000000001', 1)), 4,
          '[RWD-04] every new goal waits to be evaluated');
select pg_temp.save(1, 'scheduled', 2, 2, 50, false, pg_temp.t('started', 'scheduled', 'active'));
select is((select g.status || ':' || p.pct || ':' || p.dirty || ':' || pg_temp.events(1)
             from public.reward_goal g join public.reward_goal_progress p on p.goal_id = g.id where g.id = pg_temp.g(1)),
          'active:50.00:false:created,edited,rules_changed,activated', '[RWD-06] a goal starts on its start date');
select is(pg_temp.save(1, 'scheduled', 2, 2, 50, false, pg_temp.t('started', 'scheduled', 'active')) ->> 'reason',
          'changed', 'an evaluation that read the goal before it started is refused');
select is((pg_temp.save(1, 'active', 1, 2, 50, false) ->> 'saved') || ':' || pg_temp.events(1),
          'false:created,edited,rules_changed,activated', '... and so is one made for older rules: nothing logged twice');

select pg_temp.save(1, 'active', 2, 4, 100, true, pg_temp.t('achieved', 'active', 'achieved'));
select is((select status || ':' || achievement_count || ':' || (achieved_at is not null) || ':' ||
                  (select payload ->> 'n' from public.reward_goal_event where goal_id = pg_temp.g(1) and type = 'achieved' order by id limit 1)
             from public.reward_goal where id = pg_temp.g(1)),
          'achieved:1:true:1', '[RWD-04] achieved: achievement 1, logged');
select pg_temp.as_owner();
update public.reward_goal set celebrated_at = now() where id = pg_temp.g(1);
select pg_temp.as_job();
select pg_temp.save(1, 'achieved', 2, 3, 75, false, pg_temp.t('unachieved', 'achieved', 'active'));
select is((select status || ':' || achievement_count || ':' || coalesce(achieved_at::text, 'none') || ':' ||
                  coalesce(celebrated_at::text, 'none') from public.reward_goal where id = pg_temp.g(1)),
          'active:1:none:none', '[RWD-04][US-409] a reversed check-off un-achieves it; its celebration is due again');
select pg_temp.save(1, 'active', 2, 4, 100, true, pg_temp.t('achieved', 'active', 'achieved'));
select is((select achievement_count || ':' || pg_temp.events(1) from public.reward_goal where id = pg_temp.g(1)),
          '2:created,edited,rules_changed,activated,achieved,unachieved,achieved', '... and meeting it again is achievement 2');

select pg_temp.as_owner();
create temp table before_save as select computed_at from public.reward_rule_progress
 where goal_id = '20e00000-0000-0000-0000-000000000001';
grant select on before_save to service_role;
select pg_temp.as_job();
select pg_temp.save(1, 'achieved', 2, 4, 100, true);
select is((select computed_at from public.reward_rule_progress where goal_id = pg_temp.g(1)),
          (select computed_at from before_save), 'the same result again leaves its rows as they were');
select pg_temp.as_owner();
update public.reward_goal_progress set marked_at = clock_timestamp() where goal_id = pg_temp.g(1);
select pg_temp.as_job();
select pg_temp.save(1, 'achieved', 2, 4, 100, true, '[]', clock_timestamp() - interval '1 minute');
select is((select dirty from public.reward_goal_progress where goal_id = pg_temp.g(1)), true,
          '[US-407] a mark made after the read keeps the goal dirty');

-- New rules are recomputed and logged with the progress before and after.
select pg_temp.parent();
select public.save_goal(pg_temp.goal(1, 'a', -5, 5,
         '[{"type": "COUNT", "target": 8, "scope": {"tag_ids": ["20a00000-0000-0000-0000-000000000001"]}}]', 'Movie night'));
select pg_temp.as_job();
select pg_temp.save(1, 'achieved', 3, 4, 50, false, pg_temp.t('unachieved', 'achieved', 'active'));
select is((select payload ->> 'from_pct' || '>' || (payload ->> 'to_pct') from public.reward_goal_event
            where goal_id = pg_temp.g(1) and type = 'recomputed'),
          '100.00>50.00', '[US-406] the first evaluation of new rules is logged recomputed, before and after');

-- [RWD-04] Dirty marks: what a check-off can change.
select pg_temp.as_owner();
update public.reward_goal_progress set dirty = false;
insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
select gen_random_uuid(), o.id, 'complete', array['20110000-0000-0000-0000-00000000000a'::uuid], now()
  from public.chore_occurrence o
 where o.chore_id = '20c00000-0000-0000-0000-000000000001' and o.due_date = pg_temp.today();
create function pg_temp.dirty() returns text language sql as $$
  select string_agg(right(goal_id::text, 1) || ':' || dirty, ',' order by goal_id) from public.reward_goal_progress
$$;
select is(pg_temp.dirty(), '1:true,2:false,3:true,4:false',
          '[RWD-04] Maya''s check-off marks her goal and the family''s, not Leo''s nor one starting later');
update public.reward_goal_progress set dirty = false;
select private.generate_occurrences('20000000-0000-0000-0000-000000000001', pg_temp.today() + 20, pg_temp.today() + 20);
select is(pg_temp.dirty(), '1:true,2:true,3:true,4:true', 'planning new days marks every open goal');
update public.reward_goal_progress set dirty = false;
insert into public.chore_tag (household_id, chore_id, tag_id) values
  ('20000000-0000-0000-0000-000000000001', '20c00000-0000-0000-0000-000000000002', '20a00000-0000-0000-0000-000000000001');
select is(pg_temp.dirty(), '1:true,2:true,3:true,4:true', '[CHR-10] tagging an item marks every open goal');

-- What waits to be evaluated.
update public.reward_goal_progress set dirty = false, computed_at = now(), engine_version = 1,
       rules_version = (select rules_version from public.reward_goal g where g.id = goal_id)
 where goal_id = pg_temp.g(2);
update public.reward_goal set status = 'active' where id = pg_temp.g(2);
select pg_temp.as_job();
select ok(pg_temp.g(2) <> all (array(select public.goals_to_evaluate('20000000-0000-0000-0000-000000000001', 1))),
          'a clean goal evaluated today waits for nothing');
select ok(pg_temp.g(2) = any (array(select public.goals_to_evaluate('20000000-0000-0000-0000-000000000001', 2))),
          '... until a newer engine needs it recomputed');

-- [RWD-09][US-405] Redeeming, a review flag, cancelling.
select pg_temp.parent();
select throws_ok($$ select public.redeem_goal(pg_temp.g(1)) $$, '22023', 'only an achieved goal can be redeemed',
                 '[RWD-09] only an achieved goal is redeemed');
select pg_temp.as_job();
select pg_temp.save(1, 'active', 3, 8, 100, true, pg_temp.t('achieved', 'active', 'achieved'));
select pg_temp.parent();
select public.redeem_goal(pg_temp.g(1));
select is((select status || ':' || redeemed_by || ':' || (redeemed_at is not null) from public.reward_goal where id = pg_temp.g(1)),
          'redeemed:20100000-0000-0000-0000-000000000001:true', '[RWD-09] a parent marks it redeemed, with who and when');
select is(public.redeem_goal(pg_temp.g(1)) ->> 'duplicate', 'true', '... and doing it twice is one');
select pg_temp.as_job();
select pg_temp.save(1, 'redeemed', 3, 4, 50, false, pg_temp.t('needs_review', 'redeemed', 'redeemed'));
select pg_temp.save(1, 'redeemed', 3, 4, 50, false, pg_temp.t('needs_review', 'redeemed', 'redeemed'));
select is((select status || ':' || needs_review || ':' ||
                  (select count(*) from public.reward_goal_event where goal_id = pg_temp.g(1) and type = 'needs_review')
             from public.reward_goal where id = pg_temp.g(1)),
          'redeemed:true:1', '[US-409] a redeemed goal whose check-off is reversed stays redeemed, flagged once');
select pg_temp.parent();
select public.clear_goal_review(pg_temp.g(1));
select is((select needs_review from public.reward_goal where id = pg_temp.g(1)), false, '... until a parent clears the flag');
select throws_ok($$ select public.cancel_goal(pg_temp.g(1)) $$, '22023', 'a redeemed goal stays redeemed',
                 'a redeemed goal cannot be cancelled');
select public.cancel_goal(pg_temp.g(2));
select is((select status || ':' || (archived_at is not null) || ':' || (public.cancel_goal(pg_temp.g(2)) ->> 'duplicate')
             from public.reward_goal where id = pg_temp.g(2)),
          'cancelled:true:true', '[RWD-06] a parent cancels a goal (once); it moves to history');
select throws_ok($$ select public.save_goal(pg_temp.goal(2, 'b', -5, null, '[{"type": "COUNT", "target": 9}]')) $$,
                 '22023', 'a finished goal keeps its rules', 'a finished goal keeps its rules');
select lives_ok($$ select public.save_goal(pg_temp.goal(2, 'b', -5, null,
                     '[{"type": "COUNT", "target": 5}, {"type": "STREAK", "target": 2}]', 'Renamed')) $$,
                '... but can be renamed');
select pg_temp.as_job();
select pg_temp.save(3, 'scheduled', 1, 0, 0, false, pg_temp.t('started', 'scheduled', 'active'));
select pg_temp.parent();
select throws_ok($$ select public.save_goal(pg_temp.goal(3, 'a', -5, null, '[{"type": "DAILY_ALL_DONE", "target": 2}]')) $$,
                 '22023', 'a started goal keeps its person and start date', 'a started goal keeps who it is for');

-- [NFR-08] A parent's goal changes are audited.
select pg_temp.as_owner();
select is((select string_agg(action, ',' order by at, id) from public.audit_log
            where entity_type = 'reward_goal' and entity_id = pg_temp.g(4)),
          'insert', 'setting a goal is in the audit log');

select * from finish();
rollback;
