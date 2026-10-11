-- [MEAL-04] Lunch: buy or bring (WP-26, D-78; 02 §3.6 "Effective lunch mode"). Each child has a usual
-- lunch for each school weekday, and a parent can change one school day. Only school days have a
-- lunch to choose: the child's day type (WP-21: their own school year, or the household's default)
-- decides, so weekends, breaks and days off have none.
--   * `member_lunch`: a child's usual lunch, Monday to Friday ({"mon": "buy", …}); a weekday without
--     one is "bring". It is the child's, whatever school year they follow (member_school_profile's
--     own lunch_defaults stays unused).
--   * `lunch_override`: one day changed. Changed back to the usual, it is removed, so an override is
--     always a difference from the usual.
--   * lunch_mode(member, date): 'buy', 'bring', or null on a day with no school lunch.
--   * lunch_week(household, from): each child's seven days from `from`, for the Meals page and the
--     board (WP-28): the day type, the mode and whether it was changed.

create table public.member_lunch (
  member_id    uuid primary key,
  household_id uuid not null,
  defaults     jsonb not null default '{}' check (jsonb_typeof(defaults) = 'object'),
  updated_at   timestamptz not null default now(),
  unique (household_id, member_id),
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade
);
create trigger trg_member_lunch_updated before update on public.member_lunch
  for each row execute function private.set_updated_at();

create table public.lunch_override (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  member_id    uuid not null,
  lunch_date   date not null,
  mode         text not null check (mode in ('buy', 'bring')),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (member_id, lunch_date),
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade
);
create index on public.lunch_override (household_id, lunch_date);

-- The weekday key of a date: 'mon' … 'sun'.
create function private.weekday_key(p_date date) returns text
language sql immutable set search_path = '' as $$
  select (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[extract(isodow from p_date)::integer]
$$;

-- A child's usual lunch on a date's weekday: 'buy' or 'bring' (none set is 'bring').
create function private.usual_lunch(p_member uuid, p_date date) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select l.defaults ->> private.weekday_key(p_date)
                     from public.member_lunch l where l.member_id = p_member), 'bring')
$$;

-- [MEAL-04] A child's lunch on a date: the day's change, else their usual for the weekday; null when
-- it isn't a school day for them (a weekend, a break, a day off, the summer), and for an adult.
create function public.lunch_mode(p_member uuid, p_date date) returns text
language sql stable security definer set search_path = '' as $$
  select case when not exists (select from public.member m where m.id = p_member and m.role = 'child') then null
              when public.resolve_day_type(p_member, p_date) <> 'school_day' then null
              else coalesce((select o.mode from public.lunch_override o
                              where o.member_id = p_member and o.lunch_date = p_date),
                            private.usual_lunch(p_member, p_date)) end
$$;

