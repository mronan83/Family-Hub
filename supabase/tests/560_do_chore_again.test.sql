-- [CHR-23][D-132] Do again (WP-96): a completed one-time item done again adds a new one-time item on
-- the date picked, with the same people, points, time, icon and tags, while the original keeps its
-- completion, the points it paid and its goal credit (its occurrences' status, who did them and who
-- was rewarded); a repeating item, another household's item and no date are refused.
begin;
select plan(10);

-- Fixtures ---------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('56100000-0000-0000-0000-000000000001', 'again-parent@example.com'),
  ('56100000-0000-0000-0000-000000000002', 'again-neighbour@example.com');
insert into public.household (id, name, timezone) values
  ('56000000-0000-0000-0000-000000000001', 'Again family', 'America/Chicago'),
  ('56000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('56000000-0000-0000-0000-000000000001'), ('56000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('56000000-0000-0000-0000-000000000001', '56100000-0000-0000-0000-000000000001', 'owner'),
  ('56000000-0000-0000-0000-000000000002', '56100000-0000-0000-0000-000000000002', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('56110000-0000-0000-0000-000000000001', '56000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('56110000-0000-0000-0000-000000000002', '56000000-0000-0000-0000-000000000001', 'Leo', 'child', null),
  ('56110000-0000-0000-0000-000000000009', '56000000-0000-0000-0000-000000000002', 'Kit', 'child', null);
insert into public.tag (id, household_id, name) values
  ('56700000-0000-0000-0000-000000000001', '56000000-0000-0000-0000-000000000001', 'Garage'),
  ('56700000-0000-0000-0000-000000000002', '56000000-0000-0000-0000-000000000001', 'Old tag');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('56000000-0000-0000-0000-000000000001')
$$;
create function pg_temp.parent() returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '56100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
end $$;
-- The original's completion, points and goal credit, as one line to compare before and after.
create function pg_temp.original() returns text language sql as $$
  select string_agg(o.member_id || ':' || o.status || ':' || o.done_by::text || ':' || o.rewarded::text
                    || ':' || (select coalesce(sum(l.amount), 0) from public.points_ledger l
                                where l.occurrence_id = o.id), ',' order by o.member_id)
    from public.chore_occurrence o where o.chore_id = '56400000-0000-0000-0000-000000000001'
$$;

-- Clean out the garage: once, today, for Maya and Leo each their own, 20 points, at 10 am, tagged.
insert into public.chore (id, household_id, title, icon, kind, points, schedule, due_time, assignment, created_by)
values ('56400000-0000-0000-0000-000000000001', '56000000-0000-0000-0000-000000000001', 'Clean out the garage',
        'archive', 'chore', 20, jsonb_build_object('freq', 'once', 'on_date', pg_temp.today()), '10:00', 'each',
        '56100000-0000-0000-0000-000000000001');
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('56000000-0000-0000-0000-000000000001', '56400000-0000-0000-0000-000000000001', '56110000-0000-0000-0000-000000000001'),
  ('56000000-0000-0000-0000-000000000001', '56400000-0000-0000-0000-000000000001', '56110000-0000-0000-0000-000000000002');
insert into public.chore_tag (household_id, chore_id, tag_id) values
  ('56000000-0000-0000-0000-000000000001', '56400000-0000-0000-0000-000000000001', '56700000-0000-0000-0000-000000000001'),
  ('56000000-0000-0000-0000-000000000001', '56400000-0000-0000-0000-000000000001', '56700000-0000-0000-0000-000000000002');
update public.tag set archived_at = now() where id = '56700000-0000-0000-0000-000000000002';
-- A repeating item, and the neighbours' one-time item.
insert into public.chore (id, household_id, title, kind, schedule, created_by) values
  ('56400000-0000-0000-0000-000000000002', '56000000-0000-0000-0000-000000000001', 'Make bed', 'chore',
   '{"freq": "daily"}', '56100000-0000-0000-0000-000000000001'),
  ('56400000-0000-0000-0000-000000000009', '56000000-0000-0000-0000-000000000002', 'Their chore', 'chore',
   jsonb_build_object('freq', 'once', 'on_date', pg_temp.today()), '56100000-0000-0000-0000-000000000002');
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('56000000-0000-0000-0000-000000000001', '56400000-0000-0000-0000-000000000002', '56110000-0000-0000-0000-000000000001'),
  ('56000000-0000-0000-0000-000000000002', '56400000-0000-0000-0000-000000000009', '56110000-0000-0000-0000-000000000009');

-- Maya and Leo both do theirs.
select public.record_completions(jsonb_agg(jsonb_build_object(
  'id', gen_random_uuid(), 'occurrence_id', o.id, 'event_type', 'complete',
  'occurred_at', now() - interval '1 minute', 'done_by', jsonb_build_array(o.member_id))))
  from public.chore_occurrence o where o.chore_id = '56400000-0000-0000-0000-000000000001';
create temp table before_again as select pg_temp.original() as line;
grant select on before_again to authenticated;

select is((select count(*)::int from public.chore_occurrence
            where chore_id = '56400000-0000-0000-0000-000000000001' and status in ('completed', 'approved')), 2,
  '[CHR-23] set-up: the garage is done by Maya and Leo');
select is((select coalesce(sum(l.amount), 0)::int from public.points_ledger l join public.chore_occurrence o on o.id = l.occurrence_id
            where o.chore_id = '56400000-0000-0000-0000-000000000001'), 40,
  '[CHR-23] set-up: Maya and Leo earned its 20 points each');

-- Do again, as the parent ------------------------------------------------------------------------
select pg_temp.parent();
create temp table again as
  select public.do_chore_again('56000000-0000-0000-0000-000000000001', '56400000-0000-0000-0000-000000000001',
                               pg_temp.today() + 3) as id;

select is((select title || '|' || icon || '|' || kind || '|' || points || '|' || due_time::text || '|' || assignment
                  || '|' || (schedule ->> 'freq') || '|' || (schedule ->> 'on_date')
             from public.chore where id = (select id from again)),
  'Clean out the garage|archive|chore|20|10:00:00|each|once|' || (pg_temp.today() + 3)::text,
  '[CHR-23-b] Do again adds a new one-time item on the date picked, with the same name, icon, points, time and assignment');
select is((select string_agg(m.display_name, ',' order by m.display_name) from public.chore_assignee a
             join public.member m on m.id = a.member_id where a.chore_id = (select id from again)),
  'Leo,Maya', '[CHR-23-b] the new item is for the same people');
select is((select string_agg(t.name, ',') from public.chore_tag ct join public.tag t on t.id = ct.tag_id
            where ct.chore_id = (select id from again)),
  'Garage', '[CHR-23-b] the new item keeps the active tags, not one archived since');
select is((select count(*)::int from public.chore_occurrence
            where chore_id = (select id from again) and due_date = pg_temp.today() + 3 and status = 'scheduled'), 2,
  '[CHR-23-b] the new item is planned on its date, one for each person, not done');
select is(pg_temp.original(), (select line from before_again),
  '[CHR-23-b] the original keeps its completion, the points it paid and its goal credit, and is not reopened');

select throws_ok(
  $$ select public.do_chore_again('56000000-0000-0000-0000-000000000001', '56400000-0000-0000-0000-000000000002', pg_temp.today() + 1) $$,
  '23514', 'only a one-time item is done again', '[CHR-23-b] a repeating item is not done again');
select throws_ok(
  $$ select public.do_chore_again('56000000-0000-0000-0000-000000000001', '56400000-0000-0000-0000-000000000009', pg_temp.today() + 1) $$,
  'P0002', 'that item was not found', '[CHR-23-b] another household''s item is not found');
select throws_ok(
  $$ select public.do_chore_again('56000000-0000-0000-0000-000000000001', '56400000-0000-0000-0000-000000000001', null) $$,
  '23514', 'pick a date', '[CHR-23-b] Do again needs a date');

select * from finish();
rollback;
