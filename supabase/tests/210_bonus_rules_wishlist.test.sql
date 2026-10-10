-- [PTS-05][PTS-06] Bonus rules and the wishlist (WP-30, D-57). A parent's bonus rules applied to the
-- stored history (written here as day close would, from the rules engine): a run of 7 good days posts
-- exactly one bonus and running again posts none; perfect days pay once each; nothing before the
-- rule's counts-from date, nothing for an inactive rule or a member who doesn't earn. A child pins the
-- reward they're saving for on the board (or a parent does), and the snapshot carries it.
begin;
select plan(32);

insert into auth.users (id, email) values
  ('21100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('21300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('21d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('21000000-0000-0000-0000-000000000001', 'Bonus family', 'America/Chicago'),
  ('21000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('21000000-0000-0000-0000-000000000001'), ('21000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('21000000-0000-0000-0000-000000000001', '21100000-0000-0000-0000-000000000001', 'owner'),
  ('21000000-0000-0000-0000-000000000002', '21300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('21110000-0000-0000-0000-00000000000a', '21000000-0000-0000-0000-000000000001', 'Kid', 'child'),
  ('21110000-0000-0000-0000-00000000000b', '21000000-0000-0000-0000-000000000001', 'Grown-up', 'adult');
insert into public.device (id, household_id, name, auth_user_id) values
  ('21dd0000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'Kitchen',
   '21d00000-0000-0000-0000-00000000000d');
insert into public.reward_catalog_item (id, household_id, title, icon, cost_points, active, archived_at) values
  ('21c00000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'Movie night', 'ticket', 100, true, null),
  ('21c00000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', 'Old prize', 'gift', 10, true, now()),
  ('21c00000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000001', 'Not now', 'gift', 10, false, null);

create function pg_temp.today() returns date language sql as $$
  select private.household_today('21000000-0000-0000-0000-000000000001')
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
create function pg_temp.bonuses() returns text language sql as $$
  select coalesce(string_agg(m.display_name || ':' || l.amount || ':' || coalesce(l.reason, ''), ',' order by l.dedupe_key), '')
    from public.points_ledger l join public.member m on m.id = l.member_id
   where l.household_id = '21000000-0000-0000-0000-000000000001' and l.entry_type = 'bonus'
$$;
create function pg_temp.apply() returns int language sql as $$
  select (public.apply_points_rules('21000000-0000-0000-0000-000000000001') ->> 'posted')::int
$$;

-- Kid's stored history (as day close stores it from the engine, D-55): a run of 3 good days d1-d3
-- (ended), a bad day d4, then 7 good days d5-d11, still going. The grown-up had 8 good days too.
insert into public.member_daily_summary (household_id, member_id, summary_date, scheduled_count, done_count,
                                         missed_count, skipped_count, covered_count, points_earned, day_class,
                                         engine_version)
select '21000000-0000-0000-0000-000000000001', m, pg_temp.d(k), 2, case when k = 4 then 1 else 2 end,
       case when k = 4 then 1 else 0 end, 0, 0, 5, case when k = 4 then 'bad' else 'good' end, 1
  from generate_series(1, 11) k, (values ('21110000-0000-0000-0000-00000000000a'::uuid)) v (m);
insert into public.streak_segment (household_id, member_id, kind, start_date, end_date, length_days, engine_version) values
  ('21000000-0000-0000-0000-000000000001', '21110000-0000-0000-0000-00000000000a', 'good', pg_temp.d(1), pg_temp.d(3), 3, 1),
  ('21000000-0000-0000-0000-000000000001', '21110000-0000-0000-0000-00000000000a', 'bad', pg_temp.d(4), pg_temp.d(4), 1, 1),
  ('21000000-0000-0000-0000-000000000001', '21110000-0000-0000-0000-00000000000a', 'good', pg_temp.d(5), null, 7, 1),
  ('21000000-0000-0000-0000-000000000001', '21110000-0000-0000-0000-00000000000b', 'good', pg_temp.d(1), null, 8, 1);

-- [PTS-05] A parent sets a bonus: 10 points for 7 good days in a row, counting from d1.
select pg_temp.as_user('21100000-0000-0000-0000-000000000001');
select lives_ok($$ insert into public.points_rule (id, household_id, rule_type, streak_days, bonus_points, counts_from)
                   values ('21e00000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
                           'streak_bonus', 7, 10, pg_temp.d(1)) $$,
                '[PTS-05] a parent sets a bonus for a run of good days');
select is((select created_by from public.points_rule where id = '21e00000-0000-0000-0000-000000000001'),
          '21100000-0000-0000-0000-000000000001'::uuid, '... and it records who set it');
select throws_ok($$ insert into public.points_rule (household_id, rule_type, bonus_points, counts_from)
                    values ('21000000-0000-0000-0000-000000000001', 'streak_bonus', 10, pg_temp.d(1)) $$,
                 '23514', null, 'a run bonus says how long the run is');
select throws_ok($$ insert into public.points_rule (household_id, rule_type, bonus_points, counts_from)
                    values ('21000000-0000-0000-0000-000000000001', 'all_done_bonus', 0, pg_temp.d(1)) $$,
                 '23514', null, 'a bonus is at least a point');
select throws_ok($$ delete from public.points_rule $$, '42501', null, '... and is archived, never deleted');
select pg_temp.as_user('21300000-0000-0000-0000-000000000003');
select throws_ok($$ insert into public.points_rule (household_id, rule_type, streak_days, bonus_points, counts_from)
                    values ('21000000-0000-0000-0000-000000000001', 'streak_bonus', 3, 99, pg_temp.d(1)) $$,
                 '42501', null, 'another household cannot set this family''s bonuses');
select is((select count(*)::int from public.points_rule), 0, '... nor see them');
select throws_ok($$ select pg_temp.apply() $$, '42501', null, '... nor apply them');
select pg_temp.as_user('21d00000-0000-0000-0000-00000000000d');
select throws_ok($$ select pg_temp.apply() $$, '42501', null, 'a board cannot apply them');

-- [PTS-05] The done-when: a 7-day run posts exactly one bonus, and running again posts none.
select pg_temp.as_job();
select is(pg_temp.apply(), 1, '[PTS-05] day close: Kid''s run of 7 good days posts one bonus');
select is(pg_temp.bonuses(), 'Kid:10:7 good days in a row', '... to Kid only (the grown-up doesn''t earn), with its reason');
select is((select points_rule_id || ':' || created_by_type || ':' || dedupe_key from public.points_ledger
            where entry_type = 'bonus'),
          '21e00000-0000-0000-0000-000000000001:system:rule:21e00000-0000-0000-0000-000000000001:'
            || '21110000-0000-0000-0000-00000000000a:' || pg_temp.d(5),
          '... naming the rule, keyed by the run''s first day');
select is(pg_temp.apply(), 0, '[PTS-05] running again posts nothing');
select is(pg_temp.bonuses(), 'Kid:10:7 good days in a row', '... and the ledger still has one bonus');
-- The run going on to 8 is still the same run: no second bonus.
select pg_temp.as_owner();
update public.streak_segment set length_days = 8 where member_id = '21110000-0000-0000-0000-00000000000a' and end_date is null;
select pg_temp.as_job();
select is(pg_temp.apply(), 0, 'the same run growing longer pays nothing more');

-- Counting from a later day, or a shorter run: nothing.
select pg_temp.as_user('21100000-0000-0000-0000-000000000001');
insert into public.points_rule (id, household_id, rule_type, streak_days, bonus_points, counts_from)
values ('21e00000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', 'streak_bonus', 4, 5, pg_temp.d(9));
select pg_temp.as_job();
select is(pg_temp.apply(), 0, 'a run that reached its length before the rule''s counts-from date pays nothing; nor does a run of 3');

-- [PTS-05] Perfect days: 2 points a good day from d9, once each.
select pg_temp.as_user('21100000-0000-0000-0000-000000000001');
insert into public.points_rule (id, household_id, rule_type, bonus_points, counts_from)
values ('21e00000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000001', 'all_done_bonus', 2, pg_temp.d(9));
select pg_temp.as_job();
select is(pg_temp.apply(), 3, '[PTS-05] a perfect-day bonus pays each good day from its date: d9, d10, d11');
select is(pg_temp.apply(), 0, '... once');
select is((select sum(amount)::int from public.points_ledger where entry_type = 'bonus'), 16,
          'Kid''s bonuses: 10 for the run, 3 × 2 for perfect days');

-- An inactive or archived rule pays nothing.
select pg_temp.as_owner();
insert into public.member_daily_summary (household_id, member_id, summary_date, scheduled_count, done_count,
                                         missed_count, skipped_count, covered_count, points_earned, day_class, engine_version)
values ('21000000-0000-0000-0000-000000000001', '21110000-0000-0000-0000-00000000000a', pg_temp.d(12), 2, 2, 0, 0, 0, 5, 'good', 1);
select pg_temp.as_user('21100000-0000-0000-0000-000000000001');
update public.points_rule set active = false where id = '21e00000-0000-0000-0000-000000000003';
select is(pg_temp.apply(), 0, 'a parent may apply them too; a rule switched off pays nothing');
update public.points_rule set active = true, archived_at = now() where id = '21e00000-0000-0000-0000-000000000003';
select is(pg_temp.apply(), 0, '... nor does an archived one');

-- [PTS-06] The wishlist: the board pins what Kid is saving for.
select pg_temp.as_user('21d00000-0000-0000-0000-00000000000d');
select is(public.pin_wish('21110000-0000-0000-0000-00000000000a', '21c00000-0000-0000-0000-000000000001') ->> 'item_id',
          '21c00000-0000-0000-0000-000000000001', '[PTS-06] a child pins a reward on the board');
select is((select pinned_by_type || ':' || pinned_by from public.wishlist_pin),
          'device:21dd0000-0000-0000-0000-000000000001', '... recorded as that board');
select is((select m -> 'wish' from jsonb_array_elements(public.board_snapshot() -> 'members') m
            where m ->> 'display_name' = 'Kid'),
          jsonb_build_object('item_id', '21c00000-0000-0000-0000-000000000001', 'title', 'Movie night',
                             'icon', 'ticket', 'cost', 100),
          '[PTS-06] the snapshot carries it, with its cost, for the savings meter');
select is((select m -> 'wish' from jsonb_array_elements(public.board_snapshot() -> 'members') m
            where m ->> 'display_name' = 'Grown-up'), 'null'::jsonb, '... and nothing for someone who doesn''t earn');
select throws_ok($$ select public.pin_wish('21110000-0000-0000-0000-00000000000b', '21c00000-0000-0000-0000-000000000001') $$,
                 '22023', 'only someone who earns rewards saves for one', 'only a child who earns rewards saves');
select throws_ok($$ select public.pin_wish('21110000-0000-0000-0000-00000000000a', '21c00000-0000-0000-0000-000000000002') $$,
                 'P0002', 'that reward is not in the shop', 'an archived reward cannot be pinned');
select throws_ok($$ select public.pin_wish('21110000-0000-0000-0000-00000000000a', '21c00000-0000-0000-0000-000000000003') $$,
                 'P0002', 'that reward is not in the shop', '... nor one taken out of the shop');
select throws_ok($$ insert into public.wishlist_pin (member_id, household_id, catalog_item_id, pinned_by_type)
                    values ('21110000-0000-0000-0000-00000000000a', '21000000-0000-0000-0000-000000000001',
                            '21c00000-0000-0000-0000-000000000001', 'device') $$,
                 '42501', null, 'pins change only through pin_wish');
select public.pin_wish('21110000-0000-0000-0000-00000000000a', null);
select is((select count(*)::int from public.wishlist_pin), 0, 'unpinning leaves nothing pinned');

select pg_temp.as_user('21300000-0000-0000-0000-000000000003');
select throws_ok($$ select public.pin_wish('21110000-0000-0000-0000-00000000000a', '21c00000-0000-0000-0000-000000000001') $$,
                 '42501', null, 'another household cannot pin for Kid');
select pg_temp.as_user('21100000-0000-0000-0000-000000000001');
select public.pin_wish('21110000-0000-0000-0000-00000000000a', '21c00000-0000-0000-0000-000000000001');
select is((select pinned_by_type from public.wishlist_pin), 'admin', 'a parent may pin it for them');

select * from finish();
rollback;
