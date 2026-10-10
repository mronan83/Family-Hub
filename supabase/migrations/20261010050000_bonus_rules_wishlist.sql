-- [PTS-05][PTS-06] Bonus rules and the wishlist (WP-30, 02 §3.3b, D-57).
--   * A parent sets bonus rules: points for a run of good days reaching a length, or for each day with
--     everything done (a perfect day), counting from a date they choose. Day close applies them to the
--     history the rules engine stored (D-55), so a bonus follows the same reading of a day as the
--     flame and Insights. Each posts once, through the ledger's one writer (D-28): its dedupe key names
--     the rule, the member and the run (its first day) or the day, so replaying posts nothing.
--   * A child pins one reward from the shop as what they are saving for; the board shows how far their
--     balance has got toward its cost.

-- ---------------------------------------------------------------------------------------------
-- Bonus rules
-- ---------------------------------------------------------------------------------------------

create table public.points_rule (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  -- streak_bonus: a run of good days reaching streak_days; all_done_bonus: a day with everything done.
  rule_type    text not null check (rule_type in ('streak_bonus', 'all_done_bonus')),
  streak_days  integer check (streak_days between 2 and 365),
  bonus_points integer not null check (bonus_points between 1 and 1000),
  counts_from  date not null,                  -- days before it never pay
  active       boolean not null default true,
  created_by   uuid default auth.uid(),      -- the parent who set it
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz,
  unique (household_id, id),
  check ((rule_type = 'streak_bonus') = (streak_days is not null))
);
create index on public.points_rule (household_id) where archived_at is null;

-- A bonus names the rule that paid it.
alter table public.points_ledger add column points_rule_id uuid;
alter table public.points_ledger add constraint points_ledger_points_rule_fkey
  foreign key (household_id, points_rule_id) references public.points_rule (household_id, id);
alter table public.points_ledger add constraint points_ledger_points_rule_check
  check (points_rule_id is null or entry_type = 'bonus');
create index on public.points_ledger (points_rule_id) where points_rule_id is not null;

-- The ledger's one writer (D-28) learns the rule. Same body, one more argument, defaulted, so the
-- existing callers are unchanged.
drop function private.post_ledger(uuid, uuid, text, integer, text, text, text, uuid, uuid);
create function private.post_ledger(
  p_household uuid, p_member uuid, p_type text, p_amount integer, p_dedupe_key text, p_reason text,
  p_created_by_type text, p_created_by uuid, p_redemption uuid default null, p_points_rule uuid default null)
returns uuid
language sql security definer set search_path = '' as $$
  insert into public.points_ledger (household_id, member_id, entry_type, amount, reason, dedupe_key,
                                    created_by_type, created_by, redemption_id, points_rule_id)
  values (p_household, p_member, p_type, p_amount, p_reason, p_dedupe_key, p_created_by_type, p_created_by,
          p_redemption, p_points_rule)
  on conflict (dedupe_key) do nothing
  returning id
$$;

