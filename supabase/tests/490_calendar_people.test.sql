-- [CAL-09][US-508] A calendar for one or more people (WP-50, D-122). A calendar's people are a list:
-- none is the whole family; a board reads them in its own order; only the household's admins write
-- them, and only its admins and boards read them. The contract (member_id gone, the guard before it) is
-- in 500_calendar_people_contract.
begin;
set local client_min_messages = warning;
select plan(13);

-- Vault stand-in (as in 260_calendar_sync), for adding a calendar.
create schema if not exists vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique,
                            description text, secret text not null);
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '',
                                    new_key_id uuid default null) returns uuid language sql as $$
  insert into vault.secrets (name, description, secret) values (new_name, new_description, new_secret) returning id
$$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null,
                                    new_description text default null, new_key_id uuid default null) returns void
language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id
$$;

insert into auth.users (id, email) values
  ('49100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('49300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('49d00000-0000-0000-0000-00000000000a', null);
insert into public.household (id, name, timezone, week_start) values
  ('49000000-0000-0000-0000-000000000001', 'People family', 'America/New_York', 0),
  ('49000000-0000-0000-0000-000000000002', 'Neighbours', 'America/New_York', 0);
insert into public.household_settings (household_id) values
  ('49000000-0000-0000-0000-000000000001'), ('49000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('49000000-0000-0000-0000-000000000001', '49100000-0000-0000-0000-000000000001', 'owner'),
  ('49000000-0000-0000-0000-000000000002', '49300000-0000-0000-0000-000000000003', 'owner');
-- Made-up people: two children and an adult, and a neighbour's child.
insert into public.member (id, household_id, display_name, role) values
  ('49110000-0000-0000-0000-00000000000a', '49000000-0000-0000-0000-000000000001', 'Robin', 'adult'),
  ('49110000-0000-0000-0000-00000000000b', '49000000-0000-0000-0000-000000000001', 'Zoe', 'child'),
  ('49110000-0000-0000-0000-00000000000c', '49000000-0000-0000-0000-000000000001', 'Ivy', 'child'),
  ('49110000-0000-0000-0000-00000000000d', '49000000-0000-0000-0000-000000000002', 'Nell', 'child');
insert into public.device (id, household_id, name, auth_user_id) values
  ('49dd0000-0000-0000-0000-00000000000a', '49000000-0000-0000-0000-000000000001', 'Kitchen',
   '49d00000-0000-0000-0000-00000000000a');
-- Two calendars: Robin's and the family's.
insert into public.calendar_source (id, household_id, name, url_secret_id) values
  ('49ca0000-0000-0000-0000-000000000001', '49000000-0000-0000-0000-000000000001', 'Work', gen_random_uuid()),
  ('49ca0000-0000-0000-0000-000000000002', '49000000-0000-0000-0000-000000000001', 'Family', gen_random_uuid());
insert into public.calendar_member (household_id, calendar_id, member_id) values
  ('49000000-0000-0000-0000-000000000001', '49ca0000-0000-0000-0000-000000000001', '49110000-0000-0000-0000-00000000000a');

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
create function pg_temp.people(p_calendar uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(member_id order by member_id), '{}') from public.calendar_member where calendar_id = p_calendar
$$;
create function pg_temp.board_people(p_name text) returns jsonb language sql as $$
  select c -> 'member_ids'
    from jsonb_array_elements(public.board_calendar((now() at time zone 'America/New_York')::date,
                                                    (now() at time zone 'America/New_York')::date) -> 'calendars') c
   where c ->> 'name' = p_name
$$;

-- An admin gives a calendar two people, then the whole family, then one.
select pg_temp.as_user('49100000-0000-0000-0000-000000000001');
select is(public.save_calendar('49000000-0000-0000-0000-000000000001', '49ca0000-0000-0000-0000-000000000002',
            'Family', null, 'member-6',
            array['49110000-0000-0000-0000-00000000000b', '49110000-0000-0000-0000-00000000000c']::uuid[], true),
  '49ca0000-0000-0000-0000-000000000002'::uuid, '[CAL-09-a] an admin gives a calendar two people');
select is(pg_temp.people('49ca0000-0000-0000-0000-000000000002'),
  array['49110000-0000-0000-0000-00000000000b', '49110000-0000-0000-0000-00000000000c']::uuid[],
  '[CAL-09-a] both are on it');
select ok((select public.save_calendar('49000000-0000-0000-0000-000000000001', null, 'Kids', 'https://example.com/kids.ics',
            'member-3', array['49110000-0000-0000-0000-00000000000b', '49110000-0000-0000-0000-00000000000c']::uuid[], true)
           is not null), '[CAL-09-a] a calendar added for two people');
select is(pg_temp.people((select id from public.calendar_source where name = 'Kids')),
  array['49110000-0000-0000-0000-00000000000b', '49110000-0000-0000-0000-00000000000c']::uuid[],
  '[CAL-09-a] and both are on the new one');
select throws_ok($$ select public.save_calendar('49000000-0000-0000-0000-000000000001',
                      '49ca0000-0000-0000-0000-000000000002', 'Family', null, 'member-6',
                      array['49110000-0000-0000-0000-00000000000d']::uuid[], true) $$,
  '23503', null, '[CAL-09-a] someone from another family can''t be given a calendar');

-- On the board: both, in the board's order (children first, then by name); the family's has none.
select pg_temp.as_user('49d00000-0000-0000-0000-00000000000a');
select is(pg_temp.board_people('Family'),
  '["49110000-0000-0000-0000-00000000000c", "49110000-0000-0000-0000-00000000000b"]'::jsonb,
  '[CAL-09-b][US-508] a board reads a calendar''s two people, Ivy then Zoe');
select is(pg_temp.board_people('Work'), '["49110000-0000-0000-0000-00000000000a"]'::jsonb,
  '[CAL-09-b] and a calendar''s one person');

-- An archived person stays on the calendar through a save; the board leaves them out until restored.
select pg_temp.as_owner();
update public.member set archived_at = now() where id = '49110000-0000-0000-0000-00000000000c';
select pg_temp.as_user('49100000-0000-0000-0000-000000000001');
select public.save_calendar('49000000-0000-0000-0000-000000000001', '49ca0000-0000-0000-0000-000000000002',
  'Family', null, 'member-6', array['49110000-0000-0000-0000-00000000000b']::uuid[], true);
select is(pg_temp.people('49ca0000-0000-0000-0000-000000000002'),
  array['49110000-0000-0000-0000-00000000000b', '49110000-0000-0000-0000-00000000000c']::uuid[],
  '[CAL-09-a] an archived person stays on a calendar saved without them');
select pg_temp.as_user('49d00000-0000-0000-0000-00000000000a');
select is(pg_temp.board_people('Family'), '["49110000-0000-0000-0000-00000000000b"]'::jsonb,
  '[CAL-09-b] a board leaves an archived person out');

-- The whole family: no one, the archived person too.
select pg_temp.as_user('49100000-0000-0000-0000-000000000001');
select public.save_calendar('49000000-0000-0000-0000-000000000001', '49ca0000-0000-0000-0000-000000000002',
  'Family', null, 'member-6', '{}'::uuid[], true);
select is(pg_temp.people('49ca0000-0000-0000-0000-000000000002'), '{}'::uuid[],
  '[CAL-09-a] the whole family is no one on it');

-- One person again.
select public.save_calendar('49000000-0000-0000-0000-000000000001', '49ca0000-0000-0000-0000-000000000002',
  'Family', null, 'member-6', array['49110000-0000-0000-0000-00000000000b']::uuid[], true);

-- A person removed for good leaves it; with no one left it is the whole family's.
select pg_temp.as_owner();
delete from public.member where id = '49110000-0000-0000-0000-00000000000b';
select is(pg_temp.people('49ca0000-0000-0000-0000-000000000002'), '{}'::uuid[],
  '[CAL-09-a] a person removed for good leaves the calendar');

-- Only the household's admins write it, and the neighbours read none of it.
select pg_temp.as_user('49300000-0000-0000-0000-000000000003');
select throws_ok($$ select public.save_calendar('49000000-0000-0000-0000-000000000001',
                      '49ca0000-0000-0000-0000-000000000001', 'Work', null, 'member-6', '{}'::uuid[], true) $$,
  '42501', null, '[CAL-09-a] another family''s admin can''t change it');
select is((select count(*)::integer from public.calendar_member), 0, '[CAL-09-a] another family reads none of its people');

select * from finish();
rollback;
