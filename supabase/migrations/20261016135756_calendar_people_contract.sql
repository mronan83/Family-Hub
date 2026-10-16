-- [CAL-09][US-508] A calendar for one or more people: the contract (WP-50's deferred part, D-122).
--   WP-50 (20261016130550_calendar_people.sql) moved each calendar's people to calendar_member and kept
--   calendar_source.member_id and the one-person save_calendar_source() for the app deployed before it.
--   That app is gone: production runs WP-50's app, which reads and writes only calendar_member.
--   Dropped here, and nothing else:
--     * calendar_source.member_id (its foreign key to member goes with it);
--     * public.save_calendar_source(), the one-person save;
--     * private.carry_calendar_members(), WP-50's one-off carry-over, which read member_id.
--   Changed to stop reading it: save_calendar() no longer writes it, board_calendar() no longer sends it,
--   and the audit trigger on calendar_source watches name, color and show_on_board.
--   Guarded: the drop is refused while any calendar's one person is not in calendar_member.

-- Refuses (P0001, hint people_not_carried) while a calendar's member_id has no calendar_member row;
-- quiet once member_id is gone. Kept so pgTAP can run it against a calendar of its own.
create function private.assert_calendar_people_carried() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_missing integer;
begin
  if not exists (select from information_schema.columns
                  where table_schema = 'public' and table_name = 'calendar_source' and column_name = 'member_id') then
    return;
  end if;
  execute $q$
    select count(*)::integer
      from public.calendar_source s
     where s.member_id is not null
       and not exists (select from public.calendar_member cm
                        where cm.calendar_id = s.id and cm.member_id = s.member_id)
  $q$ into v_missing;
  if v_missing > 0 then
    raise exception '% calendar(s) have a person not in calendar_member; calendar_source.member_id is not dropped',
      v_missing using hint = 'people_not_carried';
  end if;
end $$;
revoke all on function private.assert_calendar_people_carried() from public, anon, authenticated, service_role;

select private.assert_calendar_people_carried();

-- The readers first, so nothing refers to the column when it goes.
drop trigger trg_audit on public.calendar_source;
create trigger trg_audit after insert or delete or update of name, color, show_on_board
  on public.calendar_source for each row execute function private.audit_row();

drop function public.save_calendar_source(uuid, uuid, text, text, text, uuid, boolean);
drop function private.carry_calendar_members();

-- As in WP-50 (20261016130550_calendar_people.sql), without member_id.
create or replace function public.save_calendar(p_household uuid, p_source uuid, p_name text, p_url text,
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
    insert into public.calendar_source (id, household_id, name, url_secret_id, color, show_on_board)
    values (v_id, p_household, p_name, v_secret, p_color, p_show_on_board);
  else
    v_id := p_source;
    update public.calendar_source
       set name = p_name, color = p_color, show_on_board = p_show_on_board
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

-- As in WP-50, without member_id: a calendar's people are member_ids only.
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
               'id', s.id, 'name', s.name, 'color', s.color,
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

alter table public.calendar_source drop column member_id;
