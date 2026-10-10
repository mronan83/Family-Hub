-- [CAL-01][CAL-02][CAL-03][CAL-06][CAL-07] Calendar sync (WP-22, D-63). The link lives only in Vault
-- and only the job reads it back; admins change calendars only through their functions; a sync
-- stores events and instances with all-day ones as household-local dates; the same file is skipped;
-- a failure keeps the last good events; a calendar's household alone sees it. Vault exists only on
-- hosted Supabase, so this test creates a stand-in for it inside its own transaction.
begin;
set local client_min_messages = warning;
select plan(56);

-- Vault stand-in: the functions and view the migration uses, with Supabase's signatures. Only the
-- owner can reach the schema, as on Supabase.
create schema if not exists vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique,
                            description text, secret text not null);
create view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret from vault.secrets;
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
  ('26100000-0000-0000-0000-000000000001', 'pat@example.com'),
  ('26300000-0000-0000-0000-000000000003', 'neighbour@example.com');
insert into public.household (id, name, timezone) values
  ('26000000-0000-0000-0000-000000000001', 'Calendar family', 'America/New_York'),
  ('26000000-0000-0000-0000-000000000002', 'Neighbours', 'America/New_York');
insert into public.household_user (household_id, user_id, role) values
  ('26000000-0000-0000-0000-000000000001', '26100000-0000-0000-0000-000000000001', 'owner'),
  ('26000000-0000-0000-0000-000000000002', '26300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('26110000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-000000000001', 'Pat', 'adult',
   '26100000-0000-0000-0000-000000000001');

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
create temp table cal (id uuid, other uuid);
grant all on cal to public;
create function pg_temp.cal() returns uuid language sql as $$ select id from cal $$;
create function pg_temp.instances() returns text language sql as $$
  select coalesce(string_agg(i.title || ' ' || i.local_start_date || '..' || i.local_end_date
                             || case when i.changed then ' moved' else '' end, '; '
                             order by i.instance_start, i.title), '')
    from public.calendar_event_instance i where i.source_id = (select id from cal)
$$;

-- A made-up sync of a calendar in New York: a weekly series across the November clock change with
-- one instance moved, a late event past midnight, one ending at midnight, and a four-day trip.
create function pg_temp.result(p_hash text) returns jsonb language sql as $$
  select jsonb_build_object('ok', true, 'etag', '"e1"', 'content_hash', p_hash,
    'events', jsonb_build_array(
      jsonb_build_object('uid', 'swim@test', 'title', 'Swim', 'start', '2026-10-20T21:00:00.000Z',
                         'end', '2026-10-20T22:00:00.000Z', 'all_day', false, 'tz', 'America/New_York',
                         'rrule', 'FREQ=WEEKLY;COUNT=4'),
      jsonb_build_object('uid', 'swim@test', 'recurrence_id', '2026-10-27T21:00:00.000Z', 'title', 'Swim',
                         'start', '2026-10-28T21:00:00.000Z', 'end', '2026-10-28T22:00:00.000Z',
                         'all_day', false, 'tz', 'America/New_York'),
      jsonb_build_object('uid', 'late@test', 'title', 'Late', 'start', '2026-10-21T03:30:00.000Z',
                         'end', '2026-10-21T04:30:00.000Z', 'all_day', false),
      jsonb_build_object('uid', 'midnight@test', 'title', 'Ends at midnight', 'start', '2026-10-22T02:00:00.000Z',
                         'end', '2026-10-22T04:00:00.000Z', 'all_day', false),
      jsonb_build_object('uid', 'trip@test', 'title', 'Trip', 'start', '2026-11-26', 'end', '2026-11-30',
                         'all_day', true)),
    'instances', jsonb_build_array(
      jsonb_build_object('uid', 'swim@test', 'title', 'Swim', 'start', '2026-10-20T21:00:00.000Z',
                         'end', '2026-10-20T22:00:00.000Z', 'all_day', false),
      jsonb_build_object('uid', 'swim@test', 'recurrence_id', '2026-10-27T21:00:00.000Z', 'title', 'Swim',
                         'start', '2026-10-28T21:00:00.000Z', 'end', '2026-10-28T22:00:00.000Z',
                         'all_day', false, 'changed', true),
      jsonb_build_object('uid', 'swim@test', 'title', 'Swim', 'start', '2026-11-03T22:00:00.000Z',
                         'end', '2026-11-03T23:00:00.000Z', 'all_day', false),
      jsonb_build_object('uid', 'late@test', 'title', 'Late', 'start', '2026-10-21T03:30:00.000Z',
                         'end', '2026-10-21T04:30:00.000Z', 'all_day', false),
      jsonb_build_object('uid', 'midnight@test', 'title', 'Ends at midnight', 'start', '2026-10-22T02:00:00.000Z',
                         'end', '2026-10-22T04:00:00.000Z', 'all_day', false),
      jsonb_build_object('uid', 'trip@test', 'title', 'Trip', 'start', '2026-11-26', 'end', '2026-11-30',
                         'all_day', true)))
