-- [CHR-01][CHR-09][CHR-10][CHR-11][CHR-13] The family list (WP-08, 02 §3.2, D-30..D-34): chores
-- (routines) and tasks (to-dos) for any member, several assignees each, household tags referenced by
-- id, an optional due time, and private items that only their creator and assignees who sign in can
-- see. Occurrences and events arrive in WP-09 and WP-10 and follow the same visibility rule.

-- Link tables carry household_id and reference (household_id, id), so a link can never join an item
-- to a member or tag of another household.
alter table public.member add constraint member_household_id_id_key unique (household_id, id);

-- ---------------------------------------------------------------------------
-- Schedule shape (02 §3.2). The app validates the same shape with zod (lib/chores/schedule.ts);
-- this check is the last word. by_weekday is ISO (1 = Monday … 7 = Sunday), as resolve_day_type uses.
-- ---------------------------------------------------------------------------

create function private.valid_schedule(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v_freq    text := p ->> 'freq';
  v_allowed text[];
  v_list    jsonb;
  v_lo      int;
  v_hi      int;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    return false;
  end if;
  v_allowed := case v_freq
    when 'daily'   then array['freq', 'interval']
    when 'weekly'  then array['freq', 'interval', 'by_weekday']
    when 'monthly' then array['freq', 'interval', 'by_month_day']
    when 'once'    then array['freq', 'on_date']
  end;
  if v_allowed is null or exists (select from jsonb_object_keys(p) k where k <> all (v_allowed)) then
    return false;
  end if;
  if p ? 'interval' and not (jsonb_typeof(p -> 'interval') = 'number'
                             and (p ->> 'interval') ~ '^[0-9]{1,2}$'
                             and (p ->> 'interval')::int between 1 and 52) then
    return false;
  end if;
  if v_freq in ('weekly', 'monthly') then
    v_list := p -> case v_freq when 'weekly' then 'by_weekday' else 'by_month_day' end;
    v_lo := 1;
    v_hi := case v_freq when 'weekly' then 7 else 31 end;
    if jsonb_typeof(v_list) is distinct from 'array' or jsonb_array_length(v_list) = 0
       or exists (select from jsonb_array_elements(v_list) e
                   where jsonb_typeof(e) <> 'number' or e::text !~ '^[0-9]{1,2}$'
                      or e::text::int not between v_lo and v_hi)
       or (select count(distinct e::text) from jsonb_array_elements(v_list) e) <> jsonb_array_length(v_list) then
      return false;
    end if;
  end if;
  if v_freq = 'once' then
    if jsonb_typeof(p -> 'on_date') is distinct from 'string' or (p ->> 'on_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      return false;
    end if;
    perform to_date(p ->> 'on_date', 'YYYY-MM-DD');
    if to_char(to_date(p ->> 'on_date', 'YYYY-MM-DD'), 'YYYY-MM-DD') <> p ->> 'on_date' then
      return false;
    end if;
  end if;
  return true;
exception when others then
  return false;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Household tags (D-33): rules, filters and insights keep the id, so a rename or archive never
-- breaks a goal. Colors are the six categorical tokens; a tag always shows its name too (06 §4.2).
create table public.tag (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.household (id) on delete cascade,
  name          text not null check (name = btrim(name) and length(name) between 1 and 30),
  color         text not null default 'member-6'
                  check (color in ('member-1', 'member-2', 'member-3', 'member-4', 'member-5', 'member-6')),
  icon          text check (icon ~ '^[a-z][a-z0-9-]{0,31}$'),
  sort_order    integer not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, id)
);
create unique index tag_household_name_key on public.tag (household_id, lower(name));
create trigger trg_tag_updated before update on public.tag
  for each row execute function private.set_updated_at();

-- One model for every member's chores and tasks (D-30, D-31). created_by is set from the session on
-- insert and never changes; visibility decides who can read the item and everything derived from it.
create table public.chore (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.household (id) on delete cascade,
  title               text not null check (title = btrim(title) and length(title) between 1 and 80),
  description         text check (length(description) <= 500),
  icon                text not null default 'list-check' check (icon ~ '^[a-z][a-z0-9-]{0,31}$'),
  kind                text not null default 'chore' check (kind in ('chore', 'task')),
  points              integer not null default 0 check (points between 0 and 1000),
  approval            text not null default 'inherit' check (approval in ('inherit', 'required', 'none')),
  schedule            jsonb not null constraint chore_schedule_valid check (private.valid_schedule(schedule)),
  due_time            time check (extract(second from due_time) = 0),
  day_types           text[] not null default array['school_day', 'no_school', 'break', 'weekend', 'summer']
                        constraint chore_day_types_valid check (
                          cardinality(day_types) between 1 and 5
                          and day_types <@ array['school_day', 'no_school', 'break', 'weekend', 'summer']),
  visibility          text not null default 'family' check (visibility in ('family', 'private')),
  created_by          uuid references auth.users (id) on delete set null,
  remind_lead_minutes integer check (remind_lead_minutes in (0, 15, 60, 1440)),
  start_date          date not null,
  end_date            date,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (household_id, id),
  check (end_date is null or end_date >= start_date)
);
create index on public.chore (household_id) where archived_at is null;
create trigger trg_chore_updated before update on public.chore
  for each row execute function private.set_updated_at();

-- Any member, child or adult; several per item, sharing one occurrence per due date (CHR-09).
-- remind: null follows the person's reminder default (WP-40).
create table public.chore_assignee (
  household_id uuid not null,
  chore_id     uuid not null,
  member_id    uuid not null,
  remind       boolean,
  created_at   timestamptz not null default now(),
  primary key (chore_id, member_id),
  foreign key (household_id, chore_id) references public.chore (household_id, id) on delete cascade,
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade
);
create index on public.chore_assignee (household_id, member_id);

create table public.chore_tag (
  household_id uuid not null,
  chore_id     uuid not null,
  tag_id       uuid not null,
  created_at   timestamptz not null default now(),
  primary key (chore_id, tag_id),
  foreign key (household_id, chore_id) references public.chore (household_id, id) on delete cascade,
  foreign key (household_id, tag_id) references public.tag (household_id, id) on delete cascade
);
create index on public.chore_tag (household_id, tag_id);

-- ---------------------------------------------------------------------------
-- created_by, start_date, and who may change visibility
-- ---------------------------------------------------------------------------

-- On insert: the creator is the signed-in admin (the seed and jobs, with no session, name one), and
-- an item starts today in the household's time zone unless given a start date.
-- On update: the creator never changes, except to clear it when their sign-in is deleted. Only the
-- creator changes who can see an item (D-43), so another admin cannot hide a family item from the
-- board or expose someone's private one; an item whose creator is gone is claimed by the admin who
-- changes its visibility.
create function private.chore_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_user, new.created_by);
    if new.start_date is null then
      select (now() at time zone h.timezone)::date into new.start_date
        from public.household h where h.id = new.household_id;
    end if;
    return new;
  end if;
  -- Deleting the creator's sign-in clears it (on delete set null); nothing else changes it.
  if not (new.created_by is null and not exists (select from auth.users where id = old.created_by)) then
    new.created_by := old.created_by;
  end if;
  if new.visibility is distinct from old.visibility and v_user is not null then
    if old.created_by is null then
      new.created_by := v_user;
    elsif old.created_by <> v_user then
      raise exception 'only the person who created this item can change who sees it'
        using errcode = '42501', hint = 'visibility_creator_only';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.chore_guard() from public, anon, authenticated, service_role;
