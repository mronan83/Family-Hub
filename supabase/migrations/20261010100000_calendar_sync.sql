-- [CAL-01][CAL-02][CAL-03][CAL-06][CAL-07] Calendar sync (WP-22, 01 §5.4, 02 §3.6, D-63).
--   * An admin connects a calendar by its published ICS link. The link is stored only in Vault; the
--     table keeps its Vault id, so no query, export or backup of the app's tables holds it, and the
--     admin portal never shows it again (replacing it is the only way to change it).
--   * The sync (the calendar_sync job every 15 minutes, and the admin's own save of a link) fetches
--     the file, expands it over the household-local window today−7d .. today+120d, and stores what
--     the board shows: titles, times, all-day, and which series each instance belongs to (NFR-05).
--   * A failed sync changes only the calendar's status and error: its last good events stay.
--   * Synced calendars are read-only (CAL-03): events change only through a sync, never by hand.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.calendar_source (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.household (id) on delete cascade,
  name                  text not null check (name = btrim(name) and length(name) between 1 and 40),
  type                  text not null default 'ics' check (type in ('ics', 'caldav')),
  url_secret_id         uuid not null,                  -- the link, in Vault (vault.secrets.id)
  username_secret_id    uuid,                           -- CalDAV (WP-29)
  color                 text not null default 'member-6'
                          check (color in ('member-1', 'member-2', 'member-3', 'member-4', 'member-5', 'member-6')),
  member_id             uuid,                           -- whose calendar it is, if anyone's
  show_on_board         boolean not null default true,  -- the default for boards (per-board choice: WP-23)
  sync_interval_minutes integer not null default 15 check (sync_interval_minutes between 15 and 1440),
  status                text not null default 'pending' check (status in ('pending', 'ok', 'error', 'disabled')),
  last_synced_at        timestamptz,                    -- the last attempt
  last_success_at       timestamptz,
  last_error            text check (length(last_error) <= 300),
  etag                  text check (length(etag) <= 200),
  -- What the last good sync expanded: sha256 of the window's first day, the zone and the file. Same
  -- hash, same events, so the sync skips parsing and writing; a new day re-expands (SPIKE-02).
  content_hash          text check (content_hash ~ '^[0-9a-f]{64}$'),
  sync_token            text,                           -- CalDAV (WP-29)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, member_id) references public.member (household_id, id) on delete set null (member_id)
);
create index on public.calendar_source (household_id, created_at);

-- A single event, a series, or one instance of a series moved or edited on its own (its
-- recurrence_id is the original start). Only those with an instance in the window are kept.
create table public.calendar_event (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null,
  source_id     uuid not null,
  ical_uid      text not null check (length(ical_uid) between 1 and 500),
  recurrence_id text check (length(recurrence_id) between 1 and 40),
  title         text not null check (length(title) <= 200),
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  all_day       boolean not null,
  tz            text check (length(tz) <= 64),           -- the zone it was written in; null for UTC or dates
  rrule         text check (length(rrule) <= 500),
  synced_at     timestamptz not null,
  unique (household_id, id),
  unique nulls not distinct (source_id, ical_uid, recurrence_id),
  foreign key (household_id, source_id) references public.calendar_source (household_id, id) on delete cascade
);

-- What the board reads: every instance in the window, all-day ones as household-local dates.
create table public.calendar_event_instance (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null,
  source_id        uuid not null,
  event_id         uuid not null,
  instance_start   timestamptz not null,
  instance_end     timestamptz not null,
  all_day          boolean not null,
  local_start_date date not null,
  local_end_date   date not null,                      -- the last day it covers
  title            text not null check (length(title) <= 200),
  changed          boolean not null default false,     -- moved or edited on its own
  check (instance_end >= instance_start),
  check (local_end_date >= local_start_date),
  foreign key (household_id, source_id) references public.calendar_source (household_id, id) on delete cascade,
  foreign key (household_id, event_id) references public.calendar_event (household_id, id) on delete cascade
);
create index on public.calendar_event_instance (household_id, local_start_date);
create index on public.calendar_event_instance (source_id, instance_start);
create index on public.calendar_event_instance (event_id);

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- The caller may change this household's calendars: one of its admins, or the service role (the job).
create function private.calendar_writer(p_household uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.role()), '') = 'service_role'
      or p_household in (select private.admin_household_ids())
