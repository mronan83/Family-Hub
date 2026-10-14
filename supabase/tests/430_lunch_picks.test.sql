-- [MEAL-09][MEAL-11][US-707] Next week's lunches picked on the board, with the day's choices (WP-49,
-- D-95). A board asks for a child's day as they want it (buy or bring, and a buy day's picks); it
-- waits for a parent, who approves it (the day becomes it) or keeps the day as it was. Picks are
-- checked against the day's menu: one option where a section says "Choice of", any number elsewhere.
-- A day can change up to its cut-off; a change still waiting then is dropped. A parent's own change on
-- Meals is at once and replaces what waits. A waiting change counts in the approvals alert (WP-63).
-- Every menu and family here is made up; dates are relative to today.
begin;
set local client_min_messages = warning;
select plan(48);

insert into auth.users (id, email) values
  ('43100000-0000-0000-0000-000000000001', 'alex@example.com'),
  ('43100000-0000-0000-0000-000000000002', 'sam@example.com'),
  ('43d00000-0000-0000-0000-00000000000d', null),
  ('43d00000-0000-0000-0000-00000000000e', null),
  ('43100000-0000-0000-0000-000000000009', 'other@example.com');
insert into public.household (id, name, timezone) values
  ('43000000-0000-0000-0000-000000000001', 'Picks family', 'America/Chicago'),
  ('43000000-0000-0000-0000-000000000002', 'Other family', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('43000000-0000-0000-0000-000000000001'), ('43000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('43000000-0000-0000-0000-000000000001', '43100000-0000-0000-0000-000000000001', 'owner'),
  ('43000000-0000-0000-0000-000000000001', '43100000-0000-0000-0000-000000000002', 'admin'),
  ('43000000-0000-0000-0000-000000000002', '43100000-0000-0000-0000-000000000009', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('43110000-0000-0000-0000-00000000000a', '43000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('43110000-0000-0000-0000-00000000000b', '43000000-0000-0000-0000-000000000001', 'Leo', 'child', null),
  ('43110000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-000000000001', 'Alex', 'adult',
   '43100000-0000-0000-0000-000000000001'),
  ('43110000-0000-0000-0000-000000000002', '43000000-0000-0000-0000-000000000001', 'Sam', 'adult',
   '43100000-0000-0000-0000-000000000002');
insert into public.device (id, household_id, name, auth_user_id) values
  ('43dd0000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-000000000001', 'Kitchen',
   '43d00000-0000-0000-0000-00000000000d'),
  ('43dd0000-0000-0000-0000-000000000002', '43000000-0000-0000-0000-000000000002', 'Hall',
   '43d00000-0000-0000-0000-00000000000e');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('43000000-0000-0000-0000-000000000001')
$$;
-- The n-th school day (Monday to Friday) after today: 1 is the next one.
create function pg_temp.school_day(n integer) returns date language sql as $$
  select d::date from generate_series(pg_temp.today() + 1, pg_temp.today() + 30, interval '1 day') d
   where extract(isodow from d) < 6 order by d offset n - 1 limit 1
$$;
-- The last school day before today.
create function pg_temp.past_school_day() returns date language sql as $$
  select max(d)::date from generate_series(pg_temp.today() - 7, pg_temp.today() - 1, interval '1 day') d
   where extract(isodow from d) < 6
$$;
create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.alex() returns void language sql as $$ select pg_temp.as_user('43100000-0000-0000-0000-000000000001') $$;
create function pg_temp.board() returns void language sql as $$ select pg_temp.as_user('43d00000-0000-0000-0000-00000000000d') $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
create function pg_temp.maya() returns uuid language sql as $$ select '43110000-0000-0000-0000-00000000000a'::uuid $$;
create function pg_temp.leo() returns uuid language sql as $$ select '43110000-0000-0000-0000-00000000000b'::uuid $$;
-- A child's day as lunch_week gives it.
create function pg_temp.day(p_member uuid, p_date date) returns jsonb language sql as $$
  select d from jsonb_array_elements(public.lunch_week('43000000-0000-0000-0000-000000000001', p_date)) c,
                jsonb_array_elements(c -> 'days') d
   where (c ->> 'member_id')::uuid = p_member and (d ->> 'date')::date = p_date
$$;
-- Maya's picks: an entree (option), fruit options, a milk (option).
create function pg_temp.picks(p_entree integer, p_fruit integer[], p_milk integer) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('section', 'Choice of Entree', 'options', jsonb_build_array(p_entree),
                       'names', jsonb_build_array(case p_entree when 1 then 'Cheese pizza' else 'Chicken wrap' end)),
    jsonb_build_object('section', 'Fruits & Vegetables offered', 'options', to_jsonb(p_fruit),
                       'names', (select jsonb_agg(case f when 1 then 'Apple slices' when 2 then 'Baby carrots' else 'Grapes' end)
                                   from unnest(p_fruit) f)),
    jsonb_build_object('section', 'Choice of Milk', 'options', jsonb_build_array(p_milk),
                       'names', jsonb_build_array(case p_milk when 1 then '1% milk' else 'Chocolate milk' end)))
$$;

insert into public.school_year (household_id, name, start_date, end_date, is_default) values
  ('43000000-0000-0000-0000-000000000001', 'This year', pg_temp.today() - 60, pg_temp.today() + 200, true);

-- Maya brings every day as usual; her menu has every school day of the next two weeks.
select pg_temp.alex();
select public.save_menu_source('43000000-0000-0000-0000-000000000001', null, 'Maple Elementary', 'manual', '{}');
select public.save_menu_days((select id from public.menu_source where name = 'Maple Elementary'),
  (select jsonb_agg(jsonb_build_object('date', d, 'items', '[
     {"name": "Cheese pizza", "section": "Choice of Entree", "option": 1},
     {"name": "Chicken wrap", "section": "Choice of Entree", "option": 2},
     {"name": "Apple slices", "section": "Fruits & Vegetables offered", "option": 1},
     {"name": "Baby carrots", "section": "Fruits & Vegetables offered", "option": 2},
     {"name": "Grapes", "section": "Fruits & Vegetables offered", "option": 3},
     {"name": "1% milk", "section": "Choice of Milk", "option": 1},
     {"name": "Chocolate milk", "section": "Choice of Milk", "option": 2}]'::jsonb))
     from generate_series(pg_temp.today() - 7, pg_temp.today() + 21, interval '1 day') d), 'manual');
select public.set_child_menu(pg_temp.maya(), (select id from public.menu_source where name = 'Maple Elementary'));
select public.set_child_menu(pg_temp.leo(), (select id from public.menu_source where name = 'Maple Elementary'));
select public.set_lunch_defaults(pg_temp.leo(), '{"mon": "buy", "tue": "buy", "wed": "buy", "thu": "buy", "fri": "buy"}');

-- [MEAL-09] The cut-off ---------------------------------------------------------------------------
select pg_temp.as_owner();
select is((select lunch_cutoff from public.household_settings where household_id = '43000000-0000-0000-0000-000000000001'),
          '08:00'::time, '[MEAL-09] a household''s lunch cut-off is 8:00 am to start with');
select is(private.lunch_open_until('43000000-0000-0000-0000-000000000001', pg_temp.school_day(1)),
          (pg_temp.school_day(1) + time '08:00') at time zone 'America/Chicago',
          '... so a day can change until 8:00 am that day, household time');
select pg_temp.alex();
select is((pg_temp.day(pg_temp.maya(), pg_temp.school_day(1)) ->> 'open')::boolean, true,
          '[MEAL-09] lunch_week says a coming school day is open');
select is((pg_temp.day(pg_temp.maya(), pg_temp.past_school_day()) ->> 'open')::boolean, false,
          '... and an earlier one is locked');

-- [MEAL-09] A child's change on the board waits ---------------------------------------------------
select pg_temp.board();
select is(public.request_lunch(pg_temp.maya(), pg_temp.school_day(1), 'buy', pg_temp.picks(1, '{1,2}', 1)) ->> 'waiting',
          'true', '[MEAL-09][US-707] a board asks for Maya''s day as Buy, with her picks: it waits');
select is(public.lunch_mode(pg_temp.maya(), pg_temp.school_day(1)), 'bring',
          '... and the day stays Bring until a parent approves');
select is(pg_temp.day(pg_temp.maya(), pg_temp.school_day(1)) -> 'request' ->> 'status', 'waiting',
          '... lunch_week shows the change waiting, on the board');
select is((select p -> 'names' from jsonb_array_elements(pg_temp.day(pg_temp.maya(), pg_temp.school_day(1)) -> 'request' -> 'choices') p
            where p ->> 'section' = 'Fruits & Vegetables offered'),
          '["Apple slices", "Baby carrots"]'::jsonb, '... with her picks, by section');
select is((select requested_by from public.lunch_request where member_id = pg_temp.maya()),
          '43dd0000-0000-0000-0000-000000000001'::uuid, '... and who changed it: the board');
select is(public.request_lunch(pg_temp.maya(), pg_temp.school_day(1), 'buy', pg_temp.picks(2, '{3}', 2)) ->> 'waiting',
          'true', '... asking again replaces it');
select is((select count(*)::integer from public.lunch_request where member_id = pg_temp.maya()), 1,
          '... one change a child and day');
select is(public.request_lunch(pg_temp.maya(), pg_temp.school_day(1), 'bring', '[]') ->> 'waiting', 'false',
          '[MEAL-09] asking for the day as it already is takes the change back');
select is((select count(*)::integer from public.lunch_request where member_id = pg_temp.maya()), 0,
          '... and nothing waits');

-- [MEAL-11] Picks are checked against the day's menu
select throws_ok(format($$ select public.request_lunch(%L, %L, 'buy', %L) $$, pg_temp.maya(), pg_temp.school_day(1),
                        jsonb_build_array(jsonb_build_object('section', 'Choice of Entree', 'options', '[1, 2]'::jsonb,
                                                             'names', '["Cheese pizza", "Chicken wrap"]'::jsonb))),
                 '22023', 'one option in a "Choice of" section', '[MEAL-11] two entrees are refused (Choice of)');
select is(jsonb_array_length(public.request_lunch(pg_temp.maya(), pg_temp.school_day(1), 'buy',
            jsonb_build_array(jsonb_build_object('section', 'Fruits & Vegetables offered', 'options', '[1, 2, 3]'::jsonb,
                                                 'names', '["Apple slices", "Baby carrots", "Grapes"]'::jsonb))) -> 'choices' -> 0 -> 'options'),
          3, '[MEAL-11] any number of fruits and vegetables');
select throws_ok(format($$ select public.request_lunch(%L, %L, 'buy', %L) $$, pg_temp.maya(), pg_temp.school_day(1),
                        jsonb_build_array(jsonb_build_object('section', 'Choice of Dessert', 'options', '[1]'::jsonb, 'names', '["Pie"]'::jsonb))),
                 '22023', 'that section isn''t on the day''s menu', '[MEAL-11] a section not on the menu is refused');
select throws_ok(format($$ select public.request_lunch(%L, %L, 'buy', %L) $$, pg_temp.maya(), pg_temp.school_day(1),
                        jsonb_build_array(jsonb_build_object('section', 'Choice of Milk', 'options', '[3]'::jsonb, 'names', '["Juice"]'::jsonb))),
                 '22023', 'that option isn''t on the day''s menu', '... and an option that isn''t');
select throws_ok(format($$ select public.request_lunch(%L, %L, 'bring', %L) $$, pg_temp.maya(), pg_temp.school_day(1),
                        pg_temp.picks(1, '{1}', 1)),
                 '22023', 'only a buy day has picks', '... and picks on a bring day');

-- [MEAL-09] What can't change
select throws_ok(format($$ select public.request_lunch(%L, %L, 'buy', '[]') $$, pg_temp.maya(), pg_temp.past_school_day()),
                 '22023', 'that day can''t change now', '[MEAL-09] an earlier day is locked');
select throws_ok(format($$ select public.request_lunch(%L, %L, 'buy', '[]') $$, pg_temp.maya(),
                        (select max(d)::date from generate_series(pg_temp.today() + 1, pg_temp.today() + 7, interval '1 day') d
                          where extract(isodow from d) = 6)),
                 '22023', 'no school lunch that day', '... and a Saturday has no school lunch');
select throws_ok(format($$ select public.request_lunch(%L, %L, 'buy', '[]') $$, '43110000-0000-0000-0000-000000000001',
                        pg_temp.school_day(1)),
                 '22023', 'school lunch is a child''s', '... nor has an adult');
select pg_temp.as_user('43d00000-0000-0000-0000-00000000000e');
select throws_ok(format($$ select public.request_lunch(%L, %L, 'buy', '[]') $$, pg_temp.maya(), pg_temp.school_day(1)),
                 '42501', 'not allowed', '[MEAL-09] another family''s board can''t change Maya''s lunch');
select pg_temp.alex();
select throws_ok(format($$ select public.request_lunch(%L, %L, 'buy', '[]') $$, pg_temp.maya(), pg_temp.school_day(1)),
                 '42501', 'not allowed', '... and a parent changes it on Meals, not as a board');

-- [MEAL-09][US-707] A parent approves, or keeps the day ---------------------------------------------
select pg_temp.board();
select public.request_lunch(pg_temp.maya(), pg_temp.school_day(1), 'buy', pg_temp.picks(1, '{1,2}', 1));
select public.request_lunch(pg_temp.maya(), pg_temp.school_day(2), 'buy', pg_temp.picks(2, '{3}', 2));
select public.request_lunch(pg_temp.leo(), pg_temp.school_day(1), 'bring', '[]');
select pg_temp.alex();
select is(jsonb_array_length(public.lunch_requests_waiting('43000000-0000-0000-0000-000000000001')), 3,
          '[MEAL-09] Today lists the three changes waiting');
select is(public.lunch_requests_waiting('43000000-0000-0000-0000-000000000001') -> 0 ->> 'usual', 'buy',
          '... Leo''s first (by name), with his usual for the day');
select is((public.decide_lunch_requests(
             array[(select id from public.lunch_request where member_id = pg_temp.maya() and lunch_date = pg_temp.school_day(1))],
             true) ->> 'decided')::integer, 1, '[MEAL-09][US-707] a parent approves Maya''s first day');
select is(public.lunch_mode(pg_temp.maya(), pg_temp.school_day(1)), 'buy', '... it is now a buy day');
select is((select array_agg(c.names[1] order by c.section) from public.lunch_choice c
            where c.member_id = pg_temp.maya() and c.lunch_date = pg_temp.school_day(1)),
          array['Cheese pizza', '1% milk', 'Apple slices'], '[MEAL-11] with her picks: an entree, a milk and her fruits');
select is((pg_temp.day(pg_temp.maya(), pg_temp.school_day(1)) ->> 'by_board')::boolean, true,
          '... and lunch_week says the day is as she asked on the board');
select is(pg_temp.day(pg_temp.maya(), pg_temp.school_day(1)) -> 'request', 'null'::jsonb, '... with nothing waiting');
select is((public.decide_lunch_requests(
             array[(select id from public.lunch_request where member_id = pg_temp.leo())], false) ->> 'decided')::integer, 1,
          '[MEAL-09] a parent keeps Leo''s day as it was');
select is(public.lunch_mode(pg_temp.leo(), pg_temp.school_day(1)), 'buy', '... it stays Buy');
select is(pg_temp.day(pg_temp.leo(), pg_temp.school_day(1)) -> 'request' ->> 'decided_by', 'Alex',
          '... and the board can say who kept it');
select pg_temp.board();
select is(public.seen_lunch_week(pg_temp.leo()), 1, '[US-707] once Leo taps Done on his week');
select is(pg_temp.day(pg_temp.leo(), pg_temp.school_day(1)) -> 'request', 'null'::jsonb, '... the line goes');

-- [MEAL-09] A change still waiting at the cut-off is dropped
select pg_temp.as_owner();
update public.lunch_request set open_until = now() - interval '1 minute'
 where member_id = pg_temp.maya() and lunch_date = pg_temp.school_day(2);
select pg_temp.alex();
select is(jsonb_array_length(public.lunch_requests_waiting('43000000-0000-0000-0000-000000000001')), 0,
          '[MEAL-09] past its cut-off, a waiting change no longer waits');
select is(public.decide_lunch_requests(
            array[(select id from public.lunch_request where member_id = pg_temp.maya() and lunch_date = pg_temp.school_day(2))],
            true), '{"decided": 0, "expired": 1}'::jsonb, '... and approving it does nothing');
select is(public.lunch_mode(pg_temp.maya(), pg_temp.school_day(2)), 'bring', '... the day stays as it was');
select set_config('t.request', (select id::text from public.lunch_request
                                 where member_id = pg_temp.maya() and lunch_date = pg_temp.school_day(2)), true);
select pg_temp.as_user('43100000-0000-0000-0000-000000000009');
select throws_ok(format($$ select public.decide_lunch_requests(array[%L]::uuid[], true) $$, current_setting('t.request')),
                 '42501', 'not allowed', '[MEAL-09] another family''s parent can''t decide');

-- [MEAL-11][US-707] A parent's own change on Meals ----------------------------------------------------
select pg_temp.board();
select public.request_lunch(pg_temp.maya(), pg_temp.school_day(1), 'buy', pg_temp.picks(2, '{3}', 2));
select pg_temp.alex();
select is(jsonb_array_length(public.set_lunch_choices(pg_temp.maya(), pg_temp.school_day(1), pg_temp.picks(1, '{2}', 2))), 3,
          '[MEAL-11] a parent changes Maya''s picks on Meals, at once');
select is((select count(*)::integer from public.lunch_request where member_id = pg_temp.maya()
            and lunch_date = pg_temp.school_day(1) and status = 'waiting'), 0,
          '... which replaces her change waiting for the day');
select public.set_lunch(pg_temp.maya(), pg_temp.school_day(1), 'bring');
select is((select count(*)::integer from public.lunch_choice where member_id = pg_temp.maya()
            and lunch_date = pg_temp.school_day(1)), 0, '[MEAL-11] a day changed to Bring drops its picks');
select throws_ok(format($$ select public.set_lunch_choices(%L, %L, %L) $$, pg_temp.maya(), pg_temp.school_day(1),
                        pg_temp.picks(1, '{1}', 1)),
                 '22023', 'only a buy day has picks', '... and a bring day takes none');
select public.set_lunch_cutoff('43000000-0000-0000-0000-000000000001', '07:15');
select pg_temp.as_owner();
select is(private.lunch_open_until('43000000-0000-0000-0000-000000000001', pg_temp.school_day(1)),
          (pg_temp.school_day(1) + time '07:15') at time zone 'America/Chicago',
          '[MEAL-09] a parent sets the cut-off: 7:15 am');
select pg_temp.alex();

-- [CHR-20] The approvals alert counts lunch changes (WP-63) -----------------------------------------
select pg_temp.board();
select public.request_lunch(pg_temp.leo(), pg_temp.school_day(3), 'bring', '[]');
select public.request_lunch(pg_temp.leo(), pg_temp.school_day(4), 'bring', '[]');
select pg_temp.as_owner();
select is((select lunches from private.approvals_waiting('43000000-0000-0000-0000-000000000001',
             '43110000-0000-0000-0000-000000000001', now() - interval '1 hour', now() + interval '1 minute')
            where name = 'Leo'), 2, '[CHR-20] Leo''s two lunch changes wait for Alex');
select is(private.approvals_line((select jsonb_agg(to_jsonb(w)) from private.approvals_waiting(
             '43000000-0000-0000-0000-000000000001', '43110000-0000-0000-0000-000000000001',
             now() - interval '1 hour', now() + interval '1 minute') w)),
          'Leo: 2 lunch changes waiting', '[CHR-20][US-322] the alert says so');

-- [MEAL-09] An item can open Lunches on the board
select pg_temp.alex();
insert into public.chore (household_id, title, kind, points, schedule, day_types, created_by, start_date, assignment, opens)
values ('43000000-0000-0000-0000-000000000001', 'Pick next week''s lunches', 'task', 0, '{"freq": "weekly", "by_weekday": [7]}',
        array['school_day', 'no_school', 'break', 'weekend', 'summer'], '43100000-0000-0000-0000-000000000001',
        pg_temp.today(), 'each', 'lunches');
select is((select opens from public.chore where title = 'Pick next week''s lunches'), 'lunches',
          '[MEAL-09] a parent sets an item to open Lunches');
select throws_ok($$ update public.chore set opens = 'shop' where title = 'Pick next week''s lunches' $$, '23514', null,
                 '... and nothing else');

select * from finish();
rollback;
