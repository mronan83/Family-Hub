-- [SCH-01][SCH-02][SCH-03][NFR-04] School years and day types (WP-21): precedence (weekend, break,
-- other closure, school day, summer), each member's school year with the default as fallback,
-- several years side by side, the date guards, and an item's day-type filter across a break week.
begin;
select plan(32);

-- Fixtures (as the migration owner) -----------------------------------------
insert into auth.users (id, email) values
  ('5c100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('5c300000-0000-0000-0000-000000000003', 'other@example.com'),
  ('5cd00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('5c000000-0000-0000-0000-000000000001', 'School family', 'America/Chicago'),
  ('5c000000-0000-0000-0000-000000000002', 'Other family', 'America/Chicago');
insert into public.household_user (household_id, user_id, role) values
  ('5c000000-0000-0000-0000-000000000001', '5c100000-0000-0000-0000-000000000001', 'owner'),
  ('5c000000-0000-0000-0000-000000000002', '5c300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('5c110000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000001', 'Maya', 'child'),
  ('5c110000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-000000000001', 'Leo', 'child'),
  ('5c110000-0000-0000-0000-000000000003', '5c000000-0000-0000-0000-000000000001', 'Pat', 'adult');
insert into public.device (household_id, name, auth_user_id) values
  ('5c000000-0000-0000-0000-000000000001', 'Kitchen', '5cd00000-0000-0000-0000-00000000000d');

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
-- Maya's, Leo's and Pat's day types on a date.
create function pg_temp.types(p_date date) returns text language sql as $$
  select public.resolve_day_type('5c110000-0000-0000-0000-000000000001', p_date) || ','
      || public.resolve_day_type('5c110000-0000-0000-0000-000000000002', p_date) || ','
      || public.resolve_day_type('5c110000-0000-0000-0000-000000000003', p_date)
$$;

-- The admin sets up the year --------------------------------------------------------
select pg_temp.act_as('5c100000-0000-0000-0000-000000000001');
insert into public.school_year (id, household_id, name, start_date, end_date, is_default) values
  ('5c5e0000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000001', '2026–27', '2026-08-24', '2027-06-11', true),
  ('5c5e0000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-000000000001', 'Leo''s school', '2026-09-01', '2027-06-18', false),
  ('5c5e0000-0000-0000-0000-000000000003', '5c000000-0000-0000-0000-000000000001', '2027–28', '2027-08-23', '2028-06-09', true);
insert into public.school_term (household_id, school_year_id, name, start_date, end_date) values
  ('5c000000-0000-0000-0000-000000000001', '5c5e0000-0000-0000-0000-000000000001', 'Fall', '2026-08-24', '2026-12-18'),
  ('5c000000-0000-0000-0000-000000000001', '5c5e0000-0000-0000-0000-000000000001', 'Spring', '2027-01-04', '2027-06-11');
insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date) values
  ('5c000000-0000-0000-0000-000000000001', '5c5e0000-0000-0000-0000-000000000001', 'Winter break', 'break', '2026-12-21', '2027-01-01'),
  ('5c000000-0000-0000-0000-000000000001', '5c5e0000-0000-0000-0000-000000000001', 'Teacher day', 'teacher_day', '2026-10-16', '2026-10-16'),
  ('5c000000-0000-0000-0000-000000000001', '5c5e0000-0000-0000-0000-000000000001', 'Snow day', 'snow_day', '2027-01-11', '2027-01-11'),
  ('5c000000-0000-0000-0000-000000000001', '5c5e0000-0000-0000-0000-000000000002', 'Fall break', 'break', '2026-10-12', '2026-10-16');
insert into public.member_school_profile (household_id, member_id, school_year_id) values
  ('5c000000-0000-0000-0000-000000000001', '5c110000-0000-0000-0000-000000000002', '5c5e0000-0000-0000-0000-000000000002');

-- Precedence (02 §3.5): weekend, break, other closure, school day, summer -------------------
select is(pg_temp.types('2026-10-17'), 'weekend,weekend,weekend', '[SCH-02] a Saturday is a weekend for everyone');
select is(pg_temp.types('2026-12-26'), 'weekend,weekend,weekend', '[SCH-02] a weekend inside a break is still a weekend');
select is(pg_temp.types('2026-12-22'), 'break,school_day,break',
  '[SCH-02] a weekday inside a break closure is a break (Leo''s school has no break then)');
select is(public.resolve_day_type('5c110000-0000-0000-0000-000000000001', '2026-10-16'), 'no_school',
  '[SCH-02] a teacher day is no_school');
select is(public.resolve_day_type('5c110000-0000-0000-0000-000000000001', '2027-01-11'), 'no_school',
  '[SCH-02] a snow day is no_school');
select is(public.resolve_day_type('5c110000-0000-0000-0000-000000000001', '2026-10-15'), 'school_day',
  '[SCH-02] a weekday inside the school year with no closure is a school day');
select is(pg_temp.types('2026-07-15'), 'summer,summer,summer', '[SCH-02] a weekday outside every school year is summer');

-- Each member's school year, the default as the fallback ---------------------------------------
select is(pg_temp.types('2026-10-14'), 'school_day,break,school_day',
  '[SCH-02] a member assigned to another school follows its calendar; the others follow the default');
select is(pg_temp.types('2026-08-26'), 'school_day,school_day,school_day',
  '[SCH-02] before their own school year starts, a member follows the default year');
select is(public.resolve_day_type('5c110000-0000-0000-0000-000000000003', '2026-12-22'), 'break',
  '[SCH-02] an adult with no school profile follows the default school year');
select is(pg_temp.types('2027-09-01'), 'school_day,school_day,school_day',
  '[SCH-01] next year''s default calendar applies from its first day, with nothing to switch');
select is(pg_temp.types('2027-07-14'), 'summer,summer,summer', '[SCH-02] between two school years is summer');
select results_eq(
  $$ select m.display_name, d.day_type, y.name
       from public.household_day_types('5c000000-0000-0000-0000-000000000001', '2026-10-14') d
       join public.member m on m.id = d.member_id
       left join public.school_year y on y.id = d.school_year_id
      order by m.display_name $$,
  $$ values ('Leo'::text, 'break'::text, 'Leo''s school'::text), ('Maya', 'school_day', '2026–27'), ('Pat', 'school_day', '2026–27') $$,
  '[SCH-02] each member''s day type and school year on a date, in one call');

-- Archiving a year: its members fall back to the default.
update public.school_year set archived_at = now() where id = '5c5e0000-0000-0000-0000-000000000002';
select is(public.resolve_day_type('5c110000-0000-0000-0000-000000000002', '2026-10-14'), 'school_day',
  '[SCH-01] an archived school year no longer applies; its members follow the default');
update public.school_year set archived_at = null where id = '5c5e0000-0000-0000-0000-000000000002';

-- The whole year, day by day, for the timeline
select results_eq(
  $$ select day_type, count(*)::int from public.school_year_days('5c5e0000-0000-0000-0000-000000000001')
      group by day_type order by day_type $$,
  $$ values ('break'::text, 10), ('no_school', 2), ('school_day', 198), ('weekend', 82) $$,
  '[SCH-01] a school year''s 292 days: 198 school days, 10 break days, 2 days off and 82 weekend days');

-- Guards -------------------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.school_year (household_id, name, start_date, end_date, is_default)
     values ('5c000000-0000-0000-0000-000000000001', 'Summer camp', '2027-06-01', '2027-09-01', true) $$,
  '23514', 'another default school year covers some of these dates',
  '[SCH-01] two default school years may not overlap');
select lives_ok(
  $$ insert into public.school_year (household_id, name, start_date, end_date, is_default)
     values ('5c000000-0000-0000-0000-000000000001', 'Summer camp', '2027-06-21', '2027-08-13', false) $$,
  '[SCH-01] a school year that is not the default may overlap others');
select throws_ok(
  $$ insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date)
     values ('5c000000-0000-0000-0000-000000000001', '5c5e0000-0000-0000-0000-000000000001', 'Late', 'holiday', '2027-06-14', '2027-06-14') $$,
  '23514', 'those dates are outside the school year', '[SCH-01] a closure sits inside its school year');
