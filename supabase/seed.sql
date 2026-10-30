-- The demo family (01 §9.5, D-37). Previews and e2e run as this household inside the one database;
-- RLS keeps it apart from every real household exactly as it keeps two families apart. Running this
-- file again resets the demo family: its household is deleted (every household_id cascades) and
-- recreated, along with its demo sign-ins. It touches no other household. Names are made up.
--
-- Demo sign-ins (WP-03, D-39), all `…@demo.familywise.invalid`, which can never receive email:
--   Alex   owner of the demo family        Sam    admin of the demo family
--   Jordan a parent with no household yet  Riley  a parent with no household yet
-- They are created without a password. scripts/preview-db.sh then sets each password, derived from
-- the deployment-protection bypass secret, so previews (one tap) and e2e can sign in and nobody has
-- to know or store it.

-- Households that e2e set up with demo sign-ins: every admin is a demo sign-in, so never a real one.
delete from public.household h
 where h.id <> '0de00000-0000-4000-8000-000000000001'
   and exists (select from public.household_user hu where hu.household_id = h.id)
   and not exists (
     select from public.household_user hu join auth.users u on u.id = hu.user_id
      where hu.household_id = h.id and u.email not like '%@demo.familywise.invalid');
delete from public.household where id = '0de00000-0000-4000-8000-000000000001';
delete from auth.users where email like '%@demo.familywise.invalid';
-- Boards whose device row is gone (e2e's, with the demo family): their sign-ins go too (WP-05).
delete from auth.users u
 where u.email like 'device-%@devices.familywise.invalid'
   and not exists (select from public.device d where d.auth_user_id = u.id);
-- Setup codes left behind: used by a household that is gone (e2e's), or expired unused.
delete from private.household_setup_code
 where (used_at is not null and household_id is null) or (used_at is null and expires_at < now());

-- is_demo: production's jobs leave the demo family alone; its tests run what the jobs do (D-62).
insert into public.household (id, name, timezone, is_demo)
values ('0de00000-0000-4000-8000-000000000001', 'Demo family', 'America/New_York', true);

insert into public.household_settings (household_id)
values ('0de00000-0000-4000-8000-000000000001');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, null, now(),
       '', '', '', '', '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
  from (values
    ('0de00000-0000-4000-8000-0000000000a1'::uuid, 'alex@demo.familywise.invalid'),
    ('0de00000-0000-4000-8000-0000000000a2'::uuid, 'sam@demo.familywise.invalid'),
    ('0de00000-0000-4000-8000-0000000000a3'::uuid, 'jordan@demo.familywise.invalid'),
    ('0de00000-0000-4000-8000-0000000000a4'::uuid, 'riley@demo.familywise.invalid')
  ) as demo (id, email);

insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
select id::text, id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now()
  from auth.users where email like '%@demo.familywise.invalid';

insert into public.household_user (household_id, user_id, role)
values
  ('0de00000-0000-4000-8000-000000000001', '0de00000-0000-4000-8000-0000000000a1', 'owner'),
  ('0de00000-0000-4000-8000-000000000001', '0de00000-0000-4000-8000-0000000000a2', 'admin');

insert into public.member (household_id, display_name, role, avatar_key, color, birth_year, user_id)
values
  ('0de00000-0000-4000-8000-000000000001', 'Alex', 'adult', 'owl', 'member-1', 1986, '0de00000-0000-4000-8000-0000000000a1'),
  ('0de00000-0000-4000-8000-000000000001', 'Sam', 'adult', 'bear', 'member-2', 1987, '0de00000-0000-4000-8000-0000000000a2'),
  ('0de00000-0000-4000-8000-000000000001', 'Maya', 'child', 'fox', 'member-3', 2016, null),
  ('0de00000-0000-4000-8000-000000000001', 'Leo', 'child', 'frog', 'member-4', 2019, null);


-- The family list (WP-08): household tags, six routines and three tasks. Sam's anniversary gift is
-- private, so Alex and the board never see it. Due dates count from today in the family's time zone,
-- so the list always looks current.
insert into public.tag (id, household_id, name, color, icon, sort_order)
values
  ('0de00000-0000-4000-8000-0000000a0001', '0de00000-0000-4000-8000-000000000001', 'Morning', 'member-6', 'sun', 1),
  ('0de00000-0000-4000-8000-0000000a0002', '0de00000-0000-4000-8000-000000000001', 'Kitchen', 'member-3', 'chore-dishes', 2),
  ('0de00000-0000-4000-8000-0000000a0003', '0de00000-0000-4000-8000-000000000001', 'Bedroom', 'member-4', 'chore-bed', 3),
  ('0de00000-0000-4000-8000-0000000a0004', '0de00000-0000-4000-8000-000000000001', 'School', 'member-1', 'backpack', 4);

with today as (select (now() at time zone 'America/New_York')::date as d)
insert into public.chore (id, household_id, title, icon, kind, points, approval, schedule, due_time,
                          day_types, visibility, created_by, start_date, assignment)
select id::uuid, '0de00000-0000-4000-8000-000000000001', title, icon, kind, points, approval, schedule,
       due_time::time, coalesce(day_types::text[], array['school_day', 'no_school', 'break', 'weekend', 'summer']),
       visibility, created_by::uuid, d - 14,
       -- Each child makes their own bed and brushes their own teeth (D-47); the dog is fed once.
       case when id in ('0de00000-0000-4000-8000-0000000c0001', '0de00000-0000-4000-8000-0000000c0002')
            then 'each' else 'shared' end
  from today, lateral (values
    ('0de00000-0000-4000-8000-0000000c0001', 'Make bed', 'chore-bed', 'chore', 5, 'inherit',
     '{"freq": "daily"}'::jsonb, '07:30', null, 'family', '0de00000-0000-4000-8000-0000000000a1'),
    ('0de00000-0000-4000-8000-0000000c0002', 'Brush teeth', 'chore-teeth', 'chore', 2, 'inherit',
     '{"freq": "daily"}', '07:45', null, 'family', '0de00000-0000-4000-8000-0000000000a1'),
    ('0de00000-0000-4000-8000-0000000c0003', 'Feed the dog', 'chore-pet', 'chore', 5, 'inherit',
     '{"freq": "daily"}', '17:00', null, 'family', '0de00000-0000-4000-8000-0000000000a1'),
    ('0de00000-0000-4000-8000-0000000c0004', 'Set the table', 'chore-table', 'chore', 5, 'inherit',
     '{"freq": "daily"}', '17:30', null, 'family', '0de00000-0000-4000-8000-0000000000a2'),
    ('0de00000-0000-4000-8000-0000000c0005', 'Homework', 'chore-homework', 'chore', 10, 'required',
     '{"freq": "weekly", "by_weekday": [1, 2, 3, 4, 5]}', '16:00', '{school_day}', 'family',
     '0de00000-0000-4000-8000-0000000000a1'),
    ('0de00000-0000-4000-8000-0000000c0006', 'Take out the bins', 'chore-bin', 'chore', 0, 'inherit',
     '{"freq": "weekly", "by_weekday": [4]}', '19:00', null, 'family', '0de00000-0000-4000-8000-0000000000a2'),
    ('0de00000-0000-4000-8000-0000000c0007', 'Pay the school trip fee', 'buy', 'task', 0, 'inherit',
     jsonb_build_object('freq', 'once', 'on_date', to_char(d + 3, 'YYYY-MM-DD')), null, null, 'family',
     '0de00000-0000-4000-8000-0000000000a1'),
    ('0de00000-0000-4000-8000-0000000c0008', 'Book the dentist', 'calendar', 'task', 0, 'inherit',
     jsonb_build_object('freq', 'once', 'on_date', to_char(d + 7, 'YYYY-MM-DD')), null, null, 'family',
     '0de00000-0000-4000-8000-0000000000a2'),
    ('0de00000-0000-4000-8000-0000000c0009', 'Buy anniversary gift', 'gift', 'task', 0, 'inherit',
     jsonb_build_object('freq', 'once', 'on_date', to_char(d + 10, 'YYYY-MM-DD')), null, null, 'private',
     '0de00000-0000-4000-8000-0000000000a2')
  ) as item (id, title, icon, kind, points, approval, schedule, due_time, day_types, visibility, created_by);

insert into public.chore_assignee (household_id, chore_id, member_id)
select m.household_id, a.chore_id::uuid, m.id
  from (values
    ('0de00000-0000-4000-8000-0000000c0001', 'Maya'), ('0de00000-0000-4000-8000-0000000c0001', 'Leo'),
    ('0de00000-0000-4000-8000-0000000c0002', 'Maya'), ('0de00000-0000-4000-8000-0000000c0002', 'Leo'),
    ('0de00000-0000-4000-8000-0000000c0003', 'Maya'), ('0de00000-0000-4000-8000-0000000c0003', 'Alex'),
    ('0de00000-0000-4000-8000-0000000c0004', 'Leo'),
    ('0de00000-0000-4000-8000-0000000c0005', 'Maya'),
    ('0de00000-0000-4000-8000-0000000c0006', 'Alex'),
    ('0de00000-0000-4000-8000-0000000c0007', 'Alex'),
    ('0de00000-0000-4000-8000-0000000c0008', 'Sam'),
    ('0de00000-0000-4000-8000-0000000c0009', 'Sam')
  ) as a (chore_id, name)
  join public.member m on m.household_id = '0de00000-0000-4000-8000-000000000001' and m.display_name = a.name;

insert into public.chore_tag (household_id, chore_id, tag_id)
select '0de00000-0000-4000-8000-000000000001', chore_id::uuid, tag_id::uuid
  from (values
    ('0de00000-0000-4000-8000-0000000c0001', '0de00000-0000-4000-8000-0000000a0001'),
    ('0de00000-0000-4000-8000-0000000c0001', '0de00000-0000-4000-8000-0000000a0003'),
    ('0de00000-0000-4000-8000-0000000c0002', '0de00000-0000-4000-8000-0000000a0001'),
    ('0de00000-0000-4000-8000-0000000c0003', '0de00000-0000-4000-8000-0000000a0002'),
    ('0de00000-0000-4000-8000-0000000c0004', '0de00000-0000-4000-8000-0000000a0002'),
    ('0de00000-0000-4000-8000-0000000c0005', '0de00000-0000-4000-8000-0000000a0004')
  ) as t (chore_id, tag_id);

-- The school year (WP-21): this school year as the default, with terms and closures, and next
-- year's calendar already added (also a default; default years never overlap). Dates follow
-- today, so the demo always has a current school year; the school is made up.
with base as (
  select extract(year from d)::int - case when extract(month from d) < 8 then 1 else 0 end as y
    from (select (now() at time zone 'America/New_York')::date as d) t
)
insert into public.school_year (id, household_id, name, school_name, start_date, end_date, is_default)
select id::uuid, '0de00000-0000-4000-8000-000000000001', name, 'Demo Elementary', start_date, end_date, true
  from base, lateral (values
    ('0de00000-0000-4000-8000-0000000b0001', y || '–' || right((y + 1)::text, 2), make_date(y, 8, 24), make_date(y + 1, 6, 11)),
    ('0de00000-0000-4000-8000-0000000b0002', (y + 1) || '–' || right((y + 2)::text, 2), make_date(y + 1, 8, 23), make_date(y + 2, 6, 10))
  ) as v (id, name, start_date, end_date);

insert into public.school_term (household_id, school_year_id, name, start_date, end_date)
select y.household_id, y.id, t.name, t.start_date, t.end_date
  from public.school_year y,
       lateral (values ('Fall', y.start_date, make_date(extract(year from y.start_date)::int, 12, 18)),
                       ('Spring', make_date(extract(year from y.end_date)::int, 1, 4), y.end_date)) as t (name, start_date, end_date)
 where y.id = '0de00000-0000-4000-8000-0000000b0001';

insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date)
select y.household_id, y.id, c.name, c.closure_type, c.start_date, c.end_date
  from public.school_year y,
       lateral (select extract(year from y.start_date)::int as a) s,
       lateral (values
         ('Teacher planning day', 'teacher_day', make_date(a, 10, 16), make_date(a, 10, 16)),
         ('Thanksgiving break', 'break', make_date(a, 11, 25), make_date(a, 11, 27)),
         ('Winter break', 'break', make_date(a, 12, 21), make_date(a + 1, 1, 1)),
         ('Spring break', 'break', make_date(a + 1, 3, 22), make_date(a + 1, 3, 26)),
         ('Memorial Day', 'holiday',
          make_date(a + 1, 5, 31) - ((extract(isodow from make_date(a + 1, 5, 31))::int + 6) % 7),
          make_date(a + 1, 5, 31) - ((extract(isodow from make_date(a + 1, 5, 31))::int + 6) % 7))
       ) as c (name, closure_type, start_date, end_date)
 where y.id = '0de00000-0000-4000-8000-0000000b0001';

-- Last week (WP-10), as if the family had used the board: each child's own bed and teeth (D-47), a
-- shared chore done by one or the other, a skipped day, missed days, and the latest homework waiting
-- for a parent. Recorded by the database itself; dates and times follow today. Day close then
-- finalizes the past days.
do $$
declare
  v_demo  constant uuid := '0de00000-0000-4000-8000-000000000001';
  v_today date := (now() at time zone 'America/New_York')::date;
  v_maya  uuid := (select id from public.member where household_id = v_demo and display_name = 'Maya');
  v_leo   uuid := (select id from public.member where household_id = v_demo and display_name = 'Leo');
  v_alex  uuid := (select id from public.member where household_id = v_demo and display_name = 'Alex');
  v_last_homework date;
  o       record;
  k       integer;
  v_at    timestamptz;
begin
  perform private.generate_occurrences(v_demo, v_today - 7, v_today - 1);
  v_last_homework := (select max(due_date) from public.chore_occurrence
                       where chore_id = '0de00000-0000-4000-8000-0000000c0005' and due_date < v_today);
  for o in select occ.id, occ.chore_id, occ.due_date, occ.member_id, coalesce(occ.due_time, '18:00') as due_time
             from public.chore_occurrence occ
            where occ.household_id = v_demo and occ.kind = 'chore' and occ.due_date < v_today
            order by occ.due_date loop
    k := v_today - o.due_date;
    v_at := ((o.due_date + o.due_time)::timestamp at time zone 'America/New_York') + interval '5 minutes';
    if o.chore_id = '0de00000-0000-4000-8000-0000000c0001'                       -- Make bed, each their own:
       and not (o.member_id = v_maya and k = 3) and not (o.member_id = v_leo and k = 1) then -- Maya missed 3 days ago, Leo yesterday
      insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
      values (gen_random_uuid(), o.id, 'complete', array[o.member_id], v_at);
    elsif o.chore_id = '0de00000-0000-4000-8000-0000000c0002' and not (o.member_id = v_leo and k = 5) then -- Brush teeth
      insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
      values (gen_random_uuid(), o.id, 'complete', array[o.member_id], v_at);
    elsif o.chore_id = '0de00000-0000-4000-8000-0000000c0003' then                -- Feed the dog: shared
      insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
      values (gen_random_uuid(), o.id, 'complete', array[case when k % 2 = 0 then v_alex else v_maya end], v_at);
    elsif o.chore_id = '0de00000-0000-4000-8000-0000000c0004' then                -- Set the table: one skip
      insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
      values (gen_random_uuid(), o.id, case when k = 2 then 'skip' else 'complete' end,
              case when k = 2 then '{}'::uuid[] else array[v_leo] end, v_at);
    elsif o.chore_id = '0de00000-0000-4000-8000-0000000c0005' then                -- Homework: needs approval
      insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
      values (gen_random_uuid(), o.id, 'complete', array[v_maya], v_at);
      if o.due_date < v_last_homework then
        insert into public.chore_completion_event (id, occurrence_id, event_type, occurred_at)
        values (gen_random_uuid(), o.id, 'approve', v_at + interval '2 hours');
      end if;
    elsif o.chore_id = '0de00000-0000-4000-8000-0000000c0006' then                -- Take out the bins
      insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
      values (gen_random_uuid(), o.id, 'complete', array[v_alex], v_at);
    end if;
  end loop;
  perform private.close_past_due(v_demo);
end $$;

-- Points (WP-16): last week's check-offs earned their points as they were recorded. Alex also gave
-- Leo 10 points two days ago, as a parent does on the member's page.
insert into public.points_ledger (household_id, member_id, entry_type, amount, reason, dedupe_key,
                                  created_by_type, created_by, created_at)
select m.household_id, m.id, 'adjustment', 10, 'Helped carry the shopping',
       'adj:0de00000-0000-4000-8000-0000000ad001', 'admin', '0de00000-0000-4000-8000-0000000000a1',
       now() - interval '2 days'
  from public.member m
 where m.household_id = '0de00000-0000-4000-8000-000000000001' and m.display_name = 'Leo';

-- The rewards shop (WP-18): four rewards, and Leo asking the board for "Pick the dinner" this
-- morning, waiting for a parent.
insert into public.reward_catalog_item (id, household_id, title, icon, cost_points, stock, weekly_limit, sort_order)
values
  ('0de00000-0000-4000-8000-0000000e0001', '0de00000-0000-4000-8000-000000000001', 'Movie night', 'ticket', 100, null, null, 1),
  ('0de00000-0000-4000-8000-0000000e0002', '0de00000-0000-4000-8000-000000000001', 'Ice cream trip', 'snack', 40, null, 1, 2),
  ('0de00000-0000-4000-8000-0000000e0003', '0de00000-0000-4000-8000-000000000001', 'Stay up 30 minutes late', 'moon', 25, null, null, 3),
  ('0de00000-0000-4000-8000-0000000e0004', '0de00000-0000-4000-8000-000000000001', 'Pick the dinner', 'utensils', 30, 2, null, 4);
insert into public.redemption (id, household_id, member_id, catalog_item_id, cost_snapshot, requested_by_type, requested_at)
select '0de00000-0000-4000-8000-0000000f0001', m.household_id, m.id, '0de00000-0000-4000-8000-0000000e0004', 30,
       'device', now() - interval '3 hours'
  from public.member m
 where m.household_id = '0de00000-0000-4000-8000-000000000001' and m.display_name = 'Leo';

-- [PTS-06] The wishlist (WP-30): Maya is saving for Movie night; Leo hasn't chosen yet.
insert into public.wishlist_pin (member_id, household_id, catalog_item_id, pinned_by_type)
select m.id, m.household_id, '0de00000-0000-4000-8000-0000000e0001', 'admin'
  from public.member m
 where m.household_id = '0de00000-0000-4000-8000-000000000001' and m.display_name = 'Maya';

-- Goals (WP-19): Leo's "Movie night" (19 things done since last week: he has done 18, so one more
-- today reaches it), Maya's "Trip to the park" (5 good days in a row, a miss a week forgiven) and the
-- family's "Pizza night" (10 days with every routine done). They started a week ago; the engine works
-- out their progress the first time the Goals page opens or the reconcile job runs.
do $$
declare
  v_demo  constant uuid := '0de00000-0000-4000-8000-000000000001';
  v_alex  constant uuid := '0de00000-0000-4000-8000-0000000000a1';
  v_today date := (now() at time zone 'America/New_York')::date;
  v_maya  uuid := (select id from public.member where household_id = v_demo and display_name = 'Maya');
  v_leo   uuid := (select id from public.member where household_id = v_demo and display_name = 'Leo');
