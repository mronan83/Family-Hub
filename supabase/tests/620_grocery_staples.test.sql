-- [MEAL-21] Staples (WP-106, D-138 (7), D-150): each thing's buys read from its history, a tick (at a
-- board too) a buy, an untick taking it back, one a household day; the household's choices for a
-- thing, set only through their function by its parents; a suggestion added through the one way in.
begin;
select plan(23);

insert into auth.users (id, email) values
  ('62100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('62300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('62d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('62000000-0000-0000-0000-000000000001', 'Staple family', 'America/Chicago'),
  ('62000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('62000000-0000-0000-0000-000000000001'), ('62000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('62000000-0000-0000-0000-000000000001', '62100000-0000-0000-0000-000000000001', 'owner'),
  ('62000000-0000-0000-0000-000000000002', '62300000-0000-0000-0000-000000000003', 'owner');
insert into public.device (id, household_id, name, auth_user_id) values
  ('62dd0000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000001', 'Kitchen',
   '62d00000-0000-0000-0000-00000000000d');

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('62100000-0000-0000-0000-000000000001') $$;
create function pg_temp.neighbour() returns void language sql as $$
  select pg_temp.as_user('62300000-0000-0000-0000-000000000003') $$;
create function pg_temp.board() returns void language sql as $$
  select pg_temp.as_user('62d00000-0000-0000-0000-00000000000d') $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- A thing got (and maybe unticked) at these times: one item each, ticked, with its history.
create function pg_temp.got(p_name text, p_key text, p_at timestamptz, p_untick boolean default false)
returns void language plpgsql as $$
declare
  v_item uuid;
begin
  insert into public.grocery_item (household_id, list_id, name, name_key, category_id, status, ticked_at)
  select l.household_id, l.id, p_name, p_key, c.id, 'ticked', p_at
    from public.grocery_list l join public.grocery_category c on c.household_id = l.household_id and c.is_other
   where l.household_id = '62000000-0000-0000-0000-000000000001'
  returning id into v_item;
  insert into public.grocery_item_event (household_id, item_id, kind, at)
  values ('62000000-0000-0000-0000-000000000001', v_item, 'ticked', p_at);
  if p_untick then
    insert into public.grocery_item_event (household_id, item_id, kind, at)
    values ('62000000-0000-0000-0000-000000000001', v_item, 'unticked', p_at + interval '2 minutes');
  end if;
end $$;
create function pg_temp.days(p_key text) returns date[] language sql as $$
  select days from public.grocery_buys('62000000-0000-0000-0000-000000000001') where name_key = p_key $$;
create function pg_temp.buys(p_key text) returns int language sql as $$
  select buys from public.grocery_buys('62000000-0000-0000-0000-000000000001') where name_key = p_key $$;

-- Made-up histories, a few days before today in Chicago.
select pg_temp.got('milk', 'milk', (current_date - 20) + time '10:00' at time zone 'America/Chicago');
-- Twice on one day: once.
select pg_temp.got('Milk', 'milk', (current_date - 15) + time '09:00' at time zone 'America/Chicago');
select pg_temp.got('Milk ×2', 'milk', (current_date - 15) + time '17:00' at time zone 'America/Chicago');
-- Ticked by mistake and unticked: no buy.
select pg_temp.got('Milk', 'milk', (current_date - 12) + time '10:00' at time zone 'America/Chicago', true);
-- 11:30 pm in Chicago is the next day in UTC: Chicago's day counts.
select pg_temp.got('Milk', 'milk', (current_date - 10) + time '23:30' at time zone 'America/Chicago');
-- Ticked at the board, as Sam (WP-107): a buy like any other.
select pg_temp.got('Milk', 'milk', (current_date - 5) + time '10:00' at time zone 'America/Chicago');
update public.grocery_item_event set device_id = '62dd0000-0000-0000-0000-000000000001'
 where item_id = (select id from public.grocery_item where name_key = 'milk' order by ticked_at desc limit 1);
-- Removed, never ticked: not a buy.
insert into public.grocery_item (household_id, list_id, name, name_key, category_id, status)
select l.household_id, l.id, 'Bread', 'bread', c.id, 'removed'
  from public.grocery_list l join public.grocery_category c on c.household_id = l.household_id and c.is_other
 where l.household_id = '62000000-0000-0000-0000-000000000001';
-- Bought ten times: only the latest 8 days come back, with the count.
select pg_temp.got('Eggs', 'eggs', (current_date - 7 * g) + time '10:00' at time zone 'America/Chicago')
  from generate_series(1, 10) g;

-- [MEAL-21-d] Read by the household's parent.
select pg_temp.parent();
select is(pg_temp.days('milk'),
          array[current_date - 20, current_date - 15, current_date - 10, current_date - 5]::date[],
          '[MEAL-21-d] a tick is a buy, an untick takes it back, two on a day count once, the day is the household''s');
select is(pg_temp.buys('milk'), 4, '[MEAL-21-d] Milk has 4 buys, the board''s among them');
select is((select name from public.grocery_buys('62000000-0000-0000-0000-000000000001') where name_key = 'milk'),
          'Milk', '[MEAL-21-d] with the name of its latest buy');
select is(pg_temp.days('bread'), null, '[MEAL-21-d] a removal is not a buy');
select is(pg_temp.buys('eggs'), 10, '[MEAL-21-d] Eggs were bought 10 times');
select is(cardinality(pg_temp.days('eggs')), 8, '[MEAL-21-d] and the latest 8 days come back');
select is((pg_temp.days('eggs'))[8], current_date - 7, '[MEAL-21-d] oldest first, the latest last');

-- [MEAL-21-e] Another household's parent and a board read none of it.
select pg_temp.neighbour();
select throws_ok($$ select * from public.grocery_buys('62000000-0000-0000-0000-000000000001') $$,
                 '42501', null, '[MEAL-21-e] another household''s parent can''t read the buys');
select pg_temp.board();
select throws_ok($$ select * from public.grocery_buys('62000000-0000-0000-0000-000000000001') $$,
                 '42501', null, '[MEAL-21-e] nor can a board');
select throws_ok($$ select public.set_grocery_staple('62000000-0000-0000-0000-000000000001', 'milk', 'off') $$,
                 '42501', null, '[MEAL-21-e] a board can''t set a choice');

-- [MEAL-21-e] Not now, Don't suggest and Suggest again, by the household's parent.
select pg_temp.parent();
select lives_ok($$ select public.set_grocery_staple('62000000-0000-0000-0000-000000000001', 'milk', 'not_now',
                                                   current_date + 5) $$, '[MEAL-21-e] Not now on Milk');
select is((select not_now_until from public.grocery_staple where name_key = 'milk'), current_date + 5,
          '[MEAL-21-e] it is hidden until its day');
select throws_ok($$ select public.set_grocery_staple('62000000-0000-0000-0000-000000000001', 'milk', 'not_now',
                                                    current_date - 1) $$,
                 '22023', null, '[MEAL-21-e] Not now needs a day to come');
select throws_ok($$ select public.set_grocery_staple('62000000-0000-0000-0000-000000000001', 'milk', 'not_now',
                                                    current_date + 400) $$,
                 '22023', null, '[MEAL-21-e] within the coming year');
select throws_ok($$ select public.set_grocery_staple('62000000-0000-0000-0000-000000000001', 'milk', 'never') $$,
                 '22023', null, '[MEAL-21-e] only Not now, Don''t suggest or Suggest again');
select public.set_grocery_staple('62000000-0000-0000-0000-000000000001', 'milk', 'off');
select ok((select off_at is not null from public.grocery_staple where name_key = 'milk'),
          '[MEAL-21-e] Don''t suggest stops it');
select public.set_grocery_staple('62000000-0000-0000-0000-000000000001', 'milk', 'on');
select ok((select off_at is null and not_now_until is null from public.grocery_staple where name_key = 'milk'),
          '[MEAL-21-e] Suggest again brings it back, Not now cleared');
select is((select count(*)::int from public.grocery_staple), 1, '[MEAL-21-e] one choice a thing');
select throws_ok($$ insert into public.grocery_staple (household_id, name_key)
                    values ('62000000-0000-0000-0000-000000000001', 'eggs') $$,
                 '42501', null, '[MEAL-21-e] nobody writes the table directly');
select pg_temp.neighbour();
select throws_ok($$ select public.set_grocery_staple('62000000-0000-0000-0000-000000000001', 'eggs', 'off') $$,
                 '42501', null, '[MEAL-21-e] another household''s parent can''t set one');
select is((select count(*)::int from public.grocery_staple), 0,
          '[MEAL-21-e] nor read the household''s choices');

-- [MEAL-21-f] Add goes through the one way in, its reason a staple; nothing else adds one.
select pg_temp.parent();
select public.add_groceries('62000000-0000-0000-0000-000000000001',
  '[{"name": "Eggs", "key": "eggs", "reason": {"kind": "staple"}}]');
select is((select r.kind from public.grocery_item_reason r join public.grocery_item i on i.id = r.item_id
            where i.name_key = 'eggs' and i.status = 'open'), 'staple',
          '[MEAL-21-f] Add puts it on the list as a staple');
select pg_temp.as_owner();
select is((select count(*)::int from public.grocery_item
            where household_id = '62000000-0000-0000-0000-000000000001' and status = 'open'), 1,
          '[MEAL-21-f] and nothing else is on the list: nothing is added by itself');

select * from finish();
rollback;