$$;

-- An instance's start or end as the sync sends it: an ISO instant, or for an all-day event a date,
-- which is that day's midnight in the household's zone.
create function private.calendar_instant(p_value text, p_all_day boolean, p_tz text) returns timestamptz
language sql stable set search_path = '' as $$
  select case when p_all_day then (p_value::date)::timestamp at time zone p_tz else p_value::timestamptz end
$$;

-- A calendar's secrets go with it (its own delete, or its household's).
create function private.calendar_source_drop_secrets() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id in (old.url_secret_id, old.username_secret_id);
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------
-- [CAL-01] Connecting, changing and removing a calendar (its admins)
-- ---------------------------------------------------------------------------------------------

-- Adds a calendar (p_source null; the link is required) or changes one. A link given is written to
-- Vault (replacing the old one, and resetting the status until the next sync); null keeps the link.
-- Returns the calendar's id.
create function public.save_calendar_source(p_household uuid, p_source uuid, p_name text, p_url text,
                                            p_color text, p_member uuid, p_show_on_board boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id     uuid;
  v_secret uuid;
begin
  if p_household is null or p_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if p_url is not null and (p_url !~ '^https://[^[:space:]]+$' or length(p_url) > 2000) then
    raise exception 'a calendar link is an https address' using errcode = '22023', hint = 'bad_link';
  end if;

  if p_source is null then
    if p_url is null then
      raise exception 'a new calendar needs its link' using errcode = '22023', hint = 'bad_link';
    end if;
    v_id := gen_random_uuid();
    v_secret := vault.create_secret(p_url, 'familywise_calendar_' || v_id,
                                    'Published calendar link (FamilyWise WP-22); read only by the calendar sync');
    insert into public.calendar_source (id, household_id, name, url_secret_id, color, member_id, show_on_board)
    values (v_id, p_household, p_name, v_secret, p_color, p_member, p_show_on_board);
    return v_id;
  end if;

  update public.calendar_source
     set name = p_name, color = p_color, member_id = p_member, show_on_board = p_show_on_board
   where id = p_source and household_id = p_household
  returning url_secret_id into v_secret;
  if not found then
    raise exception 'calendar not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  if p_url is not null then
    perform vault.update_secret(v_secret, p_url);
    -- A new link starts over: its first sync decides the status; the last good events stay until then.
    update public.calendar_source
       set status = 'pending', last_error = null, etag = null, content_hash = null
     where id = p_source;
  end if;
  return p_source;
end $$;

-- Removes a calendar with its events and its link (the trigger deletes the Vault secret).
create function public.remove_calendar_source(p_source uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.calendar_source
   where id = p_source and household_id in (select private.admin_household_ids());
  if not found then
    raise exception 'calendar not found' using errcode = 'P0002', hint = 'not_found';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- [CAL-02][CAL-06] The sync
-- ---------------------------------------------------------------------------------------------

-- The household's calendars due a sync, with their links read from Vault (the job; service role
-- only). Due: never synced, or last tried a sync interval ago, less 3 minutes so a call every 15
-- minutes finds each one every time. Least recently tried first.
create function public.calendar_sources_due(p_household uuid, p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'content_hash', s.content_hash, 'timezone', h.timezone,
           'url', d.decrypted_secret)
         order by s.last_synced_at nulls first, s.id), '[]'::jsonb)
    into v_out
    from public.calendar_source s
    join public.household h on h.id = s.household_id
    left join vault.decrypted_secrets d on d.id = s.url_secret_id
   where s.household_id = p_household and s.type = 'ics' and s.status <> 'disabled'
     and (s.last_synced_at is null
          or s.last_synced_at <= p_now - make_interval(mins => s.sync_interval_minutes - 3));
  return v_out;
