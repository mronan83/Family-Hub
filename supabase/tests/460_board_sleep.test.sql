-- [DEV-07][US-207] Sleep and wake per board (WP-34, D-116, D-117): only valid choices are
-- stored (missed Always, Only while awake or Never; a school night's and a weekend's sleep and wake
-- times; an idle time from a set list); an admin sets their own household's boards only and a board
-- cannot set its own; the board reads its choices and the household's school days in its snapshot.
-- school_days(): a day any member has school; a day off from school is not one; a household with no
-- school year has school Monday to Friday. Its dates are fixed (October 2030), so it holds any day.
begin;
select plan(17);

insert into auth.users (id, email) values
  ('46100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('46300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('46d00000-0000-0000-0000-00000000000a', null),
  ('46d00000-0000-0000-0000-00000000000b', null);
insert into public.household (id, name, timezone, week_start) values
  ('46000000-0000-0000-0000-000000000001', 'Sleepy family', 'America/New_York', 0),
  ('46000000-0000-0000-0000-000000000002', 'Neighbours', 'America/New_York', 0);
insert into public.household_settings (household_id) values
  ('46000000-0000-0000-0000-000000000001'), ('46000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('46000000-0000-0000-0000-000000000001', '46100000-0000-0000-0000-000000000001', 'owner'),
  ('46000000-0000-0000-0000-000000000002', '46300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('46110000-0000-0000-0000-000000000001', '46000000-0000-0000-0000-000000000001', 'Maya', 'child');
insert into public.device (id, household_id, name, auth_user_id, board_config) values
  ('46dd0000-0000-0000-0000-00000000000a', '46000000-0000-0000-0000-000000000001', 'Kitchen',
   '46d00000-0000-0000-0000-00000000000a', '{"theme": "day"}'),
  ('46dd0000-0000-0000-0000-00000000000b', '46000000-0000-0000-0000-000000000001', 'Playroom',
   '46d00000-0000-0000-0000-00000000000b', '{}');
-- The school year: Monday 14 October 2030 is a day off.
insert into public.school_year (id, household_id, name, start_date, end_date, is_default) values
  ('46200000-0000-0000-0000-000000000001', '46000000-0000-0000-0000-000000000001', '2030-31',
   '2030-09-01', '2031-06-30', true);
insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date) values
  ('46000000-0000-0000-0000-000000000001', '46200000-0000-0000-0000-000000000001', 'Teacher day',
   'teacher_day', '2030-10-14', '2030-10-14');

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
create function pg_temp.sleep_of(p_device uuid) returns jsonb language sql as $$
  select board_config -> 'sleep' from public.device where id = p_device
$$;
create function pg_temp.set_sleep(p_device uuid, p_sleep jsonb) returns void language sql as $$
  update public.device set board_config = jsonb_set(board_config, '{sleep}', p_sleep) where id = p_device
$$;

-- Only valid choices ----------------------------------------------------------------------------------
select lives_ok($$ select pg_temp.set_sleep('46dd0000-0000-0000-0000-00000000000b',
                     '{"missed": "awake", "idle_minutes": 15, "schedule": {
                        "school": {"sleep": "21:30", "wake": "06:30"},
                        "weekend": {"sleep": "22:30", "wake": "07:30"}}}');
                   select pg_temp.set_sleep('46dd0000-0000-0000-0000-00000000000b', '{"missed": "never"}');
                   select pg_temp.set_sleep('46dd0000-0000-0000-0000-00000000000b',
                     '{"missed": "always", "schedule": null, "idle_minutes": null}');
                   update public.device set board_config = board_config - 'sleep'
                    where id = '46dd0000-0000-0000-0000-00000000000b' $$,
  '[DEV-07] a board takes the three choices, each optional, or none');
select throws_ok($$ select pg_temp.set_sleep('46dd0000-0000-0000-0000-00000000000a', '{"missed": "sometimes"}') $$,
  '23514', null, '[DEV-07] missed is Always, Only while awake or Never');
select throws_ok($$ select pg_temp.set_sleep('46dd0000-0000-0000-0000-00000000000a', '{"idle_minutes": 7}') $$,
  '23514', null, '[DEV-07] the idle time is one of the set list');
select throws_ok($$ select pg_temp.set_sleep('46dd0000-0000-0000-0000-00000000000a',
                     '{"schedule": {"school": {"sleep": "21:30", "wake": "06:30"}}}') $$,
  '23514', null, '[DEV-07] set times have a school night and a weekend');
select throws_ok($$ select pg_temp.set_sleep('46dd0000-0000-0000-0000-00000000000a',
                     '{"schedule": {"school": {"sleep": "24:30", "wake": "06:30"},
                                    "weekend": {"sleep": "22:30", "wake": "07:30"}}}') $$,
  '23514', null, '[DEV-07] a time is a time of day');
