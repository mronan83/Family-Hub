-- [BRD-04][US-1003] Weather on the board (WP-45, D-69). An admin sets the household's place, kept to
-- about a kilometre, and °F or °C; the weather job (or an admin's save) stores each read; a board
-- reads the last good one in its snapshot while the last read worked and is recent, and none
-- otherwise. A layout can turn the weather off.
begin;
select plan(37);

insert into auth.users (id, email) values
  ('29100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('29300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('29d00000-0000-0000-0000-00000000000a', null),
  ('29d00000-0000-0000-0000-00000000000c', null);
insert into public.household (id, name, timezone, week_start) values
  ('29000000-0000-0000-0000-000000000001', 'Weather family', 'America/Chicago', 0),
  ('29000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago', 0);
insert into public.household_settings (household_id) values
  ('29000000-0000-0000-0000-000000000001'), ('29000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('29000000-0000-0000-0000-000000000001', '29100000-0000-0000-0000-000000000001', 'owner'),
  ('29000000-0000-0000-0000-000000000002', '29300000-0000-0000-0000-000000000003', 'owner');
insert into public.device (id, household_id, name, auth_user_id, board_config) values
  ('29dd0000-0000-0000-0000-00000000000a', '29000000-0000-0000-0000-000000000001', 'Kitchen',
   '29d00000-0000-0000-0000-00000000000a', '{}'),
  ('29dd0000-0000-0000-0000-00000000000c', '29000000-0000-0000-0000-000000000002', 'Porch',
   '29d00000-0000-0000-0000-00000000000c', '{}');

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_parent() returns void language sql as $$ select pg_temp.as_user('29100000-0000-0000-0000-000000000001') $$;
create function pg_temp.as_neighbour() returns void language sql as $$ select pg_temp.as_user('29300000-0000-0000-0000-000000000003') $$;
create function pg_temp.as_kitchen() returns void language sql as $$ select pg_temp.as_user('29d00000-0000-0000-0000-00000000000a') $$;
create function pg_temp.as_porch() returns void language sql as $$ select pg_temp.as_user('29d00000-0000-0000-0000-00000000000c') $$;
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
-- A good read for the family's place, in °F, for the place's today.
create function pg_temp.good(p_temp numeric default 54.3, p_lat numeric default 39.78,
                             p_unit text default 'fahrenheit') returns jsonb language sql as $$
  select jsonb_build_object('ok', true, 'latitude', p_lat, 'longitude', -89.65, 'unit', p_unit,
    'temperature', p_temp, 'high', 61.24, 'low', 48, 'weather_code', 3, 'is_day', true,
    'for_date', private.household_today('29000000-0000-0000-0000-000000000001'),
    'observed_at', now() - interval '10 minutes')
$$;
-- The snapshot's weather; JSON null (no weather) as SQL null.
create function pg_temp.weather() returns jsonb language sql as $$
  select nullif(public.board_snapshot() -> 'weather', 'null'::jsonb)
$$;

-- The place ------------------------------------------------------------------------------------------
select is((select temperature_unit from public.household_settings
            where household_id = '29000000-0000-0000-0000-000000000001'), 'fahrenheit',
  '[BRD-04] a household starts in °F, with no place');
select throws_ok($$ update public.household_settings set weather_place = 'Springfield'
                     where household_id = '29000000-0000-0000-0000-000000000001' $$,
  '23514', null, '[BRD-04] a place has its latitude and longitude, or none of the three');

select pg_temp.as_parent();
select lives_ok($$ select public.set_weather_place('29000000-0000-0000-0000-000000000001',
                    ' Springfield, Illinois ', 39.78173, -89.65015) $$,
  '[BRD-04][US-1003] an admin sets the household''s place');
select results_eq($$ select weather_place, weather_latitude, weather_longitude from public.household_settings
                      where household_id = '29000000-0000-0000-0000-000000000001' $$,
  $$ values ('Springfield, Illinois'::text, 39.78::numeric(5,2), -89.65::numeric(5,2)) $$,
  '[BRD-04] kept to two decimals (about a kilometre), its name trimmed');
select throws_ok($$ select public.set_weather_place('29000000-0000-0000-0000-000000000001', 'Nowhere', 95, 10) $$,
  '22023', 'not a place', '[BRD-04] a latitude past the poles is not a place');
select throws_ok($$ select public.set_weather_place('29000000-0000-0000-0000-000000000001', 'Nowhere', null, 10) $$,
  '22023', 'not a place', '[BRD-04] nor a place without coordinates');
select throws_ok($$ select public.set_temperature_unit('29000000-0000-0000-0000-000000000001', 'kelvin') $$,
  '22023', 'not a temperature unit', '[BRD-04] °F or °C only');
select throws_ok($$ select public.set_weather_place('29000000-0000-0000-0000-000000000002', 'Springfield', 39.78, -89.65) $$,
  '42501', 'not allowed', '[NFR-08] not another household''s place');

select pg_temp.as_kitchen();
select throws_ok($$ select public.set_weather_place('29000000-0000-0000-0000-000000000001', 'Springfield', 39.78, -89.65) $$,
  '42501', 'not allowed', '[BRD-04] a board doesn''t set the place');
select throws_ok($$ select public.save_weather('29000000-0000-0000-0000-000000000001', pg_temp.good()) $$,
  '42501', 'not allowed', '[BRD-04] nor store a read: it only ever reads the snapshot');
select is(pg_temp.weather(), null, '[BRD-04] no read yet, no weather on the board');

-- Reads ----------------------------------------------------------------------------------------------
select pg_temp.as_job();
select is(public.save_weather('29000000-0000-0000-0000-000000000001', pg_temp.good()) ->> 'status', 'ok',
  '[BRD-04] the weather job stores a read');
select is(public.save_weather('29000000-0000-0000-0000-000000000002', pg_temp.good()) ->> 'status', 'no_place',
  '[BRD-04] a household with no place stores nothing');
select throws_ok($$ select public.save_weather('29000000-0000-0000-0000-000000000001',
                    pg_temp.good() || '{"temperature": "warm"}') $$,
  '22023', 'not a weather read', '[BRD-04] a read is numbers, as the service sends them');
select throws_ok($$ select public.save_weather('29000000-0000-0000-0000-000000000001',
                    pg_temp.good() || '{"weather_code": 140}') $$,
  '22023', 'not a weather read', '[BRD-04] with a WMO weather code');

select pg_temp.as_kitchen();
select is(pg_temp.weather() - 'read_at' - 'for_date',
  '{"temperature": 54.3, "high": 61.2, "low": 48.0, "code": 3, "day": true, "unit": "fahrenheit"}'::jsonb,
  '[BRD-04][US-1003] the board''s snapshot carries the temperature now, today''s high and low, and the sky');
select is((pg_temp.weather() ->> 'for_date')::date, private.household_today('29000000-0000-0000-0000-000000000001'),
  '[BRD-04] for the place''s today, so a board offline overnight can tell yesterday''s');
select pg_temp.as_porch();
select is(pg_temp.weather(), null, '[NFR-08] another household''s board sees none of it');
select is((select count(*)::int from public.weather_reading), 0, '[NFR-08] not even the row');

select pg_temp.as_job();
select is(public.save_weather('29000000-0000-0000-0000-000000000001', pg_temp.good(60, 41.88)) ->> 'status', 'stale',
  '[BRD-04] a read for a place the household no longer has is dropped');
select is(public.save_weather('29000000-0000-0000-0000-000000000001', pg_temp.good(16, 39.78, 'celsius')) ->> 'status', 'stale',
  '[BRD-04] and one in the other unit');

-- The source failing ---------------------------------------------------------------------------------
select is(public.save_weather('29000000-0000-0000-0000-000000000001',
            '{"ok": false, "error": "The weather service answered 503 (Service Unavailable)."}') ->> 'status', 'error',
  '[BRD-04] a read that fails is recorded');
select results_eq($$ select temperature, error from public.weather_reading
                      where household_id = '29000000-0000-0000-0000-000000000001' $$,
  $$ values (54.3::numeric(4,1), 'The weather service answered 503 (Service Unavailable).'::text) $$,
  '[BRD-04] the last good values stay, marked, with why');
select pg_temp.as_kitchen();
select is(pg_temp.weather(), null, '[BRD-04][US-1003] the source failing: the board shows no weather');
select ok(public.board_snapshot() ? 'members' and public.board_snapshot() ? 'calendar',
  '[BRD-04] and the rest of its snapshot is as before');
select pg_temp.as_job();
select public.save_weather('29000000-0000-0000-0000-000000000001', pg_temp.good(55.1));
select pg_temp.as_kitchen();
select is((pg_temp.weather() ->> 'temperature')::numeric, 55.1, '[BRD-04] the next good read brings it back');

select pg_temp.as_owner();
update public.weather_reading set read_at = now() - interval '76 minutes'
 where household_id = '29000000-0000-0000-0000-000000000001';
select pg_temp.as_kitchen();
select is(pg_temp.weather(), null, '[BRD-04] a read over 75 minutes old (two missed) shows no weather either');

-- The parent sees how the last read went (Home) ------------------------------------------------------
select pg_temp.as_parent();
select is((select count(*)::int from public.weather_reading
            where household_id = '29000000-0000-0000-0000-000000000001'), 1,
  '[BRD-04] an admin reads the household''s last read');
select pg_temp.as_neighbour();
select is((select count(*)::int from public.weather_reading), 0, '[NFR-08] and no other household''s');

-- Changing the unit or the place ---------------------------------------------------------------------
select pg_temp.as_parent();
select public.set_temperature_unit('29000000-0000-0000-0000-000000000001', 'celsius');
select is((select count(*)::int from public.weather_reading
            where household_id = '29000000-0000-0000-0000-000000000001'), 0,
  '[BRD-04] °C instead: the °F read goes, until the next read in °C');
select pg_temp.as_job();
select is(public.save_weather('29000000-0000-0000-0000-000000000001', pg_temp.good(12.4, 39.78, 'celsius')) ->> 'status', 'ok',
  '[BRD-04] which is stored');
select pg_temp.as_parent();
select public.set_weather_place('29000000-0000-0000-0000-000000000001', 'Springfield, Illinois', 39.781, -89.649);
select is((select count(*)::int from public.weather_reading
            where household_id = '29000000-0000-0000-0000-000000000001'), 1,
  '[BRD-04] the same place again (to two decimals) keeps the read');
select public.set_weather_place('29000000-0000-0000-0000-000000000001', 'Chicago, Illinois', 41.88, -87.63);
select is((select count(*)::int from public.weather_reading
            where household_id = '29000000-0000-0000-0000-000000000001'), 0,
  '[BRD-04] a new place drops the old place''s read');
select public.set_weather_place('29000000-0000-0000-0000-000000000001', null, null, null);
select results_eq($$ select weather_place, weather_latitude, weather_longitude from public.household_settings
                      where household_id = '29000000-0000-0000-0000-000000000001' $$,
  $$ values (null::text, null::numeric(5,2), null::numeric(5,2)) $$,
  '[BRD-04] and no place clears it');

-- The layout and live updates ------------------------------------------------------------------------
select pg_temp.as_owner();
select ok(private.valid_board_layout('{"weather": false, "calendar": "5"}')
          and not private.valid_board_layout('{"weather": "no"}'),
  '[BRD-04][BRD-05] a layout may turn the weather off, as a boolean');
select ok(exists (select from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'weather_reading'),
  '[BRD-04][DEV-05] a new read reaches the boards at once');
select ok(not has_table_privilege('authenticated', 'public.weather_reading', 'insert')
          and not has_table_privilege('authenticated', 'public.weather_reading', 'update'),
  '[BRD-04] reads are stored only through save_weather');

select * from finish();
rollback;
