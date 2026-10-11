-- [MENU-01..05][MEAL-05] School menus (WP-27, D-79). The done-when's database half: four weeks of
-- menus load from a file, and a feed that fails keeps its cached days and says why. Also: a parent's
-- own day is never replaced by the feed, a day the feed drops goes, clearing a day hands it back to
-- the feed, a child's buy days show their menu, and who may.
begin;
select plan(31);

insert into auth.users (id, email) values
  ('36100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('36300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('36d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('36000000-0000-0000-0000-000000000001', 'Menu family', 'America/Chicago'),
  ('36000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('36000000-0000-0000-0000-000000000001'), ('36000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('36000000-0000-0000-0000-000000000001', '36100000-0000-0000-0000-000000000001', 'owner'),
  ('36000000-0000-0000-0000-000000000002', '36300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('36110000-0000-0000-0000-00000000000a', '36000000-0000-0000-0000-000000000001', 'Maya', 'child'),
  ('36110000-0000-0000-0000-00000000000c', '36000000-0000-0000-0000-000000000001', 'Pat', 'adult');
insert into public.device (id, household_id, name, auth_user_id) values
  ('36dd0000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001', 'Kitchen',
   '36d00000-0000-0000-0000-00000000000d');
insert into public.school_year (household_id, name, start_date, end_date, is_default) values
  ('36000000-0000-0000-0000-000000000001', '2026–27', '2026-09-01', '2027-06-15', true);

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('36100000-0000-0000-0000-000000000001')
$$;
create function pg_temp.service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
end $$;
-- Four school weeks of a file's menus from Monday 1 Feb 2027: one item a day, "Lunch <date>".
create function pg_temp.four_weeks() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('date', d::date,
                                      'items', jsonb_build_array(jsonb_build_object('name', 'Lunch ' || d::date))))
    from generate_series('2027-02-01'::date, '2027-02-26'::date, interval '1 day') d
   where extract(isodow from d) < 6
$$;
create function pg_temp.items(p_source uuid, p_date date) returns text language sql as $$
  select string_agg(i ->> 'name', ', ') from public.school_menu_day d, jsonb_array_elements(d.items) i
   where d.source_id = p_source and d.menu_date = p_date
$$;
-- A feed's fetch of 1 to 5 Feb 2027 with a hash.
create function pg_temp.fetch(p_hash text, p_days jsonb) returns jsonb language sql as $$
  select jsonb_build_object('ok', true, 'content_hash', repeat(p_hash, 64), 'from', '2027-02-01', 'to', '2027-02-05',
                            'days', p_days)
$$;

-- [MENU-01][MENU-02] Sources.
select pg_temp.parent();
create temp table src (name text primary key, id uuid);
grant all on src to public;
insert into src values ('file', public.save_menu_source('36000000-0000-0000-0000-000000000001', null, 'Maple Elementary', 'csv', '{}'));
insert into src values ('feed', public.save_menu_source('36000000-0000-0000-0000-000000000001', null, 'Maple feed', 'nutrislice',
  '{"district": "example-district", "school": "maple-elementary", "menu_type": "lunch", "school_name": "Maple Elementary"}'));
select is((select status from public.menu_source where id = (select id from src where name = 'feed')), 'pending',
          '[MENU-02] a Nutrislice feed waits for its first fetch');
select is((select config from public.menu_source where id = (select id from src where name = 'feed')),
          '{"district": "example-district", "school": "maple-elementary", "menu_type": "lunch", "school_name": "Maple Elementary"}'::jsonb,
          '... with its district, school and menu as picked');
select throws_ok($$ select public.save_menu_source('36000000-0000-0000-0000-000000000001', null, 'Bad', 'nutrislice',
                   '{"district": "https://x", "school": "a", "menu_type": "lunch"}') $$,
                 '22023', null, '... and a district that is not a name in the menu address is refused');
select throws_ok($$ select public.save_menu_source('36000000-0000-0000-0000-000000000001', null, 'Bad', 'csv',
                   '{"district": "a"}') $$,
                 '22023', 'only a feed has settings', '... a file has no settings');
select throws_ok(format($$ select public.save_menu_source('36000000-0000-0000-0000-000000000001', %L, 'Maple', 'manual') $$,
                        (select id from src where name = 'file')),
                 '22023', 'a menu keeps where it comes from', '... and a source keeps its kind');

-- [MENU-03][US-802] done-when: four weeks load from a file.
select is(public.save_menu_days((select id from src where name = 'file'), pg_temp.four_weeks(), 'csv'), 20,
          '[MENU-03][US-802] four weeks of a file load: 20 school days');
select is((select count(*)::int from public.school_menu_day
            where source_id = (select id from src where name = 'file') and origin = 'csv' and is_override), 20,
          '... each from the file, and the parent''s own');
select throws_ok(format($$ select public.save_menu_days(%L, '[{"date": "2027-03-01", "items": []}]', 'manual') $$,
                        (select id from src where name = 'file')),
                 '22023', null, '[US-802] a day has its items, or says no lunch is served');
select is(public.save_menu_days((select id from src where name = 'file'),
                                '[{"date": "2027-02-15", "no_service": true, "note": "Presidents'' Day"}]', 'manual'), 1,
          '... a day typed in: no lunch, with a note');
select is((select no_service::text || ' ' || note || ' ' || origin from public.school_menu_day
            where source_id = (select id from src where name = 'file') and menu_date = '2027-02-15'),
          'true Presidents'' Day manual', '... replaces the file''s day');

-- [MENU-02][MENU-05] The feed's fetch.
select pg_temp.service();
select is((select jsonb_array_length(public.menu_sources_due('36000000-0000-0000-0000-000000000001'))), 1,
          '[MENU-05] the feed is due (never fetched); a file never is');
select is(public.save_menu_fetch((select id from src where name = 'feed'), pg_temp.fetch('a',
  '[{"date": "2027-02-01", "items": [{"name": "Cheese Pizza", "section": "Main Line"}, {"name": "1% Milk", "section": "Beverages"}]},
    {"date": "2027-02-02", "items": [{"name": "Tacos"}]},
    {"date": "2027-02-03", "items": [{"name": "Pasta"}]}]')) ->> 'status', 'fetched',
          '[MENU-02] the feed''s first fetch stores its days');
select is(pg_temp.items((select id from src where name = 'feed'), '2027-02-01'), 'Cheese Pizza, 1% Milk',
          '... a day''s items in order');
select is((select jsonb_array_length(public.menu_sources_due('36000000-0000-0000-0000-000000000001'))), 0,
          '[MENU-05] fetched: not due again until tomorrow');
select is((select jsonb_array_length(public.menu_sources_due('36000000-0000-0000-0000-000000000001', now() + interval '1 day'))), 1,
          '... and due a day later');

-- [MENU-03] A parent's own day survives the feed.
select pg_temp.parent();
select public.save_menu_days((select id from src where name = 'feed'), '[{"date": "2027-02-02", "items": [{"name": "Field trip: bring lunch"}]}]', 'manual');
select pg_temp.service();
select is(public.save_menu_fetch((select id from src where name = 'feed'), pg_temp.fetch('b',
  '[{"date": "2027-02-01", "items": [{"name": "Hawaiian Pizza"}]},
    {"date": "2027-02-02", "items": [{"name": "Tacos"}]}]')) - 'status',
          '{"days": 1, "kept": 1}'::jsonb, '[MENU-03] the next fetch replaces the feed''s day, keeps the parent''s');
select is(pg_temp.items((select id from src where name = 'feed'), '2027-02-01'), 'Hawaiian Pizza', '... the feed''s day changed');
select is(pg_temp.items((select id from src where name = 'feed'), '2027-02-02'), 'Field trip: bring lunch',
          '... the parent''s day as they wrote it');
select is(pg_temp.items((select id from src where name = 'feed'), '2027-02-03'), null,
          '... and a day the feed no longer has is gone');

-- [MENU-04][US-803] done-when: a failing feed keeps its cached days and says why.
select is(public.save_menu_fetch((select id from src where name = 'feed'),
                                 '{"ok": false, "error": "Nutrislice answered 503."}') ->> 'status', 'error',
          '[MENU-04][US-803] a fetch that fails');
select is((select status || ': ' || last_error from public.menu_source where id = (select id from src where name = 'feed')),
          'error: Nutrislice answered 503.', '... shows its error');
select ok((select last_success_at is not null from public.menu_source where id = (select id from src where name = 'feed')),
          '... with when it last worked');
select is(pg_temp.items((select id from src where name = 'feed'), '2027-02-01'), 'Hawaiian Pizza', '... and the cached menu stays');
select is(public.save_menu_fetch((select id from src where name = 'feed'),
                                 jsonb_build_object('ok', true, 'unchanged', true, 'content_hash', repeat('b', 64))) ->> 'status',
          'unchanged', '[MENU-05] the same menus next time: nothing rewritten, and it is fine again');

-- Clearing a day hands it back to the feed: the next fetch is not skipped as unchanged.
select pg_temp.parent();
select public.clear_menu_day((select id from src where name = 'feed'), '2027-02-02');
select is((select content_hash from public.menu_source where id = (select id from src where name = 'feed')), null,
          '[MENU-03] clearing the parent''s day hands it back to the feed: the next fetch rewrites');

-- [MEAL-05][US-704] Maya's buy days show her menu.
select public.set_lunch_defaults('36110000-0000-0000-0000-00000000000a', '{"mon": "buy"}');
select public.set_child_menu('36110000-0000-0000-0000-00000000000a', (select id from src where name = 'feed'));
select is((select d -> 'menu' -> 'items' -> 0 ->> 'name'
             from jsonb_array_elements(public.lunch_week('36000000-0000-0000-0000-000000000001', '2027-02-01') -> 0 -> 'days') d
            where d ->> 'date' = '2027-02-01'), 'Hawaiian Pizza', '[MEAL-05][US-704] her Monday, a buy day, shows the menu');
select is((select d -> 'menu'
             from jsonb_array_elements(public.lunch_week('36000000-0000-0000-0000-000000000001', '2027-02-01') -> 0 -> 'days') d
            where d ->> 'date' = '2027-02-03'), 'null'::jsonb, '... a bring day doesn''t');
select throws_ok($$ select public.set_child_menu('36110000-0000-0000-0000-00000000000c', null) $$,
                 '22023', 'school lunch is a child''s', '[MENU-01] a menu is for a child''s school lunch');

-- Who may.
select pg_temp.as_user('36300000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.school_menu_day), 0, 'another household''s parent sees no menus');
select throws_ok(format($$ select public.save_menu_days(%L, '[{"date": "2027-03-01", "no_service": true}]', 'manual') $$,
                        (select id from src where name = 'file')),
                 '42501', 'not allowed', '... and can''t change them');
select pg_temp.as_user('36d00000-0000-0000-0000-00000000000d');
select is((select count(*)::int from public.school_menu_day), 21, 'the family''s board reads its menus (for WP-28)');

select * from finish();
rollback;