create trigger trg_chore_guard before insert or update on public.chore
  for each row execute function private.chore_guard();

-- ---------------------------------------------------------------------------
-- Visibility (D-34, 02 §4.5)
-- ---------------------------------------------------------------------------

-- Whether the signed-in admin is an assignee of the item through their linked member (WP-04).
create function private.is_chore_assignee(p_chore uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select from public.chore_assignee a
      join public.member m on m.id = a.member_id
     where a.chore_id = p_chore and m.user_id = (select auth.uid()))
$$;

-- Family items to everyone in the household; private items only to their creator and to assignees
-- who sign in. Everything derived from an item (assignees, tags, occurrences, events, audit rows)
-- calls this with its chore_id. A board is never a creator or an assignee, so it never sees one.
create function private.can_see_chore(p_chore uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select from public.chore c
     where c.id = p_chore
       and (c.visibility = 'family'
            or c.created_by = (select auth.uid())
            or private.is_chore_assignee(c.id)))
$$;

revoke all on function private.valid_schedule(jsonb), private.is_chore_assignee(uuid),
                       private.can_see_chore(uuid) from public, anon;
grant execute on function private.valid_schedule(jsonb), private.is_chore_assignee(uuid),
                          private.can_see_chore(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.tag            enable row level security;
alter table public.chore          enable row level security;
alter table public.chore_assignee enable row level security;
alter table public.chore_tag      enable row level security;

-- tag: admins list, add, rename, recolor and archive. Never deleted, so goals keep their ids.
create policy tag_admin_select on public.tag for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy tag_admin_insert on public.tag for insert to authenticated
  with check (household_id in (select private.admin_household_ids()));
create policy tag_admin_update on public.tag for update to authenticated
  using (household_id in (select private.admin_household_ids()))
  with check (household_id in (select private.admin_household_ids()));

-- chore: the rule is written against the row's own columns (not can_see_chore, which reads the table
-- again), so a private item is readable by its creator in the statement that inserts it. Archived,
-- not deleted.
create policy chore_admin_select on public.chore for select to authenticated
  using (household_id in (select private.admin_household_ids())
         and (visibility = 'family' or created_by = (select auth.uid()) or private.is_chore_assignee(id)));
