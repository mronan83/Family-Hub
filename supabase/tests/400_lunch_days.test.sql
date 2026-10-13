-- [CHR-19][US-321] Chores on lunch days (WP-61, D-86): an item everyone does on their own can follow
-- each child's school lunch. "Pack lunch" comes up only on a child's bring days, "Lunch money" only on
-- their buy days; never for an adult, at a weekend or on a day without school. Changing a child's
-- lunch (one day, or their usual week) re-plans at once, today included, keeping one already checked
-- off; a shared item can't follow lunch days. Dates are relative to today.
begin;
set local client_min_messages = warning;
select plan(16);

insert into auth.users (id, email) values ('40010000-0000-0000-0000-000000000001', 'parent@example.com');
insert into public.household (id, name, timezone) values
  ('40000000-0000-0000-0000-000000000001', 'Lunchbox family', 'America/New_York');
insert into public.household_settings (household_id) values ('40000000-0000-0000-0000-000000000001');
insert into public.household_user (household_id, user_id, role) values
  ('40000000-0000-0000-0000-000000000001', '40010000-0000-0000-0000-000000000001', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('40110000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'Maya', 'child'),
  ('40110000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-000000000001', 'Leo', 'child'),
  ('40110000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-000000000001', 'Pat', 'adult');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('40000000-0000-0000-0000-000000000001')
$$;
create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
create function pg_temp.member(p_name text) returns uuid language sql as $$
  select id from public.member where household_id = '40000000-0000-0000-0000-000000000001' and display_name = p_name
$$;
create function pg_temp.chore(p_title text) returns uuid language sql as $$
  select id from public.chore where household_id = '40000000-0000-0000-0000-000000000001' and title = p_title
$$;
-- An item's occurrences from p_from to p_to, by person: "Leo=10,Maya=10".
create function pg_temp.who(p_title text, p_from date, p_to date) returns text language sql as $$
  select coalesce(string_agg(m.display_name || '=' || n, ',' order by m.display_name), '')
    from (select o.member_id, count(*) as n from public.chore_occurrence o
           where o.chore_id = pg_temp.chore(p_title) and o.due_date between p_from and p_to group by o.member_id) x
    left join public.member m on m.id = x.member_id
$$;
create function pg_temp.has(p_title text, p_name text, p_date date) returns boolean language sql as $$
  select exists (select from public.chore_occurrence
                  where chore_id = pg_temp.chore(p_title) and member_id = pg_temp.member(p_name) and due_date = p_date)
$$;
-- School days (all weekdays: the school year has no closures) from p_from to p_to.
create function pg_temp.school_days(p_from date, p_to date) returns int language sql as $$
  select count(*)::int from generate_series(p_from, p_to, interval '1 day') d where extract(isodow from d) < 6
$$;
-- The first school day after today.
create function pg_temp.next_school_day() returns date language sql as $$
  select min(d)::date from generate_series(pg_temp.today() + 1, pg_temp.today() + 7, interval '1 day') d
   where extract(isodow from d) < 6
$$;

insert into public.school_year (id, household_id, name, start_date, end_date, is_default) values
  ('40500000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'This year',
   pg_temp.today() - 60, pg_temp.today() + 200, true);
-- Maya brings lunch every day (no usual set is bring); Leo buys every day.
insert into public.member_lunch (household_id, member_id, defaults) values
  ('40000000-0000-0000-0000-000000000001', pg_temp.member('Leo'),
   '{"mon": "buy", "tue": "buy", "wed": "buy", "thu": "buy", "fri": "buy"}');
insert into public.chore (household_id, title, kind, points, schedule, day_types, created_by, start_date, assignment, lunch_days)
values
  ('40000000-0000-0000-0000-000000000001', 'Pack lunch', 'chore', 2, '{"freq": "daily"}',
   array['school_day', 'no_school', 'break', 'weekend', 'summer'], '40010000-0000-0000-0000-000000000001',
   pg_temp.today() - 30, 'each', 'bring'),
  ('40000000-0000-0000-0000-000000000001', 'Lunch money', 'chore', 1, '{"freq": "daily"}',
   array['school_day'], '40010000-0000-0000-0000-000000000001', pg_temp.today() - 30, 'each', 'buy');
insert into public.chore_assignee (household_id, chore_id, member_id)
select '40000000-0000-0000-0000-000000000001', c.id, m.id
  from public.chore c cross join public.member m
 where c.household_id = '40000000-0000-0000-0000-000000000001' and m.household_id = c.household_id;

-- [CHR-19] The plan follows each child's lunch -------------------------------------------------------
select is(pg_temp.who('Pack lunch', pg_temp.today() + 1, pg_temp.today() + 14),
          'Maya=' || pg_temp.school_days(pg_temp.today() + 1, pg_temp.today() + 14),
          '[CHR-19] Pack lunch: only Maya, who brings, on each school day; not Leo, who buys, nor Pat, an adult');
select is(pg_temp.who('Lunch money', pg_temp.today() + 1, pg_temp.today() + 14),
          'Leo=' || pg_temp.school_days(pg_temp.today() + 1, pg_temp.today() + 14),
          '[CHR-19] Lunch money: only Leo, on his buy days');
select is((select count(*)::int from public.chore_occurrence o
            where o.chore_id = pg_temp.chore('Pack lunch') and extract(isodow from o.due_date) >= 6), 0,
          '[CHR-19] none at a weekend, though the item allows every kind of day');
select is(public.generate_household_occurrences('40000000-0000-0000-0000-000000000001') ->> 'added', '0',
          '[CHR-03] the hourly job finds nothing more to add');

-- [CHR-19] One day changed -------------------------------------------------------------------------
select pg_temp.as_user('40010000-0000-0000-0000-000000000001');
select public.set_lunch(pg_temp.member('Maya'), pg_temp.next_school_day(), 'buy');
select pg_temp.as_owner();
select is(pg_temp.has('Pack lunch', 'Maya', pg_temp.next_school_day())::text
          || ',' || pg_temp.has('Lunch money', 'Maya', pg_temp.next_school_day())::text, 'false,true',
          '[CHR-19][US-703] Maya buys on the next school day: no Pack lunch that day, Lunch money instead');
select pg_temp.as_user('40010000-0000-0000-0000-000000000001');
select public.set_lunch(pg_temp.member('Maya'), pg_temp.next_school_day(), 'bring');
select pg_temp.as_owner();
select is(pg_temp.has('Pack lunch', 'Maya', pg_temp.next_school_day())::text
          || ',' || pg_temp.has('Lunch money', 'Maya', pg_temp.next_school_day())::text, 'true,false',
          '[CHR-19] changed back to her usual: Pack lunch is back, Lunch money gone');

-- [CHR-19] A usual week changed ----------------------------------------------------------------------
select pg_temp.as_user('40010000-0000-0000-0000-000000000001');
select public.set_lunch_defaults(pg_temp.member('Leo'), '{"fri": "buy"}');
select pg_temp.as_owner();
select is((select count(*)::int from public.chore_occurrence
            where chore_id = pg_temp.chore('Lunch money') and member_id = pg_temp.member('Leo')
              and due_date > pg_temp.today() and extract(isodow from due_date) <> 5), 0,
          '[CHR-19][US-703] Leo now buys on Fridays only: his Lunch money stays on Fridays alone');
select is((select count(*)::int from public.chore_occurrence
            where chore_id = pg_temp.chore('Pack lunch') and member_id = pg_temp.member('Leo')
              and due_date between pg_temp.today() + 1 and pg_temp.today() + 14),
          (select count(*)::int from generate_series(pg_temp.today() + 1, pg_temp.today() + 14, interval '1 day') d
            where extract(isodow from d) < 5),
          '[CHR-19] and Pack lunch comes up for him Monday to Thursday');

-- [CHR-19] Saving an item ------------------------------------------------------------------------------
select pg_temp.as_user('40010000-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.save_chore('40000000-0000-0000-0000-000000000001', null,
       '{"title": "Lunch boxes", "kind": "chore", "schedule": {"freq": "daily"}, "assignment": "shared", "lunch_days": "bring"}',
       array[pg_temp.member('Maya'), pg_temp.member('Leo')]) $$,
  '23514', null, '[CHR-19] a shared item can''t follow lunch days: each child has their own lunch');
select throws_ok(
  $$ select public.save_chore('40000000-0000-0000-0000-000000000001', pg_temp.chore('Pack lunch'),
       '{"title": "Pack lunch", "assignment": "shared"}', array[pg_temp.member('Maya')]) $$,
  '23514', null, '... nor can a lunch-day item be made shared');
select lives_ok(
  $$ select public.save_chore('40000000-0000-0000-0000-000000000001', pg_temp.chore('Pack lunch'),
       '{"title": "Pack lunch", "points": 3}',
       array[pg_temp.member('Maya'), pg_temp.member('Leo'), pg_temp.member('Pat')]) $$,
  '[CHR-19] an edit that leaves lunch days out keeps them');
select pg_temp.as_owner();
select is((select lunch_days from public.chore where id = pg_temp.chore('Pack lunch')), 'bring', '... still bring days');
select pg_temp.as_user('40010000-0000-0000-0000-000000000001');
select public.save_chore('40000000-0000-0000-0000-000000000001', pg_temp.chore('Pack lunch'),
  '{"title": "Pack lunch", "lunch_days": null}',
  array[pg_temp.member('Maya'), pg_temp.member('Leo'), pg_temp.member('Pat')]);
select pg_temp.as_owner();
select is(pg_temp.who('Pack lunch', pg_temp.today() + 1, pg_temp.today() + 14),
          'Leo=14,Maya=14,Pat=14', '[CHR-19] lunch days taken off: everyone, every day, at once');
select public.save_chore('40000000-0000-0000-0000-000000000001', pg_temp.chore('Pack lunch'),
  '{"title": "Pack lunch", "lunch_days": "bring"}',
  array[pg_temp.member('Maya'), pg_temp.member('Leo'), pg_temp.member('Pat')]);

-- [CHR-19] Today ----------------------------------------------------------------------------------------
create function pg_temp.tests() returns setof text language plpgsql as $$
begin
  if extract(isodow from pg_temp.today()) in (6, 7) then
    return next is(pg_temp.who('Pack lunch', pg_temp.today(), pg_temp.today()), '',
      '[CHR-19] a weekend: no school lunch, so no Pack lunch today');
    return next skip('a school day runs today''s change', 2);
    return;
  end if;
  return next is(pg_temp.has('Pack lunch', 'Maya', pg_temp.today()), true,
    '[CHR-19] a school day: Maya brings, so Pack lunch is on today');

  perform pg_temp.as_user('40010000-0000-0000-0000-000000000001');
  perform public.set_lunch(pg_temp.member('Maya'), pg_temp.today(), 'buy');
  perform pg_temp.as_owner();
  return next is(pg_temp.has('Pack lunch', 'Maya', pg_temp.today())::text
                 || ',' || pg_temp.has('Lunch money', 'Maya', pg_temp.today())::text, 'false,true',
    '[CHR-19] she buys today after all: today''s Pack lunch goes at once, Lunch money comes');

  -- Lunch money checked off, then she brings after all: what was done stays.
  update public.chore_occurrence set status = 'completed'
   where chore_id = pg_temp.chore('Lunch money') and member_id = pg_temp.member('Maya') and due_date = pg_temp.today();
  perform pg_temp.as_user('40010000-0000-0000-0000-000000000001');
  perform public.set_lunch(pg_temp.member('Maya'), pg_temp.today(), 'bring');
  perform pg_temp.as_owner();
  return next is(pg_temp.has('Pack lunch', 'Maya', pg_temp.today())::text
                 || ',' || pg_temp.has('Lunch money', 'Maya', pg_temp.today())::text, 'true,true',
    '[CHR-19] back to bring: Pack lunch is back, and Lunch money, already checked off, stays');
end $$;

select * from pg_temp.tests();
select * from finish();
rollback;
