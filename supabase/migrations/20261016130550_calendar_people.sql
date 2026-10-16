-- [CAL-09][US-508] A calendar for one or more people (WP-50, D-122).
--   * A calendar belongs to the whole family (no one) or to any number of its people: calendar_member,
--     a row a person. Each calendar's one person (calendar_source.member_id) is carried over.
--   * save_calendar() saves a calendar with its people as a list (save_calendar_source() took one).
--     Given none, the calendar is the whole family's; given some, they replace the people still in the
--     family, and an archived person stays on it (restored, they are back on it). A person removed for good leaves it (cascade); with no
--     one left, it is the whole family's, as before.
--   * A board reads each calendar's people as member_ids, in the board's order (children first,
--     then by name), and puts its events on each of their screens.
--   * Expand only: member_id and the one-person save stay for the app deployed when this runs (the
--     one-person save writes the new list too). The new app reads and writes only calendar_member.

create table public.calendar_member (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  calendar_id  uuid not null,
  member_id    uuid not null,
  created_at   timestamptz not null default now(),
  unique (calendar_id, member_id),
  foreign key (household_id, calendar_id) references public.calendar_source (household_id, id) on delete cascade,
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade
);
create index on public.calendar_member (household_id);
create index on public.calendar_member (member_id);

-- Each calendar's one person, carried over (once here; the pgTAP test runs it on a calendar of its own).
create function private.carry_calendar_members() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  insert into public.calendar_member (household_id, calendar_id, member_id)
  select s.household_id, s.id, s.member_id
    from public.calendar_source s
   where s.member_id is not null
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
select private.carry_calendar_members();

-- A calendar's people still in the family, in the board's order (children first, then by name), for its household's
-- admins and boards only.
create function private.calendar_people(p_calendar uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.id order by (m.role = 'child') desc, m.display_name, m.id), '{}')
    from public.calendar_member cm
    join public.member m on m.id = cm.member_id and m.archived_at is null
   where cm.calendar_id = p_calendar
     and (cm.household_id in (select private.admin_household_ids())
          or cm.household_id = (select private.device_household_id()))
$$;

-- Adds a calendar (p_source null; the link is required) or changes one, with its people (none: the
-- whole family). A link given is written to Vault (replacing the old one, and resetting the status
-- until the next sync); null keeps the link. Returns the calendar's id.
create function public.save_calendar(p_household uuid, p_source uuid, p_name text, p_url text,
                                     p_color text, p_members uuid[], p_show_on_board boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id      uuid;
  v_secret  uuid;
  v_members uuid[] := array(select distinct x from unnest(coalesce(p_members, '{}')) x where x is not null);
begin
  if p_household is null or p_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if p_url is not null and (p_url !~ '^https://[^[:space:]]+$' or length(p_url) > 2000) then
    raise exception 'a calendar link is an https address' using errcode = '22023', hint = 'bad_link';
  end if;
  if exists (select from unnest(v_members) x
              where not exists (select from public.member m
                                 where m.id = x and m.household_id = p_household and m.archived_at is null)) then
    raise exception 'choose someone who is still in the family' using errcode = '23503', hint = 'bad_member';
  end if;

  if p_source is null then
    if p_url is null then
      raise exception 'a new calendar needs its link' using errcode = '22023', hint = 'bad_link';
    end if;
    v_id := gen_random_uuid();
    v_secret := vault.create_secret(p_url, 'familywise_calendar_' || v_id,
                                    'Published calendar link (FamilyWise WP-22); read only by the calendar sync');
    -- member_id: the one person, for the app deployed before WP-50 (expand only).
    insert into public.calendar_source (id, household_id, name, url_secret_id, color, member_id, show_on_board)
    values (v_id, p_household, p_name, v_secret, p_color,
            case when cardinality(v_members) = 1 then v_members[1] end, p_show_on_board);
  else
    v_id := p_source;
    update public.calendar_source
       set name = p_name, color = p_color, show_on_board = p_show_on_board,
           member_id = case when cardinality(v_members) = 1 then v_members[1] end
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
  end if;

  -- Its people: none is the whole family; else these, keeping anyone archived (back when restored).
  delete from public.calendar_member cm
   where cm.calendar_id = v_id
     and cm.member_id <> all (v_members)
     and (cardinality(v_members) = 0
          or exists (select from public.member m where m.id = cm.member_id and m.archived_at is null));
  insert into public.calendar_member (household_id, calendar_id, member_id)
  select p_household, v_id, x from unnest(v_members) x
  on conflict do nothing;
  return v_id;
end $$;

-- The one-person save (WP-22), for the app deployed before WP-50: the calendar's people become that
-- one person, or the whole family.
create or replace function public.save_calendar_source(p_household uuid, p_source uuid, p_name text, p_url text,
                                                       p_color text, p_member uuid, p_show_on_board boolean)
returns uuid
language sql security definer set search_path = '' as $$
  select public.save_calendar(p_household, p_source, p_name, p_url, p_color,
                              case when p_member is null then '{}'::uuid[] else array[p_member] end,
                              p_show_on_board)
$$;

-- As in WP-52 (20261012100000_calendar_location.sql), with each calendar's people.
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
               'member_ids', to_jsonb(private.calendar_people(s.id)),
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

-- ---------------------------------------------------------------------------------------------
-- Row level security: read by the household's admins and boards; written only by the save.
-- ---------------------------------------------------------------------------------------------

alter table public.calendar_member enable row level security;
create policy calendar_member_admin_select on public.calendar_member for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy calendar_member_device_select on public.calendar_member for select to authenticated
  using (household_id = (select private.device_household_id()));
revoke all on public.calendar_member from public, anon, authenticated;
grant select on public.calendar_member to authenticated;

-- Audited with the calendar it belongs to; a board hears a person leaving a calendar.
create trigger trg_audit after insert or delete on public.calendar_member
  for each row execute function private.audit_row();
alter publication supabase_realtime add table public.calendar_member;

revoke all on function private.carry_calendar_members() from public, anon, authenticated, service_role;
revoke all on function private.calendar_people(uuid) from public, anon;
grant execute on function private.calendar_people(uuid) to authenticated;
revoke all on function public.save_calendar(uuid, uuid, text, text, text, uuid[], boolean) from public, anon;
grant execute on function public.save_calendar(uuid, uuid, text, text, text, uuid[], boolean) to authenticated;
