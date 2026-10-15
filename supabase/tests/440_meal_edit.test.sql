-- [MEAL-15][US-701] Edit on a planned meal (WP-76, D-111): update_meal_entry() changes an entry in
-- place, keeping its id and its place in the order, and replaces its people; moved to another day or
-- meal of the day it goes last there; a library meal or person archived since stays while it is on the
-- entry; another household, a board and an entry that isn't there are refused.
begin;
select plan(17);

insert into auth.users (id, email) values
  ('44100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('44300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('44d00000-0000-0000-0000-00000000000d', 'board@devices.example');
insert into public.household (id, name, timezone, week_start) values
  ('44000000-0000-0000-0000-000000000001', 'Edit family', 'America/Chicago', 0),
  ('44000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago', 0);
insert into public.household_user (household_id, user_id, role) values
  ('44000000-0000-0000-0000-000000000001', '44100000-0000-0000-0000-000000000001', 'owner'),
  ('44000000-0000-0000-0000-000000000002', '44300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('44110000-0000-0000-0000-00000000000a', '44000000-0000-0000-0000-000000000001', 'Alex', 'adult'),
  ('44110000-0000-0000-0000-00000000000b', '44000000-0000-0000-0000-000000000001', 'Sam', 'adult'),
  ('44110000-0000-0000-0000-00000000000c', '44000000-0000-0000-0000-000000000001', 'Maya', 'child'),
  ('44110000-0000-0000-0000-00000000000d', '44000000-0000-0000-0000-000000000001', 'Leo', 'child'),
  ('44110000-0000-0000-0000-000000000009', '44000000-0000-0000-0000-000000000002', 'Dee', 'child');
insert into public.meal (id, household_id, name, meal_types) values
  ('44f00000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-000000000001', 'Tacos', '{dinner}'),
  ('44f00000-0000-0000-0000-000000000002', '44000000-0000-0000-0000-000000000001', 'Old casserole', '{dinner}'),
  ('44f00000-0000-0000-0000-000000000003', '44000000-0000-0000-0000-000000000001', 'Gone stew', '{dinner}');
insert into public.device (id, household_id, name, auth_user_id) values
  ('44dd0000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-000000000001', 'Kitchen',
   '44d00000-0000-0000-0000-00000000000d');

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_board() returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '44d00000-0000-0000-0000-00000000000d',
    'role', 'authenticated', 'app_metadata',
    json_build_object('role', 'device', 'device_id', '44dd0000-0000-0000-0000-000000000001'))::text, true);
end $$;
-- People as letters a to d (empty: everyone), as the form sends them.
create function pg_temp.ids(p_people text[]) returns jsonb language sql as $$
  select coalesce(jsonb_agg('44110000-0000-0000-0000-00000000000' || x), '[]'::jsonb) from unnest(p_people) x
$$;
create function pg_temp.add(p_id text, p_slot text, p_text text, p_people text[]) returns jsonb
language sql as $$
  select public.add_meal_entry(jsonb_build_object(
    'id', '44e00000-0000-0000-0000-0000000000' || p_id, 'household_id', '44000000-0000-0000-0000-000000000001',
    'plan_date', '2026-10-15', 'slot', p_slot, 'free_text', p_text, 'member_ids', pg_temp.ids(p_people)))
$$;
-- An edit of entry p_id: what the form sends, all of it.
create function pg_temp.edit(p_id text, p_date date, p_slot text, p_what jsonb, p_people text[], p_notes text,
                             p_household uuid default '44000000-0000-0000-0000-000000000001') returns jsonb
language sql as $$
  select public.update_meal_entry(jsonb_build_object(
    'id', '44e00000-0000-0000-0000-0000000000' || p_id, 'household_id', p_household,
    'plan_date', p_date, 'slot', p_slot, 'member_ids', pg_temp.ids(p_people), 'notes', p_notes) || p_what)
$$;
-- An entry as it reads: "2026-10-15 dinner #2 Tacos (Leo, Maya) — Make extra".
create function pg_temp.entry(p_id text) returns text language sql as $$
  select e.plan_date || ' ' || e.slot || ' #' || e.sort_order || ' '
         || coalesce(e.free_text, (select m.name from public.meal m where m.id = e.meal_id))
         || coalesce(' (' || (select string_agg(p.display_name, ', ' order by p.display_name)
                                from public.meal_plan_entry_member x join public.member p on p.id = x.member_id
                               where x.entry_id = e.id) || ')', '')
         || coalesce(' — ' || e.notes, '')
    from public.meal_plan_entry e where e.id = ('44e00000-0000-0000-0000-0000000000' || p_id)::uuid
$$;

select pg_temp.as_user('44100000-0000-0000-0000-000000000001');
select pg_temp.add('01', 'dinner', 'Fish fingers', array['c', 'd']);
select pg_temp.add('02', 'dinner', 'Soup', array['a', 'b']);
select pg_temp.add('03', 'dinner', 'Salad', array[]::text[]);
select pg_temp.add('04', 'lunch', 'Ham sandwiches', array[]::text[]);

