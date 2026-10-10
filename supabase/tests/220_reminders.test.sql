-- [CHR-15][CHR-16][CHR-17] Reminders (WP-40, D-58), with the job's clock passed in. Each person's
-- settings, devices and deliveries are theirs alone. A task due at 3:00 pm with a 15-minute lead is
-- planned at 2:45 pm once and claimed once (a replay plans and claims nothing); an item with no due
-- time goes at the morning time; one done first, switched off (for the person, the item or the
-- device) or with no device is not sent; quiet hours hold a reminder and release it once; a private
-- item's payload has no title; the digest lists what is open; gone subscriptions are deleted.
begin;
select plan(53);

insert into auth.users (id, email) values
  ('22100000-0000-0000-0000-000000000001', 'pat@example.com'),
  ('22100000-0000-0000-0000-000000000002', 'quinn@example.com'),
  ('22300000-0000-0000-0000-000000000003', 'neighbour@example.com');
insert into public.household (id, name, timezone) values
  ('22000000-0000-0000-0000-000000000001', 'Reminder family', 'America/Chicago'),
  ('22000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('22000000-0000-0000-0000-000000000001'), ('22000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('22000000-0000-0000-0000-000000000001', '22100000-0000-0000-0000-000000000001', 'owner'),
  ('22000000-0000-0000-0000-000000000001', '22100000-0000-0000-0000-000000000002', 'admin'),
  ('22000000-0000-0000-0000-000000000002', '22300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('22110000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-000000000001', 'Pat', 'adult', '22100000-0000-0000-0000-000000000001'),
  ('22110000-0000-0000-0000-00000000000b', '22000000-0000-0000-0000-000000000001', 'Quinn', 'adult', '22100000-0000-0000-0000-000000000002'),
  ('22110000-0000-0000-0000-00000000000c', '22000000-0000-0000-0000-000000000001', 'Kid', 'child', null),
  ('22310000-0000-0000-0000-00000000000d', '22000000-0000-0000-0000-000000000002', 'Neighbour', 'adult', '22300000-0000-0000-0000-000000000003');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('22000000-0000-0000-0000-000000000001')
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
create function pg_temp.plan(p_now timestamptz) returns jsonb language sql as $$
  select public.plan_reminders('22000000-0000-0000-0000-000000000001', p_now)
$$;
-- What a claim sends, as "member title|body" lines in order.
create function pg_temp.claim(p_now timestamptz) returns text language sql as $$
  select coalesce(string_agg(m.display_name || ' ' || (c ->> 'kind') || ': ' || (c -> 'payload' ->> 'title') || ' | '
                             || (c -> 'payload' ->> 'body') || ' -> ' || jsonb_array_length(c -> 'devices'),
                             '; ' order by c -> 'payload' ->> 'title', m.display_name), '')
    from jsonb_array_elements(public.claim_reminders('22000000-0000-0000-0000-000000000001', p_now)) c
    join public.member m on m.id = (c ->> 'member_id')::uuid
$$;
create function pg_temp.item(p_title text, p_due time, p_who uuid[], p_private boolean default false,
                             p_lead int default null) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  v_id := public.save_chore('22000000-0000-0000-0000-000000000001', null,
    jsonb_build_object('title', p_title, 'kind', 'task', 'schedule', jsonb_build_object('freq', 'once', 'on_date', pg_temp.today()),
                       'due_time', p_due, 'start_date', pg_temp.today(),
                       'visibility', case when p_private then 'private' else 'family' end),
    p_who);
  if p_lead is not null then
    update public.chore set remind_lead_minutes = p_lead where id = v_id;
  end if;
  return v_id;
end $$;
create function pg_temp.occ(p_title text) returns uuid language sql as $$
  select o.id from public.chore_occurrence o join public.chore c on c.id = o.chore_id
   where c.household_id = '22000000-0000-0000-0000-000000000001' and c.title = p_title
$$;
create function pg_temp.delivery(p_title text, p_member uuid) returns text language sql as $$
  select coalesce((select status || coalesce(':' || detail, '') from public.reminder_delivery
                    where dedupe_key = 'due:' || pg_temp.occ(p_title) || ':' || p_member), 'none')
$$;

-- [CHR-15] Each person keeps their own settings; reminders are off until they turn them on --------
select pg_temp.as_user('22100000-0000-0000-0000-000000000001');
select lives_ok($$ insert into public.reminder_preference (member_id, household_id, enabled, morning_time, digest_time)
                   values ('22110000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-000000000001', true, '13:00', '14:00') $$,
                '[CHR-15] Pat turns her reminders on');
select is((select default_on::text || ':' || default_lead_minutes || ':' || hide_private_titles
             from public.reminder_preference where member_id = '22110000-0000-0000-0000-00000000000a'),
          'true:15:true', '... the bell on for new items, 15 minutes ahead, private titles hidden by default');
select throws_ok($$ insert into public.reminder_preference (member_id, household_id, enabled)
                    values ('22110000-0000-0000-0000-00000000000b', '22000000-0000-0000-0000-000000000001', true) $$,
                 '42501', null, 'she cannot set Quinn''s');
select pg_temp.as_user('22100000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.reminder_preference), 0, 'Quinn cannot see hers');
select lives_ok($$ insert into public.reminder_preference (member_id, household_id, enabled)
                   values ('22110000-0000-0000-0000-00000000000b', '22000000-0000-0000-0000-000000000001', true) $$,
                'Quinn turns his own on');

-- [CHR-15] Devices: saved through the function, each person's own ---------------------------------
select pg_temp.as_user('22100000-0000-0000-0000-000000000001');
select isnt(public.save_push_subscription('22000000-0000-0000-0000-000000000001', 'https://push.example/pat-phone',
                                          repeat('P', 87), repeat('a', 22), 'iPhone'), null,
            '[CHR-15] Pat adds her phone');
select is(public.save_push_subscription('22000000-0000-0000-0000-000000000001', 'https://push.example/pat-phone',
                                        repeat('Q', 87), repeat('b', 22), 'iPhone'),
          (select id from public.push_subscription where endpoint = 'https://push.example/pat-phone'),
          '... adding the same browser again updates it');
select throws_ok($$ insert into public.push_subscription (household_id, member_id, user_id, endpoint, p256dh, auth_secret, device_label)
                    values ('22000000-0000-0000-0000-000000000001', '22110000-0000-0000-0000-00000000000a',
                            '22100000-0000-0000-0000-000000000001', 'https://push.example/x', repeat('P', 87), repeat('a', 22), 'X') $$,
                 '42501', null, '... only through the function');
select throws_ok($$ update public.push_subscription set failure_count = 0 $$, '42501', null,
                 '... and she changes only its switch and name');
select throws_ok($$ select public.save_push_subscription('22000000-0000-0000-0000-000000000001', 'http://push.example/plain',
                                                         repeat('P', 87), repeat('a', 22), 'Old') $$,
                 '23514', null, 'a push endpoint is https');
select pg_temp.as_user('22100000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.push_subscription), 0, 'Quinn cannot see her devices');
select is((select public.save_push_subscription('22000000-0000-0000-0000-000000000001', 'https://push.example/quinn-laptop',
                                                repeat('Q', 87), repeat('b', 22), 'Mac') is not null), true,
          'Quinn adds his laptop');
select pg_temp.as_user('22300000-0000-0000-0000-000000000003');
select throws_ok($$ select public.save_push_subscription('22000000-0000-0000-0000-000000000001', 'https://push.example/n',
                                                         repeat('P', 87), repeat('a', 22), 'N') $$,
                 '42501', null, 'another household cannot add a device here');
select is((select count(*)::int from public.push_subscription), 0, '... nor see any');
select throws_ok($$ select public.plan_reminders('22000000-0000-0000-0000-000000000001', now()) $$,
                 '42501', null, 'only the job plans reminders');

-- [CHR-16] Items: the bell follows the person's default, or is set for one item -------------------
select pg_temp.as_user('22100000-0000-0000-0000-000000000001');
select pg_temp.item('Call the plumber', '15:00', array['22110000-0000-0000-0000-00000000000a'::uuid]);
select pg_temp.item('Secret gift', '15:00', array['22110000-0000-0000-0000-00000000000a'::uuid], true);
select pg_temp.item('Water the plants', null, array['22110000-0000-0000-0000-00000000000a'::uuid]);
select pg_temp.item('Book the dentist', '15:00', array['22110000-0000-0000-0000-00000000000a'::uuid]);
select pg_temp.item('Take out the bins', '16:00', array['22110000-0000-0000-0000-00000000000a', '22110000-0000-0000-0000-00000000000b']::uuid[]);
select pg_temp.item('Fix the gate', '17:00', array['22110000-0000-0000-0000-00000000000a', '22110000-0000-0000-0000-00000000000b']::uuid[]);
select pg_temp.item('Late call', '22:00', array['22110000-0000-0000-0000-00000000000a'::uuid], false, 0);
select is((select count(*)::int from public.chore_occurrence o join public.chore c on c.id = o.chore_id
            where c.household_id = '22000000-0000-0000-0000-000000000001' and o.due_date = pg_temp.today()), 7,
          'seven tasks today');
select is(public.set_my_reminder((select id from public.chore where title = 'Book the dentist'), false) ->> 'remind', 'false',
          '[CHR-16] Pat turns the bell off for one item');
select lives_ok($$ select public.set_my_reminder((select id from public.chore where title = 'Fix the gate'), null) $$,
                '... or back to her default');
select pg_temp.as_owner();
select pg_temp.item('Quinn only', '15:00', array['22110000-0000-0000-0000-00000000000b'::uuid]);
select pg_temp.as_user('22100000-0000-0000-0000-000000000001');
select throws_ok($$ select public.set_my_reminder((select id from public.chore where title = 'Quinn only'), true) $$,
                 '22023', null, '... and not someone else''s item');
-- Quinn's quiet hours: 21:00 to 07:00; Pat's: none yet.
select pg_temp.as_user('22100000-0000-0000-0000-000000000002');
update public.reminder_preference set quiet_start = '21:00', quiet_end = '07:00';

-- [CHR-16][CHR-17] 2:45 pm: due in 15 minutes -----------------------------------------------------
select pg_temp.as_job();
select is(pg_temp.plan(pg_temp.at('14:44')), '{"pruned": 0, "digests": 1, "planned": 1}'::jsonb,
          '2:44 pm: only the morning-time item (1:00 pm) and the 2:00 pm digest have come');
select is(pg_temp.plan(pg_temp.at('14:45')), '{"pruned": 0, "digests": 0, "planned": 3}'::jsonb,
          '[CHR-16] 2:45 pm: the plumber, the secret gift and Quinn''s item (15 minutes before 3:00 pm); not the dentist (bell off)');
select is(pg_temp.delivery('Book the dentist', '22110000-0000-0000-0000-00000000000a'), 'none', '... the dentist not at all');
select is(pg_temp.claim(pg_temp.at('14:45')),
          'Pat due: Call the plumber | Due at 3:00 pm -> 1; Pat due: Private task | Due at 3:00 pm -> 1; '
          || 'Quinn due: Quinn only | Due at 3:00 pm -> 1; Pat due: Water the plants | Due today -> 1; '
          || 'Pat digest: Your day: 7 to do | Book the dentist, Call the plumber, a private item and 4 more -> 1',
          '[CHR-16][CHR-17] each claimed once, to each device; a private title hidden; the digest lists what is open');
select is((select count(*)::int from public.reminder_delivery where status = 'sent'), 5, '... marked sent before they go');
select is(pg_temp.plan(pg_temp.at('14:50')), '{"pruned": 0, "digests": 0, "planned": 0}'::jsonb,
          '[CHR-16] a replay plans nothing');
select is(pg_temp.claim(pg_temp.at('14:50')), '', '... and claims nothing');

-- How each device answered: a success counts; 410 deletes the subscription ------------------------
select is(public.finish_reminder((select id from public.reminder_delivery
                                   where dedupe_key = 'due:' || pg_temp.occ('Call the plumber') || ':22110000-0000-0000-0000-00000000000a'),
                                 jsonb_build_array(jsonb_build_object('id', (select id from public.push_subscription where endpoint = 'https://push.example/pat-phone'),
                                                                      'status', 201))),
          '{"gone": 0, "failed": 0, "delivered": 1}'::jsonb, 'a 201 is delivered');
select isnt((select last_success_at from public.push_subscription where endpoint = 'https://push.example/pat-phone'), null,
            '... and the device remembers it');
select is(public.finish_reminder((select id from public.reminder_delivery
                                   where dedupe_key = 'due:' || pg_temp.occ('Quinn only') || ':22110000-0000-0000-0000-00000000000b'),
                                 jsonb_build_array(jsonb_build_object('id', (select id from public.push_subscription where endpoint = 'https://push.example/quinn-laptop'),
                                                                      'status', 410))),
          '{"gone": 1, "failed": 0, "delivered": 0}'::jsonb, 'a 410: the subscription is gone');
select is((select count(*)::int from public.push_subscription where endpoint = 'https://push.example/quinn-laptop'), 0,
          '... so it is deleted');
select is(pg_temp.delivery('Quinn only', '22110000-0000-0000-0000-00000000000b'), 'failed:gone', '... and that reminder failed');

-- [CHR-16] Planned, then done: skipped. Done first: nothing ---------------------------------------
select is((pg_temp.plan(pg_temp.at('15:45')) ->> 'planned')::int, 2, '3:45 pm: the bins, for Pat and Quinn');
select pg_temp.as_owner();
insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
values (gen_random_uuid(), pg_temp.occ('Take out the bins'), 'admin_complete', array['22110000-0000-0000-0000-00000000000b'::uuid], now());
select pg_temp.as_job();
select is(pg_temp.claim(pg_temp.at('15:46')), '', '[CHR-16] Quinn took them out first: nobody is notified');
select is(pg_temp.delivery('Take out the bins', '22110000-0000-0000-0000-00000000000a'), 'skipped:done', '... Pat''s skipped as done');
select is(pg_temp.delivery('Take out the bins', '22110000-0000-0000-0000-00000000000b'), 'skipped:done', '... and Quinn''s');
select pg_temp.as_owner();
insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
values (gen_random_uuid(), pg_temp.occ('Fix the gate'), 'admin_complete', array['22110000-0000-0000-0000-00000000000a'::uuid], now());
select pg_temp.as_job();
select is((pg_temp.plan(pg_temp.at('16:45')) ->> 'planned')::int, 0,
          '[CHR-16] Fix the gate done before 4:45 pm: nobody is reminded');
select is(pg_temp.delivery('Fix the gate', '22110000-0000-0000-0000-00000000000a'), 'none', '... not even planned');

-- [CHR-15] Switched off: the person, or every device ----------------------------------------------
select pg_temp.as_user('22100000-0000-0000-0000-000000000001');
select pg_temp.item('Pay the nanny', '18:00', array['22110000-0000-0000-0000-00000000000a', '22110000-0000-0000-0000-00000000000b']::uuid[]);
update public.push_subscription set enabled = false where endpoint = 'https://push.example/pat-phone';
select pg_temp.as_user('22100000-0000-0000-0000-000000000002');
update public.reminder_preference set enabled = false;
select pg_temp.as_job();
select is((pg_temp.plan(pg_temp.at('17:45')) ->> 'planned')::int, 1, '[CHR-15] Quinn turned his off: only Pat''s is planned');
select is(pg_temp.claim(pg_temp.at('17:45')), '', '... and Pat switched her phone off: not sent');
select is(pg_temp.delivery('Pay the nanny', '22110000-0000-0000-0000-00000000000a'), 'skipped:no_device', '... skipped, no device');
select pg_temp.as_user('22100000-0000-0000-0000-000000000001');
update public.push_subscription set enabled = true;

-- [CHR-17] Quiet hours hold a reminder and release it once ----------------------------------------
update public.reminder_preference set quiet_start = '21:00', quiet_end = '07:00';
select pg_temp.as_job();
select is((pg_temp.plan(pg_temp.at('22:00')) ->> 'planned')::int, 1, '[CHR-17] 10:00 pm, inside quiet hours: the late call is planned');
select is((select scheduled_for from public.reminder_delivery
            where dedupe_key = 'due:' || pg_temp.occ('Late call') || ':22110000-0000-0000-0000-00000000000a'),
          pg_temp.at('07:00', 1), '... held until 7:00 am');
select is(pg_temp.claim(pg_temp.at('23:30')), '', '... nothing goes during the night');
select is(pg_temp.claim(pg_temp.at('07:00', 1)), 'Pat due: Late call | Was due yesterday at 10:00 pm -> 1',
          '... it goes once at 7:00 am');
select is(pg_temp.claim(pg_temp.at('07:05', 1)), '', '... and only once');
select pg_temp.as_owner();
select is(private.after_quiet(pg_temp.at('06:59'), '21:00', '07:00', 'America/Chicago'), pg_temp.at('07:00'),
          'quiet hours that run past midnight hold the early morning too');
select is(private.after_quiet(pg_temp.at('13:00'), '12:00', '14:00', 'America/Chicago'), pg_temp.at('14:00'),
          '... and quiet hours within a day');
select is(private.after_quiet(pg_temp.at('20:59'), '21:00', '07:00', 'America/Chicago'), pg_temp.at('20:59'),
          '... and outside them it goes at its time');

-- Late: a reminder whose time passed more than two hours ago is never planned, nor sent -----------
select pg_temp.as_job();
select is((pg_temp.plan(pg_temp.at('23:59')) ->> 'planned')::int, 0, 'a reminder whose time is long past is not planned');

-- [CHR-16][CHR-17] Each person sees only their own deliveries; old ones are pruned ----------------
select pg_temp.as_user('22100000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.reminder_delivery where member_id = '22110000-0000-0000-0000-00000000000a'), 0,
          'Quinn cannot see Pat''s deliveries');
select ok((select count(*)::int from public.reminder_delivery) > 0, '... only his own');
select throws_ok($$ update public.reminder_delivery set status = 'held' $$, '42501', null, '... and cannot change them');
select pg_temp.as_owner();
update public.reminder_delivery set created_at = now() - interval '91 days'
 where dedupe_key like 'due:' || pg_temp.occ('Quinn only') || '%';
select pg_temp.as_job();
select is((pg_temp.plan(now()) ->> 'pruned')::int, 1, 'deliveries older than 90 days are pruned');

select * from finish();
rollback;
