-- [MENU-01][MENU-02][MENU-03][MENU-04][MENU-05][MEAL-05] School menus (WP-27, 01 §5.5, 02 §3.6, D-79).
--   * `menu_source`: where a school's lunch menu comes from. `nutrislice` reads the school's public
--     Nutrislice menu (config {district, school, menu_type}, picked in the admin portal, so no school's
--     identifiers live in the repo); `csv` is filled by uploading a file; `manual` by typing each day.
--   * `school_menu_day`: one school day's lunch at a source: its items (each a name, and the section
--     it is listed under), or no lunch served that day (a holiday) with a note.
--   * A parent's own days (typed in, or imported from a file) are overrides: the feed never replaces
--     them (MENU-03). Clearing one hands the day back to the feed.
--   * The menu_import job fetches each Nutrislice source daily over the next 28 days (MENU-05). A failed
--     fetch changes only the source's status and error: its cached days stay (MENU-04).
--   * A child's menu is the source on their lunch settings (member_lunch.menu_source_id); lunch_week
--     gives the day's menu on each day they buy (MEAL-05).

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.menu_source (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.household (id) on delete cascade,
  name            text not null check (name = btrim(name) and length(name) between 1 and 40),
  adapter         text not null check (adapter in ('nutrislice', 'csv', 'manual')),
  config          jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  status          text not null default 'pending' check (status in ('pending', 'ok', 'error')),
  last_fetch_at   timestamptz,                    -- the last attempt (a feed only)
  last_success_at timestamptz,
  last_error      text check (length(last_error) <= 300),
  -- What the last good fetch read: sha256 of the window's first day and the menus. The same hash,
  -- the same days, so the fetch skips writing.
  content_hash    text check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (household_id, id)
);
create index on public.menu_source (household_id, created_at);

create table public.school_menu_day (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  source_id    uuid not null,
  menu_date    date not null,
  meal_service text not null default 'lunch' check (meal_service in ('breakfast', 'lunch')),
  items        jsonb not null default '[]' check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 60),
  no_service   boolean not null default false,  -- no lunch served that day (a holiday)
  note         text check (length(note) <= 120), -- what the day says ("No School - Fall Break")
  origin       text not null check (origin in ('adapter', 'csv', 'manual')),
  is_override  boolean not null default false,   -- a parent's own: the feed never replaces it
  fetched_at   timestamptz,
  updated_at   timestamptz not null default now(),
  unique (source_id, menu_date, meal_service),
  foreign key (household_id, source_id) references public.menu_source (household_id, id) on delete cascade
);
create index on public.school_menu_day (household_id, menu_date);

-- [MENU-01] A child's menu: on their lunch settings, whatever school year they follow (like their
-- usual lunches, D-78). Removing the source unlinks them.
alter table public.member_lunch add column menu_source_id uuid;
alter table public.member_lunch add constraint member_lunch_menu_source_fkey
  foreign key (household_id, menu_source_id) references public.menu_source (household_id, id)
  on delete set null (menu_source_id);

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- The caller may change this household's menus: one of its admins, or the service role (the job).
create function private.menu_writer(p_household uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.role()), '') = 'service_role'
      or p_household in (select private.admin_household_ids())
$$;