-- [MEAL-15] The middle of three dinners, changed to a library meal, for one other person, with a note.
select is(pg_temp.edit('02', '2026-10-15', 'dinner', '{"meal_id": "44f00000-0000-0000-0000-000000000001"}', array['c'],
                       'Make extra') ->> 'sort_order', '2',
  '[MEAL-15][US-701] an edit in the same day and meal of the day keeps its place in the order');
select is(pg_temp.entry('02'), '2026-10-15 dinner #2 Tacos (Maya) — Make extra',
  '... the same entry (its id), now the library''s Tacos, for Maya only (her people replaced), with the note');
select is((select count(*)::int from public.meal_plan_entry where household_id = '44000000-0000-0000-0000-000000000001'),
  4, '... and nothing is added');
select is((select string_agg(free_text, ', ' order by sort_order) from public.meal_plan_entry
            where plan_date = '2026-10-15' and slot = 'dinner' and free_text is not null),
  'Fish fingers, Salad', '... the dinners either side of it are where they were');
-- Opening it again: what was saved.
select is(pg_temp.edit('02', '2026-10-15', 'dinner', '{"free_text": "Tacos, homemade"}', array[]::text[], null)
            ->> 'id', '44e00000-0000-0000-0000-000000000002', '[MEAL-15] edited again, by the same id');
select is(pg_temp.entry('02'), '2026-10-15 dinner #2 Tacos, homemade',
  '... now written in, for everyone (no people) and with no note');

-- Moved to another day and meal of the day, it goes last there.
select is(pg_temp.edit('01', '2026-10-15', 'lunch', '{"free_text": "Fish fingers"}', array['c', 'd'], null)
            ->> 'sort_order', '2', '[MEAL-15] moved to lunch, it goes after what lunch has');
select is(pg_temp.entry('01'), '2026-10-15 lunch #2 Fish fingers (Leo, Maya)', '... with its people');

-- [MEAL-02][MEAL-10] A meal or a person archived since stays while it is on the entry; a new one doesn't.
reset role;
update public.meal set archived_at = now() where id in ('44f00000-0000-0000-0000-000000000002', '44f00000-0000-0000-0000-000000000003');
update public.meal_plan_entry set meal_id = '44f00000-0000-0000-0000-000000000002', free_text = null
 where id = '44e00000-0000-0000-0000-000000000003';
update public.member set archived_at = now() where id = '44110000-0000-0000-0000-00000000000d';
select pg_temp.as_user('44100000-0000-0000-0000-000000000001');
select lives_ok($$ select pg_temp.edit('03', '2026-10-15', 'dinner', '{"meal_id": "44f00000-0000-0000-0000-000000000002"}',
                                       array[]::text[], 'Last of it') $$,
  '[MEAL-02] an entry keeps a library meal archived since');
select throws_ok($$ select pg_temp.edit('03', '2026-10-15', 'dinner', '{"meal_id": "44f00000-0000-0000-0000-000000000003"}',
                                        array[]::text[], null) $$,
  '22023', 'that meal isn''t in the library', '... but can''t change to another archived one');
select lives_ok($$ select pg_temp.edit('01', '2026-10-15', 'lunch', '{"free_text": "Fish fingers"}', array['d'], null) $$,
  '[MEAL-10] an entry keeps a person archived since');
select throws_ok($$ select pg_temp.edit('04', '2026-10-15', 'lunch', '{"free_text": "Ham sandwiches"}', array['d'], null) $$,
  '22023', 'not one of this family', '... but an archived person can''t be added to another');
select throws_ok($$ select pg_temp.edit('04', '2026-10-15', 'lunch', '{"free_text": "Ham sandwiches"}', array['9'], null) $$,
  '22023', 'not one of this family', '[NFR-04] nor someone in another family');
select throws_ok($$ select pg_temp.edit('04', '2026-10-15', 'lunch', '{}', array[]::text[], null) $$,
  '22023', 'a meal from the library, or something written in', '[MEAL-15] an entry is a meal or something written in');
select throws_ok($$ select pg_temp.edit('99', '2026-10-15', 'lunch', '{"free_text": "Soup"}', array[]::text[], null) $$,
  'P0002', 'entry not found', '... and one that isn''t there isn''t made');

-- [NFR-04] Another household's parent, naming either household, and the board can't change it.
select pg_temp.as_user('44300000-0000-0000-0000-000000000003');
select throws_ok($$ select pg_temp.edit('04', '2026-10-15', 'lunch', '{"free_text": "Gotcha"}', array[]::text[], null,
                                        '44000000-0000-0000-0000-000000000002') $$,
  '42501', 'not allowed', '[NFR-04] another household can''t update the entry, through its own household');
select pg_temp.as_board();
select throws_ok($$ select pg_temp.edit('04', '2026-10-15', 'lunch', '{"free_text": "Gotcha"}', array[]::text[], null) $$,
  '42501', 'not allowed', '[NFR-04] nor a board');

select * from finish();
rollback;