select throws_ok($$ select pg_temp.set_sleep('46dd0000-0000-0000-0000-00000000000a',
                     '{"schedule": {"school": {"sleep": "06:30", "wake": "06:30"},
                                    "weekend": {"sleep": "22:30", "wake": "07:30"}}}') $$,
  '23514', null, '[DEV-07] a board can''t sleep and wake at the same time');
select throws_ok($$ select pg_temp.set_sleep('46dd0000-0000-0000-0000-00000000000a', '{"dim": true}') $$,
  '23514', null, '[DEV-07] and nothing else is kept');

-- Who sets it -------------------------------------------------------------------------------------------
select pg_temp.as_user('46100000-0000-0000-0000-000000000001');
select pg_temp.set_sleep('46dd0000-0000-0000-0000-00000000000a', '{"missed": "awake", "idle_minutes": 10}');
select pg_temp.as_owner();
select is(pg_temp.sleep_of('46dd0000-0000-0000-0000-00000000000a') ->> 'missed', 'awake',
  '[DEV-07][US-207] an admin sets their board''s sleep and wake');
select is((select board_config ->> 'theme' from public.device where id = '46dd0000-0000-0000-0000-00000000000a'), 'day',
  '[DEV-07] beside its theme, which stays');

select pg_temp.as_user('46300000-0000-0000-0000-000000000003');
select pg_temp.set_sleep('46dd0000-0000-0000-0000-00000000000a', '{"missed": "never"}');
select pg_temp.as_owner();
select is(pg_temp.sleep_of('46dd0000-0000-0000-0000-00000000000a') ->> 'missed', 'awake',
  '[DEV-07] an admin of another household cannot');

select pg_temp.as_user('46d00000-0000-0000-0000-00000000000a');
select pg_temp.set_sleep('46dd0000-0000-0000-0000-00000000000a', '{"missed": "never"}');
select pg_temp.as_owner();
select is(pg_temp.sleep_of('46dd0000-0000-0000-0000-00000000000a') ->> 'missed', 'awake',
  '[DEV-07] nor can the board itself');

-- School days -------------------------------------------------------------------------------------------
select pg_temp.as_user('46100000-0000-0000-0000-000000000001');
select is(array(select public.school_days('46000000-0000-0000-0000-000000000001', '2030-10-11', '2030-10-15')),
  array['2030-10-11', '2030-10-15']::date[],
  '[DEV-07][US-207] school days: Friday and Tuesday; the weekend and Monday''s day off are not');
select pg_temp.as_owner();
insert into public.member (household_id, display_name, role) values
  ('46000000-0000-0000-0000-000000000002', 'Ivy', 'child');
select pg_temp.as_user('46300000-0000-0000-0000-000000000003');
select is(array(select public.school_days('46000000-0000-0000-0000-000000000002', '2030-10-11', '2030-10-15')),
  array['2030-10-11', '2030-10-14', '2030-10-15']::date[],
  '[DEV-07] a household with no school year has school Monday to Friday');
select is(array(select public.school_days('46000000-0000-0000-0000-000000000001', '2030-10-11', '2030-10-15')),
  '{}'::date[], '[NFR-04] another household''s school days are not seen');
select throws_ok($$ select public.school_days('46000000-0000-0000-0000-000000000002', '2030-10-15', '2030-10-11') $$,
  '22023', null, '[DEV-07] a range runs forwards');

-- The snapshot ------------------------------------------------------------------------------------------
select pg_temp.as_user('46d00000-0000-0000-0000-00000000000a');
select is(public.board_snapshot() -> 'device' -> 'sleep', '{"missed": "awake", "idle_minutes": 10}'::jsonb,
  '[DEV-07][US-207] the board reads its sleep and wake in its snapshot');
select is(jsonb_build_array(public.board_snapshot() -> 'school_days' -> 'from',
                            public.board_snapshot() -> 'school_days' -> 'to'),
  jsonb_build_array(to_jsonb(private.household_today('46000000-0000-0000-0000-000000000001') - 1),
                    to_jsonb(private.household_today('46000000-0000-0000-0000-000000000001') + 7)),
  '[DEV-07][US-207] with the household''s school days from yesterday to a week ahead');

select * from finish();
rollback;
