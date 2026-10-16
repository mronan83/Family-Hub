-- [CAL-09][US-508] A calendar for one or more people: the contract (WP-50's deferred part, D-122).
-- calendar_source.member_id, the one-person save_calendar_source() and the carry-over are gone; the
-- audit trigger no longer names member_id; and the guard the migration ran first refuses to drop the
-- column while any calendar's one person is not in calendar_member. The guard is shown here on a
-- stand-in member_id column, added and rolled back inside this test's own transaction.
begin;
set local client_min_messages = warning;
select plan(10);

-- What the contract dropped.
select hasnt_column('public', 'calendar_source', 'member_id', '[CAL-09-g] calendar_source has no member_id');
select hasnt_function('public', 'save_calendar_source', '[CAL-09-g] the one-person save is gone');
select hasnt_function('private', 'carry_calendar_members', '[CAL-09-g] and so is WP-50''s carry-over');
select has_function('public', 'save_calendar', array['uuid', 'uuid', 'text', 'text', 'text', 'uuid[]', 'boolean'],
  '[CAL-09-g] the save of a calendar with its people stays');
select ok((select pg_get_triggerdef(t.oid) !~ 'member_id' and pg_get_triggerdef(t.oid) ~ 'UPDATE OF name, color, show_on_board'
             from pg_trigger t where t.tgrelid = 'public.calendar_source'::regclass and t.tgname = 'trg_audit'),
  '[CAL-09-g] the audit trigger watches name, color and show_on_board');
select lives_ok($$ select private.assert_calendar_people_carried() $$,
  '[CAL-09-c] with member_id gone, the guard is quiet');

-- The guard, on a calendar_source that still has member_id.
insert into public.household (id, name, timezone, week_start) values
  ('50000000-0000-0000-0000-000000000001', 'Contract family', 'America/New_York', 0);
insert into public.member (id, household_id, display_name, role, archived_at) values
  ('50110000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', 'Robin', 'adult', null),
  ('50110000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-000000000001', 'Zoe', 'child', now());
alter table public.calendar_source add column member_id uuid;
insert into public.calendar_source (id, household_id, name, url_secret_id, member_id) values
  ('50ca0000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Work', gen_random_uuid(),
   '50110000-0000-0000-0000-00000000000a'),
  ('50ca0000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'Swim', gen_random_uuid(),
   '50110000-0000-0000-0000-00000000000b'),
  ('50ca0000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 'Family', gen_random_uuid(), null);
insert into public.calendar_member (household_id, calendar_id, member_id) values
  ('50000000-0000-0000-0000-000000000001', '50ca0000-0000-0000-0000-000000000001', '50110000-0000-0000-0000-00000000000a');

select throws_ok($$ select private.assert_calendar_people_carried() $$, 'P0001',
  '1 calendar(s) have a person not in calendar_member; calendar_source.member_id is not dropped',
  '[CAL-09-c] the guard refuses while a calendar''s person (archived, here) is not in calendar_member');
insert into public.calendar_member (household_id, calendar_id, member_id) values
  ('50000000-0000-0000-0000-000000000001', '50ca0000-0000-0000-0000-000000000002', '50110000-0000-0000-0000-00000000000b');
select lives_ok($$ select private.assert_calendar_people_carried() $$,
  '[CAL-09-c] and lets the drop go on once every calendar''s person is in calendar_member');
select is((select count(*)::integer from public.calendar_member where calendar_id = '50ca0000-0000-0000-0000-000000000003'), 0,
  '[CAL-09-c] the whole family''s calendar needs no one');
update public.calendar_member set member_id = '50110000-0000-0000-0000-00000000000b'
 where calendar_id = '50ca0000-0000-0000-0000-000000000001';
select throws_ok($$ select private.assert_calendar_people_carried() $$, 'P0001', null,
  '[CAL-09-c] someone else on the calendar is not its person carried over');

select * from finish();
rollback;