create policy chore_admin_insert on public.chore for insert to authenticated
  with check (household_id in (select private.admin_household_ids()));
create policy chore_admin_update on public.chore for update to authenticated
  using (household_id in (select private.admin_household_ids())
         and (visibility = 'family' or created_by = (select auth.uid()) or private.is_chore_assignee(id)))
  with check (household_id in (select private.admin_household_ids()));
create policy chore_device_select on public.chore for select to authenticated
  using (household_id = (select private.device_household_id()) and visibility = 'family');

-- assignees and tags of an item follow the item.
create policy chore_assignee_admin_all on public.chore_assignee for all to authenticated
  using (household_id in (select private.admin_household_ids()) and private.can_see_chore(chore_id))
  with check (household_id in (select private.admin_household_ids()) and private.can_see_chore(chore_id));
create policy chore_assignee_device_select on public.chore_assignee for select to authenticated
  using (household_id = (select private.device_household_id()) and private.can_see_chore(chore_id));
create policy chore_tag_admin_all on public.chore_tag for all to authenticated
  using (household_id in (select private.admin_household_ids()) and private.can_see_chore(chore_id))
  with check (household_id in (select private.admin_household_ids()) and private.can_see_chore(chore_id));
create policy chore_tag_device_select on public.chore_tag for select to authenticated
  using (household_id = (select private.device_household_id()) and private.can_see_chore(chore_id));

-- ---------------------------------------------------------------------------
-- Audit (ACC-05): rows about an item carry its chore_id and follow its visibility (CHR-13). Otherwise
-- as in the device pairing migration (a board reporting in is not a change worth a row).
-- ---------------------------------------------------------------------------

create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row       jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_old       jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_household uuid := coalesce(
    (v_row ->> 'household_id')::uuid,
    case when tg_table_name = 'household' then (v_row ->> 'id')::uuid end);
  v_actor     uuid := auth.uid();
  v_diff      jsonb;
begin
  -- A household being deleted takes its audit trail with it; nothing to record.
  if v_household is null or not exists (select from public.household where id = v_household) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(key, jsonb_build_object('from', v_old -> key, 'to', value)), '{}'::jsonb)
      into v_diff
      from jsonb_each(v_row)
     where v_old -> key is distinct from value and key <> 'updated_at';
  else
    v_diff := v_row;
  end if;
  v_diff := v_diff - array['token_hash', 'code_hash', 'created_at', 'updated_at', 'last_seen_at', 'app_version'];
  if tg_op = 'UPDATE' and v_diff = '{}'::jsonb then
    return null;
  end if;
  insert into public.audit_log (household_id, actor_type, actor_id, action, entity_type, entity_id, chore_id, diff)
  values (
    v_household,
    case when v_actor is null then 'system'
         when auth.jwt() -> 'app_metadata' ->> 'role' = 'device' then 'device'
         else 'admin' end,
    v_actor,
    lower(tg_op),
    tg_table_name,
    case tg_table_name
      when 'household_user' then (v_row ->> 'user_id')::uuid
      when 'chore_assignee' then (v_row ->> 'member_id')::uuid
      when 'chore_tag'      then (v_row ->> 'tag_id')::uuid
      else (v_row ->> 'id')::uuid end,
    case when tg_table_name = 'chore' then (v_row ->> 'id')::uuid else (v_row ->> 'chore_id')::uuid end,
    v_diff);
  return null;
end $$;
revoke all on function private.audit_row() from public, anon, authenticated, service_role;