end $$;

-- Stores one sync's outcome for a calendar, under a lock on it so two syncs never interleave. The
-- service role (the job) or one of the household's admins (saving a link syncs it at once, D-63).
--   {"ok": false, "error": "…"}                       the sync failed: status and error only; the
--                                                     last good events stay (CAL-06)
--   {"ok": true, "unchanged": true, "content_hash", "etag"}
--                                                     the same file, day and zone as last time
--   {"ok": true, "content_hash", "etag", "events": […], "instances": […]}
--     events:    {uid, recurrence_id, title, start, end, all_day, tz, rrule}
--     instances: {uid, recurrence_id, start, end, all_day, title, changed}
--     start/end: an ISO instant, or a date for all-day (end exclusive, as in the file)
-- Events are upserted by (uid, recurrence_id) and those no longer sent are deleted; instances are
-- replaced. An instance whose event is not sent is refused, and nothing changes.
create function public.save_calendar_sync(p_source uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_src       public.calendar_source;
  v_tz        text;
  v_now       timestamptz := now();
  v_events    integer;
  v_instances integer;
begin
  select * into v_src from public.calendar_source where id = p_source for update;
  if not found or not private.calendar_writer(v_src.household_id) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if jsonb_typeof(p_result) is distinct from 'object' then
    raise exception 'a sync result is an object' using errcode = '22023', hint = 'bad_sync';
  end if;

  if (p_result ->> 'ok') is distinct from 'true' then
    update public.calendar_source
       set status = 'error', last_synced_at = v_now,
           last_error = left(coalesce(nullif(btrim(p_result ->> 'error'), ''), 'The sync failed.'), 300)
     where id = p_source;
    return jsonb_build_object('status', 'error');
  end if;

  if (p_result ->> 'content_hash') !~ '^[0-9a-f]{64}$' then
    raise exception 'a sync result has its content hash' using errcode = '22023', hint = 'bad_sync';
  end if;

  if (p_result ->> 'unchanged') = 'true' then
    if v_src.content_hash is distinct from p_result ->> 'content_hash' then
      raise exception 'unchanged since a different version' using errcode = '22023', hint = 'bad_sync';
    end if;
    update public.calendar_source
       set status = 'ok', last_synced_at = v_now, last_success_at = v_now, last_error = null,
           etag = left(p_result ->> 'etag', 200)
     where id = p_source;
    return jsonb_build_object('status', 'unchanged');
  end if;

  if jsonb_typeof(p_result -> 'events') is distinct from 'array'
     or jsonb_typeof(p_result -> 'instances') is distinct from 'array' then
    raise exception 'a sync result has its events and instances' using errcode = '22023', hint = 'bad_sync';
  end if;
  if jsonb_array_length(p_result -> 'events') > 5000 or jsonb_array_length(p_result -> 'instances') > 5000 then
    raise exception 'more than 5000 events in the window' using errcode = '22023', hint = 'too_many';
  end if;
  select timezone into v_tz from public.household where id = v_src.household_id;

  insert into public.calendar_event as ce
         (household_id, source_id, ical_uid, recurrence_id, title, start_at, end_at, all_day, tz, rrule, synced_at)
  select v_src.household_id, p_source, e.uid, nullif(e.recurrence_id, ''), left(coalesce(e.title, ''), 200),
         private.calendar_instant(e.start, e.all_day, v_tz), private.calendar_instant(e."end", e.all_day, v_tz),
         e.all_day, nullif(e.tz, ''), nullif(e.rrule, ''), v_now
    from jsonb_to_recordset(p_result -> 'events')
           as e(uid text, recurrence_id text, title text, start text, "end" text, all_day boolean, tz text, rrule text)
  on conflict (source_id, ical_uid, recurrence_id) do update
     set title = excluded.title, start_at = excluded.start_at, end_at = excluded.end_at,
         all_day = excluded.all_day, tz = excluded.tz, rrule = excluded.rrule, synced_at = excluded.synced_at;
  get diagnostics v_events = row_count;
  delete from public.calendar_event ce
   where ce.source_id = p_source
     and not exists (select from jsonb_to_recordset(p_result -> 'events') as e(uid text, recurrence_id text)
                      where e.uid = ce.ical_uid and nullif(e.recurrence_id, '') is not distinct from ce.recurrence_id);

  delete from public.calendar_event_instance where source_id = p_source;
  insert into public.calendar_event_instance
         (household_id, source_id, event_id, instance_start, instance_end, all_day,
          local_start_date, local_end_date, title, changed)
  select v_src.household_id, p_source, ce.id, t.s, t.e, i.all_day,
         case when i.all_day then i.start::date else (t.s at time zone v_tz)::date end,
         greatest(
           case when i.all_day then i.start::date else (t.s at time zone v_tz)::date end,
           case when i.all_day then i."end"::date - 1
                else ((t.e - interval '1 microsecond') at time zone v_tz)::date end),
         left(coalesce(i.title, ''), 200), coalesce(i.changed, false)
    from jsonb_to_recordset(p_result -> 'instances')
           as i(uid text, recurrence_id text, start text, "end" text, all_day boolean, title text, changed boolean)
    cross join lateral (select private.calendar_instant(i.start, i.all_day, v_tz) as s,
                               private.calendar_instant(i."end", i.all_day, v_tz) as e) t
    join public.calendar_event ce
      on ce.source_id = p_source and ce.ical_uid = i.uid
     and ce.recurrence_id is not distinct from nullif(i.recurrence_id, '');
  get diagnostics v_instances = row_count;
  if v_instances <> jsonb_array_length(p_result -> 'instances') then
    raise exception 'an instance names an event that was not sent' using errcode = '22023', hint = 'bad_sync';
  end if;

  update public.calendar_source
     set status = 'ok', last_synced_at = v_now, last_success_at = v_now, last_error = null,
         etag = left(p_result ->> 'etag', 200), content_hash = p_result ->> 'content_hash'
   where id = p_source;
  return jsonb_build_object('status', 'synced', 'events', v_events, 'instances', v_instances);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row level security: the household's admins read its calendars, events and instances; every change
-- goes through the functions above. Boards read them from WP-23 (device_calendar).
-- ---------------------------------------------------------------------------------------------

alter table public.calendar_source enable row level security;
alter table public.calendar_event enable row level security;
alter table public.calendar_event_instance enable row level security;

create policy calendar_source_admin_select on public.calendar_source for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy calendar_event_admin_select on public.calendar_event for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy calendar_event_instance_admin_select on public.calendar_event_instance for select to authenticated
  using (household_id in (select private.admin_household_ids()));

revoke all on public.calendar_source, public.calendar_event, public.calendar_event_instance
  from public, anon, authenticated;
grant select on public.calendar_source, public.calendar_event, public.calendar_event_instance to authenticated;

create trigger trg_calendar_source_updated before update on public.calendar_source
  for each row execute function private.set_updated_at();
create trigger trg_calendar_source_secrets after delete on public.calendar_source
  for each row execute function private.calendar_source_drop_secrets();
-- Audited: what an admin changes, not each sync's bookkeeping.
create trigger trg_audit after insert or delete or update of name, color, member_id, show_on_board
  on public.calendar_source for each row execute function private.audit_row();

revoke all on function private.calendar_writer(uuid), private.calendar_instant(text, boolean, text),
  private.calendar_source_drop_secrets() from public, anon, authenticated, service_role;
revoke all on function public.save_calendar_source(uuid, uuid, text, text, text, uuid, boolean),
  public.remove_calendar_source(uuid) from public, anon;
grant execute on function public.save_calendar_source(uuid, uuid, text, text, text, uuid, boolean),
  public.remove_calendar_source(uuid) to authenticated;
revoke all on function public.calendar_sources_due(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.calendar_sources_due(uuid, timestamptz) to service_role;
revoke all on function public.save_calendar_sync(uuid, jsonb) from public, anon;
grant execute on function public.save_calendar_sync(uuid, jsonb) to authenticated, service_role;
