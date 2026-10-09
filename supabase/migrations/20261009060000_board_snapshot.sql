-- [DEV-05] The board's one read (WP-06, 01 §7, 02 §4.6): everything a paired board shows, in a
-- single call, read through RLS with the board's own session. Realtime only says that something
-- changed; the board then calls this again (notify, then refetch). Members only for now; later work
-- packages add their slices (occurrences, points, calendar, meals) to the same object.

-- ---------------------------------------------------------------------------
-- A board's theme: automatic by household time (06 §4.1), or held on Day or Evening by an admin.
-- ---------------------------------------------------------------------------
alter table public.device add constraint device_board_config_theme
  check (coalesce(board_config ->> 'theme', 'auto') in ('auto', 'day', 'evening'));

-- ---------------------------------------------------------------------------
-- The snapshot. Security invoker: RLS decides every row, so a disconnected board gets null at once.
-- ---------------------------------------------------------------------------
create function public.board_snapshot(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_device    public.device;
  v_household public.household;
  v_today     date;
  v_from      date;
  v_to        date;
begin
  -- Only an active board has a snapshot; RLS shows a board its own row while it is active.
  select * into v_device from public.device
   where auth_user_id = (select auth.uid()) and status = 'active';
  if not found then
    return null;
  end if;
  select * into v_household from public.household where id = v_device.household_id;
  if not found then
    return null;
  end if;

  -- Business dates are household-local (01 §7). The default window is the widest the board shows:
  -- yesterday through two weeks ahead (calendar).
  v_today := (now() at time zone v_household.timezone)::date;
  v_from := coalesce(p_from, v_today - 1);
  v_to := coalesce(p_to, v_today + 14);
  if v_to < v_from or v_to - v_from > 31 then
    raise exception 'the snapshot covers 1 to 32 days' using errcode = '22023', hint = 'bad_range';
  end if;

  return jsonb_build_object(
    'v', 1,
    'fetched_at', now(),
    'today', v_today,
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'household', jsonb_build_object(
      'id', v_household.id,
      'name', v_household.name,
      'timezone', v_household.timezone,
      'week_start', v_household.week_start),
    'device', jsonb_build_object(
      'id', v_device.id,
      'name', v_device.name,
      'theme', coalesce(v_device.board_config ->> 'theme', 'auto')),
    -- Children first, then adults; each by name. Archived members are not on the board.
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'display_name', m.display_name,
               'role', m.role,
               'avatar_key', m.avatar_key,
               'color', m.color,
               'earns_rewards', m.earns_rewards)
             order by (m.role = 'child') desc, m.display_name, m.id)
        from public.member m
       where m.household_id = v_household.id and m.archived_at is null), '[]'::jsonb));
end $$;

revoke all on function public.board_snapshot(date, date) from public, anon;
grant execute on function public.board_snapshot(date, date) to authenticated;