-- [PTS-05] One bonus for a rule, a member and a key (the run's first day, or the day): posted once.
create function private.post_points_rule_bonus(p_rule public.points_rule, p_member uuid, p_key text, p_reason text)
returns uuid
language sql security definer set search_path = '' as $$
  select private.post_ledger(p_rule.household_id, p_member, 'bonus', p_rule.bonus_points,
                             'rule:' || p_rule.id || ':' || p_member || ':' || p_key, p_reason, 'system', null,
                             null, p_rule.id)
$$;

-- [PTS-05] Applies a household's active bonus rules to the stored history of each member who earns
-- rewards: a good run (`streak_segment`) that has reached the rule's length on or after its
-- counts-from date pays once, keyed by the run's first day; a good day (`member_daily_summary`) on or
-- after it pays once, keyed by the day. Safe to run any time and as often as needed: it posts only
-- what hasn't been. Day close calls it after rebuilding history; a parent's run of it is the same.
create function public.apply_points_rules(p_household uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r        public.points_rule;
  v_posted integer := 0;
  v_id     uuid;
  x        record;
begin
  if not (coalesce((select auth.role()), '') = 'service_role'
          or p_household in (select private.admin_household_ids())) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  for r in select * from public.points_rule
            where household_id = p_household and active and archived_at is null
            order by created_at, id loop
    if r.rule_type = 'streak_bonus' then
      for x in select s.member_id, s.start_date
                 from public.streak_segment s
                 join public.member m on m.id = s.member_id and m.earns_rewards and m.archived_at is null
                where s.household_id = p_household and s.kind = 'good' and s.length_days >= r.streak_days
                  and s.start_date + (r.streak_days - 1) >= r.counts_from
                order by s.member_id, s.start_date loop
        v_id := private.post_points_rule_bonus(r, x.member_id, x.start_date::text,
                                              r.streak_days || ' good days in a row');
        v_posted := v_posted + (v_id is not null)::integer;
      end loop;
    else
      for x in select d.member_id, d.summary_date
                 from public.member_daily_summary d
                 join public.member m on m.id = d.member_id and m.earns_rewards and m.archived_at is null
                where d.household_id = p_household and d.day_class = 'good' and d.summary_date >= r.counts_from
                order by d.member_id, d.summary_date loop
        v_id := private.post_points_rule_bonus(r, x.member_id, x.summary_date::text, 'Everything done');
        v_posted := v_posted + (v_id is not null)::integer;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('posted', v_posted);
end $$;

-- ---------------------------------------------------------------------------------------------
-- The wishlist: one pinned reward per child
-- ---------------------------------------------------------------------------------------------

create table public.wishlist_pin (
  member_id       uuid primary key,
  household_id    uuid not null,
  catalog_item_id uuid not null,
  pinned_at       timestamptz not null default now(),
  pinned_by_type  text not null check (pinned_by_type in ('device', 'admin')),
  pinned_by       uuid,                       -- the board's device id, or the admin's user id
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade,
  foreign key (household_id, catalog_item_id) references public.reward_catalog_item (household_id, id)
);

-- [PTS-06] A board (or a parent) pins the reward a child is saving for, or (p_item null) unpins it.
-- Only for a child who earns rewards, and only a reward in the shop now. Pinning the same again
-- changes nothing.
create function public.pin_wish(p_member uuid, p_item uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_member public.member;
  v_actor  record;
begin
  select * into v_member from public.member where id = p_member;
  if not found then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  -- A board or a parent of the member's household (raises otherwise), as for redemptions (WP-18).
  select * into v_actor from private.redemption_actor(v_member.household_id);
  if not v_member.earns_rewards or v_member.archived_at is not null then
    raise exception 'only someone who earns rewards saves for one' using errcode = '22023', hint = 'not_earning';
  end if;
  if p_item is null then
    delete from public.wishlist_pin where member_id = p_member;
    return jsonb_build_object('member_id', p_member, 'item_id', null);
  end if;
  if not exists (select from public.reward_catalog_item i
                  where i.id = p_item and i.household_id = v_member.household_id and i.active
                    and i.archived_at is null) then
    raise exception 'that reward is not in the shop' using errcode = 'P0002', hint = 'not_in_shop';
  end if;
  insert into public.wishlist_pin as w (member_id, household_id, catalog_item_id, pinned_by_type, pinned_by)
  values (p_member, v_member.household_id, p_item, v_actor.actor_type, v_actor.actor_id)
  on conflict (member_id) do update
     set catalog_item_id = excluded.catalog_item_id, pinned_at = now(),
         pinned_by_type = excluded.pinned_by_type, pinned_by = excluded.pinned_by
   where w.catalog_item_id <> excluded.catalog_item_id;
  return jsonb_build_object('member_id', p_member, 'item_id', p_item);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row level security: parents manage bonus rules (never deleted: archived) and read pins; boards
-- read pins. Pins change only through pin_wish().
-- ---------------------------------------------------------------------------------------------

alter table public.points_rule enable row level security;
alter table public.wishlist_pin enable row level security;

create policy points_rule_admin_select on public.points_rule for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy points_rule_admin_insert on public.points_rule for insert to authenticated
  with check (household_id in (select private.admin_household_ids()));
create policy points_rule_admin_update on public.points_rule for update to authenticated
  using (household_id in (select private.admin_household_ids()))
  with check (household_id in (select private.admin_household_ids()));
create policy wishlist_pin_admin_select on public.wishlist_pin for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy wishlist_pin_device_select on public.wishlist_pin for select to authenticated
  using (household_id = (select private.device_household_id()));

revoke all on public.points_rule, public.wishlist_pin from public, anon;
revoke delete, truncate on public.points_rule from authenticated;
revoke insert, update, delete, truncate on public.wishlist_pin from authenticated;
grant select, insert, update on public.points_rule to authenticated;
grant select on public.wishlist_pin to authenticated;

create trigger trg_points_rule_updated before update on public.points_rule
  for each row execute function private.set_updated_at();
create trigger trg_audit after insert or update or delete on public.points_rule
  for each row execute function private.audit_row();

revoke all on function private.post_ledger(uuid, uuid, text, integer, text, text, text, uuid, uuid, uuid),
  private.post_points_rule_bonus(public.points_rule, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_points_rules(uuid), public.pin_wish(uuid, uuid) from public, anon;
grant execute on function public.apply_points_rules(uuid) to authenticated, service_role;
grant execute on function public.pin_wish(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- [PTS-06] The board's snapshot: each child who earns rewards carries the reward they are saving for.
-- ---------------------------------------------------------------------------------------------

create or replace function public.board_snapshot(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_device    public.device;
  v_household public.household;
  v_today     date;
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
  -- yesterday through two weeks ahead (calendar).
  v_today := (now() at time zone v_household.timezone)::date;
  v_from := coalesce(p_from, v_today - 1);
  v_to := coalesce(p_to, v_today + 14);
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
      'theme', coalesce(v_device.board_config ->> 'theme', 'auto')),
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
                  where w.member_id = m.id and i.active and i.archived_at is null) end)
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
               'title', c.title,
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
    -- [PTS-06] The shop as a child chooses from it (what they save for; WP-20 adds asking for one).
    'shop', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'icon', i.icon, 'cost', i.cost_points)
                       order by i.sort_order, i.title, i.id)
        from public.reward_catalog_item i
       where i.household_id = v_household.id and i.active and i.archived_at is null), '[]'::jsonb));
end $$;

-- A pin changing tells the board to read again.
alter publication supabase_realtime add table public.wishlist_pin;
