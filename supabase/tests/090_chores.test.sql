-- [CHR-01][CHR-09][CHR-10][CHR-11][CHR-13][NFR-04] The family list (WP-08): chores and tasks with
-- several assignees, household tags by id, due times, schedules checked in the database, and private
-- items that only their creator and assignees who sign in can see, down to the audit rows.
begin;
select plan(41);

-- Fixtures (as the migration owner) -----------------------------------------
insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'alex@example.com'),
  ('c2000000-0000-0000-0000-000000000002', 'sam@example.com'),
  ('c3000000-0000-0000-0000-000000000003', 'other@example.com'),
  ('cd000000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('c0000000-0000-0000-0000-000000000001', 'List family', 'America/Chicago'),
  ('c0000000-0000-0000-0000-000000000002', 'Other family', 'Europe/London');
insert into public.household_user (household_id, user_id, role) values
  ('c0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'owner'),
  ('c0000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000002', 'admin'),
  ('c0000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('c1110000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('c1110000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'Alex', 'adult', 'c1000000-0000-0000-0000-000000000001'),
  ('c1110000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'Sam', 'adult', 'c2000000-0000-0000-0000-000000000002'),
  ('c1110000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-000000000002', 'Zed', 'child', null);
insert into public.device (id, household_id, name, auth_user_id) values
  ('cdd00000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Kitchen', 'cd000000-0000-0000-0000-00000000000d');

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.act_as_device(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'device'))::text, true);
end $$;
-- Remembers an id across role switches.
create function pg_temp.keep(p_name text, p_id uuid) returns uuid language sql as $$
  select set_config('test.' || p_name, p_id::text, true)::uuid
$$;
create function pg_temp.id(p_name text) returns uuid language sql as $$
  select current_setting('test.' || p_name)::uuid
$$;

-- Schedules -------------------------------------------------------------------
select results_eq(
  $$ select private.valid_schedule(s::jsonb) from (values
       ('{"freq": "daily"}'), ('{"freq": "daily", "interval": 2}'),
       ('{"freq": "weekly", "by_weekday": [1, 3, 5]}'), ('{"freq": "monthly", "by_month_day": [1, 15]}'),
       ('{"freq": "once", "on_date": "2026-11-02"}')) v (s) $$,
  $$ values (true), (true), (true), (true), (true) $$,
  '[CHR-01] daily, weekly by weekday, monthly and one-off schedules are accepted');
select results_eq(
  $$ select private.valid_schedule(s::jsonb) from (values
       ('{"freq": "hourly"}'), ('{"freq": "weekly"}'), ('{"freq": "weekly", "by_weekday": []}'),
       ('{"freq": "weekly", "by_weekday": [0]}'), ('{"freq": "weekly", "by_weekday": [1, 1]}'),
       ('{"freq": "monthly", "by_month_day": [32]}'), ('{"freq": "once", "on_date": "2026-02-30"}'),
       ('{"freq": "once"}'), ('{"freq": "daily", "by_weekday": [1]}'), ('{"freq": "daily", "interval": 0}'),
       ('{"freq": "daily", "interval": 1.5}'), ('[]'), ('{"freq": "once", "on_date": "2026-11-02", "x": 1}')) v (s) $$,
  $$ values (false), (false), (false), (false), (false), (false), (false), (false), (false), (false), (false), (false), (false) $$,
  '[CHR-01] malformed schedules are refused: unknown frequency, missing or out-of-range days, bad dates, stray keys');

-- Tags --------------------------------------------------------------------------
select pg_temp.act_as('c1000000-0000-0000-0000-000000000001');
select pg_temp.keep('kitchen', 'c7a90000-0000-0000-0000-000000000001');
insert into public.tag (id, household_id, name, color, icon) values
  ('c7a90000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Kitchen', 'member-3', 'chore-dishes'),
  ('c7a90000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'Morning', 'member-6', 'sun'),
  ('c7a90000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'Garden', 'member-5', null);
select throws_ok(
  $$ insert into public.tag (household_id, name) values ('c0000000-0000-0000-0000-000000000001', 'kitchen') $$,
  '23505', null, '[CHR-10] tag names are unique in a household, ignoring case');
select throws_ok(
  $$ insert into public.tag (household_id, name, color) values ('c0000000-0000-0000-0000-000000000001', 'Pink', 'pink') $$,
  '23514', null, '[CHR-10] a tag color is one of the brand''s categorical tokens');

-- Saving items --------------------------------------------------------------------
select pg_temp.keep('bed', public.save_chore(
  'c0000000-0000-0000-0000-000000000001', null,
  '{"title": "Make bed", "icon": "chore-bed", "kind": "chore", "points": 5, "schedule": {"freq": "daily"}, "due_time": "07:30"}',
  array['c1110000-0000-0000-0000-000000000001', 'c1110000-0000-0000-0000-000000000002']::uuid[],
  array['c7a90000-0000-0000-0000-000000000001', 'c7a90000-0000-0000-0000-000000000002']::uuid[]));
select results_eq(
  $$ select c.title, c.kind, c.points, c.due_time, c.visibility, c.created_by, c.start_date,
            (select count(*)::int from public.chore_assignee a where a.chore_id = c.id),
            (select count(*)::int from public.chore_tag t where t.chore_id = c.id)
       from public.chore c where c.id = pg_temp.id('bed') $$,
  $$ values ('Make bed'::text, 'chore'::text, 5, '07:30'::time, 'family'::text,
             'c1000000-0000-0000-0000-000000000001'::uuid, (now() at time zone 'America/Chicago')::date, 2, 2) $$,
  '[CHR-01][CHR-11] an admin saves a chore with two assignees, two tags and a due time; they are its creator and it starts today, household time');
select is(
  (select day_types from public.chore where id = pg_temp.id('bed'))::text,
  '{school_day,no_school,break,weekend,summer}',
  '[CHR-01] an item applies on every day type unless told otherwise');

select pg_temp.keep('fees', public.save_chore(
  'c0000000-0000-0000-0000-000000000001', null,
  '{"title": "Pay school fees", "icon": "buy", "kind": "task", "schedule": {"freq": "once", "on_date": "2026-11-02"}}',
  array['c1110000-0000-0000-0000-000000000002']::uuid[]));
select is((select kind || ':' || points || ':' || coalesce(due_time::text, '-') from public.chore where id = pg_temp.id('fees')),
  'task:0:-', '[CHR-01] a task for an adult, with a due date and no time or points');

select throws_ok(
  $$ select public.save_chore('c0000000-0000-0000-0000-000000000001', null,
       '{"title": "Nobody", "schedule": {"freq": "daily"}}', '{}') $$,
  '23514', 'choose who it is for', '[CHR-09] an item needs at least one assignee');
select throws_ok(
  $$ select public.save_chore('c0000000-0000-0000-0000-000000000001', null,
       '{"title": "Theirs", "schedule": {"freq": "daily"}}', array['c1110000-0000-0000-0000-000000000009']::uuid[]) $$,
  '23514', 'choose who it is for', '[NFR-04] a member of another household is not an assignee');
select throws_ok(
  $$ insert into public.chore_assignee (household_id, chore_id, member_id)
     values ('c0000000-0000-0000-0000-000000000001', current_setting('test.bed')::uuid, 'c1110000-0000-0000-0000-000000000009') $$,
  '23503', null, '[NFR-04] the database refuses a link to another household''s member');
select throws_ok(
  $$ select public.save_chore('c0000000-0000-0000-0000-000000000001', null,
       '{"title": "Bad", "schedule": {"freq": "weekly"}}', array['c1110000-0000-0000-0000-000000000001']::uuid[]) $$,
  '23514', null, '[CHR-01] the database refuses a malformed schedule whatever the app sends');
select throws_ok(
  $$ select public.save_chore('c0000000-0000-0000-0000-000000000001', null,
       '{"title": "Bad", "schedule": {"freq": "daily"}, "day_types": ["holiday"]}', array['c1110000-0000-0000-0000-000000000001']::uuid[]) $$,
  '23514', null, '[CHR-01] day types come from the known list');
select throws_ok(
  $$ select public.save_chore('c0000000-0000-0000-0000-000000000001', null,
       '{"title": "Bad", "schedule": {"freq": "daily"}, "due_time": "07:30:15"}', array['c1110000-0000-0000-0000-000000000001']::uuid[]) $$,
  '23514', null, '[CHR-11] a due time is whole minutes');

-- Editing: assignees and tags are replaced; an archived tag stays on the item but is not added.
update public.tag set archived_at = now() where id = 'c7a90000-0000-0000-0000-000000000002';
select public.save_chore('c0000000-0000-0000-0000-000000000001', pg_temp.id('bed'),
  '{"title": "Make your bed", "icon": "chore-bed", "kind": "chore", "points": 5, "schedule": {"freq": "daily"}, "due_time": "07:15"}',
  array['c1110000-0000-0000-0000-000000000001', 'c1110000-0000-0000-0000-000000000003']::uuid[],
  array['c7a90000-0000-0000-0000-000000000003']::uuid[]);
select results_eq(
  $$ select (select title from public.chore where id = pg_temp.id('bed')),
            (select string_agg(m.display_name, ',' order by m.display_name) from public.chore_assignee a
               join public.member m on m.id = a.member_id where a.chore_id = pg_temp.id('bed')),
            (select string_agg(t.name, ',' order by t.name) from public.chore_tag ct
               join public.tag t on t.id = ct.tag_id where ct.chore_id = pg_temp.id('bed')) $$,
  $$ values ('Make your bed'::text, 'Maya,Sam'::text, 'Garden,Morning'::text) $$,
  '[CHR-09][CHR-10] an edit replaces assignees and tags, and keeps an archived tag already on the item');
select public.save_chore('c0000000-0000-0000-0000-000000000001', pg_temp.id('bed'),
  '{"title": "Make your bed", "schedule": {"freq": "daily"}, "due_time": null}',
  array['c1110000-0000-0000-0000-000000000001', 'c1110000-0000-0000-0000-000000000003']::uuid[],
  array['c7a90000-0000-0000-0000-000000000003']::uuid[]);
select is((select coalesce(due_time::text, '-') || ':' || icon || ':' || points from public.chore where id = pg_temp.id('bed')),
  '-:chore-bed:5', '[CHR-11] an edit can clear the due time; fields it leaves out keep their values');
select public.save_chore('c0000000-0000-0000-0000-000000000001', pg_temp.id('fees'),
  '{"title": "Pay school fees", "kind": "task", "schedule": {"freq": "once", "on_date": "2026-11-02"}}',
  array['c1110000-0000-0000-0000-000000000002']::uuid[],
  array['c7a90000-0000-0000-0000-000000000002']::uuid[]);
select is((select count(*)::int from public.chore_tag where chore_id = pg_temp.id('fees')), 0,
  '[CHR-10] an archived tag is not added to an item');

-- Renaming a tag keeps every item that has it (goals keep the id, D-33).
update public.tag set name = 'Kitchen & dishes' where id = 'c7a90000-0000-0000-0000-000000000001';
select pg_temp.keep('dishes', public.save_chore('c0000000-0000-0000-0000-000000000001', null,
  '{"title": "Dishes", "icon": "chore-dishes", "schedule": {"freq": "daily"}}',
  array['c1110000-0000-0000-0000-000000000001']::uuid[], array['c7a90000-0000-0000-0000-000000000001']::uuid[]));
update public.tag set name = 'Kitchen' where id = 'c7a90000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.chore_tag where tag_id = 'c7a90000-0000-0000-0000-000000000001'), 1,
  '[CHR-10] renaming a tag keeps the items that have it');

update public.chore set created_by = 'c2000000-0000-0000-0000-000000000002' where id = pg_temp.id('bed');
select is((select created_by from public.chore where id = pg_temp.id('bed')), 'c1000000-0000-0000-0000-000000000001'::uuid,
  '[CHR-13] an item''s creator cannot be changed');

-- Private items -------------------------------------------------------------------
-- Alex: a surprise for the family (assigned to Alex) and one for Sam to handle (assigned to Sam).
select pg_temp.keep('gift', public.save_chore('c0000000-0000-0000-0000-000000000001', null,
  '{"title": "Buy anniversary gift", "icon": "gift", "kind": "task", "visibility": "private", "schedule": {"freq": "once", "on_date": "2026-11-20"}}',
  array['c1110000-0000-0000-0000-000000000002']::uuid[], array['c7a90000-0000-0000-0000-000000000003']::uuid[]));
select pg_temp.keep('party', public.save_chore('c0000000-0000-0000-0000-000000000001', null,
  '{"title": "Plan the surprise party", "kind": "task", "visibility": "private", "schedule": {"freq": "once", "on_date": "2026-11-21"}}',
  array['c1110000-0000-0000-0000-000000000003']::uuid[]));
select is((select count(*)::int from public.chore where visibility = 'private'), 2,
  '[CHR-13] the creator sees their private items');
update public.chore set title = 'Buy a gift' where id = pg_temp.id('gift');
select is((select title from public.chore where id = pg_temp.id('gift')), 'Buy a gift',
  '[CHR-13] the creator edits their private item');

-- Sam, the other admin: not the gift (not an assignee), but the party (an assignee who signs in).
select pg_temp.act_as('c2000000-0000-0000-0000-000000000002');
select results_eq($$ select title from public.chore where visibility = 'private' $$,
  $$ values ('Plan the surprise party'::text) $$,
  '[CHR-13] the other admin sees only the private items assigned to them');
select is((select count(*)::int from public.chore_assignee where chore_id = pg_temp.id('gift')), 0,
  '[CHR-13] the other admin gets none of a private item''s assignees');
select is((select count(*)::int from public.chore_tag where chore_id = pg_temp.id('gift')), 0,
  '[CHR-13] the other admin gets none of a private item''s tags');
select is((select count(*)::int from public.audit_log where chore_id = pg_temp.id('gift')), 0,
  '[CHR-13] the other admin gets none of a private item''s audit history');
select ok((select count(*) from public.audit_log where chore_id = pg_temp.id('party')) > 0,
  '[CHR-13] an assignee who signs in sees the audit history of a private item assigned to them');
update public.chore set title = 'Peeked' where id = pg_temp.id('gift');
select throws_ok(
  $$ select public.save_chore('c0000000-0000-0000-0000-000000000001', current_setting('test.gift')::uuid,
       '{"title": "Peeked", "schedule": {"freq": "daily"}}', array['c1110000-0000-0000-0000-000000000003']::uuid[]) $$,
  'P0002', 'that item was not found', '[CHR-13] the other admin cannot edit a private item they cannot see');
select throws_ok(
  $$ insert into public.chore_assignee (household_id, chore_id, member_id)
     values ('c0000000-0000-0000-0000-000000000001', current_setting('test.gift')::uuid, 'c1110000-0000-0000-0000-000000000003') $$,
  '42501', null, '[CHR-13] the other admin cannot assign themselves to a private item they cannot see');
select throws_ok(
  $$ update public.chore set visibility = 'private' where id = current_setting('test.dishes')::uuid $$,
  '42501', 'only the person who created this item can change who sees it',
  '[CHR-13] only the creator makes a family item private');
select throws_ok(
  $$ update public.chore set visibility = 'family' where id = current_setting('test.party')::uuid $$,
  '42501', 'only the person who created this item can change who sees it',
  '[CHR-13] an assignee cannot make someone else''s private item family-visible');
select lives_ok(
  $$ update public.chore set title = 'Plan the party' where id = current_setting('test.party')::uuid $$,
  '[CHR-13] an assignee who signs in can edit a private item assigned to them');
select is((select count(*)::int from public.chore where visibility = 'family'), 3,
  '[CHR-13] the other admin sees every family item');

reset role;
select is((select title from public.chore where id = pg_temp.id('gift')), 'Buy a gift',
  '[CHR-13] the other admin''s edit of the private item changed nothing');

-- The board: family items and their assignees, never a private one, and no writes.
select pg_temp.act_as_device('cd000000-0000-0000-0000-00000000000d');
select results_eq($$ select title from public.chore order by title $$,
  $$ values ('Dishes'::text), ('Make your bed'), ('Pay school fees') $$,
  '[CHR-13] the board sees the family items and no private item');
select is((select count(*)::int from public.chore_assignee where chore_id in (pg_temp.id('gift'), pg_temp.id('party'))), 0,
  '[CHR-13] the board gets no assignee of a private item');
select is((select count(*)::int from public.chore_assignee), 4,
  '[CHR-09] the board sees who each family item is for');
select throws_ok(
  $$ insert into public.chore (household_id, title, schedule) values
       ('c0000000-0000-0000-0000-000000000001', 'From the board', '{"freq": "daily"}') $$,
  '42501', null, '[CHR-13] a board cannot add items');

-- Another household sees none of it.
select pg_temp.act_as('c3000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.chore) + (select count(*)::int from public.tag)
          + (select count(*)::int from public.chore_assignee) + (select count(*)::int from public.chore_tag), 0,
  '[NFR-04] items, tags and their links are invisible to another household');

-- Audit: every item change is recorded with its item, so the visibility rule can follow it.
reset role;
select results_eq(
  $$ select entity_type, count(*)::int from public.audit_log
      where household_id = 'c0000000-0000-0000-0000-000000000001' and entity_type like 'chore%'
        and chore_id is not null group by entity_type order by entity_type $$,
  $$ select entity_type, count(*)::int from public.audit_log
      where household_id = 'c0000000-0000-0000-0000-000000000001' and entity_type like 'chore%'
      group by entity_type order by entity_type $$,
  '[ACC-05][CHR-13] every audit row about an item, its assignees or its tags carries the item');
select ok(exists (select from public.audit_log where entity_type = 'chore_assignee'
                    and entity_id = 'c1110000-0000-0000-0000-000000000003' and chore_id = pg_temp.id('party')),
  '[ACC-05] an assignee change names the member it added');

-- When the creator's sign-in is deleted, the item stays and has no creator.
delete from public.household_user where user_id = 'c1000000-0000-0000-0000-000000000001';
update public.member set user_id = null where user_id = 'c1000000-0000-0000-0000-000000000001';
delete from auth.users where id = 'c1000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.chore where created_by is null), 5,
  '[CHR-13] deleting a sign-in keeps its items and clears their creator');
-- The remaining admin can now claim a family item by making it private.
select pg_temp.act_as('c2000000-0000-0000-0000-000000000002');
update public.chore set visibility = 'private' where id = pg_temp.id('dishes');
reset role;
select is((select created_by from public.chore where id = pg_temp.id('dishes')), 'c2000000-0000-0000-0000-000000000002'::uuid,
  '[CHR-13] an item with no creator is claimed by the admin who makes it private');

select * from finish();
rollback;
