-- [MEAL-09][MEAL-11][US-707] Next week's lunches picked on the board, with the day's choices (WP-49,
-- D-95; 02 §3.6).
--   * A child changes a day on the board: buy or bring, and on a buy day their picks from the day's
--     menu (one option in a section whose title says "Choice of", any number in the others, D-94).
--     The change waits for a parent (the owner's): `lunch_request`, one a child and day, holds the
--     day as the child wants it, `waiting` until a parent approves it (`approved`: it becomes the
--     day's lunch and picks) or keeps the day as it was (`kept`). The board says who kept it until
--     the child taps Done on that week (`seen_at`).
--   * A day can change until its cut-off: the household's `lunch_cutoff` (8:00 am by default) on the
--     day itself. A request still waiting then is dropped: it is not shown, counted or approved, and
--     the day stays as it was (`open_until`, kept with the request).
--   * The picks of a day are `lunch_choice`, a row a section: the options' numbers in the section
--     and their names when picked, so a menu changed afterwards can be seen (the app compares).
--     They are a buy day's only: a day changed to bring drops them.
--   * A parent changes a day or its picks on Meals at once (set_lunch, set_lunch_choices), which
--     replaces anything waiting for that day; approves or keeps a child's change on Today.
--   * An item on the list can open Lunches (`chore.opens`), set on the item in Chores.
--   * A waiting change counts in the approvals alert (WP-63): "Maya: 2 lunch changes waiting".

alter table public.household_settings
  add column lunch_cutoff time not null default '08:00';

alter table public.chore
  add column opens text check (opens in ('lunches'));

-- [MEAL-11] A buy day's picks, a row a section of its menu ('' for a menu without sections).
create table public.lunch_choice (
  household_id   uuid not null,
  member_id      uuid not null,
  lunch_date     date not null,
  section        text not null check (length(section) <= 60),
  options        integer[] not null check (cardinality(options) between 1 and 60
                                           and 1 <= all (options) and 60 >= all (options)),
  names          text[] not null check (cardinality(names) = cardinality(options)),
  chosen_by_type text not null check (chosen_by_type in ('admin', 'device')),
  chosen_by      uuid,
  approved_by    uuid,
  chosen_at      timestamptz not null default now(),
  primary key (member_id, lunch_date, section),
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade
);
create index on public.lunch_choice (household_id, lunch_date);

-- [MEAL-09][MEAL-11] A child's change to a day, from the board, for a parent to approve.
create table public.lunch_request (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  member_id    uuid not null,
  lunch_date   date not null,
  mode         text not null check (mode in ('buy', 'bring')),
  -- [{section, options, names}], a buy day's picks as the child wants them; [] on a bring day.
  choices      jsonb not null default '[]' check (jsonb_typeof(choices) = 'array'),
  status       text not null default 'waiting' check (status in ('waiting', 'approved', 'kept')),
  requested_by uuid references public.device (id) on delete set null,
  requested_at timestamptz not null default now(),
  -- The day's cut-off: a request still waiting then is dropped.
  open_until   timestamptz not null,
  decided_by   uuid,
  decided_at   timestamptz,
  seen_at      timestamptz,
  unique (member_id, lunch_date),
  check ((status = 'waiting') = (decided_at is null)),
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade
);
create index on public.lunch_request (household_id, status, open_until);

alter table public.lunch_choice enable row level security;
alter table public.lunch_request enable row level security;
create policy lunch_choice_admin_select on public.lunch_choice for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy lunch_choice_device_select on public.lunch_choice for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy lunch_request_admin_select on public.lunch_request for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy lunch_request_device_select on public.lunch_request for select to authenticated
  using (household_id = (select private.device_household_id()));
revoke all on public.lunch_choice, public.lunch_request from public, anon;
revoke insert, update, delete, truncate on public.lunch_choice, public.lunch_request from authenticated;
grant select on public.lunch_choice, public.lunch_request to authenticated;

create trigger trg_audit after insert or update or delete on public.lunch_choice
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.lunch_request
  for each row execute function private.audit_row();

-- A change on the board's lunches reaches the boards at once (apps/web/lib/live.ts).
alter publication supabase_realtime add table public.lunch_choice, public.lunch_request;

-- ---------------------------------------------------------------------------------------------
-- The cut-off, and a day's picks
-- ---------------------------------------------------------------------------------------------

-- [MEAL-09] When a day's lunch stops changing on the board: its cut-off, household time, that day.
create function private.lunch_open_until(p_household uuid, p_date date) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select (p_date + coalesce((select s.lunch_cutoff from public.household_settings s
                              where s.household_id = h.id), time '08:00')) at time zone h.timezone
    from public.household h where h.id = p_household
$$;

-- [MEAL-11] Picks as given ([{section, options, names}]) checked against the day's menu and
-- returned in order by section, options sorted (their names with them), sections with nothing
-- picked left out. One option in a section whose title says "Choice of" (D-94); a bring day has
-- none. Raises when a section or an option isn't on the day's menu.
create function private.lunch_picks(p_member uuid, p_date date, p_mode text, p_choices jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_menu    jsonb;
  v_items   jsonb;
  v_pick    jsonb;
  v_section text;
  v_options integer[];
  v_names   text[];
  v_seen    text[] := '{}';
  v_out     jsonb := '[]'::jsonb;
  i         integer;
begin
  if p_choices is null or p_choices = '[]'::jsonb then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_choices) <> 'array' or jsonb_array_length(p_choices) > 20 then
    raise exception 'picks are a list, a section each' using errcode = '22023', hint = 'bad_request';
  end if;
  if p_mode <> 'buy' then
    raise exception 'only a buy day has picks' using errcode = '22023', hint = 'not_buy';
  end if;
  v_menu := (select private.menu_on(l.menu_source_id, p_date) from public.member_lunch l
              where l.member_id = p_member and l.menu_source_id is not null);
  v_items := coalesce(v_menu -> 'items', '[]'::jsonb);
  if v_menu is null or (v_menu ->> 'no_service')::boolean or jsonb_array_length(v_items) = 0 then
    raise exception 'no menu that day' using errcode = '22023', hint = 'no_menu';
  end if;
  for v_pick in select value from jsonb_array_elements(p_choices) loop
    if jsonb_typeof(v_pick) <> 'object' or jsonb_typeof(v_pick -> 'options') <> 'array'
       or jsonb_typeof(v_pick -> 'names') <> 'array'
       or jsonb_array_length(v_pick -> 'options') <> jsonb_array_length(v_pick -> 'names') then
      raise exception 'each pick is a section, its options and their names' using errcode = '22023', hint = 'bad_request';
    end if;
    v_section := coalesce(btrim(v_pick ->> 'section'), '');
    if v_section = any (v_seen) then
      raise exception 'a section once' using errcode = '22023', hint = 'bad_request';
    end if;
    v_seen := v_seen || v_section;
    if not exists (select from jsonb_array_elements(v_items) x
                    where coalesce(btrim(x.value ->> 'section'), '') = v_section) then
      raise exception 'that section isn''t on the day''s menu' using errcode = '22023', hint = 'not_on_menu';
    end if;
    if exists (select from jsonb_array_elements(v_pick -> 'options') o
                where jsonb_typeof(o.value) <> 'number' or o.value::text !~ '^[0-9]+$'
                   or (o.value::text)::integer not between 1 and 60)
       or exists (select from jsonb_array_elements(v_pick -> 'names') n
                   where jsonb_typeof(n.value) <> 'string'
                      or coalesce(length(btrim(n.value #>> '{}')), 0) not between 1 and 120) then
      raise exception 'an option is a number from 1 to 60 with a name' using errcode = '22023', hint = 'bad_request';
    end if;
    select coalesce(array_agg(o.n order by o.n), '{}'), coalesce(array_agg(o.name order by o.n), '{}')
      into v_options, v_names
      from (select distinct on ((x.value::text)::integer) (x.value::text)::integer as n,
                   btrim((v_pick -> 'names') ->> (x.ordinality::integer - 1)) as name
              from jsonb_array_elements(v_pick -> 'options') with ordinality x) o;
    continue when cardinality(v_options) = 0;
    -- A menu stored with options (WP-64) has each of them; one stored before is read by the app.
    if exists (select from jsonb_array_elements(v_items) x
                where coalesce(btrim(x.value ->> 'section'), '') = v_section and x.value ? 'option') then
      for i in 1 .. cardinality(v_options) loop
        if not exists (select from jsonb_array_elements(v_items) x
                        where coalesce(btrim(x.value ->> 'section'), '') = v_section
                          and (x.value ->> 'option')::integer = v_options[i]) then
          raise exception 'that option isn''t on the day''s menu' using errcode = '22023', hint = 'not_on_menu';
        end if;
      end loop;
    end if;
    if v_section ~* '\mchoice\s+of\M' and cardinality(v_options) > 1 then
      raise exception 'one option in a "Choice of" section' using errcode = '22023', hint = 'pick_one';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'section', v_section, 'options', to_jsonb(v_options), 'names', to_jsonb(v_names)));
  end loop;
  return coalesce((select jsonb_agg(p.value order by p.value ->> 'section') from jsonb_array_elements(v_out) p),
                  '[]'::jsonb);
end $$;

-- [MEAL-11] A day's picks as stored, in the same shape and order as lunch_picks() gives them.
create function private.lunch_choices_of(p_member uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('section', c.section, 'options', to_jsonb(c.options),
                                               'names', to_jsonb(c.names)) order by c.section), '[]'::jsonb)
    from public.lunch_choice c where c.member_id = p_member and c.lunch_date = p_date
$$;

-- Picks without their names, to tell whether two sets of picks are the same.
create function private.picks_key(p_choices jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_array(p.value ->> 'section', p.value -> 'options')
                            order by p.value ->> 'section'), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_choices, '[]'::jsonb)) p
$$;

-- Stores a day's picks (replacing the day's), as made by `p_type` `p_by`, approved by `p_approver`.
create function private.store_picks(p_household uuid, p_member uuid, p_date date, p_choices jsonb,
                                    p_type text, p_by uuid, p_approver uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.lunch_choice where member_id = p_member and lunch_date = p_date;
  insert into public.lunch_choice (household_id, member_id, lunch_date, section, options, names,
                                   chosen_by_type, chosen_by, approved_by)
  select p_household, p_member, p_date, p.value ->> 'section',
         (select array_agg((o.value::text)::integer order by o.ordinality) from jsonb_array_elements(p.value -> 'options') with ordinality o),
         (select array_agg(n.value #>> '{}' order by n.ordinality) from jsonb_array_elements(p.value -> 'names') with ordinality n),
         p_type, p_by, p_approver
    from jsonb_array_elements(coalesce(p_choices, '[]'::jsonb)) p;
$$;

-- ---------------------------------------------------------------------------------------------
-- A parent's changes (Meals): at once, and anything waiting for the day is replaced
-- ---------------------------------------------------------------------------------------------

-- [MEAL-04][US-703] As before (WP-26), and: a day changed to bring drops its picks, and a child's
-- change waiting for that day is replaced by the parent's.
create or replace function public.set_lunch(p_member uuid, p_date date, p_mode text) returns text
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
  if p_mode = 'bring' then
    delete from public.lunch_choice where member_id = p_member and lunch_date = p_date;
  end if;
  delete from public.lunch_request where member_id = p_member and lunch_date = p_date and status = 'waiting';
  return p_mode;
end $$;

-- [MEAL-04][US-703] As before (WP-26), and: a day that becomes bring drops its picks.
create or replace function public.set_lunch_defaults(p_member uuid, p_defaults jsonb) returns jsonb
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
  -- [MEAL-11] A day that is now bring has no picks.
  delete from public.lunch_choice c
   where c.member_id = p_member and c.lunch_date >= private.household_today(v_household)
     and public.lunch_mode(p_member, c.lunch_date) is distinct from 'buy';
  return v_clean;
end $$;

-- [MEAL-11][US-707] A parent sets a buy day's picks for a child on Meals, at once; any day, even
-- past its cut-off. A child's change waiting for the day is replaced. Returns the picks as stored.
create function public.set_lunch_choices(p_member uuid, p_date date, p_choices jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.lunch_access(p_member);
  v_clean     jsonb;
begin
  if p_date is null then
    raise exception 'a day' using errcode = '22023', hint = 'bad_request';
  end if;
  if public.lunch_mode(p_member, p_date) is distinct from 'buy' then
    raise exception 'only a buy day has picks' using errcode = '22023', hint = 'not_buy';
  end if;
  v_clean := private.lunch_picks(p_member, p_date, 'buy', p_choices);
  perform private.store_picks(v_household, p_member, p_date, v_clean, 'admin', auth.uid(), null);
  delete from public.lunch_request where member_id = p_member and lunch_date = p_date and status = 'waiting';
  return v_clean;
end $$;

-- [MEAL-09] A parent sets the household's cut-off (household time); changes still waiting follow it
-- (one already past its cut-off stays dropped).
create function public.set_lunch_cutoff(p_household uuid, p_cutoff time) returns time
language plpgsql security definer set search_path = '' as $$
begin
  if p_household is null or p_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if p_cutoff is null then
    raise exception 'a time' using errcode = '22023', hint = 'bad_request';
  end if;
  update public.household_settings set lunch_cutoff = p_cutoff
   where household_id = p_household and lunch_cutoff <> p_cutoff;
  update public.lunch_request r set open_until = private.lunch_open_until(p_household, r.lunch_date)
   where r.household_id = p_household and r.status = 'waiting' and r.open_until > now();
  return p_cutoff;
end $$;

-- ---------------------------------------------------------------------------------------------
-- A child's changes (the board), and a parent's answer (Today)
-- ---------------------------------------------------------------------------------------------

-- [MEAL-09][MEAL-11][US-707] A board asks for a child's day as they want it: buy or bring, and a buy
-- day's picks. Only a school day up to its cut-off, at most three weeks ahead. The same as the day
-- already is takes back anything waiting; anything else waits for a parent, replacing what waited.
-- Returns {member_id, date, mode, choices, waiting}.
create function public.request_lunch(p_member uuid, p_date date, p_mode text, p_choices jsonb default '[]')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m       public.member;
  v_board uuid := private.my_device_id();
  v_until timestamptz;
  v_clean jsonb;
  v_same  boolean;
begin
  select * into m from public.member where id = p_member and archived_at is null;
  if v_board is null or not found or m.household_id is distinct from private.device_household_id() then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if m.role <> 'child' then
    raise exception 'school lunch is a child''s' using errcode = '22023', hint = 'not_a_child';
  end if;
  if p_date is null or p_mode is null or p_mode not in ('buy', 'bring') then
    raise exception 'a day, and buy or bring' using errcode = '22023', hint = 'bad_request';
  end if;
  if public.resolve_day_type(p_member, p_date) <> 'school_day' then
    raise exception 'no school lunch that day' using errcode = '22023', hint = 'not_school_day';
  end if;
  v_until := private.lunch_open_until(m.household_id, p_date);
  if now() >= v_until or p_date > private.household_today(m.household_id) + 21 then
    raise exception 'that day can''t change now' using errcode = '22023', hint = 'locked';
  end if;
  v_clean := private.lunch_picks(p_member, p_date, p_mode, p_choices);
  -- Serialise a child's changes to a day (two boards at once).
  perform pg_advisory_xact_lock(hashtextextended('lunch_request:' || p_member || ':' || p_date, 0));
  v_same := p_mode = public.lunch_mode(p_member, p_date)
            and (p_mode = 'bring' or private.picks_key(v_clean) = private.picks_key(private.lunch_choices_of(p_member, p_date)));
  if v_same then
    delete from public.lunch_request where member_id = p_member and lunch_date = p_date and status = 'waiting';
  else
    insert into public.lunch_request as r (household_id, member_id, lunch_date, mode, choices, requested_by, open_until)
    values (m.household_id, p_member, p_date, p_mode, v_clean, v_board, v_until)
    on conflict (member_id, lunch_date) do update
       set mode = excluded.mode, choices = excluded.choices, status = 'waiting',
           requested_by = excluded.requested_by, requested_at = now(), open_until = excluded.open_until,
           decided_by = null, decided_at = null, seen_at = null
     where r.status <> 'waiting' or r.mode <> excluded.mode or r.choices <> excluded.choices;
  end if;
  return jsonb_build_object('member_id', p_member, 'date', p_date, 'mode', p_mode, 'choices', v_clean,
                            'waiting', not v_same);
end $$;

-- [MEAL-09][US-707] A board says a child has looked at their week (Done): a parent's "kept" goes.
create function public.seen_lunch_week(p_member uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if private.my_device_id() is null
     or not exists (select from public.member m where m.id = p_member
                     and m.household_id = private.device_household_id()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  update public.lunch_request set seen_at = now()
   where member_id = p_member and status = 'kept' and seen_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- [MEAL-09][MEAL-11][US-707] A parent approves the children's changes, or keeps the days as they
-- were (p_approve false). Approved: the day's lunch and picks become the child's. A change past its
-- cut-off is left as it is (counted as expired). Returns {decided, expired}.
create function public.decide_lunch_requests(p_ids uuid[], p_approve boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r         public.lunch_request;
  v_decided integer := 0;
  v_expired integer := 0;
begin
  if auth.uid() is null or p_ids is null or p_approve is null then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if exists (select from public.lunch_request x where x.id = any (p_ids)
              and x.household_id not in (select private.admin_household_ids())) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  for r in select * from public.lunch_request x where x.id = any (p_ids) and x.status = 'waiting'
            order by x.lunch_date, x.member_id for update loop
    if now() >= r.open_until then
      v_expired := v_expired + 1;
      continue;
    end if;
    update public.lunch_request
       set status = case when p_approve then 'approved' else 'kept' end,
           decided_by = auth.uid(), decided_at = now()
     where id = r.id;
    if p_approve then
      if public.resolve_day_type(r.member_id, r.lunch_date) = 'school_day' then
        perform public.set_lunch(r.member_id, r.lunch_date, r.mode);
        if r.mode = 'buy' then
          perform private.store_picks(r.household_id, r.member_id, r.lunch_date, r.choices, 'device',
                                      r.requested_by, auth.uid());
        end if;
      end if;
    end if;
    v_decided := v_decided + 1;
  end loop;
  return jsonb_build_object('decided', v_decided, 'expired', v_expired);
end $$;

-- [MEAL-09][US-707] The children's changes waiting for a parent, for Today: each with the day as
-- it is and as asked, and the usual; children by name, then by day.
create function public.lunch_requests_waiting(p_household uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_household is null or p_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'member_id', r.member_id, 'date', r.lunch_date, 'mode', r.mode,
             'choices', r.choices, 'current', public.lunch_mode(r.member_id, r.lunch_date),
             'current_choices', private.lunch_choices_of(r.member_id, r.lunch_date),
             'usual', private.usual_lunch(r.member_id, r.lunch_date),
             'requested_at', r.requested_at, 'open_until', r.open_until)
           order by m.display_name, m.id, r.lunch_date)
      from public.lunch_request r
      join public.member m on m.id = r.member_id and m.archived_at is null
     where r.household_id = p_household and r.status = 'waiting' and r.open_until > now()), '[]'::jsonb);
end $$;

-- [MEAL-04][MEAL-09][MEAL-11] lunch_week (WP-64), and on each day: `open` (a board may still change
-- it), `open_until`, a buy day's `choices`, `request` (a change waiting for a parent, or one a parent
-- kept that the child hasn't seen yet, with who kept it), and `by_board` (the day is as a child asked
-- and a parent approved).
create or replace function public.lunch_week(p_household uuid, p_from date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
begin
  if p_household is null or p_from is null
     or not (p_household in (select private.admin_household_ids())
             or p_household = private.device_household_id()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  v_today := private.household_today(p_household);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'member_id', m.id,
             'usual', coalesce(l.defaults, '{}'::jsonb),
             'menu_source_id', l.menu_source_id,
             'menu_name', s.name,
             'days', (select jsonb_agg(jsonb_build_object(
                               'date', d.day,
                               'day_type', public.resolve_day_type(m.id, d.day),
                               'mode', x.mode,
                               'changed', exists (select from public.lunch_override o
                                                   where o.member_id = m.id and o.lunch_date = d.day
                                                     and public.resolve_day_type(m.id, d.day) = 'school_day'),
                               'menu', case when x.mode is not null and l.menu_source_id is not null
                                            then private.menu_on(l.menu_source_id, d.day) end,
                               'open', x.mode is not null and now() < x.until and d.day <= v_today + 21,
                               'open_until', case when x.mode is not null then x.until end,
                               'choices', case when x.mode = 'buy' then private.lunch_choices_of(m.id, d.day) end,
                               'request', (select jsonb_build_object(
                                                    'id', r.id, 'mode', r.mode, 'choices', r.choices,
                                                    'status', r.status, 'requested_at', r.requested_at,
                                                    'decided_by', (select dm.display_name from public.member dm
                                                                    where dm.household_id = p_household
                                                                      and dm.user_id = r.decided_by))
                                             from public.lunch_request r
                                            where r.member_id = m.id and r.lunch_date = d.day and x.mode is not null
                                              and ((r.status = 'waiting' and r.open_until > now())
                                                   or (r.status = 'kept' and r.seen_at is null and d.day >= v_today))),
                               'by_board', exists (select from public.lunch_request r
                                                    where r.member_id = m.id and r.lunch_date = d.day
                                                      and r.status = 'approved' and r.mode = x.mode))
                             order by d.day)
                        from generate_series(p_from, p_from + 6, interval '1 day') g (t)
                        cross join lateral (select g.t::date as day) d
                        cross join lateral (select public.lunch_mode(m.id, d.day) as mode,
                                                   private.lunch_open_until(p_household, d.day) as until) x))
           order by m.display_name, m.id)
      from public.member m
      left join public.member_lunch l on l.member_id = m.id
      left join public.menu_source s on s.id = l.menu_source_id
     where m.household_id = p_household and m.role = 'child' and m.archived_at is null), '[]'::jsonb);
end $$;

revoke all on function private.lunch_open_until(uuid, date), private.lunch_picks(uuid, date, text, jsonb),
  private.lunch_choices_of(uuid, date), private.picks_key(jsonb),
  private.store_picks(uuid, uuid, date, jsonb, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_lunch_choices(uuid, date, jsonb), public.set_lunch_cutoff(uuid, time),
  public.request_lunch(uuid, date, text, jsonb), public.seen_lunch_week(uuid),
  public.decide_lunch_requests(uuid[], boolean), public.lunch_requests_waiting(uuid) from public, anon;
grant execute on function public.set_lunch_choices(uuid, date, jsonb), public.set_lunch_cutoff(uuid, time),
  public.request_lunch(uuid, date, text, jsonb), public.seen_lunch_week(uuid),
  public.decide_lunch_requests(uuid[], boolean), public.lunch_requests_waiting(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- [CHR-20] The approvals alert counts lunch changes (WP-63)
-- ---------------------------------------------------------------------------------------------

drop function private.approvals_waiting(uuid, uuid, timestamptz, timestamptz);

-- What waits for this parent that became waiting in (p_from, p_to] and still waits: one row per
-- child, with their check-offs, reward requests and lunch changes, in the household's member order.
create function private.approvals_waiting(p_household uuid, p_member uuid, p_from timestamptz, p_to timestamptz)
returns table (child uuid, name text, checkoffs integer, requests integer, lunches integer)
language sql stable security definer set search_path = '' as $$
  with parent as (
    select m.id, m.user_id from public.member m where m.id = p_member
  ), checkoff as (
    select coalesce(o.done_by[1], (select a.member_id from public.chore_occurrence_assignee a
                                    where a.occurrence_id = o.id order by a.member_id limit 1)) as child
      from public.chore_occurrence o
      join public.chore c on c.id = o.chore_id
      cross join parent p
     where o.household_id = p_household
       and o.status = 'pending_approval'
       and o.status_changed_at > p_from and o.status_changed_at <= p_to
       and (c.visibility = 'family' or c.created_by = p.user_id
            or exists (select from public.chore_assignee ca where ca.chore_id = c.id and ca.member_id = p.id))
       and not (p.id = any (o.done_by))
  ), request as (
    select r.member_id as child
      from public.redemption r
      cross join parent p
     where r.household_id = p_household
       and r.status = 'requested'
       and r.requested_at > p_from and r.requested_at <= p_to
       and not (r.requested_by_type = 'admin' and r.requested_by is not distinct from p.user_id)
  ), lunch as (
    -- [MEAL-09] A child's lunch change, until its cut-off.
    select l.member_id as child
      from public.lunch_request l
     where l.household_id = p_household
       and l.status = 'waiting'
       and l.requested_at > p_from and l.requested_at <= p_to
       and l.open_until > p_to
  ), counted as (
    select child, count(*)::integer as checkoffs, 0 as requests, 0 as lunches from checkoff group by child
    union all
    select child, 0, count(*)::integer, 0 from request group by child
    union all
    select child, 0, 0, count(*)::integer from lunch group by child
  )
  select m.id, m.display_name, sum(k.checkoffs)::integer, sum(k.requests)::integer, sum(k.lunches)::integer
    from counted k
    join public.member m on m.id = k.child
   group by m.id, m.display_name, m.created_at
   order by m.created_at, m.display_name
$$;

-- "Maya: 3 check-offs and 2 lunch changes · Leo: 1 reward request waiting".
create or replace function private.approvals_line(p_waiting jsonb) returns text
language sql immutable set search_path = '' as $$
  select string_agg(
           (w ->> 'name') || ': ' || concat_ws(' and ',
             case (w ->> 'checkoffs')::integer when 0 then null when 1 then '1 check-off'
                  else (w ->> 'checkoffs') || ' check-offs' end,
             case (w ->> 'requests')::integer when 0 then null when 1 then '1 reward request'
                  else (w ->> 'requests') || ' reward requests' end,
             case coalesce((w ->> 'lunches')::integer, 0) when 0 then null when 1 then '1 lunch change'
                  else (w ->> 'lunches') || ' lunch changes' end),
           ' · ' order by ord) || ' waiting'
    from jsonb_array_elements(p_waiting) with ordinality as x (w, ord)
$$;

revoke all on function private.approvals_waiting(uuid, uuid, timestamptz, timestamptz),
  private.approvals_line(jsonb) from public, anon, authenticated;

-- [CHR-20] As WP-63 built it, and: a lunch change opens Today, as a check-off does.
create or replace function public.claim_reminders(p_household uuid, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tz      text;
  v_today   date;
  d         public.reminder_delivery;
  p         public.reminder_preference;
  v_devices jsonb;
  v_title   text;
  v_body    text;
  v_url     text;
  v_tag     text;
  v_skip    text;
  v_out     jsonb := '[]'::jsonb;
  o         record;
  v_open    integer;
  v_late    integer;
  v_names   text[];
  v_waiting jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  select timezone into v_tz from public.household where id = p_household;
  v_today := (p_now at time zone v_tz)::date;

  for d in select * from public.reminder_delivery
            where household_id = p_household and status = 'held' and scheduled_for <= p_now
            order by scheduled_for, id
            for update skip locked loop
    v_skip := null;
    v_tag := d.dedupe_key;
    select * into p from public.reminder_preference where member_id = d.member_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh,
                                                 'auth', s.auth_secret) order by s.created_at), '[]'::jsonb)
      into v_devices
      from public.push_subscription s where s.member_id = d.member_id and s.enabled;

    if d.kind = 'approval' then
      update public.reminder_delivery set waiting_to = greatest(p_now, waiting_from) where id = d.id;
    end if;

    if p.member_id is null or not p.enabled then
      v_skip := 'reminders_off';
    elsif d.kind = 'approval' and not p.approval_alerts then
      v_skip := 'approvals_off';
    elsif d.scheduled_for < p_now - interval '2 hours' then
      v_skip := 'late';
    end if;

    if v_skip is null and d.kind = 'due' then
      select oc.status, oc.due_date, oc.due_time, oc.kind, c.title, c.visibility, c.archived_at,
             coalesce(ca.remind, p.default_on) as bell,
             exists (select from public.chore_occurrence_assignee a
                      where a.occurrence_id = oc.id and a.member_id = d.member_id) as assigned
        into o
        from public.chore_occurrence oc
        join public.chore c on c.id = oc.chore_id
        left join public.chore_assignee ca on ca.chore_id = oc.chore_id and ca.member_id = d.member_id
       where oc.id = d.occurrence_id;
      if o.status is null or o.status not in ('scheduled', 'rejected') then
        v_skip := 'done';
      elsif not o.assigned or not o.bell or o.archived_at is not null then
        v_skip := 'item_off';
      else
        v_title := case when o.visibility = 'private' and p.hide_private_titles
                        then case when o.kind = 'task' then 'Private task' else 'Private chore' end
                        else o.title end;
        v_body := case
          when o.due_time is null then 'Due today'
          when o.due_date = v_today then 'Due at ' || private.clock_words(o.due_time)
          when o.due_date = v_today + 1 then 'Due tomorrow at ' || private.clock_words(o.due_time)
          when o.due_date = v_today - 1 then 'Was due yesterday at ' || private.clock_words(o.due_time)
          else 'Due ' || to_char(o.due_date, 'Dy') || ' at ' || private.clock_words(o.due_time)
        end;
        v_url := '/admin/my#item-' || d.occurrence_id;
      end if;
    elsif v_skip is null and d.kind = 'approval' then
      -- [CHR-20] What still waits of what became waiting in this alert's window.
      select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) into v_waiting
        from private.approvals_waiting(p_household, d.member_id, d.waiting_from, greatest(p_now, d.waiting_from)) w;
      if jsonb_array_length(v_waiting) = 0 then
        v_skip := 'nothing_waiting';
      else
        v_title := private.approvals_line(v_waiting);
        if exists (select from jsonb_array_elements(v_waiting) w where (w ->> 'checkoffs')::integer > 0
                                                                  or (w ->> 'lunches')::integer > 0) then
          v_body := 'Open Today to approve';
          v_url := '/admin/today';
        else
          v_body := 'Open Rewards to decide';
          v_url := '/admin/rewards';
        end if;
        v_tag := 'approval';
      end if;
    elsif v_skip is null then
      -- The digest: what is open for them today, and their overdue tasks.
      select count(*) filter (where oc.due_date = v_today),
             count(*) filter (where oc.due_date < v_today),
             (array_agg(case when c.visibility = 'private' and p.hide_private_titles then 'a private item'
                             else c.title end
                        order by oc.due_date, oc.due_time nulls last, c.title))[1:3]
        into v_open, v_late, v_names
        from public.chore_occurrence oc
        join public.chore_occurrence_assignee a on a.occurrence_id = oc.id and a.member_id = d.member_id
        join public.chore c on c.id = oc.chore_id and c.archived_at is null
       where oc.household_id = p_household and oc.status in ('scheduled', 'rejected')
         and (oc.due_date = v_today or (oc.kind = 'task' and oc.due_date < v_today));
      if v_open + v_late = 0 then
        v_skip := 'nothing_due';
      else
        v_title := 'Your day: ' || v_open || ' to do' || case when v_late > 0 then ', ' || v_late || ' overdue' else '' end;
        v_body := array_to_string(v_names, ', ')
                  || case when v_open + v_late > 3 then ' and ' || (v_open + v_late - 3) || ' more' else '' end;
        v_url := '/admin/my';
      end if;
    end if;

    if v_skip is null and jsonb_array_length(v_devices) = 0 then
      v_skip := 'no_device';
    end if;

    if v_skip is not null then
      update public.reminder_delivery set status = 'skipped', detail = v_skip where id = d.id;
    else
      update public.reminder_delivery set status = 'sent', sent_at = p_now where id = d.id;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'delivery_id', d.id, 'member_id', d.member_id, 'kind', d.kind,
        'payload', jsonb_build_object('title', v_title, 'body', v_body, 'url', v_url, 'tag', v_tag)
                   || case when d.kind = 'approval' then jsonb_build_object('renotify', true) else '{}'::jsonb end,
        'devices', v_devices));
    end if;
  end loop;
  return v_out;