-- A source's config as stored: Nutrislice's {district, school, menu_type} (slugs, as in the school's
-- menu address) with the names the picker showed; nothing for a file or by hand.
create function private.menu_config(p_adapter text, p_config jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  k text;
begin
  if p_adapter <> 'nutrislice' then
    if p_config is not null and p_config <> '{}'::jsonb then
      raise exception 'only a feed has settings' using errcode = '22023', hint = 'bad_config';
    end if;
    return '{}'::jsonb;
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'a feed needs its district, school and menu' using errcode = '22023', hint = 'bad_config';
  end if;
  foreach k in array array['district', 'school', 'menu_type'] loop
    if coalesce(p_config ->> k, '') !~ '^[a-z0-9][a-z0-9-]{0,79}$' then
      raise exception 'a feed''s % is the name in its menu address', k using errcode = '22023', hint = 'bad_config';
    end if;
  end loop;
  foreach k in array array['school_name', 'menu_type_name'] loop
    if p_config ? k and (jsonb_typeof(p_config -> k) <> 'string' or length(p_config ->> k) > 80) then
      raise exception 'a feed''s names are up to 80 characters' using errcode = '22023', hint = 'bad_config';
    end if;
  end loop;
  return jsonb_strip_nulls(jsonb_build_object(
    'district', p_config ->> 'district', 'school', p_config ->> 'school', 'menu_type', p_config ->> 'menu_type',
    'school_name', nullif(btrim(p_config ->> 'school_name'), ''),
    'menu_type_name', nullif(btrim(p_config ->> 'menu_type_name'), '')));
end $$;

-- A day's items as stored: [{name, section?}], names 1 to 120 characters, sections up to 60, at most
-- 60 items. Raises on anything else.
create function private.menu_items(p_items jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_out  jsonb := '[]'::jsonb;
  v_item jsonb;
  v_name text;
  v_sec  text;
begin
  if p_items is null then
    return v_out;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 60 then
    raise exception 'a day''s menu is up to 60 items' using errcode = '22023', hint = 'bad_menu';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_name := btrim(v_item ->> 'name');
    v_sec := nullif(btrim(v_item ->> 'section'), '');
    if jsonb_typeof(v_item) <> 'object' or coalesce(length(v_name), 0) not between 1 and 120
       or coalesce(length(v_sec), 0) > 60 then
      raise exception 'each item has a name of up to 120 characters' using errcode = '22023', hint = 'bad_menu';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('name', v_name, 'section', v_sec)));
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------------------------
-- [MENU-01][MENU-02] Adding, changing and removing a source, and a child's menu (a parent)
-- ---------------------------------------------------------------------------------------------

-- Adds a source (p_source null) or renames one or changes its feed's settings; its kind stays. New
-- feed settings start over (the next fetch decides the status; the cached days stay until then).
-- Returns the source's id.
create function public.save_menu_source(p_household uuid, p_source uuid, p_name text, p_adapter text,
                                        p_config jsonb default '{}') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_src    public.menu_source;
  v_config jsonb;
  v_id     uuid;
begin
  if p_household is null or p_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if p_adapter is null or p_adapter not in ('nutrislice', 'csv', 'manual') then
    raise exception 'a menu comes from Nutrislice, a file, or by hand' using errcode = '22023', hint = 'bad_config';
  end if;
  v_config := private.menu_config(p_adapter, p_config);

  if p_source is null then
    insert into public.menu_source (household_id, name, adapter, config, status)
    values (p_household, btrim(p_name), p_adapter, v_config,
            case when p_adapter = 'nutrislice' then 'pending' else 'ok' end)
    returning id into v_id;
    return v_id;
  end if;

  select * into v_src from public.menu_source where id = p_source and household_id = p_household for update;
  if not found then
    raise exception 'menu not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  if v_src.adapter <> p_adapter then
    raise exception 'a menu keeps where it comes from' using errcode = '22023', hint = 'bad_config';
  end if;
  update public.menu_source
     set name = btrim(p_name), config = v_config,
         status = case when v_config <> v_src.config then 'pending' else status end,
         last_error = case when v_config <> v_src.config then null else last_error end,
         content_hash = case when v_config <> v_src.config then null else content_hash end
   where id = p_source;
  return p_source;
end $$;

