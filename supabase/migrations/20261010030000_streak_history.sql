-- [RWD-11][RWD-12] Streak history and insights (WP-17, D-55): each member's days and their raw runs of
-- good and bad days, as the rules engine reads them (evaluateHistory, 02 §5), stored for every member
-- through yesterday. The engine runs in TypeScript, so the database keeps the facts and the results:
--   * a trigger marks a member whose occurrences changed (a check-off, a late credit, an uncheck, day
--     close), and day close (the job) rebuilds each marked member's history from all their facts;
--   * a parent's Insights page rebuilds a marked member before it reads, so it is never behind;
--   * member_insights() reads the stored days and runs with the member's items and events.
-- Both tables are derived and rebuildable: the same facts always give the same rows.

create table public.member_daily_summary (
  household_id     uuid not null,
  member_id        uuid not null,
  summary_date     date not null,
  -- Routines due; routines and tasks done and credited to them (by the day they count for).
  scheduled_count  integer not null check (scheduled_count >= 0),
  done_count       integer not null check (done_count >= 0),
  missed_count     integer not null check (missed_count >= 0),
  skipped_count    integer not null check (skipped_count >= 0),
  covered_count    integer not null check (covered_count >= 0),
  points_earned    integer not null,
  -- `open`: a past day still waiting for a parent (D-51); it settles when the parent decides.
  day_class        text not null check (day_class in ('good', 'bad', 'neutral', 'open')),
  engine_version   integer not null check (engine_version > 0),
  computed_at      timestamptz not null default now(),
  primary key (member_id, summary_date),
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade
);
create index on public.member_daily_summary (household_id, summary_date);

-- Raw runs, no grace (goal streaks with grace are the engine's, per goal). Runs never overlap, so a
-- member and a start date name one; the run still going has no end.
create table public.streak_segment (
  household_id     uuid not null,
  member_id        uuid not null,
  kind             text not null check (kind in ('good', 'bad')),
  start_date       date not null,
  end_date         date check (end_date is null or end_date >= start_date),
  length_days      integer not null check (length_days > 0),
  engine_version   integer not null check (engine_version > 0),
  primary key (member_id, start_date),
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade
);
create unique index streak_segment_one_current on public.streak_segment (member_id) where end_date is null;

-- Members whose history must be rebuilt, and since when they were marked.
create table private.member_history_dirty (
  member_id    uuid primary key references public.member (id) on delete cascade,
  household_id uuid not null,
  marked_at    timestamptz not null default clock_timestamp()
);

-- An occurrence whose status, credit or finalization changed marks everyone it concerns: its
-- assignees and whoever did it, before and after.
create function private.mark_history_dirty() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.member_history_dirty (member_id, household_id)
  select distinct m, new.household_id
    from (select a.member_id from public.chore_occurrence_assignee a where a.occurrence_id = new.id
          union select unnest(old.done_by) union select unnest(new.done_by)) x (m)
   where m is not null
  on conflict (member_id) do update set marked_at = clock_timestamp();
  return null;
end $$;
create trigger trg_occurrence_history_dirty
  after update of status, done_by, finalized_at on public.chore_occurrence
  for each row
  when ((old.status, old.done_by, old.finalized_at) is distinct from (new.status, new.done_by, new.finalized_at))
  execute function private.mark_history_dirty();

-- Everyone starts marked, so the first day close (or Insights page) builds their history.
insert into private.member_history_dirty (member_id, household_id)
select id, household_id from public.member
on conflict (member_id) do nothing;

-- Who may read a member's facts or save their history: the job (service role), or a parent of the
-- member's household. Raises otherwise; returns the member's household.
create function private.history_member_household(p_member uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_household uuid;
begin
  select household_id into v_household from public.member where id = p_member;
  if v_household is null
     or not (coalesce((select auth.role()), '') = 'service_role'
             or v_household in (select private.admin_household_ids())) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return v_household;
end $$;

-- [RWD-11] Everything the engine reads for one member (02 §5 OccurrenceFact), every item whatever its
-- visibility, since history counts all of it; through `p_through`. `read_at` lets the save clear only
-- the marks made before this read.
create function public.member_history_facts(p_member uuid, p_through date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.history_member_household(p_member);
  return jsonb_build_object(
    'read_at', clock_timestamp(),
    'facts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.occurrence_id,
               'chore_id', v.chore_id,
               'member_id', v.member_id,
               'kind', v.kind,
               'tag_ids', coalesce((select jsonb_agg(t.tag_id order by t.tag_id)
                                      from public.chore_tag t where t.chore_id = v.chore_id), '[]'::jsonb),
               'due_date', v.due_date,
               'credit_date', case when v.kind = 'chore' then v.due_date
                                   when o.status in ('completed', 'approved', 'pending_approval')
                                     then e.credit_date end,
               'status', v.member_status,
               'credited', v.credited,
               'points', v.points_snapshot)
             order by v.due_date, v.occurrence_id)
        from public.v_member_occurrence v
        join public.chore_occurrence o on o.id = v.occurrence_id
        left join public.chore_completion_event e on e.id = o.status_event_id
       where v.member_id = p_member
         and (v.due_date <= p_through or e.credit_date <= p_through)), '[]'::jsonb));