$$;
create function pg_temp.hash(p_n int) returns text language sql as $$ select repeat(p_n::text, 64) $$;

-- [CAL-01] Connecting ---------------------------------------------------------------------------
select pg_temp.as_user('26100000-0000-0000-0000-000000000001');
insert into cal (id) values (public.save_calendar_source('26000000-0000-0000-0000-000000000001', null, 'Family',
  'https://p01-caldav.icloud.com/published/2/made-up-link', 'member-3', '26110000-0000-0000-0000-00000000000a', true));
select isnt(pg_temp.cal(), null, '[CAL-01] an admin connects a calendar by its link');
select results_eq($$ select name, color, member_id, show_on_board, status from public.calendar_source $$,
  $$ values ('Family'::text, 'member-3'::text, '26110000-0000-0000-0000-00000000000a'::uuid, true, 'pending'::text) $$,
  '[CAL-01] it is listed with its color and person, not synced yet');
select throws_ok($$ select decrypted_secret from vault.decrypted_secrets $$, '42501', null,
  '[CAL-01] an admin cannot read Vault');
select throws_ok($$ select public.calendar_sources_due('26000000-0000-0000-0000-000000000001') $$, '42501', null,
  '[CAL-01] nor ask for the links the job reads');
select throws_ok($$ insert into public.calendar_source (household_id, name, url_secret_id)
                    values ('26000000-0000-0000-0000-000000000001', 'Sneaky', gen_random_uuid()) $$, '42501', null,
  '[CAL-03] calendars change only through their functions: no insert');
select throws_ok($$ update public.calendar_source set status = 'ok' $$, '42501', null, '[CAL-03] no update');
select throws_ok($$ delete from public.calendar_event_instance $$, '42501', null,
  '[CAL-03] and no event or instance is changed by hand');
select throws_ok($$ select public.save_calendar_source('26000000-0000-0000-0000-000000000001', null, 'Plain',
                      'http://example.com/a.ics', 'member-1', null, true) $$, '22023', null,
  '[CAL-01] a link that is not https is refused');
select throws_ok($$ select public.save_calendar_source('26000000-0000-0000-0000-000000000001', null, 'No link',
                      null, 'member-1', null, true) $$, '22023', null, '[CAL-01] a new calendar needs its link');

select pg_temp.as_owner();
select is((select d.decrypted_secret from vault.decrypted_secrets d
             join public.calendar_source s on s.url_secret_id = d.id where s.id = pg_temp.cal()),
  'https://p01-caldav.icloud.com/published/2/made-up-link', '[CAL-01] the link is in Vault');
select is((select count(*) from public.calendar_source s where to_jsonb(s)::text like '%made-up-link%'), 0::bigint,
  '[CAL-01] and not in the calendar''s row');
select is((select count(*) from public.audit_log a where a.diff::text like '%made-up-link%'), 0::bigint,
  '[CAL-01] nor in the audit log');