begin
  insert into public.reward_goal (id, household_id, member_id, title, description, icon, start_date, end_date,
                                  rule_logic, status, created_by, created_at)
  values
    ('0de00000-0000-4000-8000-000000060001', v_demo, v_leo, 'Movie night', 'Leo picks the film.', 'ticket',
     v_today - 7, v_today + 7, 'all', 'active', v_alex, now() - interval '7 days'),
    ('0de00000-0000-4000-8000-000000060002', v_demo, v_maya, 'Trip to the park', null, 'sun',
     v_today - 7, v_today + 14, 'all', 'active', v_alex, now() - interval '7 days'),
    ('0de00000-0000-4000-8000-000000060003', v_demo, null, 'Pizza night', 'Everyone chooses a topping.', 'utensils',
     v_today - 7, v_today + 21, 'all', 'active', v_alex, now() - interval '7 days');
  insert into public.reward_rule (household_id, goal_id, rule_type, target, scope, params, sort_order)
  values
    (v_demo, '0de00000-0000-4000-8000-000000060001', 'COUNT', 19, '{"all": true}', '{}', 1),
    (v_demo, '0de00000-0000-4000-8000-000000060002', 'STREAK', 5, '{"all": true}', '{"grace_per_week": 1}', 1),
    (v_demo, '0de00000-0000-4000-8000-000000060003', 'DAILY_ALL_DONE', 10, '{"all": true}', '{}', 1);
  insert into public.reward_goal_progress (goal_id, household_id)
  select id, v_demo from public.reward_goal where household_id = v_demo;
  insert into public.reward_goal_event (household_id, goal_id, type, actor_type, actor_id, at)
  select v_demo, g.id, e.type, e.actor, case when e.actor = 'admin' then v_alex end, now() - interval '7 days'
    from public.reward_goal g
   cross join (values ('created', 'admin'), ('activated', 'system')) e (type, actor)
   where g.household_id = v_demo;
