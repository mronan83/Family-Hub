-- [NFR-17][SCH-01][US-109] No school today, from Home (WP-57, D-84): on a school day, an admin makes
-- today a snow day and today is re-planned at once (a school-days-only item goes, an every-day one
-- stays, one already checked off stays); Undo brings today back. Only that household's admins may.
-- On a weekend it is refused, as today is no school day. Dates are relative to today.
begin;
set local client_min_messages = warning;
select plan(9);

insert into auth.users (id, email) values
  ('39510000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('39520000-0000-0000-0000-000000000002', 'other@example.com');
insert into public.household (id, name, timezone) values
  ('39500000-0000-0000-0000-000000000001', 'Snow family', 'America/New_York'),
  ('39500000-0000-0000-0000-000000000002', 'Other family', 'America/New_York');
insert into public.household_settings (household_id) values
  ('39500000-0000-0000-0000-000000000001'), ('39500000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('39500000-0000-0000-0000-000000000001', '39510000-0000-0000-0000-000000000001', 'owner'),
  ('39500000-0000-0000-0000-000000000002', '39520000-0000-0000-0000-000000000002', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('39511000-0000-0000-0000-000000000001', '39500000-0000-0000-0000-000000000001', 'Maya', 'child');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('39500000-0000-0000-0000-000000000001')
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
create function pg_temp.today_count(p_title text) returns int language sql as $$
  select count(*)::int from public.chore_occurrence o join public.chore c on c.id = o.chore_id
   where c.title = p_title and o.due_date = pg_temp.today()
$$;

insert into public.school_year (id, household_id, name, start_date, end_date, is_default) values
  ('39530000-0000-0000-0000-000000000001', '39500000-0000-0000-0000-000000000001', 'This year',
   pg_temp.today() - 60, pg_temp.today() + 200, true);
insert into public.chore (id, household_id, title, kind, points, schedule, day_types, created_by, start_date) values
  ('39540000-0000-0000-0000-000000000001', '39500000-0000-0000-0000-000000000001', 'Homework', 'chore', 5,
   '{"freq": "daily"}', array['school_day'], '39510000-0000-0000-0000-000000000001', pg_temp.today() - 30),
  ('39540000-0000-0000-0000-000000000002', '39500000-0000-0000-0000-000000000001', 'Make bed', 'chore', 5,
   '{"freq": "daily"}', array['school_day', 'no_school', 'break', 'weekend', 'summer'],
   '39510000-0000-0000-0000-000000000001', pg_temp.today() - 30),
  ('39540000-0000-0000-0000-000000000003', '39500000-0000-0000-0000-000000000001', 'Pack bag', 'chore', 5,
   '{"freq": "daily"}', array['school_day'], '39510000-0000-0000-0000-000000000001', pg_temp.today() - 30);
insert into public.chore_assignee (household_id, chore_id, member_id)
select '39500000-0000-0000-0000-000000000001', id, '39511000-0000-0000-0000-000000000001'
  from public.chore where household_id = '39500000-0000-0000-0000-000000000001';
select private.replan('39500000-0000-0000-0000-000000000001', pg_temp.today());
-- Pack bag was already checked off this morning.
update public.chore_occurrence o set status = 'completed'
  from public.chore c where c.id = o.chore_id and c.title = 'Pack bag' and o.due_date = pg_temp.today();

create function pg_temp.tests() returns setof text language plpgsql as $$
declare
  v_id uuid;
begin
  if extract(isodow from pg_temp.today()) in (6, 7) then
    perform pg_temp.as_user('39510000-0000-0000-0000-000000000001');
    return next throws_ok($q$ select public.no_school_today('39500000-0000-0000-0000-000000000001') $q$,
      '22023', null, '[SCH-01] on a weekend there is no school to call off');
    perform pg_temp.as_owner();
    return next skip('a weekday runs the snow day itself', 8);
    return;
  end if;
  return next is(pg_temp.today_count('Homework'), 1, '[SCH-03] a school day: homework is on today');

  perform pg_temp.as_user('39520000-0000-0000-0000-000000000002');
  return next throws_ok($q$ select public.no_school_today('39500000-0000-0000-0000-000000000001') $q$,
    '42501', null, '[NFR-04] another household''s admin can''t call off school');

  perform pg_temp.as_user('39510000-0000-0000-0000-000000000001');
  v_id := public.no_school_today('39500000-0000-0000-0000-000000000001');
  perform pg_temp.as_owner();
  return next is((select closure_type || ':' || (start_date = pg_temp.today() and end_date = pg_temp.today())
                    from public.school_closure where id = v_id),
    'snow_day:true', '[NFR-17][US-109] no school today: today is a snow day');
  return next is(pg_temp.today_count('Homework'), 0, '[SCH-03] and today''s homework goes at once');
  return next is(pg_temp.today_count('Make bed'), 1, '[SCH-03] an every-day item stays');
  return next is(pg_temp.today_count('Pack bag'), 1, '[SCH-03] and one already checked off stays');

  perform pg_temp.as_user('39510000-0000-0000-0000-000000000001');
  return next throws_ok($q$ select public.no_school_today('39500000-0000-0000-0000-000000000001') $q$,
    '22023', null, '[SCH-01] a second time: today is already off');
  return next is(public.undo_no_school_today('39500000-0000-0000-0000-000000000001', v_id), true,
    '[NFR-17] Undo takes today''s snow day away');
  perform pg_temp.as_owner();
  return next is(pg_temp.today_count('Homework'), 1, '[SCH-03] and homework is back on today');
end $$;

select * from pg_temp.tests();
select * from finish();
rollback;