select is((select count(*) from public.audit_log where entity_type = 'calendar_source' and action = 'insert'), 1::bigint,
  '[ACC-05] connecting a calendar is audited');

-- Another household ------------------------------------------------------------------------------
select pg_temp.as_user('26300000-0000-0000-0000-000000000003');
select is((select count(*) from public.calendar_source), 0::bigint, '[NFR-04] another household sees no calendar');
select throws_ok($$ select public.save_calendar_source('26000000-0000-0000-0000-000000000001', pg_temp.cal(), 'Mine',
                      null, 'member-1', null, true) $$, '42501', null, '[NFR-04] nor changes one');
select throws_ok($$ select public.save_calendar_sync(pg_temp.cal(), '{"ok": false, "error": "x"}') $$, '42501', null,
  '[NFR-04] nor stores a sync for it');
select throws_ok($$ select public.remove_calendar_source(pg_temp.cal()) $$, 'P0002', null, '[NFR-04] nor removes it');

-- [CAL-02] The job finds it with its link ------------------------------------------------------
select pg_temp.as_job();
select is(public.calendar_sources_due('26000000-0000-0000-0000-000000000001'),
  jsonb_build_array(jsonb_build_object('id', pg_temp.cal(), 'name', 'Family', 'content_hash', null,
                                       'timezone', 'America/New_York',
                                       'url', 'https://p01-caldav.icloud.com/published/2/made-up-link')),
  '[CAL-02] the job gets the calendars due, each with its link and the household''s zone');
select is(public.calendar_sources_due('26000000-0000-0000-0000-000000000002'), '[]'::jsonb,
  '[CAL-02] and only the household''s own');

-- [CAL-07] A first sync (an admin saving the link syncs it at once, D-63) -----------------------
select pg_temp.as_user('26100000-0000-0000-0000-000000000001');
select is(public.save_calendar_sync(pg_temp.cal(), pg_temp.result(pg_temp.hash(1))),
  '{"status": "synced", "events": 5, "instances": 6}'::jsonb, '[CAL-02] a sync stores its events and instances');
select is(pg_temp.instances(),
  'Swim 2026-10-20..2026-10-20; Late 2026-10-20..2026-10-21; Ends at midnight 2026-10-21..2026-10-21; '
  'Swim 2026-10-28..2026-10-28 moved; Swim 2026-11-03..2026-11-03; Trip 2026-11-26..2026-11-29',
  '[CAL-07] each instance on its household-local days: past midnight it covers two, ending at midnight one');
select is((select instance_start from public.calendar_event_instance where title = 'Trip'),
  '2026-11-26 00:00 America/New_York'::timestamptz,
  '[CAL-07] an all-day event starts at the household''s midnight, its dates as written');
select is((select (instance_start at time zone 'America/New_York')::time from public.calendar_event_instance
            where title = 'Swim' and local_start_date = '2026-11-03'), '17:00'::time,
  '[CAL-07] the series keeps 5 pm after the clocks change');
select is((select e.recurrence_id from public.calendar_event_instance i join public.calendar_event e on e.id = i.event_id
            where i.changed), '2026-10-27T21:00:00.000Z',
  '[CAL-07] the moved instance belongs to its own event, the one that moved it');
select is((select count(distinct event_id) from public.calendar_event_instance where title = 'Swim' and not changed),
  1::bigint, '[CAL-07] the others to the series');
select results_eq($$ select status, last_error, content_hash, etag, last_success_at is not null
                       from public.calendar_source $$,
  $$ values ('ok'::text, null::text, repeat('1', 64), '"e1"'::text, true) $$,
  '[CAL-06] the calendar is OK, with what it synced');
select is((select count(*) from public.audit_log where entity_type = 'calendar_source'), 1::bigint,
  '[ACC-05] a sync''s bookkeeping is not audited');

select pg_temp.as_job();
select is(jsonb_array_length(public.calendar_sources_due('26000000-0000-0000-0000-000000000001')), 0,
  '[CAL-02] just synced, it is not due');