select throws_ok(
  $$ insert into public.school_term (household_id, school_year_id, name, start_date, end_date)
     values ('5c000000-0000-0000-0000-000000000001', '5c5e0000-0000-0000-0000-000000000001', 'Early', '2026-08-01', '2026-09-01') $$,
  '23514', 'those dates are outside the school year', '[SCH-01] a term sits inside its school year');
select throws_ok(
  $$ update public.school_year set end_date = '2026-12-01' where id = '5c5e0000-0000-0000-0000-000000000001' $$,
  '23514', 'a term or closure falls outside these dates', '[SCH-01] shortening a year may not strand its closures');
select throws_ok(
  $$ insert into public.member_school_profile (household_id, member_id, school_year_id)
     values ('5c000000-0000-0000-0000-000000000001', '5c110000-0000-0000-0000-000000000002', '5c5e0000-0000-0000-0000-000000000001') $$,
  '23514', 'they already follow another school year on some of these dates',
  '[SCH-02] a member follows one school year on any date');
select throws_ok(
  $$ insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date)
     values ('5c000000-0000-0000-0000-000000000001', '5c5e0000-0000-0000-0000-000000000001', 'Field trip', 'trip', '2026-11-02', '2026-11-02') $$,
  '23514', null, '[SCH-01] a closure is a break, holiday, teacher day, snow day or other');

