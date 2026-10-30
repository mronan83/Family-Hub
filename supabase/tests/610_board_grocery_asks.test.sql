-- [MEAL-22][MEAL-30] Asking, ticking off and taking off on the board's Groceries (WP-107, D-149): a
-- board asks, ticks and takes off only for its own household, as one of its own members; an adult's
-- ask never waits, a child's waits while their OK is on and only a parent puts it on the list; at
-- most 5 wait; a child takes off only their own asks; Undo puts back what the board took off; a
-- waiting ask is in the approvals alert, which opens Groceries.
begin;
select plan(48);

-- The job calls are recorded here instead of going out (pg_net isn't in the test database).
create table pg_temp.calls (job text, payload jsonb);
create or replace function private.call_job(p_job text, p_payload jsonb default '{}'::jsonb) returns bigint
language plpgsql set search_path = '' as $$
begin
  insert into pg_temp.calls values (p_job, p_payload);
  return 1;
end $$;

insert into auth.users (id, email) values
  ('61100000-0000-0000-0000-000000000001', 'pat@example.com'),
  ('61300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('61d00000-0000-0000-0000-00000000000d', null),
  ('61d00000-0000-0000-0000-00000000000e', null);
insert into public.household (id, name, timezone) values
  ('61000000-0000-0000-0000-000000000001', 'Ask family', 'America/Chicago'),
  ('61000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('61000000-0000-0000-0000-000000000001'), ('61000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('61000000-0000-0000-0000-000000000001', '61100000-0000-0000-0000-000000000001', 'owner'),
  ('61000000-0000-0000-0000-000000000002', '61300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role, user_id, created_at) values
  ('61110000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-000000000001', 'Pat', 'adult', '61100000-0000-0000-0000-000000000001', now() - interval '4 minutes'),
  ('61110000-0000-0000-0000-00000000000c', '61000000-0000-0000-0000-000000000001', 'Maya', 'child', null, now() - interval '3 minutes'),
  ('61110000-0000-0000-0000-00000000000d', '61000000-0000-0000-0000-000000000001', 'Leo', 'child', null, now() - interval '2 minutes'),
  ('61110000-0000-0000-0000-00000000000e', '61000000-0000-0000-0000-000000000002', 'Nell', 'child', null, now() - interval '1 minute');
insert into public.device (id, household_id, name, auth_user_id) values
  ('61dd0000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'Kitchen',
   '61d00000-0000-0000-0000-00000000000d'),
  ('61dd0000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000002', 'Hall',
   '61d00000-0000-0000-0000-00000000000e');

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('61100000-0000-0000-0000-000000000001') $$;
create function pg_temp.neighbour() returns void language sql as $$
  select pg_temp.as_user('61300000-0000-0000-0000-000000000003') $$;
create function pg_temp.board() returns void language sql as $$
  select pg_temp.as_user('61d00000-0000-0000-0000-00000000000d') $$;
create function pg_temp.other_board() returns void language sql as $$
  select pg_temp.as_user('61d00000-0000-0000-0000-00000000000e') $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
create function pg_temp.as_job() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
end $$;
create function pg_temp.pat() returns uuid language sql as $$ select '61110000-0000-0000-0000-00000000000a'::uuid $$;
create function pg_temp.maya() returns uuid language sql as $$ select '61110000-0000-0000-0000-00000000000c'::uuid $$;
create function pg_temp.leo() returns uuid language sql as $$ select '61110000-0000-0000-0000-00000000000d'::uuid $$;
create function pg_temp.ask(p_who uuid, p_name text, p_brand uuid default null) returns jsonb language sql as $$
  select public.ask_groceries(p_who, p_name, lower(p_name), null, p_brand) $$;
create function pg_temp.open_item(p_name text) returns uuid language sql as $$
  select id from public.grocery_item
   where household_id = '61000000-0000-0000-0000-000000000001' and name = p_name and status = 'open' $$;
create function pg_temp.status_of(p_name text) returns text language sql as $$
  select status from public.grocery_item
   where household_id = '61000000-0000-0000-0000-000000000001' and name = p_name
   order by created_at desc limit 1 $$;
create function pg_temp.asks(p_status text) returns text language sql as $$
  select coalesce(string_agg(m.display_name || ':' || a.name, ',' order by a.asked_at, a.name), '')
    from public.grocery_ask a join public.member m on m.id = a.member_id
   where a.household_id = '61000000-0000-0000-0000-000000000001' and a.status = p_status $$;

-- A brand for the ask, and things already on the list.
select pg_temp.parent();
select public.add_grocery_brand('61000000-0000-0000-0000-000000000001', 'Tropicana');
select public.add_groceries('61000000-0000-0000-0000-000000000001', '[
  {"name": "Milk", "key": "milk"}, {"name": "Paper towels", "key": "paper towel"}, {"name": "Rice", "key": "rice"}]');

-- [MEAL-22-a] Only its own household's board, as one of its own members ------------------------------
select pg_temp.other_board();
select throws_ok($$ select pg_temp.ask(pg_temp.maya(), 'Popcorn') $$, '42501', null,
                 '[MEAL-22-a] another household''s board can''t ask as this household''s child');
select pg_temp.board();
select throws_ok($$ select pg_temp.ask('61110000-0000-0000-0000-00000000000e', 'Popcorn') $$, '42501', null,
                 '[MEAL-22-a] a board can''t ask as another household''s child');
select pg_temp.parent();
select throws_ok($$ select pg_temp.ask(pg_temp.maya(), 'Popcorn') $$, '42501', null,
                 '[MEAL-22-a] a parent''s session is not a board');
select throws_ok($$ insert into public.grocery_ask (household_id, member_id, name, name_key)
                    values ('61000000-0000-0000-0000-000000000001', pg_temp.maya(), 'Popcorn', 'popcorn') $$,
                 '42501', null, '[MEAL-22-a] nobody writes the asks directly');
select pg_temp.as_owner();
update public.member set archived_at = now() where id = pg_temp.leo();
select pg_temp.board();
select throws_ok($$ select pg_temp.ask(pg_temp.leo(), 'Popcorn') $$, '42501', null,
                 '[MEAL-22-a] an archived member can''t ask');
select pg_temp.as_owner();
update public.member set archived_at = null where id = pg_temp.leo();

-- [MEAL-22-b] An adult's ask never waits; a child's waits while their OK is on ------------------------
select pg_temp.board();
select is(pg_temp.ask(pg_temp.pat(), 'Coffee') ->> 'status', 'added', '[MEAL-22-b] Pat''s ask goes on the list');
select is((select string_agg(kind || ':' || member_id::text, ',') from public.grocery_item_reason
            where item_id = pg_temp.open_item('Coffee')), 'ask:' || pg_temp.pat()::text,
          '[MEAL-22-b] ... marked as Pat''s ask');
select is(pg_temp.ask(pg_temp.maya(), 'Orange juice', (select id from public.grocery_brand where name = 'Tropicana')) ->> 'status',
          'waiting', '[MEAL-22-b] Maya''s ask waits (her OK is on to start)');
select is(pg_temp.open_item('Orange juice'), null, '[MEAL-22-b] ... and is not on the list');
select is(pg_temp.ask(pg_temp.maya(), 'Orange juice') ->> 'status', 'waiting',
          '[MEAL-22-b] asking again for the same thing is the same ask');
select is((select count(*)::int from public.grocery_ask where name = 'Orange juice'), 1, '[MEAL-22-b] ... not a second one');
select is(pg_temp.ask(pg_temp.maya(), 'milk') -> 'already', 'true'::jsonb,
          '[MEAL-22-b] something on the list already: "already", never waits');
select is((select count(*)::int from public.grocery_item_reason
            where item_id = pg_temp.open_item('Milk') and kind = 'ask' and member_id = pg_temp.maya()), 1,
          '[MEAL-22-b] ... Maya is a reason on Milk');

-- [MEAL-22-d] Each child's OK, set only by the household's parents ------------------------------------
select pg_temp.board();
select throws_ok($$ select public.set_grocery_ask_ok(pg_temp.leo(), false) $$, '42501', null,
                 '[MEAL-22-d] a board can''t set a child''s OK');
select pg_temp.neighbour();
select throws_ok($$ select public.set_grocery_ask_ok(pg_temp.leo(), false) $$, '42501', null,
                 '[MEAL-22-d] another household''s parent can''t');
select pg_temp.parent();
select throws_ok($$ select public.set_grocery_ask_ok(pg_temp.pat(), false) $$, '22023', null,
                 '[MEAL-22-d] it is a child''s setting');
select is(public.set_grocery_ask_ok(pg_temp.leo(), false), false, '[MEAL-22-d] Pat turns Leo''s OK off');
select pg_temp.board();
select is(pg_temp.ask(pg_temp.leo(), 'Apples') ->> 'status', 'added', '[MEAL-22-b] with it off, Leo''s ask goes straight on');
select isnt(pg_temp.open_item('Apples'), null, '[MEAL-22-b] ... Apples is on the list');

-- [MEAL-22-c] At most 5 waiting; Call off; only a parent decides ---------------------------------------
select pg_temp.ask(pg_temp.maya(), 'Popcorn');
select pg_temp.ask(pg_temp.maya(), 'Cookies');
select pg_temp.ask(pg_temp.maya(), 'Grapes');
select pg_temp.ask(pg_temp.maya(), 'Juice boxes');
select throws_ok($$ select pg_temp.ask(pg_temp.maya(), 'Ice cream') $$, '22023', null,
                 '[MEAL-22-c] a 6th waiting ask is refused');
select ok(public.call_off_grocery_ask((select id from public.grocery_ask where name = 'Juice boxes')),
          '[MEAL-22-c] the board calls one off');
select is(pg_temp.ask(pg_temp.maya(), 'Ice cream') ->> 'status', 'waiting', '[MEAL-22-c] ... and there is room again');
select pg_temp.other_board();
select throws_ok($$ select public.call_off_grocery_ask((select id from public.grocery_ask where name = 'Popcorn')) $$,
                 '42501', null, '[MEAL-22-c] another household''s board can''t call one off');
select pg_temp.board();
select throws_ok($$ select public.decide_grocery_asks(array[(select id from public.grocery_ask where name = 'Popcorn')], true) $$,
                 '42501', null, '[MEAL-22-c] a board can''t decide');
select pg_temp.neighbour();
select throws_ok($$ select public.decide_grocery_asks(array['00000000-0000-0000-0000-000000000000'::uuid], true) $$,
                 '42501', null, '[MEAL-22-c] nor another household''s parent');
select pg_temp.parent();
select is(public.decide_grocery_asks(array(select id from public.grocery_ask where name in ('Orange juice', 'Popcorn')), true), 2,
          '[MEAL-22-c] Pat adds two');
select is((select b.name from public.grocery_item i join public.grocery_brand b on b.id = i.brand_id
            where i.id = pg_temp.open_item('Orange juice')), 'Tropicana',
          '[MEAL-22-c] ... through the merge, with the brand Maya picked');
select is(public.decide_grocery_asks(array(select id from public.grocery_ask where name = 'Cookies'), false), 1,
          '[MEAL-22-c] Not this time');
select is(pg_temp.open_item('Cookies'), null, '[MEAL-22-c] ... Cookies is not on the list');
select pg_temp.board();
select ok(not public.call_off_grocery_ask((select id from public.grocery_ask where name = 'Cookies')),
          '[MEAL-22-c] a decided ask can''t be called off');
select is(pg_temp.asks('waiting'), 'Maya:Grapes,Maya:Ice cream', '[MEAL-22-c] two still wait');

-- [MEAL-22-e] The approvals alert ----------------------------------------------------------------------
select pg_temp.as_owner();
select is((select coalesce(string_agg(job || ':' || (payload ->> 'household'), ','), '') from pg_temp.calls
            where payload ->> 'household' = '61000000-0000-0000-0000-000000000001'),
          'reminders:61000000-0000-0000-0000-000000000001',
          '[MEAL-22-e] a waiting ask calls the alert at once (once per transaction)');
select is(private.approvals_line((select jsonb_agg(to_jsonb(w)) from private.approvals_waiting(
             '61000000-0000-0000-0000-000000000001', pg_temp.pat(), now() - interval '1 hour', now() + interval '1 minute') w)),
          'Maya: 2 grocery asks waiting', '[MEAL-22-e] the alert counts them');
insert into public.reminder_preference (member_id, household_id, enabled) values (pg_temp.pat(), '61000000-0000-0000-0000-000000000001', true);
update public.reminder_preference set approvals_on_at = now() - interval '1 hour' where member_id = pg_temp.pat();
insert into public.push_subscription (household_id, member_id, user_id, endpoint, p256dh, auth_secret, device_label) values
  ('61000000-0000-0000-0000-000000000001', pg_temp.pat(), '61100000-0000-0000-0000-000000000001',
   'https://push.example/pat', repeat('P', 87), repeat('a', 22), 'iPhone');
select pg_temp.as_job();
select public.plan_reminders('61000000-0000-0000-0000-000000000001', now() + interval '1 minute');
select is((select string_agg((c -> 'payload' ->> 'title') || ' | ' || (c -> 'payload' ->> 'body') || ' -> ' || (c -> 'payload' ->> 'url'), '; ')
             from jsonb_array_elements(public.claim_reminders('61000000-0000-0000-0000-000000000001', now() + interval '1 minute')) c
            where c ->> 'kind' = 'approval'),
          'Maya: 2 grocery asks waiting | Open Groceries to decide -> /admin/groceries#asked',
          '[MEAL-22-e] with only asks waiting, it opens Groceries');
select pg_temp.as_owner();

-- [MEAL-30-a] Ticking and taking off at the board, as a member, recorded ------------------------------
select pg_temp.other_board();
select throws_ok($$ select public.board_tick_groceries(array[pg_temp.open_item('Rice')], '61110000-0000-0000-0000-00000000000e', true) $$,
                 'P0002', null, '[MEAL-30-a] another household''s board can''t tick this household''s items');
select pg_temp.board();
select throws_ok($$ select public.board_tick_groceries(array[pg_temp.open_item('Rice')], '61110000-0000-0000-0000-00000000000e', true) $$,
                 '42501', null, '[MEAL-30-a] nor as another household''s member');
select pg_temp.parent();
select throws_ok($$ select public.board_remove_groceries(array[pg_temp.open_item('Rice')], pg_temp.pat()) $$,
                 '42501', null, '[MEAL-30-a] a parent''s session is not a board');
select pg_temp.board();
select is(public.board_tick_groceries(array[pg_temp.open_item('Rice')], pg_temp.leo(), true), 1, '[MEAL-30-a] Leo ticks Rice');
select pg_temp.as_owner();
select is((select status || ':' || ticked_member_id::text || ':' || ticked_device_id::text from public.grocery_item
            where name = 'Rice' and household_id = '61000000-0000-0000-0000-000000000001'),
          'ticked:' || pg_temp.leo()::text || ':61dd0000-0000-0000-0000-000000000001',
          '[MEAL-30-a] a buy, by Leo at the Kitchen board');
select pg_temp.board();
select is(public.board_tick_groceries(array[(select id from public.grocery_item where name = 'Rice')], pg_temp.leo(), false), 1,
          '[MEAL-30-a] Untick puts it back');

-- [MEAL-30-b] A child takes off only their own asks; Undo ---------------------------------------------
select throws_ok($$ select public.board_remove_groceries(array[pg_temp.open_item('Paper towels')], pg_temp.leo()) $$,
                 '42501', null, '[MEAL-30-b] Leo can''t take off what Pat added');
select throws_ok($$ select public.board_remove_groceries(array[pg_temp.open_item('Milk')], pg_temp.maya()) $$,
                 '42501', null, '[MEAL-30-b] nor can Maya take off Milk, which she only joined');
select is(public.board_remove_groceries(array[pg_temp.open_item('Apples')], pg_temp.leo()), 1,
          '[MEAL-30-b] Leo takes off Apples, his own ask');
select is(public.board_remove_groceries(array[pg_temp.open_item('Paper towels')], pg_temp.pat()), 1,
          '[MEAL-30-b] Pat takes off Paper towels');
select pg_temp.as_owner();
select is((select kind || ':' || member_id::text from public.grocery_item_event
            where item_id = (select id from public.grocery_item where name = 'Paper towels') and kind = 'removed'),
          'removed:' || pg_temp.pat()::text, '[MEAL-30-a] the removal is Pat''s, not a buy');
select pg_temp.parent();
select public.add_groceries('61000000-0000-0000-0000-000000000001', '[{"name": "Paper towels", "key": "paper towel", "amount": "×2"}]');
select pg_temp.other_board();
select throws_ok($$ select public.board_restore_groceries(array[(select id from public.grocery_item where name = 'Paper towels' order by created_at limit 1)], '61110000-0000-0000-0000-00000000000e') $$,
                 'P0002', null, '[MEAL-30-b] another household''s board can''t undo it');
select pg_temp.board();
select is(public.board_restore_groceries(
            array[(select id from public.grocery_item where name = 'Paper towels' and status = 'removed' order by created_at limit 1)], pg_temp.pat()), 1,
          '[MEAL-30-b] Undo puts it back');
select is((select count(*)::int from public.grocery_item where name = 'Paper towels' and status = 'open'), 1,
          '[MEAL-30-b] ... once: the one added meanwhile is folded into it');

select * from finish();
rollback;