select is(jsonb_array_length(public.calendar_sources_due('26000000-0000-0000-0000-000000000001',
                                                         now() + interval '12 minutes')), 1,
  '[CAL-02] 12 minutes later it is, so a call every 15 minutes syncs it every time');

-- The same file ----------------------------------------------------------------------------------
select is(public.save_calendar_sync(pg_temp.cal(), jsonb_build_object('ok', true, 'unchanged', true,
                                    'content_hash', pg_temp.hash(1), 'etag', '"e1"')),
  '{"status": "unchanged"}'::jsonb, '[CAL-02] the same file, day and zone is skipped');
select is((select count(*) from public.calendar_event_instance), 6::bigint, '[CAL-02] and its events stay');
select throws_ok($$ select public.save_calendar_sync(pg_temp.cal(), jsonb_build_object('ok', true, 'unchanged', true,
                      'content_hash', pg_temp.hash(2))) $$, '22023', null,
  '[CAL-02] "unchanged" since another version is refused');

-- [CAL-06] A failure keeps the last good events ---------------------------------------------------
select pg_temp.as_owner();
update public.calendar_source set last_success_at = '2026-10-10 12:00Z' where id = pg_temp.cal();
select pg_temp.as_job();
select is(public.save_calendar_sync(pg_temp.cal(), '{"ok": false, "error": "The link answered 404 (Not Found)."}'),
  '{"status": "error"}'::jsonb, '[CAL-06] a failed sync is recorded');
select results_eq($$ select status, last_error, last_success_at from public.calendar_source $$,
  $$ values ('error'::text, 'The link answered 404 (Not Found).'::text, '2026-10-10 12:00Z'::timestamptz) $$,
  '[CAL-06] with its error, the last success kept');
select is((select count(*) from public.calendar_event_instance), 6::bigint, '[CAL-06] and the last good events');
select throws_ok($$ select public.save_calendar_sync(pg_temp.cal(),
                      jsonb_build_object('ok', true, 'content_hash', pg_temp.hash(3), 'events', '[]'::jsonb,
                        'instances', jsonb_build_array(jsonb_build_object('uid', 'ghost@test', 'title', 'Ghost',
                          'start', '2026-10-20T21:00:00.000Z', 'end', '2026-10-20T22:00:00.000Z', 'all_day', false)))) $$,
  '22023', null, '[CAL-06] a sync whose instance has no event is refused');
select is(pg_temp.instances(),
  'Swim 2026-10-20..2026-10-20; Late 2026-10-20..2026-10-21; Ends at midnight 2026-10-21..2026-10-21; '
  'Swim 2026-10-28..2026-10-28 moved; Swim 2026-11-03..2026-11-03; Trip 2026-11-26..2026-11-29',
  '[CAL-06] and changes nothing');
select throws_ok($$ select public.save_calendar_sync(pg_temp.cal(),
                      jsonb_build_object('ok', true, 'content_hash', pg_temp.hash(3), 'events', '[]'::jsonb,
                        'instances', (select jsonb_agg(jsonb_build_object('uid', 'x', 'start', '2026-10-20', 'end', '2026-10-21',
                                                                          'all_day', true))
                                        from generate_series(1, 5001)))) $$,
  '22023', null, '[CAL-02] more than 5000 instances in the window is refused');

-- [US-505] The next good sync: OK again, and only what the file still has --------------------------
select is(public.save_calendar_sync(pg_temp.cal(), pg_temp.result(pg_temp.hash(4)) || jsonb_build_object(
    'events', jsonb_build_array(pg_temp.result(pg_temp.hash(4)) -> 'events' -> 4),
    'instances', jsonb_build_array(pg_temp.result(pg_temp.hash(4)) -> 'instances' -> 5))),
  '{"status": "synced", "events": 1, "instances": 1}'::jsonb, '[US-505] the link works again');
select results_eq($$ select status, last_error from public.calendar_source $$,
  $$ values ('ok'::text, null::text) $$, '[US-505] the calendar is OK again');