-- Removes a source with its days; the children who used it have no menu until another is chosen.
create function public.remove_menu_source(p_source uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.menu_source
   where id = p_source and household_id in (select private.admin_household_ids());
  if not found then
    raise exception 'menu not found' using errcode = 'P0002', hint = 'not_found';
  end if;
end $$;

-- [MENU-01] A parent chooses which menu a child's school lunch comes from (null: none).
create function public.set_child_menu(p_member uuid, p_source uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.lunch_access(p_member);
begin
  if p_source is not null
     and not exists (select from public.menu_source where id = p_source and household_id = v_household) then
    raise exception 'menu not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  insert into public.member_lunch (member_id, household_id, menu_source_id) values (p_member, v_household, p_source)
  on conflict (member_id) do update set menu_source_id = excluded.menu_source_id
   where member_lunch.menu_source_id is distinct from excluded.menu_source_id;
  return p_source;
end $$;

-- ---------------------------------------------------------------------------------------------
-- [MENU-03] A parent's own days: from a file, or typed in. Each is an override: the feed never
-- replaces it.
-- ---------------------------------------------------------------------------------------------

-- Stores days for a source: p_days [{date, items: [{name, section?}], no_service?, note?}], at most 120,
-- each replacing that day's lunch whatever it was. p_origin 'csv' (a file) or 'manual' (typed in).
-- Returns how many days were stored.
create function public.save_menu_days(p_source uuid, p_days jsonb, p_origin text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_src public.menu_source;
  v_day jsonb;
  v_n   integer := 0;
  v_ok  boolean;
begin
  select * into v_src from public.menu_source where id = p_source for update;
  if not found or v_src.household_id not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if p_origin is null or p_origin not in ('csv', 'manual') then
    raise exception 'days come from a file or are typed in' using errcode = '22023', hint = 'bad_request';
  end if;
  if jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days) not between 1 and 120 then
    raise exception 'between 1 and 120 days at once' using errcode = '22023', hint = 'bad_menu';
  end if;
  for v_day in select value from jsonb_array_elements(p_days) loop
    begin
      v_ok := (v_day ->> 'date')::date is not null;
    exception when others then
      v_ok := false;
    end;
    if not v_ok then
      raise exception 'each day has its date' using errcode = '22023', hint = 'bad_menu';
    end if;
    if coalesce((v_day ->> 'no_service')::boolean, false) is false
       and jsonb_array_length(private.menu_items(v_day -> 'items')) = 0 then
      raise exception 'a day has its items, or says no lunch is served' using errcode = '22023', hint = 'bad_menu';
    end if;
    insert into public.school_menu_day as d
           (household_id, source_id, menu_date, items, no_service, note, origin, is_override)
    values (v_src.household_id, p_source, (v_day ->> 'date')::date, private.menu_items(v_day -> 'items'),
            coalesce((v_day ->> 'no_service')::boolean, false),
            left(nullif(btrim(v_day ->> 'note'), ''), 120), p_origin, true)
    on conflict (source_id, menu_date, meal_service) do update
       set items = excluded.items, no_service = excluded.no_service, note = excluded.note,
           origin = excluded.origin, is_override = true, fetched_at = null, updated_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Clears a day: a feed's day goes back to the feed (its next fetch fills it in again), a file's or
-- typed-in day is gone.
create function public.clear_menu_day(p_source uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_src public.menu_source;
begin
  select * into v_src from public.menu_source where id = p_source for update;
  if not found or v_src.household_id not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  delete from public.school_menu_day where source_id = p_source and menu_date = p_date;
  if v_src.adapter = 'nutrislice' then
    update public.menu_source set content_hash = null where id = p_source;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- [MENU-02][MENU-04][MENU-05] The fetch
-- ---------------------------------------------------------------------------------------------

-- The household's feeds due a fetch (the job; service role only): never fetched, or last tried 20
-- hours ago or more, so a daily call finds each one each day. With the household's zone.
create function public.menu_sources_due(p_household uuid, p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'config', s.config, 'content_hash', s.content_hash, 'timezone', h.timezone)
         order by s.last_fetch_at nulls first, s.id), '[]'::jsonb)
    into v_out
    from public.menu_source s
    join public.household h on h.id = s.household_id
   where s.household_id = p_household and s.adapter = 'nutrislice'
     and (s.last_fetch_at is null or s.last_fetch_at <= p_now - interval '20 hours');
  return v_out;
end $$;

-- Stores one fetch's outcome for a feed, under a lock on it. The service role (the job) or one of the
-- household's admins (saving a feed fetches it at once).
--   {"ok": false, "error": "…"}             the fetch failed: status and error only; the cached
--                                           days stay (MENU-04)
--   {"ok": true, "unchanged": true, "content_hash"}
--   {"ok": true, "content_hash", "from", "to", "days": [{date, items, no_service?, note?}]}
--     the days from `from` to `to` (inclusive) as the feed has them: each replaces the cached day
--     unless that day is a parent's own; a cached feed day in the window the feed no longer has is
--     removed. Days more than 60 days past are dropped.
create function public.save_menu_fetch(p_source uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_src   public.menu_source;
  v_now   timestamptz := now();
  v_from  date;
  v_to    date;
  v_saved integer;
  v_kept  integer;
begin
  select * into v_src from public.menu_source where id = p_source for update;
  if not found or not private.menu_writer(v_src.household_id) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_src.adapter <> 'nutrislice' then
    raise exception 'only a feed is fetched' using errcode = '22023', hint = 'bad_fetch';
  end if;
  if jsonb_typeof(p_result) is distinct from 'object' then
    raise exception 'a fetch result is an object' using errcode = '22023', hint = 'bad_fetch';
  end if;

  if (p_result ->> 'ok') is distinct from 'true' then
    update public.menu_source
       set status = 'error', last_fetch_at = v_now,
           last_error = left(coalesce(nullif(btrim(p_result ->> 'error'), ''), 'The menu couldn''t be read.'), 300)
     where id = p_source;
    return jsonb_build_object('status', 'error');
  end if;

  if coalesce(p_result ->> 'content_hash', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'a fetch result has its content hash' using errcode = '22023', hint = 'bad_fetch';
  end if;
  if (p_result ->> 'unchanged') = 'true' then
    if v_src.content_hash is distinct from p_result ->> 'content_hash' then
      raise exception 'unchanged since a different fetch' using errcode = '22023', hint = 'bad_fetch';
    end if;
    update public.menu_source
       set status = 'ok', last_fetch_at = v_now, last_success_at = v_now, last_error = null
     where id = p_source;
    return jsonb_build_object('status', 'unchanged');
  end if;

  begin
    v_from := (p_result ->> 'from')::date;
    v_to := (p_result ->> 'to')::date;
  exception when others then
    v_from := null;
  end;
  if v_from is null or v_to is null or v_to < v_from or v_to - v_from > 62
     or jsonb_typeof(p_result -> 'days') is distinct from 'array'
     or exists (select from jsonb_array_elements(p_result -> 'days') e
                 where (e ->> 'date') is null or (e ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$'
                    or (e ->> 'date')::date not between v_from and v_to) then
    raise exception 'a fetch result has its window and its days in it' using errcode = '22023', hint = 'bad_fetch';
  end if;

  insert into public.school_menu_day as d
         (household_id, source_id, menu_date, items, no_service, note, origin, is_override, fetched_at)
  select v_src.household_id, p_source, (e ->> 'date')::date, private.menu_items(e -> 'items'),
         coalesce((e ->> 'no_service')::boolean, false), left(nullif(btrim(e ->> 'note'), ''), 120),
         'adapter', false, v_now
    from jsonb_array_elements(p_result -> 'days') e
  on conflict (source_id, menu_date, meal_service) do update
     set items = excluded.items, no_service = excluded.no_service, note = excluded.note,
         fetched_at = excluded.fetched_at, updated_at = now()
   where not d.is_override;
  get diagnostics v_saved = row_count;

  -- A day the feed no longer has (a menu taken down) goes, unless it is a parent's own.
  delete from public.school_menu_day d
   where d.source_id = p_source and not d.is_override and d.menu_date between v_from and v_to
     and not exists (select from jsonb_array_elements(p_result -> 'days') e
                      where (e ->> 'date')::date = d.menu_date);
  delete from public.school_menu_day
   where source_id = p_source and menu_date < private.household_today(v_src.household_id) - 60;
  select count(*) into v_kept from public.school_menu_day
   where source_id = p_source and is_override and menu_date between v_from and v_to;

  update public.menu_source
     set status = 'ok', last_fetch_at = v_now, last_success_at = v_now, last_error = null,
         content_hash = p_result ->> 'content_hash'
   where id = p_source;
  return jsonb_build_object('status', 'fetched', 'days', v_saved, 'kept', v_kept);
end $$;

-- ---------------------------------------------------------------------------------------------
-- [MEAL-05] The menu on a child's buy days
-- ---------------------------------------------------------------------------------------------

-- A day's lunch at a source, as the Meals page and the board show it: {items, no_service, note,
-- own}, or null when the source has nothing for that day.
create function private.menu_on(p_source uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('items', d.items, 'no_service', d.no_service, 'note', d.note, 'own', d.is_override)
    from public.school_menu_day d
   where d.source_id = p_source and d.menu_date = p_date and d.meal_service = 'lunch'
$$;

-- lunch_week (WP-26) with each child's menu (menu_source_id) and, on each day they buy, that day's
-- menu (null when the menu has nothing that day, or they have no menu).
create or replace function public.lunch_week(p_household uuid, p_from date) returns jsonb
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
             'usual', coalesce(l.defaults, '{}'::jsonb),
             'menu_source_id', l.menu_source_id,
             'days', (select jsonb_agg(jsonb_build_object(
                               'date', d.day,
                               'day_type', public.resolve_day_type(m.id, d.day),
                               'mode', x.mode,
                               'changed', exists (select from public.lunch_override o
                                                   where o.member_id = m.id and o.lunch_date = d.day
                                                     and public.resolve_day_type(m.id, d.day) = 'school_day'),
                               'menu', case when x.mode = 'buy' and l.menu_source_id is not null
                                            then private.menu_on(l.menu_source_id, d.day) end)
                             order by d.day)
                        from generate_series(p_from, p_from + 6, interval '1 day') g (t)
                        cross join lateral (select g.t::date as day) d
                        cross join lateral (select public.lunch_mode(m.id, d.day) as mode) x))
           order by m.display_name, m.id)
      from public.member m
      left join public.member_lunch l on l.member_id = m.id
     where m.household_id = p_household and m.role = 'child' and m.archived_at is null), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row level security: the household's admins and boards read its menus; every change goes through
-- the functions above.
-- ---------------------------------------------------------------------------------------------

alter table public.menu_source enable row level security;
alter table public.school_menu_day enable row level security;
create policy menu_source_admin_select on public.menu_source for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy menu_source_device_select on public.menu_source for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy school_menu_day_admin_select on public.school_menu_day for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy school_menu_day_device_select on public.school_menu_day for select to authenticated
  using (household_id = (select private.device_household_id()));
revoke all on public.menu_source, public.school_menu_day from public, anon, authenticated;
grant select on public.menu_source, public.school_menu_day to authenticated;

create trigger trg_menu_source_updated before update on public.menu_source
  for each row execute function private.set_updated_at();
-- Audited: what a parent changes, not each fetch's bookkeeping or the feed's days.
create trigger trg_audit after insert or delete or update of name, config on public.menu_source
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update on public.school_menu_day
  for each row when (new.is_override) execute function private.audit_row();
create trigger trg_audit_delete after delete on public.school_menu_day
  for each row when (old.is_override) execute function private.audit_row();

revoke all on function private.menu_writer(uuid), private.menu_config(text, jsonb), private.menu_items(jsonb),
  private.menu_on(uuid, date) from public, anon, authenticated, service_role;
revoke all on function public.save_menu_source(uuid, uuid, text, text, jsonb), public.remove_menu_source(uuid),
  public.set_child_menu(uuid, uuid), public.save_menu_days(uuid, jsonb, text), public.clear_menu_day(uuid, date)
  from public, anon;
grant execute on function public.save_menu_source(uuid, uuid, text, text, jsonb), public.remove_menu_source(uuid),
  public.set_child_menu(uuid, uuid), public.save_menu_days(uuid, jsonb, text), public.clear_menu_day(uuid, date)
  to authenticated;
revoke all on function public.menu_sources_due(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.menu_sources_due(uuid, timestamptz) to service_role;
revoke all on function public.save_menu_fetch(uuid, jsonb) from public, anon;
grant execute on function public.save_menu_fetch(uuid, jsonb) to authenticated, service_role;
