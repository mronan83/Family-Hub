-- [DEV-05][NFR-04] WP-126, D-159: the board hears a change from a message the database sends when
-- the change commits (Realtime Broadcast from Database), instead of Realtime polling the WAL for
-- every board's Postgres Changes subscriptions (WP-124 measured that polling as the largest user of
-- both databases).
--
-- Each board listens on its own private topic, `board:<device id>`. A statement that changes a
-- board-readable table sends one message to each active board it concerns, however many rows it
-- changed: the household's boards for the household's tables, the board itself for `device` and
-- `device_calendar` (as the old subscriptions' filters did). The message says only which table
-- changed ({"table": "member"}); the board then reads its snapshot through RLS, as before.
--
-- Why a topic per board, not per household: Realtime checks a private channel's policy when a
-- board joins and keeps the answer for the connection. A board disconnected while joined would go
-- on hearing a household topic; sending only to active boards stops it at once, as RLS did.
--
-- The tables stay in the supabase_realtime publication for now (expand; D-159): a board still on
-- the old app listens there until it reloads onto this one. Nothing else subscribes to them, so
-- Realtime does not poll them once those boards have reloaded.

-- realtime.send() and realtime.topic() are Realtime's (hosted Supabase). Refuse to apply without
-- them, rather than ship triggers that fail every write.
do $$
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null
     or to_regprocedure('realtime.topic()') is null then
    raise exception 'WP-126 needs Realtime''s realtime.send() and realtime.topic()';
  end if;
end $$;

-- The caller's board while it is active (null for anyone else).
create function private.device_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.device where auth_user_id = (select auth.uid()) and status = 'active'
$$;
revoke all on function private.device_id() from public, anon;
grant execute on function private.device_id() to authenticated, service_role;

-- Sends {"table": <name>} on each concerned active board's topic, once per statement. Arguments:
-- the scope ('household' or 'device') and the column of the changed rows that names it. The rows
-- are the statement's transition table `changed`. realtime.send() catches its own errors, so a
-- message that cannot be sent never fails the change.
create function private.board_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ids uuid[];
  board uuid;
begin
  execute format('select array_agg(distinct %I) from changed', tg_argv[1]) into ids;
  if ids is null then
    return null;
  end if;
  for board in
    select d.id from public.device d
     where d.status = 'active'
       and (case when tg_argv[0] = 'device' then d.id else d.household_id end) = any (ids)
  loop
    perform realtime.send(jsonb_build_object('table', tg_table_name), 'change', 'board:' || board, true);
  end loop;
  return null;
end $$;
revoke all on function private.board_notify() from public, anon, authenticated;

-- One trigger per table and kind of change (a transition table needs a trigger of one event).
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('household', 'household', 'id'),
      ('household_settings', 'household', 'household_id'),
      ('member', 'household', 'household_id'),
      ('device', 'device', 'id'),
      ('points_ledger', 'household', 'household_id'),
      ('penalty', 'household', 'household_id'),
      ('penalty_payment', 'household', 'household_id'),
      ('penalty_payback', 'household', 'household_id'),
      ('chore_occurrence', 'household', 'household_id'),
      ('chore', 'household', 'household_id'),
      ('streak_segment', 'household', 'household_id'),
      ('wishlist_pin', 'household', 'household_id'),
      ('reward_catalog_item', 'household', 'household_id'),
      ('redemption', 'household', 'household_id'),
      ('reward_goal', 'household', 'household_id'),
      ('reward_goal_progress', 'household', 'household_id'),
      ('reward_goal_period', 'household', 'household_id'),
      ('reward_rule_progress', 'household', 'household_id'),
      ('calendar_source', 'household', 'household_id'),
      ('calendar_member', 'household', 'household_id'),
      ('device_calendar', 'device', 'device_id'),
      ('weather_reading', 'household', 'household_id'),
      ('meal', 'household', 'household_id'),
      ('meal_plan_entry', 'household', 'household_id'),
      ('member_lunch', 'household', 'household_id'),
      ('lunch_override', 'household', 'household_id'),
      ('school_menu_day', 'household', 'household_id'),
      ('lunch_request', 'household', 'household_id'),
      ('lunch_choice', 'household', 'household_id'),
      ('grocery_item', 'household', 'household_id'),
      ('grocery_item_reason', 'household', 'household_id'),
      ('grocery_category', 'household', 'household_id'),
      ('grocery_store', 'household', 'household_id'),
      ('grocery_brand', 'household', 'household_id'),
      ('grocery_ask', 'household', 'household_id')
    ) as v (tbl, scope, col)
  loop
    execute format(
      'create trigger board_notify_insert after insert on public.%I referencing new table as changed
         for each statement execute function private.board_notify(%L, %L)', t.tbl, t.scope, t.col);
    execute format(
      'create trigger board_notify_update after update on public.%I referencing new table as changed
         for each statement execute function private.board_notify(%L, %L)', t.tbl, t.scope, t.col);
    execute format(
      'create trigger board_notify_delete after delete on public.%I referencing old table as changed
         for each statement execute function private.board_notify(%L, %L)', t.tbl, t.scope, t.col);
  end loop;
end $$;

-- Realtime authorization: an active board may receive Broadcast on its own topic only. Nobody gets
-- an insert policy, so no client can send on a board's topic.
drop policy if exists board_hears_its_own_topic on realtime.messages;
create policy board_hears_its_own_topic on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'board:' || (select private.device_id())
  );
