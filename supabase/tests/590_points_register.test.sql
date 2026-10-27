-- [PTS-08] The household points register (WP-115, D-147): points_register() lists a household's
-- ledger newest first, filtered by member, type (a goal payout apart from a bonus), bonus rule and the
-- household's own days; points_register_totals() adds up the same entries per member; and
-- points_rule_payouts() counts each bonus rule's payouts. Each runs as its caller, so an earn on an
-- item the parent may not see has no title (D-34), and nobody reads another household's ledger.
begin;
select plan(17);

insert into auth.users (id, email) values
  ('59100000-0000-0000-0000-0000000000a1', 'alex@example.com'),
  ('59100000-0000-0000-0000-0000000000a2', 'sam@example.com'),
  ('59100000-0000-0000-0000-0000000000b1', 'other@example.com');
insert into public.household (id, name, timezone) values
  ('59000000-0000-0000-0000-000000000001', 'Register family', 'America/Chicago'),
  ('59000000-0000-0000-0000-000000000002', 'Another family', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('59000000-0000-0000-0000-000000000001'), ('59000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('59000000-0000-0000-0000-000000000001', '59100000-0000-0000-0000-0000000000a1', 'owner'),
  ('59000000-0000-0000-0000-000000000001', '59100000-0000-0000-0000-0000000000a2', 'admin'),
  ('59000000-0000-0000-0000-000000000002', '59100000-0000-0000-0000-0000000000b1', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('59110000-0000-0000-0000-0000000000a1', '59000000-0000-0000-0000-000000000001', 'Alex', 'adult', '59100000-0000-0000-0000-0000000000a1'),
  ('59110000-0000-0000-0000-0000000000a2', '59000000-0000-0000-0000-000000000001', 'Sam', 'adult', '59100000-0000-0000-0000-0000000000a2'),
  ('59110000-0000-0000-0000-00000000000a', '59000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('59110000-0000-0000-0000-00000000000b', '59000000-0000-0000-0000-000000000001', 'Leo', 'child', null),
  ('59110000-0000-0000-0000-00000000000c', '59000000-0000-0000-0000-000000000002', 'Kim', 'child', null);

-- A family chore, and Sam's private one for Leo, each done once.
insert into public.chore (id, household_id, title, schedule, visibility, created_by) values
  ('594e0000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000001', 'Feed the dog', '{"freq": "daily"}', 'family', '59100000-0000-0000-0000-0000000000a1'),
  ('594e0000-0000-0000-0000-000000000002', '59000000-0000-0000-0000-000000000001', 'Gift wrap', '{"freq": "daily"}', 'private', '59100000-0000-0000-0000-0000000000a2');
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('59000000-0000-0000-0000-000000000001', '594e0000-0000-0000-0000-000000000001', '59110000-0000-0000-0000-00000000000a'),
  ('59000000-0000-0000-0000-000000000001', '594e0000-0000-0000-0000-000000000002', '59110000-0000-0000-0000-00000000000b');
insert into public.chore_occurrence (id, household_id, chore_id, due_date, kind, points_snapshot, requires_approval_snapshot) values
  ('594f0000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000001', '594e0000-0000-0000-0000-000000000001', '2026-10-25', 'chore', 5, false),
  ('594f0000-0000-0000-0000-000000000002', '59000000-0000-0000-0000-000000000001', '594e0000-0000-0000-0000-000000000002', '2026-10-26', 'chore', 3, false);
insert into public.points_rule (id, household_id, rule_type, streak_days, bonus_points, counts_from) values
  ('59700000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000001', 'all_done_bonus', null, 5, '2026-10-01'),
  ('59700000-0000-0000-0000-000000000002', '59000000-0000-0000-0000-000000000001', 'streak_bonus', 7, 20, '2026-10-01');
insert into public.reward_goal (id, household_id, member_id, title, start_date) values
  ('59600000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000001', '59110000-0000-0000-0000-00000000000a', 'Read 5 books', '2026-10-01');

-- The household is at UTC−5 (CDT) on these days: Mon Oct 26 runs 05:00Z Oct 26 to 05:00Z Oct 27.
insert into public.points_ledger (id, household_id, member_id, entry_type, amount, occurrence_id, reason,
                                  dedupe_key, created_by_type, created_by, points_rule_id, goal_id, goal_n, created_at) values
  -- e1: Maya's earn, Sun Oct 25 at 23:30 there.
  ('59e00000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000001', '59110000-0000-0000-0000-00000000000a', 'earn', 5,
   '594f0000-0000-0000-0000-000000000001', null, 'r:e1', 'system', null, null, null, null, '2026-10-26 04:30Z'),
  -- e3: a rule's bonus for Maya, Mon Oct 26 at 02:05.
  ('59e00000-0000-0000-0000-000000000003', '59000000-0000-0000-0000-000000000001', '59110000-0000-0000-0000-00000000000a', 'bonus', 5,
   null, 'Everything done', 'r:e3', 'system', null, '59700000-0000-0000-0000-000000000001', null, null, '2026-10-26 07:05Z'),
  -- e2: Leo's earn on Sam's private item.
  ('59e00000-0000-0000-0000-000000000002', '59000000-0000-0000-0000-000000000001', '59110000-0000-0000-0000-00000000000b', 'earn', 3,
   '594f0000-0000-0000-0000-000000000002', null, 'r:e2', 'system', null, null, null, null, '2026-10-26 12:00Z'),
  -- e5: a goal paid in points, Mon Oct 26 at 19:31 there (Tue in UTC).
  ('59e00000-0000-0000-0000-000000000005', '59000000-0000-0000-0000-000000000001', '59110000-0000-0000-0000-00000000000a', 'bonus', 25,
   null, 'Read 5 books', 'r:e5', 'system', null, null, '59600000-0000-0000-0000-000000000001', 1, '2026-10-27 00:31Z'),
  -- e4: the same rule's bonus for Leo, Tue Oct 27 at 02:05.
  ('59e00000-0000-0000-0000-000000000004', '59000000-0000-0000-0000-000000000001', '59110000-0000-0000-0000-00000000000b', 'bonus', 5,
   null, 'Everything done', 'r:e4', 'system', null, '59700000-0000-0000-0000-000000000001', null, null, '2026-10-27 07:05Z'),
  -- e6: Sam adds 10 for Maya.
  ('59e00000-0000-0000-0000-000000000006', '59000000-0000-0000-0000-000000000001', '59110000-0000-0000-0000-00000000000a', 'adjustment', 10,
   null, 'Helped carry the groceries', 'r:e6', 'admin', '59100000-0000-0000-0000-0000000000a2', null, null, null, '2026-10-27 21:15Z'),
  -- e7: Maya's earn unchecked.
  ('59e00000-0000-0000-0000-000000000007', '59000000-0000-0000-0000-000000000001', '59110000-0000-0000-0000-00000000000a', 'reversal', -5,
   '594f0000-0000-0000-0000-000000000001', null, 'r:e7', 'system', null, null, null, null, '2026-10-27 22:00Z'),
  -- Another household's bonus.
  ('59e00000-0000-0000-0000-0000000000b1', '59000000-0000-0000-0000-000000000002', '59110000-0000-0000-0000-00000000000c', 'adjustment', 7,
   null, 'Theirs', 'r:b1', 'admin', '59100000-0000-0000-0000-0000000000b1', null, null, null, '2026-10-27 12:00Z');

create function pg_temp.ids(p_rows uuid[]) returns text language sql as $$
  select string_agg(right(x::text, 2), ',' order by n) from unnest(p_rows) with ordinality as t(x, n) $$;
create function pg_temp.as_user(p_user text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true) $$;

select pg_temp.as_user('59100000-0000-0000-0000-0000000000a1');  -- Alex

select is(pg_temp.ids(array(select id from public.points_register('59000000-0000-0000-0000-000000000001', p_limit => 100))),
          '07,06,04,05,02,03,01',
          '[PTS-08-a] every entry of the household, every member''s, newest first, none of another household''s');
select is(pg_temp.ids(array(select id from public.points_register('59000000-0000-0000-0000-000000000001', p_limit => 2, p_offset => 2))),
          '04,05', '[PTS-08-a] a page of it: two, after the newest two');
select is(pg_temp.ids(array(select id from public.points_register('59000000-0000-0000-0000-000000000001',
          p_members => array['59110000-0000-0000-0000-00000000000b']::uuid[]))),
          '04,02', '[PTS-08-b] one member''s entries');
select is(pg_temp.ids(array(select id from public.points_register('59000000-0000-0000-0000-000000000001', p_kinds => array['goal']))),
          '05', '[PTS-08-b] a goal paid in points is a goal payout');
select is(pg_temp.ids(array(select id from public.points_register('59000000-0000-0000-0000-000000000001', p_kinds => array['bonus', 'adjustment']))),
          '06,04,03', '[PTS-08-b] bonuses and adjustments: a goal payout is not a bonus');
select is(pg_temp.ids(array(select id from public.points_register('59000000-0000-0000-0000-000000000001',
          p_rule => '59700000-0000-0000-0000-000000000001'))),
          '04,03', '[PTS-08-b] one bonus rule''s payouts');
select is(pg_temp.ids(array(select id from public.points_register('59000000-0000-0000-0000-000000000001',
          p_from => '2026-10-26', p_to => '2026-10-26'))),
          '05,02,03', '[PTS-08-b] Mon Oct 26 in the household''s own day: 05:00Z to 05:00Z, not the UTC day');
select is((select kind || ':' || goal_title from public.points_register('59000000-0000-0000-0000-000000000001')
            where id = '59e00000-0000-0000-0000-000000000005'),
          'goal:Read 5 books', '[PTS-08-b] a goal payout names its goal');

select is((select coalesce(item_title, '(none)') from public.points_register('59000000-0000-0000-0000-000000000001')
            where id = '59e00000-0000-0000-0000-000000000002'),
          '(none)', '[PTS-08-c] Alex may not see Sam''s private item, so its earn has no title');
select is((select item_title from public.points_register('59000000-0000-0000-0000-000000000001')
            where id = '59e00000-0000-0000-0000-000000000001'),
          'Feed the dog', '[PTS-08-c] a family item''s earn has its title');

select is((select string_agg(m.display_name || ' ' || t.entries || ' +' || t.added || ' ' || t.taken, '; ' order by m.display_name)
             from public.points_register_totals('59000000-0000-0000-0000-000000000001') t
             join public.member m on m.id = t.member_id),
          'Leo 2 +8 0; Maya 5 +45 -5', '[PTS-08-d] each member''s count, what was added and what was taken away');
select is((select string_agg(m.display_name || ' ' || t.entries || ' ' || to_char(t.latest at time zone 'UTC', 'MM-DD HH24:MI'), '; ' order by m.display_name)
             from public.points_register_totals('59000000-0000-0000-0000-000000000001', p_kinds => array['bonus']) t
             join public.member m on m.id = t.member_id),
          'Leo 1 10-27 07:05; Maya 1 10-26 07:05', '[PTS-08-d] the same filters as the list, with each member''s latest');

select is((select string_agg(right(points_rule_id::text, 2) || ' ' || times || ' ' || to_char(latest at time zone 'UTC', 'MM-DD HH24:MI'), '; ')
             from public.points_rule_payouts('59000000-0000-0000-0000-000000000001')),
          '01 2 10-27 07:05', '[PTS-08-e] each bonus rule''s payouts and its latest; a rule that never paid is not there');

select pg_temp.as_user('59100000-0000-0000-0000-0000000000a2');  -- Sam
select is((select item_title from public.points_register('59000000-0000-0000-0000-000000000001')
            where id = '59e00000-0000-0000-0000-000000000002'),
          'Gift wrap', '[PTS-08-c] Sam, who made the private item, sees its title');

select pg_temp.as_user('59100000-0000-0000-0000-0000000000b1');  -- a parent of another household
select is((select count(*)::integer from public.points_register('59000000-0000-0000-0000-000000000001'))
          + (select count(*)::integer from public.points_register_totals('59000000-0000-0000-0000-000000000001'))
          + (select count(*)::integer from public.points_rule_payouts('59000000-0000-0000-0000-000000000001')),
          0, '[PTS-08-f] a parent of another household reads nothing of this one');

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select * from public.points_register('59000000-0000-0000-0000-000000000001') $$,
                 '42501', null, '[PTS-08-f] a signed-out caller is refused');
select throws_ok($$ select * from public.points_rule_payouts('59000000-0000-0000-0000-000000000001') $$,
                 '42501', null, '[PTS-08-f] a signed-out caller is refused the payouts too');

select * from finish();
rollback;
