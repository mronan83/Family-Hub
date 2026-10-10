-- [CAL-04][CAL-05] Calendars on the boards (WP-23, D-65). A board follows each calendar's "show on the
-- boards" until an admin saves its own choice; then exactly the calendars ticked, and one connected
-- later stays off it. Another board's choice is its own. A board reads its household's calendars and
-- only the events of those it shows, over the snapshot's window and any range up to 62 days.
begin;
select plan(31);

-- Vault exists only on hosted Supabase: removing a calendar deletes its link there (WP-22).
create schema if not exists vault;
create table vault.secrets (id uuid primary key);

insert into auth.users (id, email) values
  ('27100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('27300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('27d00000-0000-0000-0000-00000000000a', null),
  ('27d00000-0000-0000-0000-00000000000b', null),
  ('27d00000-0000-0000-0000-00000000000c', null);
insert into public.household (id, name, timezone, week_start) values
  ('27000000-0000-0000-0000-000000000001', 'Calendar family', 'America/New_York', 0),
  ('27000000-0000-0000-0000-000000000002', 'Neighbours', 'America/New_York', 0);
insert into public.household_settings (household_id) values
  ('27000000-0000-0000-0000-000000000001'), ('27000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('27000000-0000-0000-0000-000000000001', '27100000-0000-0000-0000-000000000001', 'owner'),
  ('27000000-0000-0000-0000-000000000002', '27300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('27110000-0000-0000-0000-00000000000a', '27000000-0000-0000-0000-000000000001', 'Ava', 'child');
insert into public.device (id, household_id, name, auth_user_id) values
  ('27dd0000-0000-0000-0000-00000000000a', '27000000-0000-0000-0000-000000000001', 'Kitchen',
   '27d00000-0000-0000-0000-00000000000a'),
  ('27dd0000-0000-0000-0000-00000000000b', '27000000-0000-0000-0000-000000000001', 'Hall',
   '27d00000-0000-0000-0000-00000000000b'),
  ('27dd0000-0000-0000-0000-00000000000c', '27000000-0000-0000-0000-000000000002', 'Porch',
   '27d00000-0000-0000-0000-00000000000c');
-- Calendars as the sync leaves them (the links' Vault ids are made up: nothing here reads them).
insert into public.calendar_source (id, household_id, name, url_secret_id, color, member_id, show_on_board,
                                    status, last_success_at) values
  ('27ca0000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', 'Family', gen_random_uuid(),
   'member-6', null, true, 'ok', now()),
  ('27ca0000-0000-0000-0000-000000000002', '27000000-0000-0000-0000-000000000001', 'School', gen_random_uuid(),
   'member-3', '27110000-0000-0000-0000-00000000000a', true, 'ok', now()),
  ('27ca0000-0000-0000-0000-000000000003', '27000000-0000-0000-0000-000000000001', 'Work', gen_random_uuid(),
   'member-1', null, false, 'ok', now()),
  ('27ca0000-0000-0000-0000-000000000004', '27000000-0000-0000-0000-000000000002', 'Theirs', gen_random_uuid(),
   'member-2', null, true, 'ok', now());

create function pg_temp.today() returns date language sql as $$
  select (now() at time zone 'America/New_York')::date
$$;
-- One event per calendar tomorrow at 5 pm, and a three-day trip on Family from today.
create function pg_temp.add_event(p_source uuid, p_title text, p_day int, p_days int default 0,
                                  p_all_day boolean default false) returns void language plpgsql as $$
declare
  v_event uuid := gen_random_uuid();
  v_household uuid := (select household_id from public.calendar_source where id = p_source);
  v_start timestamptz := case when p_all_day then (pg_temp.today() + p_day)::timestamp at time zone 'America/New_York'
                              else ((pg_temp.today() + p_day) + time '17:00') at time zone 'America/New_York' end;
  v_end timestamptz := case when p_all_day then (pg_temp.today() + p_day + p_days + 1)::timestamp at time zone 'America/New_York'
                            else v_start + interval '1 hour' end;
begin
  insert into public.calendar_event (id, household_id, source_id, ical_uid, title, start_at, end_at, all_day, synced_at)
  values (v_event, v_household, p_source, p_title || '@test', p_title, v_start, v_end, p_all_day, now());
  insert into public.calendar_event_instance (household_id, source_id, event_id, instance_start, instance_end, all_day,
                                              local_start_date, local_end_date, title)
  values (v_household, p_source, v_event, v_start, v_end, p_all_day, pg_temp.today() + p_day,
          pg_temp.today() + p_day + p_days, p_title);
end $$;
select pg_temp.add_event('27ca0000-0000-0000-0000-000000000001', 'Swim', 1);
select pg_temp.add_event('27ca0000-0000-0000-0000-000000000001', 'Trip', 0, 2, true);
select pg_temp.add_event('27ca0000-0000-0000-0000-000000000002', 'Picture day', 1);
select pg_temp.add_event('27ca0000-0000-0000-0000-000000000003', 'Meeting', 1);
select pg_temp.add_event('27ca0000-0000-0000-0000-000000000004', 'Their party', 1);
select pg_temp.add_event('27ca0000-0000-0000-0000-000000000001', 'Far away', 50);

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_kitchen() returns void language sql as $$ select pg_temp.as_user('27d00000-0000-0000-0000-00000000000a') $$;
create function pg_temp.as_hall() returns void language sql as $$ select pg_temp.as_user('27d00000-0000-0000-0000-00000000000b') $$;
create function pg_temp.as_parent() returns void language sql as $$ select pg_temp.as_user('27100000-0000-0000-0000-000000000001') $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
-- The calendars a board shows over the coming week, and their events' titles, in order.
create function pg_temp.shown() returns text language sql as $$
  select string_agg(c ->> 'name', ', ' order by ord)
    from jsonb_array_elements(public.board_calendar(pg_temp.today(), pg_temp.today() + 6) -> 'calendars')
         with ordinality as x(c, ord)
$$;
create function pg_temp.events() returns text language sql as $$
  select string_agg(e ->> 'title', ', ' order by ord)
    from jsonb_array_elements(public.board_calendar(pg_temp.today(), pg_temp.today() + 6) -> 'events')
         with ordinality as x(e, ord)
$$;

-- A board following the calendars' own setting ------------------------------------------------------
select pg_temp.as_kitchen();
select is(pg_temp.shown(), 'Family, School', '[CAL-05] a board shows the calendars set to show on the boards');
select is(pg_temp.events(), 'Trip, Picture day, Swim',
  '[CAL-04] and their events in the range: all-day first on a day, then by start, one far ahead left out');
select is((select count(*) from public.calendar_event_instance), 4::bigint,
  '[CAL-05] RLS shows a board only the events of calendars it shows (the far one included)');
select is((select string_agg(name, ', ' order by name) from public.calendar_source), 'Family, School, Work',
  '[CAL-05] a board reads its household''s calendars, not another''s');
select is((select count(*) from public.calendar_event), 0::bigint, '[CAL-04] nor the events table behind the instances');
select is((select e from jsonb_array_elements(public.board_calendar(pg_temp.today(), pg_temp.today()) -> 'events') e
            where e ->> 'title' = 'Trip') ->> 'end_date', (pg_temp.today() + 2)::text,
  '[CAL-07] an all-day event spanning days is there on its first day, with its last day');
select is((select c from jsonb_array_elements(public.board_calendar(pg_temp.today(), pg_temp.today()) -> 'calendars') c
            where c ->> 'name' = 'School') - 'last_success_at',
  jsonb_build_object('id', '27ca0000-0000-0000-0000-000000000002', 'name', 'School', 'color', 'member-3',
                     'member_id', '27110000-0000-0000-0000-00000000000a', 'status', 'ok'),
  '[CAL-05] each calendar with its color and whose it is');
select is((public.board_snapshot() -> 'calendar' -> 'calendars'), public.board_calendar(pg_temp.today() - 1, pg_temp.today() + 14) -> 'calendars',
  '[DEV-05] the snapshot carries the calendar over its own window');
select is(jsonb_array_length(public.board_snapshot() -> 'calendar' -> 'events'), 3,
  '[DEV-05] with the events in it');
select throws_ok($$ select public.board_calendar(pg_temp.today(), pg_temp.today() + 62) $$, '22023', null,
  '[CAL-04] a range over 62 days is refused');
select throws_ok($$ select public.set_board_calendars('27dd0000-0000-0000-0000-00000000000a', array[]::uuid[]) $$,
  '42501', null, '[CAL-05] a board does not choose its own calendars');

-- An admin's own choice for one board ------------------------------------------------------------------
select pg_temp.as_parent();
select is(public.board_calendar(pg_temp.today(), pg_temp.today()), null, '[CAL-04] only a board has a board calendar');
select is(public.set_board_calendars('27dd0000-0000-0000-0000-00000000000a',
            array['27ca0000-0000-0000-0000-000000000001', '27ca0000-0000-0000-0000-000000000003']::uuid[]),
  '{"shown": 2, "hidden": 1}'::jsonb, '[US-507] an admin ticks Family and Work for the kitchen board');
select pg_temp.as_kitchen();
select is(pg_temp.shown(), 'Family, Work', '[US-507] the kitchen board shows exactly those');
select is(pg_temp.events(), 'Trip, Meeting, Swim', '[US-507] and only their events');
select is((select count(*) from public.device_calendar), 3::bigint, '[CAL-05] a board reads its own choice');
select pg_temp.as_hall();
select is(pg_temp.shown(), 'Family, School', '[US-507] the hall board is unaffected');
select is((select count(*) from public.device_calendar), 0::bigint, '[CAL-05] and cannot read the kitchen''s choice');

-- A calendar connected later --------------------------------------------------------------------------
select pg_temp.as_owner();
insert into public.calendar_source (id, household_id, name, url_secret_id, color, show_on_board, status)
values ('27ca0000-0000-0000-0000-000000000005', '27000000-0000-0000-0000-000000000001', 'Sports', gen_random_uuid(),
        'member-5', true, 'ok');
select pg_temp.as_kitchen();
select is(pg_temp.shown(), 'Family, Work', '[US-507] a calendar connected later stays off a board with its own choice');
select pg_temp.as_hall();
select is(pg_temp.shown(), 'Family, School, Sports', '[CAL-05] and shows on a board following the defaults');

-- Reselecting keeps the calendar's color and person; only changes are written ----------------------------
select pg_temp.as_parent();
select is(public.set_board_calendars('27dd0000-0000-0000-0000-00000000000a',
            array['27ca0000-0000-0000-0000-000000000001', '27ca0000-0000-0000-0000-000000000002',
                  '27ca0000-0000-0000-0000-000000000003']::uuid[]),
  '{"shown": 3, "hidden": 1}'::jsonb, '[US-507] School ticked again (Sports added, unticked)');
select pg_temp.as_kitchen();
select is((select c ->> 'color' || ' ' || (c ->> 'member_id') from jsonb_array_elements(
            public.board_calendar(pg_temp.today(), pg_temp.today()) -> 'calendars') c where c ->> 'name' = 'School'),
  'member-3 27110000-0000-0000-0000-00000000000a', '[US-507] with its color and person kept');
select pg_temp.as_owner();
select is((select count(*) from public.audit_log where entity_type = 'device_calendar' and action = 'update'), 1::bigint,
  '[ACC-05] only the calendar that changed was written (and audited)');

-- Who may choose -------------------------------------------------------------------------------------------
select pg_temp.as_user('27300000-0000-0000-0000-000000000003');
select throws_ok($$ select public.set_board_calendars('27dd0000-0000-0000-0000-00000000000a', array[]::uuid[]) $$,
  '42501', null, '[NFR-04] another household''s admin cannot choose for this board');
select is((select count(*) from public.device_calendar), 0::bigint, '[NFR-04] nor see its choice');
select is((select count(*) from public.calendar_event_instance where title <> 'Their party'), 0::bigint,
  '[NFR-04] nor its events');

-- The defaults change --------------------------------------------------------------------------------------
select pg_temp.as_owner();
update public.calendar_source set show_on_board = false where id = '27ca0000-0000-0000-0000-000000000002';
select pg_temp.as_hall();
select is(pg_temp.shown(), 'Family, Sports', '[CAL-05] turning "show on the boards" off takes it off boards following it');
select pg_temp.as_kitchen();
select is(pg_temp.shown(), 'Family, School, Work', '[CAL-05] but not off a board whose own choice shows it');

select pg_temp.as_owner();
delete from public.calendar_source where id = '27ca0000-0000-0000-0000-000000000003';
select is((select count(*) from public.device_calendar where calendar_source_id = '27ca0000-0000-0000-0000-000000000003'),
  0::bigint, '[CAL-05] a calendar removed leaves no choice behind');

select is((select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime'
             and tablename in ('calendar_source', 'device_calendar')), 2,
  '[DEV-05] a board hears when its choice or a calendar changes');
select ok(not has_function_privilege('anon', 'public.board_calendar(date, date)', 'execute')
      and not has_function_privilege('anon', 'public.set_board_calendars(uuid, uuid[])', 'execute'),
  '[NFR-04] nobody signed out reaches any of it');

select * from finish();
rollback;
