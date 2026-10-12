-- [CAL-10][US-509] An event's details on the board (WP-52, D-82): where it is, as Apple Calendar has it.
--   * calendar_event and calendar_event_instance gain `location` (LOCATION, trimmed, up to 300
--     characters; null when the event has none). An instance moved or edited on its own keeps its
--     own, as its title does. Nothing else of an event is kept: its notes, links, attendees and
--     organiser still never leave Apple Calendar (NFR-05).
--   * save_calendar_sync() stores it from the sync's events and instances (a sync that sends none
--     stores null, so the app before this release goes on working); board_calendar() returns it.
--   * The sync's content hash gains a version (lib/calendar/sync.ts), so every calendar is read in
--     full once more after this release and its events gain their locations.

alter table public.calendar_event
  add column location text check (length(location) <= 300);
alter table public.calendar_event_instance
  add column location text check (length(location) <= 300);

-- As in WP-22 (20261010100000_calendar_sync.sql), storing each event's and instance's location.
--     events:    {uid, recurrence_id, title, location, start, end, all_day, tz, rrule}
--     instances: {uid, recurrence_id, start, end, all_day, title, location, changed}
create or replace function public.save_calendar_sync(p_source uuid, p_result jsonb) returns jsonb
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
         (household_id, source_id, ical_uid, recurrence_id, title, location, start_at, end_at, all_day, tz, rrule,
          synced_at)
  select v_src.household_id, p_source, e.uid, nullif(e.recurrence_id, ''), left(coalesce(e.title, ''), 200),
         nullif(left(btrim(e.location), 300), ''),
         private.calendar_instant(e.start, e.all_day, v_tz), private.calendar_instant(e."end", e.all_day, v_tz),
         e.all_day, nullif(e.tz, ''), nullif(e.rrule, ''), v_now
    from jsonb_to_recordset(p_result -> 'events')
           as e(uid text, recurrence_id text, title text, location text, start text, "end" text, all_day boolean,
                tz text, rrule text)
  on conflict (source_id, ical_uid, recurrence_id) do update
     set title = excluded.title, location = excluded.location, start_at = excluded.start_at, end_at = excluded.end_at,
         all_day = excluded.all_day, tz = excluded.tz, rrule = excluded.rrule, synced_at = excluded.synced_at;
  get diagnostics v_events = row_count;
  delete from public.calendar_event ce
   where ce.source_id = p_source
     and not exists (select from jsonb_to_recordset(p_result -> 'events') as e(uid text, recurrence_id text)
                      where e.uid = ce.ical_uid and nullif(e.recurrence_id, '') is not distinct from ce.recurrence_id);

  delete from public.calendar_event_instance where source_id = p_source;
  insert into public.calendar_event_instance
         (household_id, source_id, event_id, instance_start, instance_end, all_day,
          local_start_date, local_end_date, title, location, changed)
  select v_src.household_id, p_source, ce.id, t.s, t.e, i.all_day,
         case when i.all_day then i.start::date else (t.s at time zone v_tz)::date end,
         greatest(
           case when i.all_day then i.start::date else (t.s at time zone v_tz)::date end,
           case when i.all_day then i."end"::date - 1
                else ((t.e - interval '1 microsecond') at time zone v_tz)::date end),
         left(coalesce(i.title, ''), 200), nullif(left(btrim(i.location), 300), ''),
         coalesce(i.changed, false)
    from jsonb_to_recordset(p_result -> 'instances')
           as i(uid text, recurrence_id text, start text, "end" text, all_day boolean, title text, location text,
                changed boolean)
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

-- As in WP-23 (20261010110000_board_calendars.sql), with each event's location.
create or replace function public.board_calendar(p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_device uuid := private.my_device_id();
begin
  if v_device is null then
    return null;
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 61 then
    raise exception 'the calendar covers 1 to 62 days' using errcode = '22023', hint = 'bad_range';
  end if;
  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'calendars', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'color', s.color, 'member_id', s.member_id,
               'status', s.status, 'last_success_at', s.last_success_at)
             order by s.created_at, s.id)
        from public.calendar_source s
       where private.calendar_on_board(v_device, s.id)), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'calendar_id', i.source_id, 'title', i.title, 'location', i.location,
               'all_day', i.all_day,
               'start', i.instance_start, 'end', i.instance_end,
               'start_date', i.local_start_date, 'end_date', i.local_end_date, 'changed', i.changed)
             order by i.local_start_date, i.all_day desc, i.instance_start, i.title, i.id)
        from public.calendar_event_instance i
       where i.local_start_date <= p_to and i.local_end_date >= p_from), '[]'::jsonb));
end $$;