select is(pg_temp.instances(), 'Trip 2026-11-26..2026-11-29', '[CAL-02] instances are replaced');
select is((select count(*) from public.calendar_event), 1::bigint, '[CAL-02] and events no longer sent are removed');

-- Replacing the link --------------------------------------------------------------------------------
select pg_temp.as_user('26100000-0000-0000-0000-000000000001');
select is(public.save_calendar_source('26000000-0000-0000-0000-000000000001', pg_temp.cal(), 'Family',
  'https://p02-caldav.icloud.com/published/2/another-made-up-link', 'member-3', '26110000-0000-0000-0000-00000000000a', true),
  pg_temp.cal(), '[CAL-01] an admin replaces the link');
select pg_temp.as_owner();
select is((select d.decrypted_secret from vault.decrypted_secrets d
             join public.calendar_source s on s.url_secret_id = d.id where s.id = pg_temp.cal()),
  'https://p02-caldav.icloud.com/published/2/another-made-up-link', '[CAL-01] in Vault, in place of the old one');
select is((select count(*) from vault.secrets), 1::bigint, '[CAL-01] the old link is gone');
select results_eq($$ select status, content_hash from public.calendar_source $$,
  $$ values ('pending'::text, null::text) $$, '[CAL-01] the new link waits for its first sync');
select is((select count(*) from public.calendar_event_instance), 1::bigint, '[CAL-06] the last good events stay until then');
select is((select count(*) from public.audit_log where entity_type = 'calendar_source'), 1::bigint,
  '[ACC-05] saving the same details is not a change');

select pg_temp.as_user('26100000-0000-0000-0000-000000000001');
select lives_ok($$ select public.save_calendar_source('26000000-0000-0000-0000-000000000001', pg_temp.cal(), 'Our family',
                     null, 'member-5', null, false) $$, '[CAL-01] details change without the link');
select results_eq($$ select name, color, member_id, show_on_board, status from public.calendar_source $$,
  $$ values ('Our family'::text, 'member-5'::text, null::uuid, false, 'pending'::text) $$,
  '[CAL-01] and the link and status stay');
select pg_temp.as_owner();
select is((select count(*) from public.audit_log where entity_type = 'calendar_source' and action = 'update'), 1::bigint,
  '[ACC-05] the change is audited');

-- Removing ----------------------------------------------------------------------------------------
select pg_temp.as_user('26100000-0000-0000-0000-000000000001');
select lives_ok($$ select public.remove_calendar_source(pg_temp.cal()) $$, '[CAL-01] an admin removes a calendar');
select pg_temp.as_owner();
select is((select count(*) from vault.secrets), 0::bigint, '[CAL-01] its link goes from Vault');
select is((select count(*) from public.calendar_event) + (select count(*) from public.calendar_event_instance), 0::bigint,
  '[CAL-01] its events go with it');

select pg_temp.as_user('26300000-0000-0000-0000-000000000003');
update cal set other = public.save_calendar_source('26000000-0000-0000-0000-000000000002', null, 'Theirs',
  'https://example.com/made-up.ics', 'member-1', null, true);
select pg_temp.as_owner();
delete from public.household where id = '26000000-0000-0000-0000-000000000002';
select is((select count(*) from vault.secrets), 0::bigint, '[CAL-01] a household''s removal takes its links from Vault');

select ok(not has_function_privilege('authenticated', 'public.calendar_sources_due(uuid, timestamptz)', 'execute')
      and not has_function_privilege('anon', 'public.save_calendar_source(uuid, uuid, text, text, text, uuid, boolean)', 'execute')
      and not has_function_privilege('anon', 'public.save_calendar_sync(uuid, jsonb)', 'execute')
      and has_function_privilege('service_role', 'public.calendar_sources_due(uuid, timestamptz)', 'execute'),
  '[NFR-04] only the job reads links back; nobody signed out reaches any of it');

select * from finish();
rollback;
