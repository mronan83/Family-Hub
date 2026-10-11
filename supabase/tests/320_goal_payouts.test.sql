-- [RWD-04][RWD-10][RWD-13] Goal payouts and the rule-change preview (WP-39, D-75). The done-when: a
-- points payout posts one bonus on achievement even if the job runs twice; unchecking the deciding
-- chore reverses it once; re-achieving pays again as n + 1; a fulfilled catalog payout raises the
-- review flag. Also: what a goal may pay, a family goal paying each child, a shop reward called off
-- without a refund, a redeemed goal's points taken back and put back, and the preview's facts. The
-- evaluations are written by hand, as the engine would send them (200_goals does the same).
begin;
select plan(43);

insert into auth.users (id, email) values
  ('32100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('32300000-0000-0000-0000-000000000003', 'neighbour@example.com');
insert into public.household (id, name, timezone, week_start) values
  ('32000000-0000-0000-0000-000000000001', 'Payout family', 'America/Chicago', 1),
  ('32000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago', 0);
insert into public.household_settings (household_id) values
  ('32000000-0000-0000-0000-000000000001'), ('32000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('32000000-0000-0000-0000-000000000001', '32100000-0000-0000-0000-000000000001', 'owner'),
  ('32000000-0000-0000-0000-000000000002', '32300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('32110000-0000-0000-0000-00000000000a', '32000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('32110000-0000-0000-0000-00000000000b', '32000000-0000-0000-0000-000000000001', 'Leo', 'child', null),
  ('32110000-0000-0000-0000-00000000000c', '32000000-0000-0000-0000-000000000001', 'Pat', 'adult',
   '32100000-0000-0000-0000-000000000001');
insert into public.reward_catalog_item (id, household_id, title, cost_points, archived_at) values
  ('32f00000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001', 'Ice cream', 30, null),
  ('32f00000-0000-0000-0000-000000000002', '32000000-0000-0000-0000-000000000001', 'Old prize', 30, now()),
  ('32f00000-0000-0000-0000-000000000009', '32000000-0000-0000-0000-000000000002', 'Their prize', 30, null);

create function pg_temp.today() returns date language sql as $$
  select private.household_today('32000000-0000-0000-0000-000000000001')
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
  select pg_temp.as_user('32100000-0000-0000-0000-000000000001')
$$;

insert into public.chore (id, household_id, title, kind, points, schedule, created_by, start_date) values
  ('32c00000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001', 'Make bed', 'chore', 5,
   '{"freq": "daily"}', '32100000-0000-0000-0000-000000000001', pg_temp.today() - 20);
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('32000000-0000-0000-0000-000000000001', '32c00000-0000-0000-0000-000000000001', '32110000-0000-0000-0000-00000000000a');
select private.generate_occurrences('32000000-0000-0000-0000-000000000001', pg_temp.today() - 5, pg_temp.today());

-- A goal as the form sends it: G1 Maya (10 points), G2 Maya (Ice cream), G3 the family (5 points each),
-- G4 Leo (7 points, redeemed later).
create function pg_temp.goal(p_n int, p_member text, p_payout jsonb, p_title text default 'A goal') returns jsonb
language sql as $$
  select jsonb_build_object('id', '32e00000-0000-0000-0000-00000000000' || p_n,
                            'household_id', '32000000-0000-0000-0000-000000000001',
                            'member_id', case when p_member is null then null
                                              else '32110000-0000-0000-0000-00000000000' || p_member end,
                            'title', p_title, 'icon', 'trophy',
                            'start_date', pg_temp.today() - 5, 'end_date', null, 'rule_logic', 'all',
                            'rules', '[{"type": "COUNT", "target": 3}]'::jsonb)
         || case when p_payout is null then '{}'::jsonb else jsonb_build_object('payout', p_payout) end
$$;
create function pg_temp.g(p_n int) returns uuid language sql as $$
  select ('32e00000-0000-0000-0000-00000000000' || p_n)::uuid
$$;
-- An evaluation of a goal's rule as the engine sends it, saved as the job.
create function pg_temp.save(p_n int, p_status text, p_met boolean, p_transitions jsonb default '[]')
returns jsonb language sql as $$
  select public.save_goal_evaluation(pg_temp.g(p_n), p_status, 1,
    jsonb_build_object('goal_id', pg_temp.g(p_n), 'pct', case when p_met then 100 else 67 end, 'is_achieved', p_met,
      'rules', (select jsonb_agg(jsonb_build_object('rule_id', r.id, 'current_value', case when p_met then 3 else 2 end,
                                   'target_value', r.target, 'pct', case when p_met then 100 else 67 end,
                                   'current_streak', null, 'best_streak', null, 'last_qualifying_date', null,
                                   'is_met', p_met))
                  from public.reward_rule r where r.goal_id = pg_temp.g(p_n)),
      'transitions', p_transitions),
    1, clock_timestamp())
$$;
create function pg_temp.t(p_type text, p_from text, p_to text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('type', p_type, 'from', p_from, 'to', p_to))
$$;
create function pg_temp.achieve(p_n int) returns jsonb language sql as $$
  select pg_temp.save(p_n, 'active', true, pg_temp.t('achieved', 'active', 'achieved'))
$$;
create function pg_temp.undo(p_n int) returns jsonb language sql as $$
  select pg_temp.save(p_n, 'achieved', false, pg_temp.t('unachieved', 'achieved', 'active'))
$$;
-- A goal's ledger entries in posting order: "Maya bonus 10 n1, ...".
create function pg_temp.paid(p_n int) returns text language sql as $$
  select coalesce(string_agg(m.display_name || ' ' || l.entry_type || ' ' || l.amount || ' n' || l.goal_n, ', '
                             order by l.created_at, l.id), '')
    from public.points_ledger l join public.member m on m.id = l.member_id where l.goal_id = pg_temp.g(p_n)
$$;
create function pg_temp.events(p_n int) returns text language sql as $$
  select string_agg(type, ',' order by id) from public.reward_goal_event where goal_id = pg_temp.g(p_n)
$$;

-- ---------------------------------------------------------------------------------------------
-- [RWD-13][US-409] What a goal may pay
-- ---------------------------------------------------------------------------------------------
select pg_temp.parent();
select public.save_goal(pg_temp.goal(1, 'a', '{"type": "points", "amount": 10}'));
select is((select payout from public.reward_goal where id = pg_temp.g(1)), '{"type": "points", "amount": 10}'::jsonb,
          '[RWD-13] a parent sets a goal that pays 10 points');
select throws_ok($$ select public.save_goal(pg_temp.goal(5, 'a', '{"type": "points", "amount": 0}')) $$,
                 '22023', null, '... not 0 points');
select is((select count(*)::int from public.reward_goal where id = pg_temp.g(5)), 0, '... so nothing is saved');
select throws_ok($$ select public.save_goal(pg_temp.goal(5, 'a', '{"type": "points", "amount": 2.5}')) $$,
                 '22023', null, '... nor part of a point');
select throws_ok($$ select public.save_goal(pg_temp.goal(5, null, '{"type": "catalog_item", "item_id": "32f00000-0000-0000-0000-000000000001"}')) $$,
                 '22023', 'a family goal pays points, or the celebration', '... a family goal does not pay a shop reward');
select throws_ok($$ select public.save_goal(pg_temp.goal(5, 'a', '{"type": "catalog_item", "item_id": "32f00000-0000-0000-0000-000000000009"}')) $$,
                 '22023', 'choose a reward from the shop', '... nor another family''s reward');
select throws_ok($$ select public.save_goal(pg_temp.goal(5, 'a', '{"type": "catalog_item", "item_id": "32f00000-0000-0000-0000-000000000002"}')) $$,
                 '22023', 'choose a reward from the shop', '... nor one removed from the shop');
select throws_ok($$ select public.save_goal(pg_temp.goal(5, 'a', '{"type": "cash"}')) $$,
                 '22023', 'unknown payout', '... nor anything else');
select public.save_goal(pg_temp.goal(2, 'a', '{"type": "catalog_item", "item_id": "32f00000-0000-0000-0000-000000000001"}'));
select public.save_goal(pg_temp.goal(3, null, '{"type": "points", "amount": 5}'));
select public.save_goal(pg_temp.goal(4, 'b', '{"type": "points", "amount": 7}'));
select is((select payout ->> 'type' from public.reward_goal where id = pg_temp.g(2)), 'catalog_item',
          '... a child''s goal pays a reward from the shop');

-- Left out, a goal keeps its payout; a change is logged with the edit.
select public.save_goal(pg_temp.goal(1, 'a', null, 'Renamed'));
select is((select payout ->> 'amount' from public.reward_goal where id = pg_temp.g(1)), '10',
          'a change that leaves the payout out keeps it');
select public.save_goal(pg_temp.goal(1, 'a', '{"type": "points", "amount": 12}', 'Renamed'));
select public.save_goal(pg_temp.goal(1, 'a', '{"type": "points", "amount": 10}', 'Renamed'));
select is((select payload -> 'payout' from public.reward_goal_event where goal_id = pg_temp.g(1) order by id desc limit 1),
          '{"from": {"type": "points", "amount": 12}, "to": {"type": "points", "amount": 10}}'::jsonb,
          'a changed payout is logged, from and to');

-- ---------------------------------------------------------------------------------------------
-- [RWD-13][RWD-04][US-409] Points: paid once, taken back once, paid again as n + 1
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_job();
select pg_temp.save(1, 'scheduled', false, pg_temp.t('started', 'scheduled', 'active'));
select pg_temp.achieve(1);
select is(pg_temp.paid(1), 'Maya bonus 10 n1', '[RWD-13] achieved: one bonus of 10 for Maya, achievement 1');
select is((select payload -> 'paid' from public.reward_goal_event where goal_id = pg_temp.g(1) and type = 'achieved'),
          '{"type": "points", "amount": 10, "children": 1}'::jsonb, '... and the achievement says what it paid');
select is(pg_temp.achieve(1) ->> 'saved', 'false', 'the job running twice: the second is refused (it read the goal before it changed)');
select pg_temp.as_owner();
select private.pay_goal(g, 1) from public.reward_goal g where g.id = pg_temp.g(1);
select is(pg_temp.paid(1), 'Maya bonus 10 n1', '... and paying achievement 1 again posts nothing');
select pg_temp.as_job();
select pg_temp.undo(1);
select is(pg_temp.paid(1), 'Maya bonus 10 n1, Maya reversal -10 n1',
          '[RWD-04] the deciding check-off unchecked: the 10 points are taken back');
select is(pg_temp.undo(1) ->> 'saved', 'false', '... once, however often the job runs');
select is(pg_temp.paid(1), 'Maya bonus 10 n1, Maya reversal -10 n1', '... so one reversal');
select is((select payload from public.reward_goal_event where goal_id = pg_temp.g(1) and type = 'payout_reversed'),
          '{"n": 1, "item": null, "points": 10}'::jsonb, '... logged as payout_reversed');
select pg_temp.achieve(1);
select is(pg_temp.paid(1), 'Maya bonus 10 n1, Maya reversal -10 n1, Maya bonus 10 n2',
          '[US-409] reached again: paid again, as achievement 2');
select is((select sum(amount)::int from public.points_ledger where member_id = '32110000-0000-0000-0000-00000000000a'),
          10, '... so Maya holds 10');

-- ---------------------------------------------------------------------------------------------
-- [RWD-13][US-409] A shop reward: approved at once, free; called off when undone, kept once given
-- ---------------------------------------------------------------------------------------------
select pg_temp.save(2, 'scheduled', false, pg_temp.t('started', 'scheduled', 'active'));
select pg_temp.achieve(2);
select is((select status || ':' || cost_snapshot || ':' || requested_by_type || ':' || goal_n || ':' || (decided_at is not null)
             from public.redemption where goal_id = pg_temp.g(2)),
          'approved:0:system:1:true', '[RWD-13] achieved: Ice cream, approved at once and costing nothing');
select is((select sum(amount)::int from public.points_ledger where member_id = '32110000-0000-0000-0000-00000000000a'),
          10, '... no points spent');
select pg_temp.undo(2);
select is((select status from public.redemption where goal_id = pg_temp.g(2) and goal_n = 1), 'cancelled',
          '[RWD-04] undone before it was given: called off');
select is((select count(*)::int from public.points_ledger l join public.redemption r on r.id = l.redemption_id
            where r.goal_id = pg_temp.g(2)), 0, '... with nothing refunded, as nothing was spent');
select pg_temp.achieve(2);
select pg_temp.parent();
select public.fulfil_redemption(id) from public.redemption where goal_id = pg_temp.g(2) and goal_n = 2;
select pg_temp.as_job();
select pg_temp.undo(2);
select is((select r.status || ':' || g.needs_review || ':' || g.status
             from public.redemption r join public.reward_goal g on g.id = r.goal_id
            where r.goal_id = pg_temp.g(2) and r.goal_n = 2),
          'fulfilled:true:active', '[US-409] undone after it was given: it stays given, and the goal needs a look');
select is((select payload ->> 'why' from public.reward_goal_event where goal_id = pg_temp.g(2) and type = 'needs_review'),
          'reward_given', '... saying why');
select pg_temp.achieve(2);
select pg_temp.parent();
select public.cancel_redemption(id) from public.redemption where goal_id = pg_temp.g(2) and goal_n = 3;
select is((select status from public.redemption where goal_id = pg_temp.g(2) and goal_n = 3)
          || ':' || (select count(*) from public.points_ledger where entry_type = 'refund'),
          'cancelled:0', '[PTS-04] a parent calling off a goal''s reward gives back nothing, as it cost nothing');

-- ---------------------------------------------------------------------------------------------
-- [RWD-13] A family goal pays each child who earns rewards
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_job();
select pg_temp.save(3, 'scheduled', false, pg_temp.t('started', 'scheduled', 'active'));
select pg_temp.achieve(3);
select is((select string_agg(m.display_name || ' ' || l.amount, ', ' order by m.display_name)
             from public.points_ledger l join public.member m on m.id = l.member_id where l.goal_id = pg_temp.g(3)),
          'Leo 5, Maya 5', '[RWD-13] the family''s goal: 5 points to each child, none to a parent');
select pg_temp.undo(3);
select is((select coalesce(sum(amount), 0)::int || ':' || count(*) from public.points_ledger where goal_id = pg_temp.g(3)),
          '0:4', '... and both taken back when it is undone');

-- ---------------------------------------------------------------------------------------------
-- [RWD-04][US-409] A redeemed goal: points taken back when it stops being met, put back when met again
-- ---------------------------------------------------------------------------------------------
select pg_temp.save(4, 'scheduled', false, pg_temp.t('started', 'scheduled', 'active'));
select pg_temp.achieve(4);
select pg_temp.parent();
select public.redeem_goal(pg_temp.g(4));
select pg_temp.as_job();
select pg_temp.save(4, 'redeemed', false, pg_temp.t('needs_review', 'redeemed', 'redeemed'));
select is(pg_temp.paid(4) || ' | ' || (select status || ':' || needs_review from public.reward_goal where id = pg_temp.g(4)),
          'Leo bonus 7 n1, Leo reversal -7 n1 | redeemed:true',
          '[US-409] redeemed, then undone: still redeemed, flagged, and the 7 points taken back');
select pg_temp.save(4, 'redeemed', false, pg_temp.t('needs_review', 'redeemed', 'redeemed'));
select pg_temp.parent();
select public.clear_goal_review(pg_temp.g(4));
select pg_temp.as_job();
select pg_temp.save(4, 'redeemed', false, pg_temp.t('needs_review', 'redeemed', 'redeemed'));
select is((select needs_review from public.reward_goal where id = pg_temp.g(4)) || ' | ' || pg_temp.paid(4),
          'false | Leo bonus 7 n1, Leo reversal -7 n1',
          '... later evaluations change nothing, so a parent''s clearing sticks');
select pg_temp.save(4, 'redeemed', true);
select is(pg_temp.paid(4), 'Leo bonus 7 n1, Leo reversal -7 n1, Leo bonus 7 n1',
          '... met again: the 7 points go back');
select pg_temp.save(4, 'redeemed', true);
select pg_temp.save(4, 'redeemed', false, pg_temp.t('needs_review', 'redeemed', 'redeemed'));
select is((select sum(amount)::int from public.points_ledger where goal_id = pg_temp.g(4))
          || ':' || (select needs_review from public.reward_goal where id = pg_temp.g(4)),
          '0:true', '... and undone again: taken back again and flagged again, each move once');
select is(pg_temp.events(4),
          'created,activated,achieved,redeemed,needs_review,payout_reversed,payout_restored,needs_review,payout_reversed',
          '... all of it in the goal''s log');

-- ---------------------------------------------------------------------------------------------
-- [RWD-10][US-406] The preview reads what an evaluation would, for dates and a person not yet saved
-- ---------------------------------------------------------------------------------------------
select pg_temp.parent();
select is((select (f ->> 'status') || ':' || (f ->> 'saved') || ':' || (jsonb_array_length(f -> 'facts') > 0)
             from public.goal_preview_facts(jsonb_build_object(
                    'household_id', '32000000-0000-0000-0000-000000000001',
                    'id', '32e00000-0000-0000-0000-000000000009',
                    'member_id', '32110000-0000-0000-0000-00000000000a',
                    'start_date', pg_temp.today() - 3)) f),
          'scheduled:false:true', '[RWD-10] a new goal''s preview: Maya''s facts since its start');
select is((select f -> 'facts' from public.goal_preview_facts(jsonb_build_object(
                    'household_id', '32000000-0000-0000-0000-000000000001', 'id', pg_temp.g(1),
                    'member_id', '32110000-0000-0000-0000-00000000000a', 'start_date', pg_temp.today() - 5)) f),
          (select public.goal_facts(pg_temp.g(1)) -> 'facts'),
          '... for a saved goal unchanged, exactly what its evaluation reads');
select is((select f ->> 'status' from public.goal_preview_facts(jsonb_build_object(
                    'household_id', '32000000-0000-0000-0000-000000000001', 'id', pg_temp.g(1),
                    'member_id', '32110000-0000-0000-0000-00000000000a', 'start_date', pg_temp.today() - 1)) f),
          'achieved', '... and with its status, so the preview says what saving would do');
select throws_ok($$ select public.goal_preview_facts(jsonb_build_object(
                    'household_id', '32000000-0000-0000-0000-000000000001',
                    'start_date', pg_temp.today(), 'end_date', pg_temp.today() - 1)) $$,
                 '22023', null, '... not ending before it starts');
select pg_temp.as_user('32300000-0000-0000-0000-000000000003');
select throws_ok($$ select public.goal_preview_facts(jsonb_build_object(
                    'household_id', '32000000-0000-0000-0000-000000000001', 'start_date', pg_temp.today())) $$,
                 '42501', null, '[NFR-04] another family''s parent cannot preview');
select pg_temp.as_job();
select throws_ok($$ select public.goal_preview_facts(jsonb_build_object(
                    'household_id', '32000000-0000-0000-0000-000000000001', 'start_date', pg_temp.today())) $$,
                 '42501', null, '... nor the job: the preview is a parent''s');

-- ---------------------------------------------------------------------------------------------
-- [NFR-04] Only the functions pay
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_owner();
select throws_ok($$ insert into public.points_ledger (household_id, member_id, entry_type, amount, dedupe_key,
                      created_by_type, goal_id, goal_n)
                    values ('32000000-0000-0000-0000-000000000001', '32110000-0000-0000-0000-00000000000a', 'spend', -1,
                            'x', 'system', '32e00000-0000-0000-0000-000000000001', 1) $$,
                 '23514', null, 'a goal''s entries are bonuses and their reversals');
select ok(not has_function_privilege('authenticated', 'private.pay_goal(public.reward_goal, integer)', 'execute')
          and not has_function_privilege('authenticated', 'private.settle_goal_points(public.reward_goal, integer, boolean)', 'execute')
          and not has_function_privilege('authenticated', 'private.take_back_goal(public.reward_goal, integer)', 'execute')
          and not has_function_privilege('service_role', 'private.pay_goal(public.reward_goal, integer)', 'execute')
          and not has_function_privilege('anon', 'public.goal_preview_facts(jsonb)', 'execute'),
          '[NFR-04] paying and taking back are not callable from outside; signed-out callers cannot preview');

select * from finish();
rollback;