-- Raises unless the caller is a parent of the member's household and the member a child (school
-- lunch is a child's); returns the member's household.
create function private.lunch_access(p_member uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.member;
begin
  select * into m from public.member where id = p_member and archived_at is null;
  if auth.uid() is null or not found or m.household_id not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if m.role <> 'child' then
    raise exception 'school lunch is a child''s' using errcode = '22023', hint = 'not_a_child';
  end if;
  return m.household_id;
end $$;

-- [MEAL-04][US-703] A parent sets a child's usual lunches: p_defaults {mon … fri: 'buy' | 'bring'}
-- (keys left out are 'bring'). Returns them as stored.
create function public.set_lunch_defaults(p_member uuid, p_defaults jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.lunch_access(p_member);
  v_clean     jsonb := '{}'::jsonb;
  k           text;
begin
  if p_defaults is null or jsonb_typeof(p_defaults) <> 'object' then
    raise exception 'usual lunches by weekday' using errcode = '22023', hint = 'bad_request';
  end if;
  for k in select jsonb_object_keys(p_defaults) loop
    if k not in ('mon', 'tue', 'wed', 'thu', 'fri') or p_defaults ->> k not in ('buy', 'bring') then
      raise exception 'Monday to Friday, buy or bring' using errcode = '22023', hint = 'bad_request';
    end if;
    v_clean := v_clean || jsonb_build_object(k, p_defaults ->> k);
  end loop;
  insert into public.member_lunch (member_id, household_id, defaults) values (p_member, v_household, v_clean)
  on conflict (member_id) do update set defaults = excluded.defaults
   where member_lunch.defaults is distinct from excluded.defaults;
  -- A day changed to what is now the usual is no longer a change.
  delete from public.lunch_override o
   where o.member_id = p_member and o.lunch_date >= private.household_today(v_household)
     and o.mode = coalesce(v_clean ->> private.weekday_key(o.lunch_date), 'bring');
  return v_clean;
end $$;

-- [MEAL-04][US-703] A parent sets one day's lunch for a child, on a school day only. The usual for the
-- weekday removes the change; anything else is kept as the day's change. Returns the day's mode.
create function public.set_lunch(p_member uuid, p_date date, p_mode text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.lunch_access(p_member);
begin
  if p_date is null or p_mode is null or p_mode not in ('buy', 'bring') then
    raise exception 'a day, and buy or bring' using errcode = '22023', hint = 'bad_request';
  end if;
  if public.resolve_day_type(p_member, p_date) <> 'school_day' then
    raise exception 'no school lunch that day' using errcode = '22023', hint = 'not_school_day';
  end if;
  if p_mode = private.usual_lunch(p_member, p_date) then
    delete from public.lunch_override where member_id = p_member and lunch_date = p_date;
  else
    insert into public.lunch_override (household_id, member_id, lunch_date, mode, created_by)
    values (v_household, p_member, p_date, p_mode, auth.uid())
    on conflict (member_id, lunch_date) do update set mode = excluded.mode, created_by = excluded.created_by,
                                                      created_at = now()
     where lunch_override.mode <> excluded.mode;
  end if;
  return p_mode;
end $$;

-- [MEAL-04] Each child's lunch for the seven days from p_from: [{member_id, usual: {mon …}, days:
-- [{date, day_type, mode (null: no school lunch), changed}]}], children by name. For a parent of the
-- household or one of its boards (the board's meals, WP-28).
create function public.lunch_week(p_household uuid, p_from date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_household is null or p_from is null
     or not (p_household in (select private.admin_household_ids())
             or p_household = private.device_household_id()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'member_id', m.id,
             'usual', coalesce((select l.defaults from public.member_lunch l where l.member_id = m.id), '{}'::jsonb),
             'days', (select jsonb_agg(jsonb_build_object(
                               'date', d.day,
                               'day_type', public.resolve_day_type(m.id, d.day),
                               'mode', public.lunch_mode(m.id, d.day),
                               'changed', exists (select from public.lunch_override o
                                                   where o.member_id = m.id and o.lunch_date = d.day
                                                     and public.resolve_day_type(m.id, d.day) = 'school_day'))
                             order by d.day)
                        from generate_series(p_from, p_from + 6, interval '1 day') g (t)
                        cross join lateral (select g.t::date as day) d))
           order by m.display_name, m.id)
      from public.member m
     where m.household_id = p_household and m.role = 'child' and m.archived_at is null), '[]'::jsonb);
end $$;

alter table public.member_lunch enable row level security;
alter table public.lunch_override enable row level security;
create policy member_lunch_admin_select on public.member_lunch for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy member_lunch_device_select on public.member_lunch for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy lunch_override_admin_select on public.lunch_override for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy lunch_override_device_select on public.lunch_override for select to authenticated
  using (household_id = (select private.device_household_id()));
revoke all on public.member_lunch, public.lunch_override from public, anon;
revoke insert, update, delete, truncate on public.member_lunch, public.lunch_override from authenticated;
grant select on public.member_lunch, public.lunch_override to authenticated;

create trigger trg_audit after insert or update or delete on public.member_lunch
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.lunch_override
  for each row execute function private.audit_row();

revoke all on function private.weekday_key(date), private.usual_lunch(uuid, date), private.lunch_access(uuid)
  from public, anon, authenticated;
revoke all on function public.lunch_mode(uuid, date), public.set_lunch_defaults(uuid, jsonb),
  public.set_lunch(uuid, date, text), public.lunch_week(uuid, date) from public, anon;
grant execute on function public.lunch_mode(uuid, date), public.set_lunch_defaults(uuid, jsonb),
  public.set_lunch(uuid, date, text), public.lunch_week(uuid, date) to authenticated;