end $$;

-- [MEAL-01][MEAL-02][MEAL-08] Meals (WP-25): the library (one meal archived) and this week's plan, from
-- the household week's first day (Sunday): a dinner most days, two breakfasts, Leo's packed lunch and
-- Maya's snack after school, two snacks today, one written in.
do $$
declare
  v_demo  constant uuid := '0de00000-0000-4000-8000-000000000001';
  v_alex  constant uuid := '0de00000-0000-4000-8000-0000000000a1';
  v_today date := (now() at time zone 'America/New_York')::date;
  v_week  date := v_today - extract(dow from v_today)::integer;
  v_maya  uuid := (select id from public.member where household_id = v_demo and display_name = 'Maya');
  v_leo   uuid := (select id from public.member where household_id = v_demo and display_name = 'Leo');
begin
  insert into public.meal (id, household_id, name, description, icon, meal_types, recipe_url, archived_at) values
    ('0de00000-0000-4000-8000-000000071001', v_demo, 'Tacos', null, 'utensils', '{dinner}', 'https://example.com/tacos', null),
    ('0de00000-0000-4000-8000-000000071002', v_demo, 'Spaghetti', 'With the sauce from the freezer', 'dinner', '{dinner}', null, null),
    ('0de00000-0000-4000-8000-000000071003', v_demo, 'Porridge', null, 'breakfast', '{breakfast}', null, null),
    ('0de00000-0000-4000-8000-000000071004', v_demo, 'Pancakes', 'Saturdays', 'breakfast', '{breakfast}', null, null),
    ('0de00000-0000-4000-8000-000000071005', v_demo, 'Chicken soup', null, 'soup', '{lunch,dinner}', null, null),
    ('0de00000-0000-4000-8000-000000071006', v_demo, 'Apple slices', null, 'apple', '{snack}', null, null),
    ('0de00000-0000-4000-8000-000000071007', v_demo, 'Old casserole', null, 'dinner', '{}', null, now() - interval '30 days');
  -- [MEAL-07] What three of them need to buy (WP-105); salt-and-oil things the family usually has.
  update public.meal set ingredients = i.rows
    from (values
      ('0de00000-0000-4000-8000-000000071001'::uuid,
       '[{"name": "Ground beef", "amount": "1 lb"}, {"name": "Tortillas", "amount": "8"},
         {"name": "Onion", "amount": "1"}, {"name": "Lettuce", "amount": "1"}, {"name": "Cheddar"},
         {"name": "Taco seasoning", "have": true}, {"name": "Olive oil", "have": true}]'::jsonb),
      ('0de00000-0000-4000-8000-000000071002'::uuid,
       '[{"name": "Ground beef", "amount": "1 lb"}, {"name": "Onions", "amount": "2"},
         {"name": "Spaghetti", "amount": "1 box"}, {"name": "Parmesan"}]'::jsonb),
      ('0de00000-0000-4000-8000-000000071004'::uuid,
       '[{"name": "Eggs"}, {"name": "Milk"}, {"name": "Flour", "have": true}]'::jsonb)
    ) i (id, rows)
   where meal.id = i.id;
  insert into public.meal_plan_entry (id, household_id, plan_date, slot, sort_order, meal_id, free_text, notes,
                                      created_by)
  values
    ('0de00000-0000-4000-8000-000000072001', v_demo, v_week, 'dinner', 1, '0de00000-0000-4000-8000-000000071005', null, null, v_alex),
    ('0de00000-0000-4000-8000-000000072002', v_demo, v_week + 1, 'breakfast', 1, '0de00000-0000-4000-8000-000000071003', null, null, v_alex),
    ('0de00000-0000-4000-8000-000000072003', v_demo, v_week + 1, 'dinner', 1, '0de00000-0000-4000-8000-000000071001', null, 'Make extra for lunch', v_alex),
    ('0de00000-0000-4000-8000-000000072004', v_demo, v_week + 2, 'lunch', 1, null, 'Leftover tacos', null, v_alex),
    ('0de00000-0000-4000-8000-000000072005', v_demo, v_week + 2, 'dinner', 1, '0de00000-0000-4000-8000-000000071002', null, null, v_alex),
    ('0de00000-0000-4000-8000-000000072006', v_demo, v_today, 'snack', 1, '0de00000-0000-4000-8000-000000071006', null, 'After school', v_alex),
    ('0de00000-0000-4000-8000-000000072007', v_demo, v_today, 'snack', 2, null, 'Crackers', null, v_alex),
    ('0de00000-0000-4000-8000-000000072008', v_demo, v_week + 5, 'dinner', 1, null, 'Pizza and a movie', null, v_alex),
    ('0de00000-0000-4000-8000-000000072009', v_demo, v_week + 6, 'breakfast', 1, '0de00000-0000-4000-8000-000000071004', null, null, v_alex);
  -- [MEAL-10] Each entry's people (WP-62); none is everyone. Leo's lunch, Maya's snack.
  insert into public.meal_plan_entry_member (household_id, entry_id, member_id) values
    (v_demo, '0de00000-0000-4000-8000-000000072004', v_leo),
    (v_demo, '0de00000-0000-4000-8000-000000072006', v_maya);
