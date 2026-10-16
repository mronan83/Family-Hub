-- [CHR-05][CHR-20] What WP-92 found (D-119): an approval alert is only for a check-off that waits for
-- a parent. With the family's approval off, a child's check-off on an item left on the family setting
-- counts at once and plans no alert; on an item that always needs a parent's OK it waits and is in
-- the next alert; with the family's approval on, the family-setting item waits too.
begin;
select plan(8);

insert into auth.users (id, email) values ('47100000-0000-0000-0000-000000000001', 'robin@example.com');
insert into public.household (id, name, timezone) values
  ('47000000-0000-0000-0000-000000000001', 'Findings family', 'America/Chicago');
insert into public.household_settings (household_id, approval_mode) values ('47000000-0000-0000-0000-000000000001', 'off');
insert into public.household_user (household_id, user_id, role) values
  ('47000000-0000-0000-0000-000000000001', '47100000-0000-0000-0000-000000000001', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('47110000-0000-0000-0000-00000000000a', '47000000-0000-0000-0000-000000000001', 'Robin', 'adult', '47100000-0000-0000-0000-000000000001'),
  ('47110000-0000-0000-0000-00000000000c', '47000000-0000-0000-0000-000000000001', 'Sky', 'child', null);
insert into public.reminder_preference (member_id, household_id, enabled) values
  ('47110000-0000-0000-0000-00000000000a', '47000000-0000-0000-0000-000000000001', true);
update public.reminder_preference set approvals_on_at = now() - interval '1 hour'
 where member_id = '47110000-0000-0000-0000-00000000000a';
insert into public.push_subscription (household_id, member_id, user_id, endpoint, p256dh, auth_secret, device_label) values
  ('47000000-0000-0000-0000-000000000001', '47110000-0000-0000-0000-00000000000a', '47100000-0000-0000-0000-000000000001',
   'https://push.example/robin', repeat('P', 87), repeat('a', 22), 'iPhone');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('47000000-0000-0000-0000-000000000001')
$$;
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
-- An item for Sky today, made by Robin, with its own approval setting.
create function pg_temp.item(p_title text, p_approval text) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '47100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
  v_id := public.save_chore('47000000-0000-0000-0000-000000000001', null,
    jsonb_build_object('title', p_title, 'kind', 'chore', 'points', 5, 'approval', p_approval,
                       'schedule', jsonb_build_object('freq', 'once', 'on_date', pg_temp.today()),
                       'start_date', pg_temp.today(), 'visibility', 'family'),
    array['47110000-0000-0000-0000-00000000000c'::uuid]);
  perform pg_temp.as_owner();
  return v_id;
end $$;
-- Sky checks it off on the board, waiting from p_at on the job's clock if it waits; answers its status.
create function pg_temp.check_off(p_chore uuid, p_at timestamptz) returns text language plpgsql as $$
declare
  v_occ uuid := (select id from public.chore_occurrence where chore_id = p_chore);
begin
  insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
  values (gen_random_uuid(), v_occ, 'complete', array['47110000-0000-0000-0000-00000000000c'::uuid], now() - interval '1 minute');
  update public.chore_occurrence set status_changed_at = p_at where id = v_occ;
  return (select status from public.chore_occurrence where id = v_occ);
end $$;
create function pg_temp.plan(p_now timestamptz) returns int language sql as $$
  select (public.plan_reminders('47000000-0000-0000-0000-000000000001', p_now) ->> 'approvals')::int
$$;
create function pg_temp.claim(p_now timestamptz) returns text language sql as $$
  select coalesce(string_agg(c -> 'payload' ->> 'title', '; '), '')
    from jsonb_array_elements(public.claim_reminders('47000000-0000-0000-0000-000000000001', p_now)) c
$$;

select pg_temp.item('Family-setting chore', 'inherit');
select pg_temp.item('Always-OK chore', 'required');
select pg_temp.item('Later chore', 'inherit');

-- The family's approval off: the family-setting item counts at once; no alert ------------------------
select is(pg_temp.check_off((select id from public.chore where title = 'Family-setting chore'), now() - interval '1 minute'), 'completed',
          '[CHR-05] approval off: a check-off on an item left on the family setting counts at once');
select pg_temp.as_job();
select is(pg_temp.plan(now()), 0, '[CHR-20] ... nothing waits for a parent, so no approval alert is planned');
select pg_temp.as_owner();

-- An item that always needs a parent's OK waits, whatever the family setting, and is alerted ---------
select is(pg_temp.check_off((select id from public.chore where title = 'Always-OK chore'), now() - interval '1 minute'), 'pending_approval',
          '[CHR-05] an item set to always need a parent''s OK waits, with the family''s approval off');
select pg_temp.as_job();
select is(pg_temp.plan(now() + interval '1 second'), 1, '[CHR-20] ... and one approval alert is planned');
select is(pg_temp.claim(now() + interval '1 second'), 'Sky: 1 check-off waiting',
          '... for that one check-off only: the family-setting item that counted at once is not in it');
select pg_temp.as_owner();

-- The family's approval on: the family-setting item waits too, and is alerted ------------------------
update public.household_settings set approval_mode = 'on' where household_id = '47000000-0000-0000-0000-000000000001';
select is(pg_temp.check_off((select id from public.chore where title = 'Later chore'), now() + interval '1.5 seconds'), 'pending_approval',
          '[CHR-05] approval switched on: a family-setting item still to do now waits');
select pg_temp.as_job();
select is(pg_temp.plan(now() + interval '2 seconds'), 1, '[CHR-20] ... and is in a new approval alert');
select is(pg_temp.claim(now() + interval '2 seconds'), 'Sky: 2 check-offs waiting',
          '... counting both still waiting (D-119)');

select * from finish();
rollback;