create trigger trg_audit after insert or update or delete on public.tag
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.chore
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.chore_assignee
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.chore_tag
  for each row execute function private.audit_row();

alter policy audit_log_admin_select on public.audit_log
  using (household_id in (select private.admin_household_ids())
         and (chore_id is null or private.can_see_chore(chore_id)));

-- ---------------------------------------------------------------------------
-- Saving an item (CHR-01): the item, its assignees and its tags in one transaction, under the
-- caller's RLS (security invoker). Archived tags stay on an item: the form no longer offers them,
-- but goals and history that use them keep working (US-312). On an edit, a field left out of p_item
-- keeps its value (a JSON null clears it). Errors carry a stable HINT.
-- ---------------------------------------------------------------------------

create function public.save_chore(
  p_household_id uuid,
  p_id           uuid,
  p_item         jsonb,
  p_assignees    uuid[],
  p_tags         uuid[] default '{}'
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id        uuid := coalesce(p_id, gen_random_uuid());
  v_assignees uuid[];
  v_tags      uuid[];
begin
  select coalesce(array_agg(m.id), '{}') into v_assignees
    from public.member m
   where m.id = any (coalesce(p_assignees, '{}')) and m.household_id = p_household_id and m.archived_at is null;
  if cardinality(v_assignees) = 0 then
    raise exception 'choose who it is for' using errcode = '23514', hint = 'chore_needs_assignee';
  end if;
  select coalesce(array_agg(t.id), '{}') into v_tags
    from public.tag t
   where t.id = any (coalesce(p_tags, '{}')) and t.household_id = p_household_id and t.archived_at is null;

  if p_id is null then
    insert into public.chore (id, household_id, title, description, icon, kind, points, approval,
                              schedule, due_time, day_types, visibility, start_date, end_date)
    values (v_id, p_household_id, p_item ->> 'title', p_item ->> 'description',
            coalesce(p_item ->> 'icon', 'list-check'), coalesce(p_item ->> 'kind', 'chore'),
            coalesce((p_item ->> 'points')::int, 0), coalesce(p_item ->> 'approval', 'inherit'),
            p_item -> 'schedule', (p_item ->> 'due_time')::time,
            coalesce((select array_agg(d) from jsonb_array_elements_text(p_item -> 'day_types') d),
                     array['school_day', 'no_school', 'break', 'weekend', 'summer']),
            coalesce(p_item ->> 'visibility', 'family'),
            (p_item ->> 'start_date')::date, (p_item ->> 'end_date')::date);
  else
    update public.chore
       set title       = p_item ->> 'title',
           description = case when p_item ? 'description' then p_item ->> 'description' else description end,
           icon        = coalesce(p_item ->> 'icon', icon),
           kind        = coalesce(p_item ->> 'kind', kind),
           points      = coalesce((p_item ->> 'points')::int, points),
           approval    = coalesce(p_item ->> 'approval', approval),
           schedule    = coalesce(p_item -> 'schedule', schedule),
           due_time    = case when p_item ? 'due_time' then (p_item ->> 'due_time')::time else due_time end,
           day_types   = coalesce((select array_agg(d) from jsonb_array_elements_text(p_item -> 'day_types') d), day_types),
           visibility  = coalesce(p_item ->> 'visibility', visibility),
           end_date    = case when p_item ? 'end_date' then (p_item ->> 'end_date')::date else end_date end
     where id = p_id and household_id = p_household_id;
    if not found then
      raise exception 'that item was not found' using errcode = 'P0002', hint = 'chore_not_found';
    end if;
  end if;

  delete from public.chore_assignee where chore_id = v_id and member_id <> all (v_assignees);
  insert into public.chore_assignee (household_id, chore_id, member_id)
  select p_household_id, v_id, unnest(v_assignees)
  on conflict do nothing;

  delete from public.chore_tag ct
   using public.tag t
   where ct.chore_id = v_id and t.id = ct.tag_id and t.archived_at is null and ct.tag_id <> all (v_tags);
  insert into public.chore_tag (household_id, chore_id, tag_id)
  select p_household_id, v_id, unnest(v_tags)
  on conflict do nothing;

  return v_id;
end $$;
revoke all on function public.save_chore(uuid, uuid, jsonb, uuid[], uuid[]) from public, anon;
grant execute on function public.save_chore(uuid, uuid, jsonb, uuid[], uuid[]) to authenticated;