end $$;

-- [MEAL-18][MEAL-23] Groceries (WP-104): a made-up list in the starter categories (made when the
-- household was), with stores, the reasons each thing is on it (Tuesday's tacos and Wednesday's
-- spaghetti, the children's asks, who added the rest) and four things got in the last few days.
do $$
declare
  v_demo constant uuid := '0de00000-0000-4000-8000-000000000001';
  v_alex constant uuid := '0de00000-0000-4000-8000-0000000000a1';
  v_sam  constant uuid := '0de00000-0000-4000-8000-0000000000a2';
  v_list uuid := (select id from public.grocery_list where household_id = v_demo);
  v_maya uuid := (select id from public.member where household_id = v_demo and display_name = 'Maya');
  v_leo  uuid := (select id from public.member where household_id = v_demo and display_name = 'Leo');
  v_tacos constant uuid := '0de00000-0000-4000-8000-000000072003';
  v_spag  constant uuid := '0de00000-0000-4000-8000-000000072005';
begin
  insert into public.grocery_item (id, household_id, list_id, name, name_key, category_id, store_id, status,
                                   ticked_at, ticked_by, created_by, created_at)
  select ('0de00000-0000-4000-8000-0000000730' || lpad(i.n::text, 2, '0'))::uuid, v_demo, v_list, i.name, i.k,
         (select c.id from public.grocery_category c where c.household_id = v_demo and c.starter_key = i.cat),
         (select s.id from public.grocery_store s where s.household_id = v_demo and s.name = i.store),
         case when i.got is null then 'open' else 'ticked' end,
         now() - i.got, case when i.got is null then null else coalesce(i.by, v_sam) end,
         coalesce(i.by, v_alex), now() - interval '3 days' + i.n * interval '1 minute'
    from (values
      (1, 'Apples', 'apple', 'produce', null, null::uuid, null::interval),
      (2, 'Avocados', 'avocado', 'produce', 'Aldi', v_alex, null),
      (3, 'Baby spinach', 'baby spinach', 'produce', null, v_sam, null),
      (4, 'Bananas', 'banana', 'produce', 'Aldi', v_sam, null),
      (5, 'Lettuce', 'lettuce', 'produce', null, null, null),
      (6, 'Onions', 'onion', 'produce', null, null, null),
      (7, 'Cheddar', 'cheddar', 'dairy', 'Kroger', null, null),
      (8, 'Eggs', 'egg', 'dairy', 'Aldi', v_sam, null),
      (9, 'Greek yogurt', 'greek yogurt', 'dairy', null, null, null),
      (10, 'Milk', 'milk', 'dairy', 'Costco', v_alex, null),
      (11, 'Sourdough', 'sourdough', 'bakery', null, v_alex, null),
      (12, 'Tortillas', 'tortilla', 'bakery', 'Kroger', null, null),
      (13, 'Ground beef', 'ground beef', 'meat', 'Kroger', null, null),
      (14, 'Salmon fillets', 'salmon fillet', 'meat', 'Costco', v_alex, null),
      (15, 'Peanut butter', 'peanut butter', 'pantry', null, v_sam, null),
      (16, 'Rice', 'rice', 'pantry', null, v_sam, null),
      (17, 'Dish soap', 'dish soap', 'household', 'Walmart', v_alex, null),
      (18, 'Paper towels', 'paper towel', 'household', 'Costco', v_sam, null),
      (19, 'Coffee', 'coffee', 'pantry', null, v_sam, interval '20 hours'),
      (20, 'Pasta', 'pasta', 'pantry', null, v_sam, interval '20 hours 1 minute'),
      (21, 'Strawberries', 'strawberry', 'produce', null, v_sam, interval '20 hours 2 minutes'),
      (22, 'Foil', 'foil', 'household', null, v_alex, interval '2 days')
    ) i (n, name, k, cat, store, by, got);

  insert into public.grocery_item_reason (household_id, item_id, kind, by_user, member_id, meal_plan_entry_id,
                                          label, amount)
  select v_demo, ('0de00000-0000-4000-8000-0000000730' || lpad(r.n::text, 2, '0'))::uuid, r.kind,
         case when r.kind = 'added' then coalesce(r.by, v_alex) end, r.member, r.entry, r.label, r.amount
    from (values
      (1, 'ask', null::uuid, v_leo, null::uuid, null, '×6'),
      (2, 'added', v_alex, null, null, null, '×2'),
      (3, 'added', v_sam, null, null, null, null),
      (4, 'added', v_sam, null, null, null, null),
      (5, 'meal', null, null, v_tacos, 'Tacos, Tue', '1'),
      (6, 'meal', null, null, v_tacos, 'Tacos, Tue', '1'),
      (6, 'meal', null, null, v_spag, 'Spaghetti, Wed', '2'),
      (7, 'meal', null, null, v_tacos, 'Tacos, Tue', null),
      (8, 'added', v_sam, null, null, null, '1 dozen'),
      (9, 'ask', null, v_maya, null, null, null),
      (10, 'added', v_alex, null, null, null, '×2'),
      (11, 'added', v_alex, null, null, null, null),
      (12, 'meal', null, null, v_tacos, 'Tacos, Tue', '8'),
      (13, 'meal', null, null, v_tacos, 'Tacos, Tue', '1 lb'),
      (13, 'meal', null, null, v_spag, 'Spaghetti, Wed', '1 lb'),
      (14, 'added', v_alex, null, null, null, '×4'),
      (15, 'added', v_sam, null, null, null, null),
      (16, 'added', v_sam, null, null, null, null),
      (17, 'added', v_alex, null, null, null, null),
      (18, 'added', v_sam, null, null, null, null),
      (19, 'added', v_sam, null, null, null, null),
      (20, 'added', v_sam, null, null, null, '×2'),
      (21, 'added', v_sam, null, null, null, null),
      (22, 'added', v_alex, null, null, null, null)
    ) r (n, kind, by, member, entry, label, amount);

  insert into public.grocery_item_event (household_id, item_id, kind, at, by_user)
  select v_demo, i.id, 'added', i.created_at, i.created_by from public.grocery_item i where i.household_id = v_demo
  union all
  select v_demo, i.id, 'ticked', i.ticked_at, i.ticked_by from public.grocery_item i
   where i.household_id = v_demo and i.status = 'ticked';
end $$;

-- [MEAL-29] Grocery brands (WP-116): the demo family's saved brands, Kirkland and Kirkland Signature
-- the near-duplicates to merge, Horizon archived; some of the list's items with their brand.
do $$
declare
  v_demo constant uuid := '0de00000-0000-4000-8000-000000000001';
begin
  insert into public.grocery_brand (id, household_id, name, archived_at)
  select ('0de00000-0000-4000-8000-0000000740' || lpad(b.n::text, 2, '0'))::uuid, v_demo, b.name,
         case when b.archived then now() - interval '30 days' end
    from (values (1, 'Chobani', false), (2, 'Dave''s Killer Bread', false), (3, 'Fairlife', false),
                 (4, 'Horizon', true), (5, 'Jif', false), (6, 'Kirkland', false),
                 (7, 'Kirkland Signature', false), (8, 'Mission', false), (9, 'Peet''s', false)) b (n, name, archived);
  update public.grocery_item i
     set brand_id = ('0de00000-0000-4000-8000-0000000740' || lpad(x.brand::text, 2, '0'))::uuid
    from (values (9, 1), (10, 6), (11, 2), (12, 8), (15, 5), (18, 7), (19, 9)) x (item, brand)
   where i.id = ('0de00000-0000-4000-8000-0000000730' || lpad(x.item::text, 2, '0'))::uuid;
end $$;

-- [MEAL-22][MEAL-30] The board's asks (WP-107): Maya's popcorn and Leo's ice cream wait for a parent,
-- Leo's cereal was turned down today; Sam ticked the coffee, at a board.
do $$
declare
  v_demo constant uuid := '0de00000-0000-4000-8000-000000000001';
  -- A board paired to the demo family, if there is one yet (previews pair theirs as they start).
  v_kitchen uuid := (select id from public.device where household_id = v_demo order by created_at limit 1);
  v_alex constant uuid := '0de00000-0000-4000-8000-0000000000a1';
  v_maya uuid := (select id from public.member where household_id = v_demo and display_name = 'Maya');
  v_leo  uuid := (select id from public.member where household_id = v_demo and display_name = 'Leo');
  v_sam  uuid := (select id from public.member where household_id = v_demo and display_name = 'Sam');
  v_other uuid := (select id from public.grocery_category where household_id = v_demo and is_other);
begin
  insert into public.grocery_ask (household_id, member_id, name, name_key, category_id, status, asked_by,
                                  asked_at, decided_by, decided_at)
  values (v_demo, v_maya, 'Popcorn', 'popcorn', v_other, 'waiting', v_kitchen, now() - interval '40 minutes', null, null),
         (v_demo, v_leo, 'Ice cream', 'ice cream', v_other, 'waiting', v_kitchen, now() - interval '10 minutes', null, null),
         (v_demo, v_leo, 'Chocolate cereal', 'chocolate cereal', v_other, 'declined', v_kitchen,
          now() - interval '3 hours', v_alex, now() - interval '5 minutes');
  update public.grocery_item set ticked_member_id = v_sam, ticked_device_id = v_kitchen
   where household_id = v_demo and name = 'Coffee';
end $$;

-- [MEAL-21] Staples (WP-106): a made-up history of ticks, days before today. Butter every 9 days,
-- Cereal every week and Trash bags every 3 weeks are running low; Milk (on the list) every 5 days;
-- Coffee every 2 weeks (its latest buy is today's above); Birthday candles turned off.
do $$
declare
  v_demo constant uuid := '0de00000-0000-4000-8000-000000000001';
  v_sam  constant uuid := '0de00000-0000-4000-8000-0000000000a2';
  v_list uuid := (select id from public.grocery_list where household_id = v_demo);
begin
  insert into public.grocery_item (id, household_id, list_id, name, name_key, category_id, store_id, brand_id,
                                   status, ticked_at, ticked_by, created_by, created_at)
  select ('0de00000-0000-4000-8000-000000075' || lpad((t.n * 10 + b)::text, 3, '0'))::uuid, v_demo, v_list,
         t.name, t.k,
         (select c.id from public.grocery_category c where c.household_id = v_demo and c.starter_key = t.cat),
         (select s.id from public.grocery_store s where s.household_id = v_demo and s.name = t.store),
         case when t.brand is null then null
              else ('0de00000-0000-4000-8000-0000000740' || lpad(t.brand::text, 2, '0'))::uuid end,
         'ticked', now() - make_interval(days => t.last + t.gap * b), v_sam, v_sam,
         now() - make_interval(days => t.last + t.gap * b + 2)
    from (values
      (1, 'Butter', 'butter', 'dairy', 'Kroger', null::int, 9, 10, 5),
      (2, 'Cereal', 'cereal', 'pantry', 'Kroger', null, 7, 8, 6),
      (3, 'Trash bags', 'trash bag', 'household', 'Costco', 7, 21, 22, 5),
      (4, 'Milk', 'milk', 'dairy', 'Costco', 6, 5, 9, 6),
      (5, 'Coffee', 'coffee', 'pantry', null, 9, 14, 14, 3),
      (6, 'Birthday candles', 'birthday candle', 'other', null, null, 40, 50, 3)
    ) t (n, name, k, cat, store, brand, gap, last, buys)
    cross join lateral generate_series(0, t.buys - 1) b;
  insert into public.grocery_item_event (household_id, item_id, kind, at, by_user)
  select v_demo, i.id, 'ticked', i.ticked_at, i.ticked_by from public.grocery_item i
   where i.household_id = v_demo and i.id::text like '0de00000-0000-4000-8000-000000075%';
  insert into public.grocery_staple (household_id, name_key, off_at)
  values (v_demo, 'birthday candle', now() - interval '45 days');
end $$;

-- [MEAL-04] School lunch (WP-26): Leo buys on Wednesdays, Maya on Fridays; they bring the rest.
insert into public.member_lunch (member_id, household_id, defaults)
select m.id, m.household_id, case m.display_name when 'Leo' then '{"wed": "buy"}' else '{"fri": "buy"}' end::jsonb
  from public.member m
 where m.household_id = '0de00000-0000-4000-8000-000000000001' and m.display_name in ('Leo', 'Maya');

-- [MENU-01][MENU-03][MEAL-05][MENU-06] School menus (WP-27, WP-64): a made-up school's lunch menu from a
-- file, the next four weeks of weekdays, five lunches in turn, each by section with its options (two
-- entrees, one with a side; fruits and vegetables; two milks); Leo's and Maya's lunch comes from it.
-- No real school's menu or identifiers (NFR-05).
do $$
declare
  v_demo  uuid := '0de00000-0000-4000-8000-000000000001';
  v_today date := private.household_today(v_demo);
  v_src   uuid := '0de00000-0000-4000-8000-000000073001';
begin
  insert into public.menu_source (id, household_id, name, adapter, status)
  values (v_src, v_demo, 'Maple Elementary', 'csv', 'ok');
  insert into public.school_menu_day (household_id, source_id, menu_date, items, origin, is_override)
  select v_demo, v_src, d::date,
         (select jsonb_agg(i order by n) from (
            select 1 as n, jsonb_build_object('name', m.e1, 'section', 'Choice of Entree', 'option', 1) as i
            union all select 2, jsonb_build_object('name', m.e2, 'section', 'Choice of Entree', 'option', 2)
            union all select 3, jsonb_build_object('name', m.side, 'section', 'Choice of Entree', 'option', 2)
            union all select 4, jsonb_build_object('name', m.f1, 'section', 'Fruits & Vegetables offered', 'option', 1)
            union all select 5, jsonb_build_object('name', m.f2, 'section', 'Fruits & Vegetables offered', 'option', 2)
            union all select 6, jsonb_build_object('name', m.f3, 'section', 'Fruits & Vegetables offered', 'option', 3)
            union all select 7, jsonb_build_object('name', '1% milk', 'section', 'Choice of Milk', 'option', 1)
            union all select 8, jsonb_build_object('name', 'Chocolate milk', 'section', 'Choice of Milk', 'option', 2)) x),
         'csv', true
    from generate_series(v_today, v_today + 27, interval '1 day') d
    join (values (1, 'Chicken Nuggets', 'Cheese quesadilla', 'Salsa', 'Carrot Sticks', 'Apple', 'Corn'),
                 (2, 'Cheese Pizza', 'Turkey sandwich', 'Pretzels', 'Green Beans', 'Orange', 'Grapes'),
                 (3, 'Beef Tacos', 'Chicken wrap', 'Tortilla chips', 'Corn', 'Orange', 'Cucumber slices'),
                 (4, 'Spaghetti', 'Veggie burger', 'Garlic Bread', 'Peas', 'Pear', 'Celery sticks'),
                 (5, 'Fish Tacos', 'Mac and cheese', 'Roll', 'Rice', 'Banana', 'Apple'))
         m (dow, e1, e2, side, f1, f2, f3) on m.dow = extract(isodow from d)
   where extract(isodow from d) < 6;
  update public.member_lunch l set menu_source_id = v_src
    from public.member m
   where m.id = l.member_id and m.household_id = v_demo and m.display_name in ('Leo', 'Maya');
end $$;