end $$;

-- [RWD-11] Saves what the engine made of a member's history through `p_through`: each day and each
-- run, replacing what was there, leaving a row that did not change as it was (so a rebuild from the
-- same facts leaves every row identical). Clears the member's mark if nothing changed since `p_read_at`.
create function public.save_member_history(
  p_member uuid, p_through date, p_days jsonb, p_segments jsonb, p_engine_version integer,
  p_read_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.history_member_household(p_member);
  v_days      integer;
  v_segments  integer;
begin
  if jsonb_typeof(p_days) <> 'array' or jsonb_typeof(p_segments) <> 'array' or p_engine_version < 1 then
    raise exception 'days and segments are lists' using errcode = '22023', hint = 'bad_request';
  end if;

  delete from public.member_daily_summary m
   where m.member_id = p_member
     and not exists (select from jsonb_to_recordset(p_days) d (date date)
                      where d.date = m.summary_date and d.date <= p_through);
  insert into public.member_daily_summary as m (household_id, member_id, summary_date, scheduled_count,
         done_count, missed_count, skipped_count, covered_count, points_earned, day_class, engine_version)
  select v_household, p_member, d.date, d.scheduled, d.done, d.missed, d.skipped, d.covered, d.points,
         d."dayClass", p_engine_version
    from jsonb_to_recordset(p_days) d (date date, scheduled integer, done integer, missed integer,
                                       skipped integer, covered integer, points integer, "dayClass" text)
   where d.date <= p_through
  on conflict (member_id, summary_date) do update
     set scheduled_count = excluded.scheduled_count, done_count = excluded.done_count,
         missed_count = excluded.missed_count, skipped_count = excluded.skipped_count,
         covered_count = excluded.covered_count, points_earned = excluded.points_earned,
         day_class = excluded.day_class, engine_version = excluded.engine_version, computed_at = now()
   where (m.scheduled_count, m.done_count, m.missed_count, m.skipped_count, m.covered_count,
          m.points_earned, m.day_class, m.engine_version)
         is distinct from (excluded.scheduled_count, excluded.done_count, excluded.missed_count,
          excluded.skipped_count, excluded.covered_count, excluded.points_earned, excluded.day_class,
          excluded.engine_version);
  select count(*) into v_days from jsonb_to_recordset(p_days) d (date date) where d.date <= p_through;

  delete from public.streak_segment s
   where s.member_id = p_member
     and not exists (select from jsonb_to_recordset(p_segments) r (kind text, start date, "end" date, length integer)
                      where (r.start, r.kind, r."end", r.length)
                            is not distinct from (s.start_date, s.kind, s.end_date, s.length_days));
  insert into public.streak_segment as s (household_id, member_id, kind, start_date, end_date, length_days,
                                          engine_version)
  select v_household, p_member, r.kind, r.start, r."end", r.length, p_engine_version
    from jsonb_to_recordset(p_segments) r (kind text, start date, "end" date, length integer)
  on conflict (member_id, start_date) do update set engine_version = excluded.engine_version
   where s.engine_version <> excluded.engine_version;
  select count(*) into v_segments from jsonb_to_recordset(p_segments) r (kind text);

  delete from private.member_history_dirty where member_id = p_member and marked_at <= p_read_at;
  return jsonb_build_object('days', v_days, 'segments', v_segments);
end $$;

-- The members of a household whose history must be rebuilt: marked, or built by an older engine.
create function public.history_dirty_members(p_household_id uuid, p_engine_version integer)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select d.member_id from private.member_history_dirty d where d.household_id = p_household_id
  union
  select distinct s.member_id from public.member_daily_summary s
   where s.household_id = p_household_id and s.engine_version <> p_engine_version
$$;

-- Whether a member's history waits to be rebuilt (the Insights page rebuilds first).
create function public.member_history_stale(p_member uuid, p_engine_version integer)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.history_member_household(p_member);
  return exists (select from private.member_history_dirty where member_id = p_member)
      or exists (select from public.member_daily_summary
                  where member_id = p_member and engine_version <> p_engine_version);
end $$;

-- [RWD-12] A parent's insights for one member over [p_from, p_to] (closed days), as the parent may
-- see them (security invoker: RLS applies, so an item private to someone else is left out of the
-- item lists). Streaks come from the stored runs; the rate, most-missed items and tags from the
-- member's routines; the trust figures from the events on the member's check-offs.
create function public.member_insights(p_member uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_member public.member;
begin
  select * into v_member from public.member where id = p_member;
  if not found or v_member.household_id not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'insights cover 1 to 367 days' using errcode = '22023', hint = 'bad_range';
  end if;

  return (
    with routines as (
      -- The member's routines in range, as they stand for the member (covered: someone else did it).
      select v.occurrence_id, v.chore_id, v.member_status, v.credited
        from public.v_member_occurrence v
       where v.member_id = p_member and v.kind = 'chore' and v.due_date between p_from and p_to
    ), counted as (
      select r.*, (r.member_status in ('completed', 'approved') and r.credited) as done
        from routines r
       where r.member_status not in ('skipped', 'covered')
    ), checkoffs as (
      -- The member's own check-offs in range (by the day they count for).
      select e.id, e.occurrence_id, e.occurred_at, e.recorded_at
        from public.chore_completion_event e
        join public.chore_occurrence o on o.id = e.occurrence_id
       where o.household_id = v_member.household_id and e.event_type = 'complete'
         and p_member = any (e.done_by) and e.credit_date between p_from and p_to
    ), judged as (
      -- What a parent did next to each check-off: the first approve, reject or uncheck after it.
      select c.id, c.occurred_at as checked_at, n.event_type, n.occurred_at as judged_at
        from checkoffs c
        cross join lateral (
          select x.event_type, x.occurred_at from public.chore_completion_event x
           where x.occurrence_id = c.occurrence_id
             and (x.occurred_at, x.recorded_at, x.id) > (c.occurred_at, c.recorded_at, c.id)
           order by x.occurred_at, x.recorded_at, x.id
           limit 1) n
       where n.event_type in ('approve', 'reject', 'admin_uncomplete')
    )
    select jsonb_build_object(
      'member_id', p_member,
      'from', p_from,
      'to', p_to,
      'streaks', jsonb_build_object(
        'current_kind', (select s.kind from public.streak_segment s where s.member_id = p_member and s.end_date is null),
        'current_length', coalesce((select s.length_days from public.streak_segment s
                                     where s.member_id = p_member and s.end_date is null), 0),
        'best_good', coalesce((select max(s.length_days) from public.streak_segment s
                                where s.member_id = p_member and s.kind = 'good'), 0),
        'longest_bad', coalesce((select max(s.length_days) from public.streak_segment s
                                  where s.member_id = p_member and s.kind = 'bad'), 0),
        'through', (select max(d.summary_date) from public.member_daily_summary d where d.member_id = p_member)),
      'days', coalesce((select jsonb_agg(jsonb_build_object(
                                 'date', d.summary_date, 'class', d.day_class, 'scheduled', d.scheduled_count,
                                 'done', d.done_count, 'missed', d.missed_count) order by d.summary_date)
                          from public.member_daily_summary d
                         where d.member_id = p_member and d.summary_date between p_from and p_to), '[]'::jsonb),
      'rate', jsonb_build_object(
        'done', (select count(*) filter (where done) from counted),
        'counted', (select count(*) from counted)),
      'most_missed', coalesce((select jsonb_agg(jsonb_build_object('chore_id', x.chore_id, 'title', x.title,
                                                                   'missed', x.missed)
                                                 order by x.missed desc, x.title)
                                 from (select r.chore_id, c.title, count(*)::integer as missed
                                         from routines r join public.chore c on c.id = r.chore_id
                                        where r.member_status = 'missed'
                                        group by r.chore_id, c.title
                                        order by count(*) desc, c.title
                                        limit 5) x), '[]'::jsonb),
      'by_tag', coalesce((select jsonb_agg(jsonb_build_object('tag_id', x.id, 'name', x.name, 'done', x.done,
                                                              'counted', x.counted) order by x.name)
                            from (select t.id, t.name, count(*) filter (where k.done)::integer as done,
                                         count(*)::integer as counted
                                    from counted k
                                    join public.chore_tag ct on ct.chore_id = k.chore_id
                                    join public.tag t on t.id = ct.tag_id
                                   group by t.id, t.name) x), '[]'::jsonb),
      'trust', jsonb_build_object(
        'checkoffs', (select count(*) from checkoffs),
        'unchecked', (select count(*) from judged where event_type = 'admin_uncomplete'),
        'approved', (select count(*) from judged where event_type = 'approve'),
        'sent_back', (select count(*) from judged where event_type = 'reject'),
        'median_verify_seconds', (select round(percentile_cont(0.5) within group (
                                            order by extract(epoch from judged_at - checked_at)))::integer
                                    from judged where event_type in ('approve', 'reject'))))
  );
end $$;

-- RLS: parents read their household's history; a board reads its household's runs (the flame).
-- Only the functions above write.
alter table public.member_daily_summary enable row level security;
alter table public.streak_segment enable row level security;
alter table private.member_history_dirty enable row level security;

create policy member_daily_summary_admin_select on public.member_daily_summary for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy streak_segment_admin_select on public.streak_segment for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy streak_segment_device_select on public.streak_segment for select to authenticated
  using (household_id = (select private.device_household_id()));

revoke all on public.member_daily_summary, public.streak_segment from public, anon;
grant select on public.member_daily_summary, public.streak_segment to authenticated;
revoke all on private.member_history_dirty from public, anon, authenticated;

revoke all on function private.mark_history_dirty(), private.history_member_household(uuid)
  from public, anon, authenticated;
revoke all on function public.member_history_facts(uuid, date),
                       public.save_member_history(uuid, date, jsonb, jsonb, integer, timestamptz),
                       public.member_history_stale(uuid, integer),
                       public.member_insights(uuid, date, date) from public, anon;
grant execute on function public.member_history_facts(uuid, date),
                          public.save_member_history(uuid, date, jsonb, jsonb, integer, timestamptz),
                          public.member_history_stale(uuid, integer),
                          public.member_insights(uuid, date, date) to authenticated, service_role;
revoke all on function public.history_dirty_members(uuid, integer) from public, anon, authenticated;
grant execute on function public.history_dirty_members(uuid, integer) to service_role;

-- [RWD-05] The board's streak flame: each member who earns rewards gets their run as of the last
-- closed day; the board adds today with the same engine (it knows today's items).
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
                                    where s.member_id = m.id and s.kind = 'good'), 0)) end)
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
                  and o.status in ('scheduled', 'rejected', 'pending_approval')))), '[]'::jsonb));
end $$;

-- A rebuilt run tells the board to read again, so the flame follows day close.
alter publication supabase_realtime add table public.streak_segment;
