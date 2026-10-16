-- [CHR-20] An alert when something waits for a parent (WP-63, D-88), with the job's clock passed in.
-- Maya's three check-offs and Leo's reward request make one alert per parent with Approvals on,
-- grouped by child; a parent with it off gets none; a replay plans nothing and nothing is in two
-- alerts; quiet hours hold an alert, which is skipped once another parent has cleared everything;
-- what waits only for others (a private item, a parent's own request) is left out.
begin;
select plan(26);

insert into auth.users (id, email) values
  ('41100000-0000-0000-0000-000000000001', 'pat@example.com'),
  ('41100000-0000-0000-0000-000000000002', 'quinn@example.com');
insert into public.household (id, name, timezone) values
  ('41000000-0000-0000-0000-000000000001', 'Approval family', 'America/Chicago');
insert into public.household_settings (household_id) values ('41000000-0000-0000-0000-000000000001');
insert into public.household_user (household_id, user_id, role) values
  ('41000000-0000-0000-0000-000000000001', '41100000-0000-0000-0000-000000000001', 'owner'),
  ('41000000-0000-0000-0000-000000000001', '41100000-0000-0000-0000-000000000002', 'admin');
insert into public.member (id, household_id, display_name, role, user_id, created_at) values
  ('41110000-0000-0000-0000-00000000000a', '41000000-0000-0000-0000-000000000001', 'Pat', 'adult', '41100000-0000-0000-0000-000000000001', now() - interval '4 minutes'),
  ('41110000-0000-0000-0000-00000000000b', '41000000-0000-0000-0000-000000000001', 'Quinn', 'adult', '41100000-0000-0000-0000-000000000002', now() - interval '3 minutes'),
  ('41110000-0000-0000-0000-00000000000c', '41000000-0000-0000-0000-000000000001', 'Maya', 'child', null, now() - interval '2 minutes'),
  ('41110000-0000-0000-0000-00000000000d', '41000000-0000-0000-0000-000000000001', 'Leo', 'child', null, now() - interval '1 minute');
insert into public.reward_catalog_item (id, household_id, title, icon, cost_points, active) values
  ('41c00000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'Movie night', 'ticket', 10, true);

create function pg_temp.today() returns date language sql as $$
  select private.household_today('41000000-0000-0000-0000-000000000001')
$$;
-- A household-local time today (or days from today), as the job's clock.
create function pg_temp.at(p_time time, p_days int default 0) returns timestamptz language sql as $$
  select ((pg_temp.today() + p_days) + p_time) at time zone 'America/Chicago'
$$;
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
create function pg_temp.plan(p_now timestamptz) returns int language sql as $$
  select (public.plan_reminders('41000000-0000-0000-0000-000000000001', p_now) ->> 'approvals')::int
$$;
-- What a claim sends: "member: title | body -> url [tag]" in member order.
create function pg_temp.claim(p_now timestamptz) returns text language sql as $$
  select coalesce(string_agg(m.display_name || ': ' || (c -> 'payload' ->> 'title') || ' | ' || (c -> 'payload' ->> 'body')
                             || ' -> ' || (c -> 'payload' ->> 'url') || ' [' || (c -> 'payload' ->> 'tag') || ']',
                             '; ' order by m.display_name), '')
    from jsonb_array_elements(public.claim_reminders('41000000-0000-0000-0000-000000000001', p_now)) c
    join public.member m on m.id = (c ->> 'member_id')::uuid
$$;
-- An item for one child today that needs a parent's OK, made by Pat.
create function pg_temp.item(p_title text, p_who uuid, p_private boolean default false) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.as_user('41100000-0000-0000-0000-000000000001');
  v_id := public.save_chore('41000000-0000-0000-0000-000000000001', null,
    jsonb_build_object('title', p_title, 'kind', 'chore', 'points', 5, 'approval', 'required',
                       'schedule', jsonb_build_object('freq', 'once', 'on_date', pg_temp.today()),
                       'start_date', pg_temp.today(),
                       'visibility', case when p_private then 'private' else 'family' end),
    array[p_who]);
  perform pg_temp.as_owner();
  return v_id;
end $$;
-- The child checks it off on the board; it became waiting at p_at, on the job's clock. (Events
-- can't be in the future, so the event itself is an hour ago, before any approval.)
create function pg_temp.check_off(p_chore uuid, p_who uuid, p_at timestamptz) returns void language plpgsql as $$
declare
  v_occ uuid := (select id from public.chore_occurrence where chore_id = p_chore);
begin
  insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
  values (gen_random_uuid(), v_occ, 'complete', array[p_who], now() - interval '1 hour');
  update public.chore_occurrence set status_changed_at = p_at where id = v_occ;
end $$;
create function pg_temp.approve(p_chore uuid) returns void language plpgsql as $$
begin
  insert into public.chore_completion_event (id, occurrence_id, event_type, occurred_at)
  values (gen_random_uuid(), (select id from public.chore_occurrence where chore_id = p_chore), 'approve', now());
end $$;
create function pg_temp.ask(p_who uuid, p_at timestamptz, p_by_parent uuid default null) returns uuid language sql as $$
  insert into public.redemption (id, household_id, member_id, catalog_item_id, cost_snapshot, requested_at,
                                 requested_by_type, requested_by)
  values (gen_random_uuid(), '41000000-0000-0000-0000-000000000001', p_who, '41c00000-0000-0000-0000-000000000001', 10,
          p_at, case when p_by_parent is null then 'device' else 'admin' end, p_by_parent)
  returning id
$$;

-- Approvals is on by default; Pat and Quinn have reminders on, with a phone each ----------------------
insert into public.reminder_preference (member_id, household_id, enabled) values
  ('41110000-0000-0000-0000-00000000000a', '41000000-0000-0000-0000-000000000001', true),
  ('41110000-0000-0000-0000-00000000000b', '41000000-0000-0000-0000-000000000001', true);
insert into public.push_subscription (household_id, member_id, user_id, endpoint, p256dh, auth_secret, device_label) values
  ('41000000-0000-0000-0000-000000000001', '41110000-0000-0000-0000-00000000000a', '41100000-0000-0000-0000-000000000001',
   'https://push.example/pat', repeat('P', 87), repeat('a', 22), 'iPhone'),
  ('41000000-0000-0000-0000-000000000001', '41110000-0000-0000-0000-00000000000b', '41100000-0000-0000-0000-000000000002',
   'https://push.example/quinn', repeat('P', 87), repeat('a', 22), 'iPhone');
select is((select string_agg(approval_alerts::text || ':' || (approvals_on_at = now())::text, ',' order by member_id)
             from public.reminder_preference where household_id = '41000000-0000-0000-0000-000000000001'),
          'true:true,true:true', '[CHR-20] Approvals is on by default once reminders are, counting from now');
update public.reminder_preference set approval_alerts = false where member_id = '41110000-0000-0000-0000-00000000000b';
select is((select approvals_on_at from public.reminder_preference where member_id = '41110000-0000-0000-0000-00000000000b'),
          now(), '... switching it off keeps when it was on');
-- On the job's clock, Pat turned hers on at 3:00 pm.
update public.reminder_preference set approvals_on_at = pg_temp.at('15:00') where member_id = '41110000-0000-0000-0000-00000000000a';

select pg_temp.item('Homework', '41110000-0000-0000-0000-00000000000c');
select pg_temp.item('Tidy room', '41110000-0000-0000-0000-00000000000c');
select pg_temp.item('Practice piano', '41110000-0000-0000-0000-00000000000c');
select pg_temp.item('Feed the fish', '41110000-0000-0000-0000-00000000000d');
select pg_temp.item('Diary', '41110000-0000-0000-0000-00000000000c', true);  -- private: made by Pat
select pg_temp.item('Make bed', '41110000-0000-0000-0000-00000000000d');
select pg_temp.item('Water the plants', '41110000-0000-0000-0000-00000000000c');
select pg_temp.item('Pack the bag', '41110000-0000-0000-0000-00000000000c');

-- One alert for several check-offs and a request, grouped by child -------------------------------------
select pg_temp.check_off((select id from public.chore where title = 'Homework'), '41110000-0000-0000-0000-00000000000c', pg_temp.at('15:01'));
select pg_temp.check_off((select id from public.chore where title = 'Tidy room'), '41110000-0000-0000-0000-00000000000c', pg_temp.at('15:02'));
select pg_temp.check_off((select id from public.chore where title = 'Practice piano'), '41110000-0000-0000-0000-00000000000c', pg_temp.at('15:03'));
select pg_temp.ask('41110000-0000-0000-0000-00000000000c', pg_temp.at('15:03'));
select is((select status from public.chore_occurrence o join public.chore c on c.id = o.chore_id where c.title = 'Homework'),
          'pending_approval', 'Maya''s check-offs wait for a parent''s OK');

select pg_temp.as_job();
select is(pg_temp.plan(pg_temp.at('15:05')), 1,
          '[CHR-20] 3:05 pm: one alert planned, for Pat only (Quinn has Approvals off)');
select is(pg_temp.claim(pg_temp.at('15:05')),
          'Pat: Maya: 3 check-offs and 1 reward request waiting | Open Today to approve -> /admin/today [approval]',
          '... one alert for all four, grouped by child, opening Today, with the one tag for every approval alert');
select is((select claim_reminders('41000000-0000-0000-0000-000000000001', pg_temp.at('15:05'))), '[]'::jsonb,
          '... claimed once');
select is(pg_temp.plan(pg_temp.at('15:10')), 0, '[CHR-20] a replay plans nothing: nothing is in two alerts');
select is(pg_temp.plan(pg_temp.at('15:05')), 0, '... nor the same run again');

-- What became waiting since brings an alert counting all still waiting, several children in one line ---
select pg_temp.as_owner();
select pg_temp.check_off((select id from public.chore where title = 'Feed the fish'), '41110000-0000-0000-0000-00000000000d', pg_temp.at('15:11'));
select pg_temp.ask('41110000-0000-0000-0000-00000000000c', pg_temp.at('15:12'));
select pg_temp.as_job();
select is(pg_temp.plan(pg_temp.at('15:15')), 1, 'Leo''s check-off and Maya''s second request: a new alert');
select is(pg_temp.claim(pg_temp.at('15:15')),
          'Pat: Maya: 3 check-offs and 2 reward requests · Leo: 1 check-off waiting | Open Today to approve -> /admin/today [approval]',
          '[CHR-20] something new brings an alert that counts all still waiting (D-119), several children in one line');
select pg_temp.as_owner();
select pg_temp.ask('41110000-0000-0000-0000-00000000000d', pg_temp.at('15:16'));
select pg_temp.as_job();
select is(pg_temp.plan(pg_temp.at('15:20')), 1, 'a request alone');
select is(pg_temp.claim(pg_temp.at('15:20')),
          'Pat: Maya: 3 check-offs and 2 reward requests · Leo: 1 check-off and 1 reward request waiting | Open Today to approve -> /admin/today [approval]',
          '... with check-offs still waiting it opens Today');

-- What waits only for others is left out ---------------------------------------------------------------
select pg_temp.as_owner();
update public.reminder_preference set approval_alerts = true where member_id = '41110000-0000-0000-0000-00000000000b';
select is((select approvals_on_at from public.reminder_preference where member_id = '41110000-0000-0000-0000-00000000000b'),
          now(), '[CHR-20] Quinn turns Approvals on: it counts from then');
update public.reminder_preference set approvals_on_at = pg_temp.at('15:20') where member_id = '41110000-0000-0000-0000-00000000000b';
select pg_temp.check_off((select id from public.chore where title = 'Diary'), '41110000-0000-0000-0000-00000000000c', pg_temp.at('15:21'));
select pg_temp.ask('41110000-0000-0000-0000-00000000000d', pg_temp.at('15:21'), '41100000-0000-0000-0000-000000000001');
select pg_temp.as_job();
select is(pg_temp.plan(pg_temp.at('15:25')), 2, 'Quinn turns Approvals on; Pat''s private item and her own request for Leo');
select is(pg_temp.claim(pg_temp.at('15:25')),
          'Pat: Maya: 4 check-offs and 2 reward requests · Leo: 1 check-off and 1 reward request waiting | Open Today to approve -> /admin/today [approval]; '
          || 'Quinn: Maya: 3 check-offs and 2 reward requests · Leo: 1 check-off and 2 reward requests waiting | Open Today to approve -> /admin/today [approval]',
          '[CHR-20] Pat counts her private item but not her own request; Quinn counts the request but not '
          || 'the private item, and is alerted only because something new waits since he turned Approvals on');
select is((select string_agg(to_char(waiting_from at time zone 'America/Chicago', 'HH24:MI'), ',' order by created_at)
             from public.reminder_delivery where member_id = '41110000-0000-0000-0000-00000000000b'),
          '15:20', '... his first alert counts from when he turned it on');

-- Switched off: none ----------------------------------------------------------------------------------
select pg_temp.as_owner();
update public.reminder_preference set approval_alerts = false where member_id = '41110000-0000-0000-0000-00000000000b';
select pg_temp.check_off((select id from public.chore where title = 'Make bed'), '41110000-0000-0000-0000-00000000000d', pg_temp.at('15:26'));
select pg_temp.as_job();
select is(pg_temp.plan(pg_temp.at('15:30')), 1, '[CHR-20] with Approvals off, Quinn gets none (Pat does)');
select is((select count(*)::int from public.reminder_delivery where member_id = '41110000-0000-0000-0000-00000000000b'),
          1, '... Quinn still has only his one earlier alert');
select lives_ok($$ select public.claim_reminders('41000000-0000-0000-0000-000000000001', pg_temp.at('15:30')) $$, 'Pat''s goes');

-- Quiet hours hold an alert; cleared by then, it is dropped ------------------------------------------
select pg_temp.as_owner();
update public.reminder_preference set quiet_start = '21:00', quiet_end = '07:00'
 where member_id = '41110000-0000-0000-0000-00000000000a';
select pg_temp.check_off((select id from public.chore where title = 'Water the plants'), '41110000-0000-0000-0000-00000000000c', pg_temp.at('21:30'));
select pg_temp.as_job();
select is(pg_temp.plan(pg_temp.at('21:35')), 1, '[CHR-20] 9:35 pm, inside quiet hours: planned');
select is((select to_char(scheduled_for at time zone 'America/Chicago', 'HH24:MI') from public.reminder_delivery
            where member_id = '41110000-0000-0000-0000-00000000000a' and status = 'held'),
          '07:00', '... held until quiet hours end');
select pg_temp.as_owner();
select pg_temp.check_off((select id from public.chore where title = 'Pack the bag'), '41110000-0000-0000-0000-00000000000c', pg_temp.at('23:00'));
select pg_temp.as_job();
select is(pg_temp.plan(pg_temp.at('23:05')), 0, '... while one is held, no other is planned');
select is(pg_temp.claim(pg_temp.at('23:05')), '', '... nor sent before 7:00 am');
select pg_temp.as_owner();
select pg_temp.approve((select id from public.chore where title = 'Water the plants'));
select pg_temp.approve((select id from public.chore where title = 'Pack the bag'));
select pg_temp.as_job();
select is(pg_temp.claim(pg_temp.at('07:00', 1)), '', '[CHR-20] 7:00 am: Quinn cleared both overnight, so nothing is sent');
select is((select status || ':' || detail from public.reminder_delivery
            where member_id = '41110000-0000-0000-0000-00000000000a' and scheduled_for = pg_temp.at('07:00', 1)),
          'skipped:nothing_waiting', '... it is dropped, and says why');

-- Nobody else can read a parent's deliveries -----------------------------------------------------------
select pg_temp.as_user('41100000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.reminder_delivery where member_id = '41110000-0000-0000-0000-00000000000a'), 0,
          'Quinn cannot see Pat''s alerts');

select * from finish();
rollback;
