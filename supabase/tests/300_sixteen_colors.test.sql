-- [ACC-04][CHR-10][CAL-05] Sixteen colors (WP-46, D-70): members, tags and calendars take any of
-- member-1 to member-16, and nothing else. Icons are checked by name only, so the larger icon set
-- needs no database change; a Lucide name like trash-2 fits the existing checks.
begin;
select plan(16);

insert into public.household (id, name, timezone, week_start) values
  ('30000000-0000-0000-0000-000000000001', 'Color family', 'America/New_York', 0);
insert into public.member (id, household_id, display_name, role, color) values
  ('30110000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', 'Ava', 'child', 'member-1');

-- Members
select lives_ok(
  $$update public.member set color = 'member-16' where id = '30110000-0000-0000-0000-00000000000a'$$,
  'a member can be Slate (member-16)');
select lives_ok(
  $$update public.member set color = 'member-10' where id = '30110000-0000-0000-0000-00000000000a'$$,
  'a member can be Cyan (member-10)');
select throws_ok(
  $$update public.member set color = 'member-17' where id = '30110000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'member-17 is not a color');
select throws_ok(
  $$update public.member set color = 'member-0' where id = '30110000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'member-0 is not a color');
select throws_ok(
  $$update public.member set color = 'member-01' where id = '30110000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'member-01 is not a color');
select throws_ok(
  $$update public.member set color = 'red' where id = '30110000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'a color name is not a color key');

-- Tags
select lives_ok(
  $$insert into public.tag (household_id, name, color, icon)
    values ('30000000-0000-0000-0000-000000000001', 'Kitchen', 'member-12', 'cooking-pot')$$,
  'a tag can be Indigo (member-12) with a Lucide icon');
select lives_ok(
  $$insert into public.tag (household_id, name, color, icon)
    values ('30000000-0000-0000-0000-000000000001', 'Bins', 'member-9', 'trash-2')$$,
  'a Lucide name with a digit fits the icon check');
select throws_ok(
  $$insert into public.tag (household_id, name, color)
    values ('30000000-0000-0000-0000-000000000001', 'Garden', 'member-20')$$,
  '23514', null, 'a tag cannot be member-20');
select is(
  (select color from public.tag where name = 'Kitchen' and household_id = '30000000-0000-0000-0000-000000000001'),
  'member-12', 'the tag keeps its color');

-- Calendars
select lives_ok(
  $$insert into public.calendar_source (household_id, name, url_secret_id, color)
    values ('30000000-0000-0000-0000-000000000001', 'Sport', gen_random_uuid(), 'member-13')$$,
  'a calendar can be Purple (member-13)');
select throws_ok(
  $$insert into public.calendar_source (household_id, name, url_secret_id, color)
    values ('30000000-0000-0000-0000-000000000001', 'Music', gen_random_uuid(), 'member-7 ')$$,
  '23514', null, 'a calendar color with a trailing space is refused');
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'calendar_source' and column_name = 'color'),
  '''member-6''::text', 'the calendar default is unchanged');

-- Every key from 1 to 16 passes all three checks
select is(
  (select count(*)::int from generate_series(1, 16) n where ('member-' || n) ~ '^member-([1-9]|1[0-6])$'),
  16, 'member-1 to member-16 all pass');
select is(
  (select count(*)::int from pg_constraint
    where conname in ('member_color_check', 'tag_color_check', 'calendar_source_color_check')
      and pg_get_constraintdef(oid) like '%member-([1-9]|1[0-6])$%'),
  3, 'the three color checks are the sixteen-color check');
select is(
  (select count(*)::int from pg_constraint
    where conname in ('member_color_check', 'tag_color_check', 'calendar_source_color_check')
      and convalidated),
  3, 'the three checks are validated against every stored row');

select * from finish();
rollback;
