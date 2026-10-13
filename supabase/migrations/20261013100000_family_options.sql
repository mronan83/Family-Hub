-- WP-57 (D-84): Family options and Home at a glance.
--
-- [ACC-08][US-110] The day the week starts on, changed in Family options (WP-57, D-84). A change waits
-- for the next week: the week now running keeps its days, and the new start applies from the first
-- day of the new start on or after the end of this week. Until then it is held in household_settings;
-- the day-close job (hourly) and the admin pages apply it once that day has come in the household's
-- time zone. Everything that counts by the week (weekly reward limits, weekly goals, streak weeks,
-- Insights, the Meals week, the calendar) keeps reading household.week_start, so nothing else changes.

alter table public.household_settings
  add column week_start_next    smallint check (week_start_next between 0 and 6),
  add column week_start_next_on date,
  add constraint household_settings_week_start_next_pair
    check ((week_start_next is null) = (week_start_next_on is null));

-- The first day of the new start on or after the end of the week that holds p_today: the week running
-- (old start) keeps its seven days; the days between its end and the new start's first day run as a
-- short week of their own. Same start: none.
create function private.week_start_switch_day(p_today date, p_old smallint, p_new smallint) returns date
language sql immutable set search_path = '' as $$
  select case when p_old = p_new then null else
    (p_today - ((extract(dow from p_today)::integer - p_old + 7) % 7)) + 7 + ((p_new - p_old + 7) % 7)
  end
$$;

-- [ACC-08] An admin asks for a new start day. The same day as now cancels a waiting change. Returns
-- {week_start, next, next_on}.
create function public.set_week_start(p_household uuid, p_day smallint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old smallint;
  v_today date;
  v_on date;
begin
  if p_household is null or p_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if p_day is null or p_day not between 0 and 6 then
    raise exception 'not a day of the week' using errcode = '22023', hint = 'bad_day';
  end if;
  select h.week_start, (now() at time zone h.timezone)::date into v_old, v_today
    from public.household h where h.id = p_household;
  v_on := private.week_start_switch_day(v_today, v_old, p_day);
  update public.household_settings
     set week_start_next = case when v_on is null then null else p_day end,
         week_start_next_on = v_on
   where household_id = p_household;
  return jsonb_build_object('week_start', v_old,
                            'next', case when v_on is null then null else p_day end,
                            'next_on', v_on);
end $$;

-- [ACC-08] A waiting change takes effect once its day has come in the household's time zone. The
-- day-close job (service role) runs this hourly; an admin's page runs it too. True when it applied.
create function public.apply_week_start(p_household uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_next smallint;
begin
  if p_household is null or not (coalesce((select auth.role()), '') = 'service_role'
                                 or p_household in (select private.admin_household_ids())) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  select s.week_start_next into v_next
    from public.household_settings s
    join public.household h on h.id = s.household_id
   where s.household_id = p_household
     and s.week_start_next_on <= (now() at time zone h.timezone)::date
     for update of s;
  if v_next is null then
    return false;
  end if;
  update public.household set week_start = v_next where id = p_household;
  update public.household_settings set week_start_next = null, week_start_next_on = null
   where household_id = p_household;
  return true;
end $$;

revoke all on function private.week_start_switch_day(date, smallint, smallint) from public, anon, authenticated;
revoke all on function public.set_week_start(uuid, smallint), public.apply_week_start(uuid) from public, anon;
grant execute on function public.set_week_start(uuid, smallint) to authenticated;
grant execute on function public.apply_week_start(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- [NFR-17][SCH-01][US-109] No school today, from Home: today becomes a snow day in the school year
-- it falls in (the household's own year first). A day off added on School re-plans from tomorrow, so
-- a mid-day edit never disturbs today; this one is called off in the morning, so today is re-planned
-- too. Re-planning removes only today's untouched items no longer due (homework on a
-- school-days-only item) and keeps anything already checked off. Undo takes today's snow day away
-- and re-plans today again.
-- ---------------------------------------------------------------------------
create function public.no_school_today(p_household uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_today date;
  v_year uuid;
  v_id uuid;
begin
  if p_household is null or p_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  v_today := private.household_today(p_household);
  select y.id into v_year from public.school_year y
   where y.household_id = p_household and y.archived_at is null
     and v_today between y.start_date and y.end_date
   order by y.is_default desc, y.start_date limit 1;
  if v_year is null then
    raise exception 'today is in no school year' using errcode = '22023', hint = 'no_year';
  end if;
  if extract(isodow from v_today) in (6, 7) or exists (
       select from public.school_closure c
        where c.school_year_id = v_year and v_today between c.start_date and c.end_date) then
    raise exception 'today is not a school day' using errcode = '22023', hint = 'not_school_day';
  end if;
  insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date)
  values (p_household, v_year, 'Snow day', 'snow_day', v_today, v_today)
  returning id into v_id;
  perform private.replan(p_household, v_today);
  return v_id;
end $$;

create function public.undo_no_school_today(p_household uuid, p_closure uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_today date;
begin
  if p_household is null or p_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  v_today := private.household_today(p_household);
  delete from public.school_closure
   where id = p_closure and household_id = p_household and closure_type = 'snow_day'
     and start_date = v_today and end_date = v_today;
  if not found then
    return false;
  end if;
  perform private.replan(p_household, v_today);
  return true;
end $$;

revoke all on function public.no_school_today(uuid), public.undo_no_school_today(uuid, uuid) from public, anon;
grant execute on function public.no_school_today(uuid), public.undo_no_school_today(uuid, uuid) to authenticated;
