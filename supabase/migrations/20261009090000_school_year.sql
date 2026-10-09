-- [SCH-01][SCH-02][SCH-03] School years and day types (WP-21, 02 §3.5, §4.4, D-44). A household keeps
-- several school years: this year and next, or two schools' calendars at once. Each member follows
-- the school year they are assigned to (member_school_profile) or, without one for that date, the
-- household's default school year for that date. Default years may not overlap, so adding next
-- year's calendar ahead of time works for everyone without switching anything on the first day.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.school_year (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.household (id) on delete cascade,
  name          text not null check (name = btrim(name) and length(name) between 1 and 40),
  school_name   text check (school_name = btrim(school_name) and length(school_name) between 1 and 80),
  start_date    date not null,
  end_date      date not null,
  is_default    boolean not null default false,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, id),
  check (end_date > start_date and end_date - start_date <= 400)
);
create index on public.school_year (household_id) where archived_at is null;
create trigger trg_school_year_updated before update on public.school_year
  for each row execute function private.set_updated_at();

-- Terms are informational (and reward-window presets later).
create table public.school_term (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null,
  school_year_id  uuid not null,
  name            text not null check (name = btrim(name) and length(name) between 1 and 40),
  start_date      date not null,
  end_date        date not null check (end_date >= start_date),
  created_at      timestamptz not null default now(),
  foreign key (household_id, school_year_id) references public.school_year (household_id, id) on delete cascade
);
create index on public.school_term (school_year_id);

-- A break makes its days `break`; any other closure makes them `no_school`.
create table public.school_closure (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null,
  school_year_id  uuid not null,
  name            text not null check (name = btrim(name) and length(name) between 1 and 60),
  closure_type    text not null check (closure_type in ('break', 'holiday', 'teacher_day', 'snow_day', 'other')),
  start_date      date not null,
  end_date        date not null check (end_date >= start_date),
  created_at      timestamptz not null default now(),
  foreign key (household_id, school_year_id) references public.school_year (household_id, id) on delete cascade
);
create index on public.school_closure (school_year_id, start_date);

-- Which school year a member follows, when it isn't the default (any member: a child at another
-- school, or a parent who works to a school calendar). Lunch defaults are for WP-26.
create table public.member_school_profile (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null,
  member_id       uuid not null,
  school_year_id  uuid not null,
  lunch_defaults  jsonb not null default '{}'::jsonb check (jsonb_typeof(lunch_defaults) = 'object'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (member_id, school_year_id),
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade,
  foreign key (household_id, school_year_id) references public.school_year (household_id, id) on delete cascade
);
create index on public.member_school_profile (household_id, member_id);
create trigger trg_member_school_profile_updated before update on public.member_school_profile
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Guards: dates that make sense together. Errors carry a stable HINT.
-- ---------------------------------------------------------------------------

-- Default years never overlap (one calendar answers "which default covers this date"), and a year's
-- dates keep its terms and closures inside it.
create function private.school_year_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_default and new.archived_at is null and exists (
    select from public.school_year y
     where y.household_id = new.household_id and y.id <> new.id and y.is_default and y.archived_at is null
       and daterange(y.start_date, y.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
    raise exception 'another default school year covers some of these dates'
      using errcode = '23514', hint = 'default_year_overlap';
  end if;
  if tg_op = 'UPDATE' and (new.start_date, new.end_date) is distinct from (old.start_date, old.end_date) and (
       exists (select from public.school_term t where t.school_year_id = new.id
                and (t.start_date < new.start_date or t.end_date > new.end_date))
    or exists (select from public.school_closure c where c.school_year_id = new.id
                and (c.start_date < new.start_date or c.end_date > new.end_date))) then
    raise exception 'a term or closure falls outside these dates'
      using errcode = '23514', hint = 'year_excludes_dates';
  end if;
  return new;
end $$;
create trigger trg_school_year_guard before insert or update on public.school_year
  for each row execute function private.school_year_guard();

-- Terms and closures sit inside their school year.
create function private.school_dates_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select from public.school_year y
     where y.id = new.school_year_id and new.start_date >= y.start_date and new.end_date <= y.end_date) then
    raise exception 'those dates are outside the school year'
      using errcode = '23514', hint = 'outside_school_year';
  end if;
  return new;
end $$;
create trigger trg_school_term_dates before insert or update on public.school_term
  for each row execute function private.school_dates_guard();
create trigger trg_school_closure_dates before insert or update on public.school_closure
  for each row execute function private.school_dates_guard();

-- A member follows at most one school year on any date.
create function private.school_profile_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select from public.member_school_profile p
      join public.school_year y on y.id = p.school_year_id
      join public.school_year n on n.id = new.school_year_id
     where p.member_id = new.member_id and p.id <> new.id and y.archived_at is null
       and daterange(y.start_date, y.end_date, '[]') && daterange(n.start_date, n.end_date, '[]')) then
    raise exception 'they already follow another school year on some of these dates'
      using errcode = '23514', hint = 'profile_overlap';
  end if;
  return new;
end $$;
create trigger trg_member_school_profile_guard before insert or update on public.member_school_profile
  for each row execute function private.school_profile_guard();

revoke all on function private.school_year_guard(), private.school_dates_guard(),
                       private.school_profile_guard() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Day types (02 §4.4, SCH-02). Security invoker: an admin, the board and the generator each read
-- through their own access.
-- ---------------------------------------------------------------------------

-- The school year a member follows on a date: the one they are assigned to, else the household's
-- default for that date; null when neither covers it (summer).
create function public.member_school_year(p_member uuid, p_date date) returns uuid
language sql stable set search_path = '' as $$
  select coalesce(
    (select y.id
       from public.member_school_profile p
       join public.school_year y on y.id = p.school_year_id
      where p.member_id = p_member and y.archived_at is null
        and p_date between y.start_date and y.end_date
      limit 1),
    (select y.id
       from public.school_year y
       join public.member m on m.household_id = y.household_id
      where m.id = p_member and y.is_default and y.archived_at is null
        and p_date between y.start_date and y.end_date
        and not exists (
          select from public.member_school_profile p
            join public.school_year own on own.id = p.school_year_id
           where p.member_id = p_member and own.archived_at is null
             and p_date between own.start_date and own.end_date)
      limit 1))
$$;

-- The day type of a date in a given school year (null: outside any year), by precedence:
-- weekend, break, other closure, school day, summer.
create function public.school_day_type(p_school_year uuid, p_date date) returns text
language sql stable set search_path = '' as $$
  select case
    when extract(isodow from p_date) in (6, 7) then 'weekend'
    when p_school_year is null then 'summer'
    when exists (select from public.school_closure c
                  where c.school_year_id = p_school_year and c.closure_type = 'break'
                    and p_date between c.start_date and c.end_date) then 'break'
    when exists (select from public.school_closure c
                  where c.school_year_id = p_school_year
                    and p_date between c.start_date and c.end_date) then 'no_school'
    when exists (select from public.school_year y
                  where y.id = p_school_year and p_date between y.start_date and y.end_date) then 'school_day'
    else 'summer'
  end
$$;

-- [SCH-02] A member's day type on a date.
create function public.resolve_day_type(p_member uuid, p_date date) returns text
language sql stable set search_path = '' as $$
  select public.school_day_type(public.member_school_year(p_member, p_date), p_date)
$$;

-- [SCH-03] Whether an item applies on a date by day type: when the day type of any of its assignees
-- is one it allows (02 §3.5). The occurrence generator (WP-09) uses it with the item's schedule.
create function public.chore_day_type_matches(p_chore uuid, p_date date) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select from public.chore c
      join public.chore_assignee a on a.chore_id = c.id
     where c.id = p_chore
       and public.resolve_day_type(a.member_id, p_date) = any (c.day_types))