end $$;

-- [MEAL-09][US-707] The board's snapshot (WP-62), and each item says what it opens on the board
-- (`opens`: 'lunches' opens the child's coming week).
create or replace function public.board_snapshot(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_device    public.device;
  v_household public.household;
  v_today     date;
  v_week      date;
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
  -- yesterday through three weeks ahead (the dashboard's "Coming up", D-66).
  v_today := (now() at time zone v_household.timezone)::date;
  v_from := coalesce(p_from, v_today - 1);
  v_to := coalesce(p_to, v_today + 21);
  -- The household's week so far, for each reward's weekly limit (as request_redemption() counts it).
  v_week := v_today - ((extract(dow from v_today)::integer - v_household.week_start + 7) % 7);
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
      'week_start', v_household.week_start,
      -- How long a check-off can be undone on the board (US-305, D-46).
      'undo_window_seconds', coalesce((select s.undo_window_seconds from public.household_settings s
                                        where s.household_id = v_household.id), 120)),
    'device', jsonb_build_object(
      'id', v_device.id,
      'name', v_device.name,
      'theme', coalesce(v_device.board_config ->> 'theme', 'auto'),
      -- [BRD-08] Its text size (WP-47): the board zooms by it, on top of fitting its screen.
      'text_size', coalesce(v_device.board_config ->> 'text_size', 'standard')),
    -- [BRD-05] The home screen's layout (D-67): the household's, and this board's own if it has one
    -- (a board without its own follows the household's). '{}' is the defaults. Since WP-45 a layout
    -- may also say whether the weather shows.
    'layout', jsonb_build_object(
      'household', coalesce((select s.board_layout from public.household_settings s
                              where s.household_id = v_household.id), '{}'::jsonb),
      'board', v_device.board_config -> 'layout'),
    -- Children first, then adults; each by name. Archived members are not on the board. Points and
    -- the streak only for those who earn rewards (D-32).
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'display_name', m.display_name,
               'role', m.role,
               'avatar_key', m.avatar_key,
               'color', m.color,
               'earns_rewards', m.earns_rewards,
               'points', case when m.earns_rewards then jsonb_build_object(
                 'balance', (select coalesce(sum(l.amount), 0)::integer
                               from public.points_ledger l where l.member_id = m.id),
                 'recent', (select coalesce(jsonb_agg(jsonb_build_object(
                                    'id', x.id, 'type', x.entry_type, 'amount', x.amount, 'at', x.created_at,
                                    'label', x.label) order by x.created_at desc, x.id desc), '[]'::jsonb)
                              from (select l.id, l.entry_type, l.amount, l.created_at,
                                           case when l.occurrence_id is null then l.reason else c.title end as label
                                      from public.points_ledger l
                                      left join public.chore_occurrence o on o.id = l.occurrence_id
                                      left join public.chore c on c.id = o.chore_id
                                     where l.member_id = m.id
                                     order by l.created_at desc, l.id desc
                                     limit 5) x)) end,
               -- [RWD-05] The run going as of the last closed day, and the best good run.
               'streak', case when m.earns_rewards then jsonb_build_object(
                 'kind', (select s.kind from public.streak_segment s where s.member_id = m.id and s.end_date is null),
                 'length', coalesce((select s.length_days from public.streak_segment s
                                      where s.member_id = m.id and s.end_date is null), 0),
                 'best', coalesce((select max(s.length_days) from public.streak_segment s
                                    where s.member_id = m.id and s.kind = 'good'), 0)) end,
               -- [PTS-06] The reward they are saving for, if they pinned one still in the shop.
               'wish', case when m.earns_rewards then (
                 select jsonb_build_object('item_id', i.id, 'title', i.title, 'icon', i.icon,
                                           'cost', i.cost_points)
                   from public.wishlist_pin w
                   join public.reward_catalog_item i on i.id = w.catalog_item_id
                  where w.member_id = m.id and i.active and i.archived_at is null) end,
               -- [PTS-04] What they can still ask for: the balance less the requests waiting for a
               -- parent, as request_redemption() reckons it.
               'available', case when m.earns_rewards then
                 (select coalesce(sum(l.amount), 0)::integer from public.points_ledger l where l.member_id = m.id)
                 - (select coalesce(sum(r.cost_snapshot), 0)::integer from public.redemption r
                     where r.member_id = m.id and r.status = 'requested') end,
               -- [PTS-04][US-1104][US-1105] Their requests: those still open, and those settled in the last
               -- two days (so "not this time" is seen), newest first.
               'requests', case when m.earns_rewards then (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', x.id, 'item_id', x.catalog_item_id, 'title', x.title, 'icon', x.icon,
                          'cost', x.cost_snapshot, 'status', x.status, 'at', x.at)
                          order by x.at desc, x.id), '[]'::jsonb)
                   from (select r.id, r.catalog_item_id, i.title, i.icon, r.cost_snapshot, r.status,
                                coalesce(r.cancelled_at, r.fulfilled_at, r.decided_at, r.requested_at) as at
                           from public.redemption r
                           join public.reward_catalog_item i on i.id = r.catalog_item_id
                          where r.member_id = m.id
                            and (r.status in ('requested', 'approved')
                                 or coalesce(r.cancelled_at, r.fulfilled_at, r.decided_at, r.requested_at)
                                    > now() - interval '2 days')
                          order by at desc, r.id
                          limit 6) x) end,
               -- [PTS-04] The rewards they have asked for as often as allowed this week.
               'limited', case when m.earns_rewards then (
                 select coalesce(jsonb_agg(i.id order by i.id), '[]'::jsonb)
                   from public.reward_catalog_item i
                  where i.household_id = v_household.id and i.weekly_limit is not null
                    and (select count(*) from public.redemption r
                          where r.catalog_item_id = i.id and r.member_id = m.id
                            and r.status in ('requested', 'approved', 'fulfilled')
                            and (r.requested_at at time zone v_household.timezone)::date >= v_week)
                        >= i.weekly_limit) end)
             order by (m.role = 'child') desc, m.display_name, m.id)
        from public.member m
       where m.household_id = v_household.id and m.archived_at is null), '[]'::jsonb),
    -- [BRD-01][CHR-12][D-21] Today's items and the open overdue tasks (a task carries over until it is
    -- done; a routine from another day is a parent's to catch up). RLS as the board means private
    -- items never arrive (D-34). Overdue first, then by due time (none last), then title.
    'occurrences', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id,
               'chore_id', o.chore_id,
               'opens', c.opens,
               'title', c.title,
               -- [D-66] What "More info" opens on the board.
               'description', c.description,
               'icon', c.icon,
               'kind', o.kind,
               'due_date', o.due_date,
               'due_time', to_char(o.due_time, 'HH24:MI'),
               'member_id', o.member_id,
               'assignees', (select coalesce(jsonb_agg(a.member_id order by a.member_id), '[]'::jsonb)
                               from public.chore_occurrence_assignee a where a.occurrence_id = o.id),
               'status', o.status,
               'done_by', to_jsonb(o.done_by),
               'rewarded', to_jsonb(o.rewarded),
               'points', o.points_snapshot,
               'requires_approval', o.requires_approval_snapshot,
               -- When the check-off it shows was made, so the board knows whether it can still be undone.
               'checked_at', (select e.occurred_at from public.chore_completion_event e
                               where e.id = o.status_event_id and e.event_type = 'complete'))
             order by o.due_date, o.due_time nulls last, c.title, o.member_id nulls first, o.id)
        from public.chore_occurrence o
        join public.chore c on c.id = o.chore_id
       where o.household_id = v_household.id
         and (o.due_date = v_today
              or (o.kind = 'task' and o.due_date < v_today and c.archived_at is null
                  and o.status in ('scheduled', 'rejected', 'pending_approval')))), '[]'::jsonb),
    -- [PTS-03][PTS-04][PTS-06] The shop as a child chooses from it: to save for (WP-30) and to ask for
    -- (WP-20). `left` is how many are still to be had (null: as many as asked for); `photo` is the path
    -- in the private rewards bucket, which the board reads through a signed link.
    'shop', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'title', i.title, 'icon', i.icon, 'cost', i.cost_points, 'photo', i.image_path,
               'description', i.description,
               'left', case when i.stock is not null then greatest(0, i.stock - (
                         select count(*) from public.redemption r
                          where r.catalog_item_id = i.id and r.status in ('requested', 'approved', 'fulfilled')))
                       end)
             order by i.sort_order, i.title, i.id)
        from public.reward_catalog_item i
       where i.household_id = v_household.id and i.active and i.archived_at is null), '[]'::jsonb),
    -- [RWD-07][RWD-08] The goals in play (WP-19's progress): each child's and the family's, going or
    -- reached, with each rule's progress. `celebrate` is a reached goal no board has celebrated yet.
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id,
               'member_id', g.member_id,
               'title', g.title,
               'icon', g.icon,
               'photo', g.image_path,
               'status', g.status,
               'n', g.achievement_count,
               'achieved_at', g.achieved_at,
               'celebrate', g.status = 'achieved' and g.celebrated_at is null,
               'end_date', g.end_date,
               'logic', g.rule_logic,
               'pct', coalesce(p.pct, 0),
               'rules', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'id', r.id, 'type', r.rule_type, 'target', r.target,
                                  'current', coalesce(rp.current_value, 0), 'pct', coalesce(rp.pct, 0),
                                  'met', coalesce(rp.is_met, false), 'streak', rp.current_streak,
                                  'best', rp.best_streak)
                                  order by r.sort_order, r.id), '[]'::jsonb)
                           from public.reward_rule r
                           left join public.reward_rule_progress rp on rp.rule_id = r.id
                          where r.goal_id = g.id))
             order by g.member_id nulls last, g.status = 'achieved' desc, g.end_date nulls last, g.title, g.id)
        from public.reward_goal g
        left join public.reward_goal_progress p on p.goal_id = g.id
        left join public.member m on m.id = g.member_id
       where g.household_id = v_household.id and g.archived_at is null
         and g.status in ('active', 'achieved')
         and (g.member_id is null or (m.archived_at is null and m.earns_rewards))), '[]'::jsonb),
    -- [CAL-04][CAL-05] The calendars this board shows and their events over the window (WP-23).
    'calendar', public.board_calendar(v_from, v_to),
    -- [BRD-04] The weather at the household's place (WP-45, D-69): the last good reading while the
    -- last read worked and is under 75 minutes old (two reads every hour), else none: the board then
    -- shows no weather and nothing else changes.
    'weather', (select jsonb_build_object(
                         'temperature', w.temperature,
                         'high', w.high,
                         'low', w.low,
                         'code', w.weather_code,
                         'day', w.is_day,
                         'unit', w.unit,
                         'for_date', w.for_date,
                         'read_at', w.read_at)
                  from public.weather_reading w
                 where w.household_id = v_household.id
                   and w.failed_at is null
                   and w.read_at > now() - interval '75 minutes'),
    -- [MEAL-06][US-705] The household week's meals (WP-28, D-80): each day's breakfast, snack, lunch
    -- and dinner as planned on Meals, in order, for everyone or any set of people (WP-62); and each
    -- child's school lunch, buy or bring, with the school's menu on a buy day (lunch_week, WP-26 and
    -- WP-27).
    'meals', jsonb_build_object(
      'week_from', v_week,
      'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', e.id,
                 'date', e.plan_date,
                 'slot', e.slot,
                 -- [MEAL-10] Who it's for (WP-62): member_ids, none for everyone; member_id is the one
                 -- person when there is exactly one, for a board still on the app before WP-62.
                 'member_id', (select case when count(*) = 1 then min(p.member_id::text)::uuid end
                                 from public.meal_plan_entry_member p where p.entry_id = e.id),
                 'member_ids', (select coalesce(jsonb_agg(p.member_id order by p.member_id), '[]'::jsonb)
                                  from public.meal_plan_entry_member p where p.entry_id = e.id),
                 'name', coalesce(ml.name, e.free_text),
                 'icon', ml.icon,
                 'notes', e.notes)
               order by e.plan_date, array_position(array['breakfast', 'snack', 'lunch', 'dinner'], e.slot),
                        e.sort_order, e.id)
          from public.meal_plan_entry e
          left join public.meal ml on ml.id = e.meal_id
         where e.household_id = v_household.id and e.plan_date between v_week and v_week + 6), '[]'::jsonb),
      'lunch', public.lunch_week(v_household.id, v_week)));
end $$;
