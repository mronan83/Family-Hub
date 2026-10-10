-- [PTS-02][PTS-03][PTS-04][RWD-07][RWD-08] The board's shop, requests and goals (WP-20, D-59). The
-- snapshot says what a child can still spend (their balance less the requests waiting for a parent),
-- their requests (open, and settled in the last two days), the rewards they've asked for as often as
-- allowed this week, and for each reward how many are left. It carries the goals in play with each
-- rule's progress, and a reached goal is celebrated once per achievement, by whichever board shows it.
begin;
select plan(37);

insert into auth.users (id, email) values
  ('23100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('23300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('23d00000-0000-0000-0000-00000000000d', null),
  ('23d00000-0000-0000-0000-00000000000e', null);
insert into public.household (id, name, timezone, week_start) values
  ('23000000-0000-0000-0000-000000000001', 'Shop family', 'America/Chicago', 0),
  ('23000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago', 0);
insert into public.household_settings (household_id) values
  ('23000000-0000-0000-0000-000000000001'), ('23000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('23000000-0000-0000-0000-000000000001', '23100000-0000-0000-0000-000000000001', 'owner'),
  ('23000000-0000-0000-0000-000000000002', '23300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role, archived_at) values
  ('23110000-0000-0000-0000-00000000000a', '23000000-0000-0000-0000-000000000001', 'Kid', 'child', null),
  ('23110000-0000-0000-0000-00000000000b', '23000000-0000-0000-0000-000000000001', 'Grown-up', 'adult', null),
  ('23110000-0000-0000-0000-00000000000c', '23000000-0000-0000-0000-000000000001', 'Gone', 'child', now()),
  ('23110000-0000-0000-0000-00000000000d', '23000000-0000-0000-0000-000000000002', 'Neighbour', 'child', null);
insert into public.device (id, household_id, name, auth_user_id) values
  ('23dd0000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', 'Kitchen',
   '23d00000-0000-0000-0000-00000000000d'),
  ('23dd0000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000002', 'Hall',
   '23d00000-0000-0000-0000-00000000000e');
insert into public.reward_catalog_item (id, household_id, title, icon, cost_points, stock, weekly_limit, active,
                                        archived_at, sort_order, image_path) values
  ('23c00000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', 'Movie night', 'ticket', 100, 2,
   null, true, null, 1, '23000000-0000-0000-0000-000000000001/23c00000-0000-0000-0000-000000000001/movie.jpg'),
  ('23c00000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000001', 'Ice cream trip', 'snack', 40,
   null, 1, true, null, 2, null),
  ('23c00000-0000-0000-0000-000000000003', '23000000-0000-0000-0000-000000000001', 'Stay up late', 'moon', 25,
   null, null, true, null, 3, null),
  ('23c00000-0000-0000-0000-000000000004', '23000000-0000-0000-0000-000000000001', 'Not now', 'gift', 10,
   null, null, false, null, 4, null),
  ('23c00000-0000-0000-0000-000000000005', '23000000-0000-0000-0000-000000000001', 'Old prize', 'gift', 10,
   null, null, true, now(), 5, null);

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_board() returns void language sql as $$
  select pg_temp.as_user('23d00000-0000-0000-0000-00000000000d')
$$;
create function pg_temp.as_parent() returns void language sql as $$
  select pg_temp.as_user('23100000-0000-0000-0000-000000000001')
$$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
-- A member as the board reads them.
create function pg_temp.kid(p_key text) returns jsonb language sql as $$
  select m -> p_key from jsonb_array_elements(public.board_snapshot() -> 'members') m
   where m ->> 'display_name' = 'Kid'
$$;
create function pg_temp.requests() returns text language sql as $$
  select coalesce(string_agg((r ->> 'title') || ':' || (r ->> 'status') || ':' || (r ->> 'cost'), ', '
                             order by ord), '')
    from jsonb_array_elements(pg_temp.kid('requests')) with ordinality as x (r, ord)
$$;
create function pg_temp.shop() returns jsonb language sql as $$ select public.board_snapshot() -> 'shop' $$;
create function pg_temp.goals() returns text language sql as $$
  select coalesce(string_agg((g ->> 'title') || ':' || (g ->> 'status') || ':' || (g ->> 'celebrate'), ', '
                             order by ord), '')
    from jsonb_array_elements(public.board_snapshot() -> 'goals') with ordinality as x (g, ord)
$$;
create function pg_temp.goal(p_title text) returns jsonb language sql as $$
  select g from jsonb_array_elements(public.board_snapshot() -> 'goals') g where g ->> 'title' = p_title
$$;

-- What a child can spend ------------------------------------------------------------
select pg_temp.as_parent();
select public.adjust_points('23110000-0000-0000-0000-00000000000a', 150, 'A good start', gen_random_uuid());

select pg_temp.as_board();
select is(pg_temp.kid('available'), '150'::jsonb,
  '[PTS-04] with nothing asked for, a child can spend their whole balance');
select is(pg_temp.kid('requests'), '[]'::jsonb, '[PTS-04] and has no requests');
select is(pg_temp.kid('limited'), '[]'::jsonb, '[PTS-04] and no weekly limit reached');
select is((select m -> 'available' from jsonb_array_elements(public.board_snapshot() -> 'members') m
            where m ->> 'display_name' = 'Grown-up'),
  'null'::jsonb, '[PTS-04][D-32] someone who doesn''t earn rewards has nothing to spend');

-- The shop as the board shows it -------------------------------------------------------
select is((select array_agg(i ->> 'title' order by ord) from jsonb_array_elements(pg_temp.shop()) with ordinality x (i, ord)),
  array['Movie night', 'Ice cream trip', 'Stay up late'],
  '[PTS-03] the shop offers what is on and not archived, in the parent''s order');
select is(pg_temp.shop() -> 0,
  '{"id": "23c00000-0000-0000-0000-000000000001", "title": "Movie night", "icon": "ticket", "cost": 100,
    "photo": "23000000-0000-0000-0000-000000000001/23c00000-0000-0000-0000-000000000001/movie.jpg",
    "description": null, "left": 2}'::jsonb,
  '[PTS-03] each reward with its cost, its photo''s path and how many are left');
select is(pg_temp.shop() -> 2 -> 'left', 'null'::jsonb, '[PTS-03] a reward without stock has no count left');

-- Asking ------------------------------------------------------------------------------
select public.request_redemption('23e00000-0000-0000-0000-000000000001', '23110000-0000-0000-0000-00000000000a',
                                 '23c00000-0000-0000-0000-000000000002');
select is(pg_temp.kid('available'), '110'::jsonb, '[PTS-04][US-1104] a request waiting for a parent holds its cost');
select is(pg_temp.requests(), 'Ice cream trip:requested:40', '[PTS-04][US-1104] the board shows it as pending');
select is(pg_temp.kid('requests') -> 0 ->> 'id', '23e00000-0000-0000-0000-000000000001',
  '[PTS-04] by the id the board made, so it can find it again');
select is(pg_temp.kid('limited'), '["23c00000-0000-0000-0000-000000000002"]'::jsonb,
  '[PTS-04] once a week reached: the board knows not to offer it again this week');

select public.request_redemption('23e00000-0000-0000-0000-000000000002', '23110000-0000-0000-0000-00000000000a',
                                 '23c00000-0000-0000-0000-000000000001');
-- (Asked a minute apart: one transaction's now() is the same for both.)
select pg_temp.as_owner();
update public.redemption set requested_at = now() - interval '1 minute'
 where id = '23e00000-0000-0000-0000-000000000001';
select pg_temp.as_board();
select is(pg_temp.kid('available'), '10'::jsonb, '[PTS-04] two requests hold both costs');
select is(pg_temp.shop() -> 0 -> 'left', '1'::jsonb, '[PTS-03] a request takes one of the stock');
select is(pg_temp.requests(), 'Movie night:requested:100, Ice cream trip:requested:40',
  '[PTS-04] newest first');
select throws_ok($$ select public.request_redemption(gen_random_uuid(), '23110000-0000-0000-0000-00000000000a',
                                                    '23c00000-0000-0000-0000-000000000003') $$,
  '23514', null, '[PTS-04][US-1104] what the board says can''t be spent is what the database refuses');

-- A parent decides ---------------------------------------------------------------------
select pg_temp.as_parent();
select public.decide_redemption('23e00000-0000-0000-0000-000000000001', 'deny');
select public.decide_redemption('23e00000-0000-0000-0000-000000000002', 'approve');
select pg_temp.as_board();
select is(pg_temp.requests(), 'Ice cream trip:denied:40, Movie night:approved:100',
  '[PTS-04][US-1105] the board shows a yes and a "not this time" (decided at the same moment: a fixed order, by id)');
select is(pg_temp.kid('available'), '50'::jsonb,
  '[PTS-04] the approved one is spent, the refused one no longer held');
select is(pg_temp.kid('points') -> 'balance', '50'::jsonb, '[PTS-02] the balance drops by the cost once');
select is(pg_temp.kid('limited'), '[]'::jsonb, '[PTS-04] a refused request doesn''t count toward the weekly limit');

-- Settled requests fade after two days; open ones stay -----------------------------------
select pg_temp.as_owner();
update public.redemption set decided_at = now() - interval '3 days', requested_at = now() - interval '3 days'
 where id = '23e00000-0000-0000-0000-000000000001';
update public.redemption set requested_at = now() - interval '9 days', decided_at = now() - interval '9 days'
 where id = '23e00000-0000-0000-0000-000000000002';
select pg_temp.as_board();
select is(pg_temp.requests(), 'Movie night:approved:100',
  '[PTS-04] a request settled more than two days ago leaves the board; an approved one still to give stays');

-- Who sees what ---------------------------------------------------------------------------
select pg_temp.as_user('23d00000-0000-0000-0000-00000000000e');
select is((select m -> 'requests' from jsonb_array_elements(public.board_snapshot() -> 'members') m),
  '[]'::jsonb, '[NFR-04] another family''s board sees none of this family''s requests');
select is(public.board_snapshot() -> 'shop', '[]'::jsonb, '[NFR-04] nor its shop');

-- Goals ------------------------------------------------------------------------------------
select pg_temp.as_owner();
insert into public.reward_goal (id, household_id, member_id, title, icon, start_date, end_date, status,
                                achievement_count, celebrated_at, archived_at) values
  ('23900000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', '23110000-0000-0000-0000-00000000000a',
   'Zoo trip', 'star', current_date - 5, current_date + 9, 'active', 0, null, null),
  ('23900000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000001', null,
   'Pizza night', 'trophy', current_date - 5, null, 'active', 0, null, null),
  ('23900000-0000-0000-0000-000000000003', '23000000-0000-0000-0000-000000000001', '23110000-0000-0000-0000-00000000000a',
   'Bike ride', 'trophy', current_date - 5, null, 'achieved', 1, null, null),
  ('23900000-0000-0000-0000-000000000004', '23000000-0000-0000-0000-000000000001', '23110000-0000-0000-0000-00000000000a',
   'Next month', 'trophy', current_date + 20, null, 'scheduled', 0, null, null),
  ('23900000-0000-0000-0000-000000000005', '23000000-0000-0000-0000-000000000001', '23110000-0000-0000-0000-00000000000a',
   'Called off', 'trophy', current_date - 5, null, 'cancelled', 0, null, now()),
  ('23900000-0000-0000-0000-000000000006', '23000000-0000-0000-0000-000000000001', '23110000-0000-0000-0000-00000000000c',
   'Left the family', 'trophy', current_date - 5, null, 'active', 0, null, null),
  ('23900000-0000-0000-0000-000000000007', '23000000-0000-0000-0000-000000000002', '23110000-0000-0000-0000-00000000000d',
   'Next door', 'trophy', current_date - 5, null, 'active', 0, null, null);
insert into public.reward_rule (id, household_id, goal_id, rule_type, target, sort_order) values
  ('23a00000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', '23900000-0000-0000-0000-000000000001', 'COUNT', 10, 0),
  ('23a00000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000001', '23900000-0000-0000-0000-000000000001', 'STREAK', 5, 1),
  ('23a00000-0000-0000-0000-000000000003', '23000000-0000-0000-0000-000000000001', '23900000-0000-0000-0000-000000000002', 'COUNT', 20, 0);
insert into public.reward_goal_progress (goal_id, household_id, pct, is_achieved, dirty, rules_version, engine_version,
                                         computed_at) values
  ('23900000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', 70, false, false, 1, 1, now());
insert into public.reward_rule_progress (rule_id, household_id, goal_id, current_value, target_value, pct,
                                         current_streak, best_streak, is_met, engine_version) values
  ('23a00000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', '23900000-0000-0000-0000-000000000001',
   9, 10, 90, null, null, false, 1),
  ('23a00000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000001', '23900000-0000-0000-0000-000000000001',
   3, 5, 60, 2, 3, false, 1);

select pg_temp.as_board();
select is(pg_temp.goals(), 'Bike ride:achieved:true, Zoo trip:active:false, Pizza night:active:false',
  '[RWD-07] the goals in play: each child''s (reached first), then the family''s; not one that starts later, was cancelled, or is for someone who left');
select is(pg_temp.goal('Zoo trip'),
  jsonb_build_object('id', '23900000-0000-0000-0000-000000000001', 'member_id', '23110000-0000-0000-0000-00000000000a',
    'title', 'Zoo trip', 'icon', 'star', 'photo', null, 'status', 'active', 'n', 0, 'achieved_at', null,
    'celebrate', false, 'end_date', current_date + 9, 'logic', 'all', 'pct', 70,
    'rules', jsonb_build_array(
      jsonb_build_object('id', '23a00000-0000-0000-0000-000000000001', 'type', 'COUNT', 'target', 10, 'current', 9,
                         'pct', 90, 'met', false, 'streak', null, 'best', null),
      jsonb_build_object('id', '23a00000-0000-0000-0000-000000000002', 'type', 'STREAK', 'target', 5, 'current', 3,
                         'pct', 60, 'met', false, 'streak', 2, 'best', 3))),
  '[RWD-07][US-403] a goal with its progress, and each rule''s, with the run now and the best for a streak');
select is(pg_temp.goal('Pizza night') -> 'rules',
  '[{"id": "23a00000-0000-0000-0000-000000000003", "type": "COUNT", "target": 20, "current": 0, "pct": 0,
     "met": false, "streak": null, "best": null}]'::jsonb,
  '[RWD-07] a goal not worked out yet reads as nothing done');
select pg_temp.as_user('23d00000-0000-0000-0000-00000000000e');
select is(pg_temp.goals(), 'Next door:active:false', '[NFR-04] another family''s board sees only its own goals');

-- Celebrated once -----------------------------------------------------------------------------
select pg_temp.as_board();
select is(public.mark_goal_celebrated('23900000-0000-0000-0000-000000000003', 1), true,
  '[RWD-08][US-404] the first board to celebrate a reached goal marks it');
select is(pg_temp.goal('Bike ride') -> 'celebrate', 'false'::jsonb, '[RWD-08] so no board celebrates it again');
select is(public.mark_goal_celebrated('23900000-0000-0000-0000-000000000003', 1), false,
  '[RWD-08] a second board finds it done already');
select is(public.mark_goal_celebrated('23900000-0000-0000-0000-000000000001', 0), false,
  '[RWD-08] a goal not reached has nothing to celebrate');
select pg_temp.as_owner();
-- Unchecked, then reached again (as save_goal_evaluation() records it): the second time is new.
update public.reward_goal set status = 'achieved', achievement_count = 2, achieved_at = now(), celebrated_at = null
 where id = '23900000-0000-0000-0000-000000000003';
select pg_temp.as_board();
select is(pg_temp.goal('Bike ride') -> 'celebrate', 'true'::jsonb, '[RWD-08] reaching it again is celebrated again');
select is(public.mark_goal_celebrated('23900000-0000-0000-0000-000000000003', 1), false,
  '[RWD-08] a board still showing the first time doesn''t mark the second');
select is(public.mark_goal_celebrated('23900000-0000-0000-0000-000000000003', 2), true,
  '[RWD-08] the second time is marked as itself');
select pg_temp.as_user('23d00000-0000-0000-0000-00000000000e');
select throws_ok($$ select public.mark_goal_celebrated('23900000-0000-0000-0000-000000000001', 0) $$,
  'P0002', null, '[NFR-04] another family''s board can''t touch this family''s goals');
select pg_temp.as_parent();
select throws_ok($$ select public.mark_goal_celebrated(null, 1) $$, '22023', null,
  '[RWD-08] it names a goal and an achievement');
select pg_temp.as_owner();
update public.reward_goal set celebrated_at = null where id = '23900000-0000-0000-0000-000000000003';
select pg_temp.as_parent();
select is(public.mark_goal_celebrated('23900000-0000-0000-0000-000000000003', 2), true,
  '[RWD-08] a parent may mark it too');
select pg_temp.as_owner();
select ok(not has_function_privilege('anon', 'public.mark_goal_celebrated(uuid, integer)', 'execute'),
  '[NFR-04] signed out, nothing is marked');

select * from finish();
rollback;
