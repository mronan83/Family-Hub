-- [CHR-20] Approval alerts at once (WP-92, D-119). When a check-off starts waiting for a parent, a
-- reward request is made or a lunch change waits, the database calls the reminders job for that
-- household at once, once per transaction, and a failed call never stops the change. A plan holds a
-- lock per household, so a run called at once and the 5-minute run never plan the same alert twice.
-- An alert goes when something new waits, and counts everything still waiting for the parent.
begin;
select plan(14);

-- The job calls are recorded here instead of going out (pg_net isn't in the test database). Each
-- step of the test is its own transaction in real life: pg_temp.next_transaction() says so.
create table pg_temp.calls (job text, payload jsonb);
create or replace function private.call_job(p_job text, p_payload jsonb default '{}'::jsonb) returns bigint
language plpgsql set search_path = '' as $$
begin
  if current_setting('test.call_job_fails', true) = 'yes' then
    raise exception 'pg_net is down';
  end if;
  insert into pg_temp.calls values (p_job, p_payload);
  return 1;
end $$;
create function pg_temp.next_transaction() returns void language sql as $$
  select set_config('familywise.alert_now_48000000000000000000000000000001', '', true)
$$;
create function pg_temp.calls() returns text language sql as $$
  select coalesce(string_agg(job || ':' || (payload ->> 'household'), ','), '') from pg_temp.calls
$$;

insert into auth.users (id, email) values ('48100000-0000-0000-0000-000000000001', 'jo@example.com');
insert into public.household (id, name, timezone) values
  ('48000000-0000-0000-0000-000000000001', 'At once family', 'America/Chicago');
insert into public.household_settings (household_id, approval_mode) values ('48000000-0000-0000-0000-000000000001', 'off');
insert into public.household_user (household_id, user_id, role) values
  ('48000000-0000-0000-0000-000000000001', '48100000-0000-0000-0000-000000000001', 'owner');
insert into public.member (id, household_id, display_name, role, user_id, created_at) values
  ('48110000-0000-0000-0000-00000000000a', '48000000-0000-0000-0000-000000000001', 'Jo', 'adult', '48100000-0000-0000-0000-000000000001', now() - interval '2 minutes'),
  ('48110000-0000-0000-0000-00000000000c', '48000000-0000-0000-0000-000000000001', 'Kit', 'child', null, now() - interval '1 minute');
insert into public.reminder_preference (member_id, household_id, enabled) values
  ('48110000-0000-0000-0000-00000000000a', '48000000-0000-0000-0000-000000000001', true);
update public.reminder_preference set approvals_on_at = now() - interval '1 hour'
 where member_id = '48110000-0000-0000-0000-00000000000a';
insert into public.push_subscription (household_id, member_id, user_id, endpoint, p256dh, auth_secret, device_label) values
  ('48000000-0000-0000-0000-000000000001', '48110000-0000-0000-0000-00000000000a', '48100000-0000-0000-0000-000000000001',
   'https://push.example/jo', repeat('P', 87), repeat('a', 22), 'iPhone');
insert into public.reward_catalog_item (id, household_id, title, icon, cost_points, active) values
  ('48c00000-0000-0000-0000-000000000001', '48000000-0000-0000-0000-000000000001', 'Movie night', 'ticket', 10, true);

create function pg_temp.today() returns date language sql as $$
  select private.household_today('48000000-0000-0000-0000-000000000001')
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
create function pg_temp.item(p_title text, p_approval text) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '48100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
  v_id := public.save_chore('48000000-0000-0000-0000-000000000001', null,
    jsonb_build_object('title', p_title, 'kind', 'chore', 'points', 5, 'approval', p_approval,
                       'schedule', jsonb_build_object('freq', 'once', 'on_date', pg_temp.today()),
                       'start_date', pg_temp.today(), 'visibility', 'family'),
    array['48110000-0000-0000-0000-00000000000c'::uuid]);
  perform pg_temp.as_owner();
  return v_id;
end $$;
-- Kit checks it off on the board; it is waiting from p_at on the job's clock if it waits.
create function pg_temp.check_off(p_title text, p_at timestamptz) returns text language plpgsql as $$
declare
  v_occ uuid := (select o.id from public.chore_occurrence o join public.chore c on c.id = o.chore_id
                where c.title = p_title and c.household_id = '48000000-0000-0000-0000-000000000001');
begin
  insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
  values (gen_random_uuid(), v_occ, 'complete', array['48110000-0000-0000-0000-00000000000c'::uuid], now() - interval '1 minute');
  update public.chore_occurrence set status_changed_at = p_at where id = v_occ;
  return (select status from public.chore_occurrence where id = v_occ);
end $$;
create function pg_temp.plan(p_now timestamptz) returns int language sql as $$
  select (public.plan_reminders('48000000-0000-0000-0000-000000000001', p_now) ->> 'approvals')::int
$$;
create function pg_temp.claim(p_now timestamptz) returns text language sql as $$
  select coalesce(string_agg(c -> 'payload' ->> 'title', '; '), '')
    from jsonb_array_elements(public.claim_reminders('48000000-0000-0000-0000-000000000001', p_now)) c
$$;

select pg_temp.item('Homework', 'required');
select pg_temp.item('Reading', 'required');
select pg_temp.item('Feed the cat', 'inherit');
select pg_temp.item('Piano', 'required');
select pg_temp.item('Spelling', 'required');
delete from pg_temp.calls;  -- making items calls nothing, but start clean

-- At once, once per transaction ------------------------------------------------------------------
select pg_temp.next_transaction();
select pg_temp.check_off('Feed the cat', now() - interval '1 minute');
select is(pg_temp.calls(), '', '[CHR-20] a check-off that counts at once calls nothing');

select pg_temp.next_transaction();
select pg_temp.check_off('Homework', now() - interval '1 minute');
select is(pg_temp.calls(), 'reminders:48000000-0000-0000-0000-000000000001',
          '[CHR-20] a check-off that starts waiting calls the reminders job for its household at once');
select pg_temp.check_off('Reading', now() - interval '1 minute');
select is(pg_temp.calls(), 'reminders:48000000-0000-0000-0000-000000000001',
          '... once per transaction, however many start waiting in it');

-- The alert: planned under a lock, counting what is new -----------------------------------------
select pg_temp.as_job();
select is(pg_temp.plan(now()), 1, '[CHR-20] the run called at once plans the alert');
select ok(exists (select from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted),
          '... holding the household''s plan lock until its transaction ends');
select is(pg_temp.claim(now()), 'Kit: 2 check-offs waiting', '... and sends it');
select pg_temp.as_owner();

-- The next alert counts everything still waiting, not only what is new ----------------------------
select pg_temp.next_transaction();
delete from pg_temp.calls;
select pg_temp.check_off('Piano', now() + interval '1 second');
select is(pg_temp.calls(), 'reminders:48000000-0000-0000-0000-000000000001', '[CHR-20] a third check-off calls at once again');
select pg_temp.as_job();
select is(pg_temp.plan(now() + interval '2 seconds'), 1, '... a new alert, for something new');
select is(pg_temp.claim(now() + interval '2 seconds'), 'Kit: 3 check-offs waiting',
          '[CHR-20] it counts all three still waiting, so the newest alert on the lock screen is never short');
select is(pg_temp.plan(now() + interval '3 seconds'), 0, '... and nothing new: no alert');
select pg_temp.as_owner();

-- Reward requests and lunch changes call at once too ---------------------------------------------
select pg_temp.next_transaction();
delete from pg_temp.calls;
insert into public.redemption (id, household_id, member_id, catalog_item_id, cost_snapshot, requested_at, requested_by_type)
values (gen_random_uuid(), '48000000-0000-0000-0000-000000000001', '48110000-0000-0000-0000-00000000000c',
        '48c00000-0000-0000-0000-000000000001', 10, now() + interval '2.5 seconds', 'device');
select is(pg_temp.calls(), 'reminders:48000000-0000-0000-0000-000000000001', '[CHR-20] a reward request calls at once');
-- Jo approves the three check-offs: only the request waits, so the alert opens Rewards.
insert into public.chore_completion_event (id, occurrence_id, event_type, occurred_at)
select gen_random_uuid(), o.id, 'approve', now()
  from public.chore_occurrence o where o.household_id = '48000000-0000-0000-0000-000000000001' and o.status = 'pending_approval';
select pg_temp.as_job();
select pg_temp.plan(now() + interval '3 seconds');
select is((select string_agg((c -> 'payload' ->> 'title') || ' -> ' || (c -> 'payload' ->> 'url'), '; ')
             from jsonb_array_elements(public.claim_reminders('48000000-0000-0000-0000-000000000001', now() + interval '3 seconds')) c),
          'Kit: 1 reward request waiting -> /admin/rewards', '[CHR-20] only a request waiting: the alert opens Rewards');
select pg_temp.as_owner();

select pg_temp.next_transaction();
delete from pg_temp.calls;
insert into public.lunch_request (household_id, member_id, lunch_date, mode, open_until)
values ('48000000-0000-0000-0000-000000000001', '48110000-0000-0000-0000-00000000000c', pg_temp.today() + 7, 'bring',
        now() + interval '7 days');
select is(pg_temp.calls(), 'reminders:48000000-0000-0000-0000-000000000001', '[CHR-20] a lunch change calls at once');

-- A failed call never stops the check-off ---------------------------------------------------------
select pg_temp.next_transaction();
select set_config('test.call_job_fails', 'yes', true);
select is(pg_temp.check_off('Spelling', now() + interval '4 seconds'), 'pending_approval',
          '[CHR-20] with the call failing, the check-off still waits for a parent (the 5-minute run sends the alert)');

select * from finish();
rollback;