$$;

-- [SCH-01] Every date of a school year with its day type, for the admin timeline.
create function public.school_year_days(p_school_year uuid)
returns table (day date, day_type text)
language sql stable set search_path = '' as $$
  select d::date, public.school_day_type(y.id, d::date)
    from public.school_year y,
         generate_series(y.start_date, y.end_date, interval '1 day') d
   where y.id = p_school_year
   order by 1
$$;

-- [SCH-02] Each active member's day type on a date, with the school year they follow.
create function public.household_day_types(p_household_id uuid, p_date date)
returns table (member_id uuid, day_type text, school_year_id uuid)
language sql stable set search_path = '' as $$
  select m.id, public.resolve_day_type(m.id, p_date), public.member_school_year(m.id, p_date)
    from public.member m
   where m.household_id = p_household_id and m.archived_at is null
$$;

revoke all on function public.member_school_year(uuid, date), public.school_day_type(uuid, date),
                       public.resolve_day_type(uuid, date), public.chore_day_type_matches(uuid, date),
                       public.school_year_days(uuid), public.household_day_types(uuid, date)
  from public, anon;
grant execute on function public.member_school_year(uuid, date), public.school_day_type(uuid, date),
                          public.resolve_day_type(uuid, date), public.chore_day_type_matches(uuid, date),
                          public.school_year_days(uuid), public.household_day_types(uuid, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row level security: admins manage; the board reads (it shows the day's type, WP-11).
-- ---------------------------------------------------------------------------

alter table public.school_year           enable row level security;
alter table public.school_term           enable row level security;
alter table public.school_closure        enable row level security;
alter table public.member_school_profile enable row level security;

-- school_year: archived, never deleted (its closures are the history of past day types).
create policy school_year_admin_select on public.school_year for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy school_year_admin_insert on public.school_year for insert to authenticated
  with check (household_id in (select private.admin_household_ids()));
create policy school_year_admin_update on public.school_year for update to authenticated
  using (household_id in (select private.admin_household_ids()))
  with check (household_id in (select private.admin_household_ids()));
create policy school_year_device_select on public.school_year for select to authenticated
  using (household_id = (select private.device_household_id()));

-- terms, closures and who follows which year: admins add, change and remove.
create policy school_term_admin_all on public.school_term for all to authenticated
  using (household_id in (select private.admin_household_ids()))
  with check (household_id in (select private.admin_household_ids()));
create policy school_term_device_select on public.school_term for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy school_closure_admin_all on public.school_closure for all to authenticated
  using (household_id in (select private.admin_household_ids()))
  with check (household_id in (select private.admin_household_ids()));
create policy school_closure_device_select on public.school_closure for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy member_school_profile_admin_all on public.member_school_profile for all to authenticated
  using (household_id in (select private.admin_household_ids()))
  with check (household_id in (select private.admin_household_ids()));
create policy member_school_profile_device_select on public.member_school_profile for select to authenticated
  using (household_id = (select private.device_household_id()));

-- Audit (ACC-05).
create trigger trg_audit after insert or update or delete on public.school_year
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.school_term
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.school_closure
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.member_school_profile
  for each row execute function private.audit_row();
