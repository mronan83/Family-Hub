-- [CAL-10][US-509] Where an event is (WP-52, D-82). A sync stores each event's and instance's location,
-- trimmed and up to 300 characters, null when it has none or sends none (the app before WP-52); an
-- instance moved or edited on its own keeps its own; a board reads it with the event.
begin;
set local client_min_messages = warning;
select plan(8);

create schema if not exists vault;
create table vault.secrets (id uuid primary key);

insert into auth.users (id, email) values
  ('38100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('38d00000-0000-0000-0000-00000000000a', null);
insert into public.household (id, name, timezone, week_start) values
  ('38000000-0000-0000-0000-000000000001', 'Location family', 'America/New_York', 0);
insert into public.household_settings (household_id) values ('38000000-0000-0000-0000-000000000001');
insert into public.household_user (household_id, user_id, role) values
  ('38000000-0000-0000-0000-000000000001', '38100000-0000-0000-0000-000000000001', 'owner');
insert into public.device (id, household_id, name, auth_user_id) values
  ('38dd0000-0000-0000-0000-00000000000a', '38000000-0000-0000-0000-000000000001', 'Kitchen',
   '38d00000-0000-0000-0000-00000000000a');
insert into public.calendar_source (id, household_id, name, url_secret_id, color, show_on_board, status) values
  ('38ca0000-0000-0000-0000-000000000001', '38000000-0000-0000-0000-000000000001', 'Family', gen_random_uuid(),
   'member-6', true, 'pending');

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
create function pg_temp.today() returns date language sql as $$
  select (now() at time zone 'America/New_York')::date
$$;
-- A sync of two series tomorrow: a dentist with a place (its moved instance somewhere else) and a
-- swim without one. `p_places` false sends no location at all, as the app before WP-52 does.
create function pg_temp.result(p_places boolean) returns jsonb language sql as $$
  select jsonb_build_object('ok', true, 'etag', '"e1"', 'content_hash', repeat('a', 64),
    'events', jsonb_build_array(
      jsonb_build_object('uid', 'dentist@test', 'title', 'Dentist', 'start', s.d || 'T13:30:00.000Z',
                         'end', s.d || 'T14:15:00.000Z', 'all_day', false)
        || case when p_places then jsonb_build_object('location', '  12 Made-up Street  ') else '{}' end,
      jsonb_build_object('uid', 'swim@test', 'title', 'Swim', 'start', s.d || 'T21:00:00.000Z',
                         'end', s.d || 'T22:00:00.000Z', 'all_day', false, 'location', '   ')),
    'instances', jsonb_build_array(
      jsonb_build_object('uid', 'dentist@test', 'title', 'Dentist', 'start', s.d || 'T13:30:00.000Z',
                         'end', s.d || 'T14:15:00.000Z', 'all_day', false, 'changed', false)
        || case when p_places then jsonb_build_object('location', '12 Made-up Street') else '{}' end,
      jsonb_build_object('uid', 'swim@test', 'title', 'Swim', 'start', s.d || 'T21:00:00.000Z',
                         'end', s.d || 'T22:00:00.000Z', 'all_day', false, 'changed', false,
                         'location', repeat('x', 400))))
    from (select (pg_temp.today() + 1)::text as d) s
$$;

select pg_temp.as_user('38100000-0000-0000-0000-000000000001');
select is(public.save_calendar_sync('38ca0000-0000-0000-0000-000000000001', pg_temp.result(true)) ->> 'status', 'synced',
  '[CAL-10] a sync with places is stored');
select pg_temp.as_owner();
select is((select location from public.calendar_event where title = 'Dentist'), '12 Made-up Street',
  '[CAL-10] an event keeps where it is, trimmed');
select is((select location from public.calendar_event where title = 'Swim'), null,
  '[CAL-10] a blank place is none');
select is((select location from public.calendar_event_instance where title = 'Dentist'), '12 Made-up Street',
  '[CAL-10] and so does its instance');
select is((select length(location) from public.calendar_event_instance where title = 'Swim'), 300,
  '[CAL-10] a place is kept to 300 characters');

select pg_temp.as_user('38d00000-0000-0000-0000-00000000000a');
select is((select e ->> 'location' from jsonb_array_elements(
             public.board_calendar(pg_temp.today(), pg_temp.today() + 6) -> 'events') e
            where e ->> 'title' = 'Dentist'), '12 Made-up Street',
  '[CAL-10][US-509] a board reads where an event is');

-- The app before WP-52 sends no location: its sync is stored as before, without one.
select pg_temp.as_owner();
update public.calendar_source set content_hash = null where id = '38ca0000-0000-0000-0000-000000000001';
select pg_temp.as_user('38100000-0000-0000-0000-000000000001');
select is(public.save_calendar_sync('38ca0000-0000-0000-0000-000000000001', pg_temp.result(false)) ->> 'status', 'synced',
  '[CAL-10] a sync that sends no places is stored as before');
select pg_temp.as_owner();
select is((select location from public.calendar_event_instance where title = 'Dentist'), null,
  '[CAL-10] and its events have none');

select * from finish();
rollback;
