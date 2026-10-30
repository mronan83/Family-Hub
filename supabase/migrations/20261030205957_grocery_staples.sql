-- [MEAL-21] Staples by how often they run out (WP-106, D-138 (7), D-150; 02 §3.8).
--   * `grocery_buys()`: each thing's buys, read from its history (`grocery_item_event`), for the
--     admin app to learn its usual gap (apps/web/lib/grocery-staples.ts). A thing is its merge key;
--     a tick is a buy, in the admin app or at a board (D-150); a tick undone by an untick is not; two
--     on one household day count once. A removal is never a tick, so never a buy.
--   * `grocery_staple`: the household's choice for a thing: Not now until a day, or Don't suggest
--     until Suggest again. Set only through `set_grocery_staple()`, by a parent of the household.
-- Nothing here adds to the list: a suggestion is added by a parent's Add, through add_groceries()
-- with the reason "staple".

create table public.grocery_staple (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.household (id) on delete cascade,
  name_key       text not null check (name_key = btrim(name_key) and length(name_key) between 1 and 80),
  not_now_until  date,
  off_at         timestamptz,
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  unique (household_id, name_key)
);

-- [MEAL-21] A parent's choice for a thing: 'not_now' hides it until p_until (the app's one more
-- gap, at most a year off); 'off' is Don't suggest; 'on' is Suggest again (and clears Not now).
create function public.set_grocery_staple(p_household uuid, p_key text, p_choice text,
                                          p_until date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_key   text := nullif(btrim(p_key), '');
  v_today date;
begin
  perform private.grocery_access(p_household);
  if v_key is null or length(v_key) > 80 or p_choice is null or p_choice not in ('not_now', 'off', 'on') then
    raise exception 'bad choice' using errcode = '22023', hint = 'bad_request';
  end if;
  select (now() at time zone h.timezone)::date into v_today from public.household h where h.id = p_household;
  if p_choice = 'not_now' and (p_until is null or p_until <= v_today or p_until > v_today + 366) then
    raise exception 'a day in the coming year' using errcode = '22023', hint = 'bad_request';
  end if;
  insert into public.grocery_staple as s (household_id, name_key, not_now_until, off_at, updated_by)
  values (p_household, v_key,
          case when p_choice = 'not_now' then p_until end,
          case when p_choice = 'off' then now() end,
          auth.uid())
  on conflict (household_id, name_key) do update
    set not_now_until = case when p_choice = 'not_now' then p_until
                             when p_choice = 'off' then s.not_now_until end,
        off_at = case when p_choice = 'off' then coalesce(s.off_at, now())
                      when p_choice = 'on' then null else s.off_at end,
        updated_by = auth.uid(), updated_at = now();
end $$;

-- [MEAL-21] Each thing's buys: its merge key, the name at its latest buy, how many buys, and the
-- days of its latest 8 (oldest first), in the household's own days. Things last bought more than
-- 400 days ago are left out. For the household's parents only.
create function public.grocery_buys(p_household uuid)
returns table (name_key text, name text, buys integer, days date[])
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.grocery_access(p_household);
  return query
  with ev as (
    select e.item_id, e.kind, e.at,
           lead(e.kind) over (partition by e.item_id order by e.at, e.id) as next_kind
      from public.grocery_item_event e
     where e.household_id = p_household and e.kind in ('ticked', 'unticked')
  ), bought as (
    select i.name_key as k, i.name as n, ev.at,
           (ev.at at time zone h.timezone)::date as d
      from ev
      join public.grocery_item i on i.id = ev.item_id
      join public.household h on h.id = p_household
     where ev.kind = 'ticked' and ev.next_kind is distinct from 'unticked'
  ), per_day as (
    select k, d, max(at) as at, (array_agg(n order by at desc))[1] as n from bought group by k, d
  ), ranked as (
    select k, d, at, n, row_number() over (partition by k order by d desc) as r, count(*) over (partition by k) as c
      from per_day
  )
  select r1.k, r1.n, r1.c::integer,
         (select array_agg(r2.d order by r2.d) from ranked r2 where r2.k = r1.k and r2.r <= 8)
    from ranked r1
   where r1.r = 1 and r1.d > (now() at time zone (select h.timezone from public.household h where h.id = p_household))::date - 400
   order by r1.d desc
   limit 1000;
end $$;

-- Row level security: the household's parents read their choices; nobody writes but the function.
alter table public.grocery_staple enable row level security;
create policy grocery_staple_admin_select on public.grocery_staple for select to authenticated
  using (household_id in (select private.admin_household_ids()));
revoke all on public.grocery_staple from public, anon;
revoke insert, update, delete, truncate on public.grocery_staple from authenticated;
grant select on public.grocery_staple to authenticated;

-- A setting, audited like the brands.
create trigger trg_audit after insert or update or delete on public.grocery_staple
  for each row execute function private.audit_row();

revoke all on function public.set_grocery_staple(uuid, text, text, date), public.grocery_buys(uuid)
  from public, anon;
grant execute on function public.set_grocery_staple(uuid, text, text, date), public.grocery_buys(uuid)
  to authenticated;