-- Day types drive items (SCH-03): a school-days-only item has no day in a break week ----------
reset role;
insert into public.chore (id, household_id, title, schedule, day_types, created_by) values
  ('5c4e0000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000001', 'Homework', '{"freq": "daily"}', '{school_day}', '5c100000-0000-0000-0000-000000000001'),
  ('5c4e0000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-000000000001', 'Pack lunches', '{"freq": "daily"}', '{school_day}', '5c100000-0000-0000-0000-000000000001'),
  ('5c4e0000-0000-0000-0000-000000000003', '5c000000-0000-0000-0000-000000000001', 'Sleep in', '{"freq": "daily"}', '{weekend,break,summer}', '5c100000-0000-0000-0000-000000000001');
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('5c000000-0000-0000-0000-000000000001', '5c4e0000-0000-0000-0000-000000000001', '5c110000-0000-0000-0000-000000000001'),
  ('5c000000-0000-0000-0000-000000000001', '5c4e0000-0000-0000-0000-000000000002', '5c110000-0000-0000-0000-000000000001'),
  ('5c000000-0000-0000-0000-000000000001', '5c4e0000-0000-0000-0000-000000000002', '5c110000-0000-0000-0000-000000000002'),
  ('5c000000-0000-0000-0000-000000000001', '5c4e0000-0000-0000-0000-000000000003', '5c110000-0000-0000-0000-000000000001');
select pg_temp.act_as('5c100000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from generate_series('2026-12-21'::date, '2026-12-25'::date, interval '1 day') d
    where public.chore_day_type_matches('5c4e0000-0000-0000-0000-000000000001', d::date)), 0,
  '[SCH-03] a school-days-only item applies on no day of a break week');
select is(
  (select count(*)::int from generate_series('2026-12-21'::date, '2026-12-25'::date, interval '1 day') d
    where public.chore_day_type_matches('5c4e0000-0000-0000-0000-000000000003', d::date)), 5,
  '[SCH-03] an item for breaks applies on every day of the break week');
select ok(public.chore_day_type_matches('5c4e0000-0000-0000-0000-000000000001', '2026-10-15'),
  '[SCH-03] a school-days-only item applies on a school day');
select ok(public.chore_day_type_matches('5c4e0000-0000-0000-0000-000000000002', '2026-10-14'),
  '[SCH-03] a shared item applies when any assignee''s day matches (Leo is on break, Maya at school)');
select ok(not public.chore_day_type_matches('5c4e0000-0000-0000-0000-000000000001', '2026-10-16'),
  '[SCH-03] a school-days-only item skips a teacher day');

-- Access -------------------------------------------------------------------------------------
select is((select count(*)::int from public.audit_log where entity_type in ('school_year', 'school_term', 'school_closure', 'member_school_profile')
            and actor_id = '5c100000-0000-0000-0000-000000000001'), 13,
  '[ACC-05] school year changes are audited with their admin (4 years, 2 terms, 4 closures, 1 profile, archive and restore; refused ones leave nothing)');

select pg_temp.act_as('5c300000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.school_year) + (select count(*)::int from public.school_closure)
          + (select count(*)::int from public.school_term) + (select count(*)::int from public.member_school_profile), 0,
  '[NFR-04] another household sees none of the school years, terms, closures or profiles');

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object('sub', '5cd00000-0000-0000-0000-00000000000d', 'role', 'authenticated')::text, true);
select is(public.resolve_day_type('5c110000-0000-0000-0000-000000000001', '2026-12-22'), 'break',
  '[SCH-02] the board resolves its family''s day types');
select throws_ok(
  $$ insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date)
     values ('5c000000-0000-0000-0000-000000000001', '5c5e0000-0000-0000-0000-000000000001', 'Board day', 'other', '2026-11-02', '2026-11-02') $$,
  '42501', null, '[NFR-04] a board cannot change the school year');

reset role;
select ok(not has_function_privilege('anon', 'public.resolve_day_type(uuid, date)', 'execute'),
  '[NFR-04] signed-out callers cannot resolve day types');

select * from finish();
rollback;
