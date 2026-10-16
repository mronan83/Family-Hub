-- [CHR-20] Why approval alerts did or did not go (reminders-report workflow, WP-92, D-119). Read only, and counts
-- and reasons only: households and parents are numbered (H1, P1), never named, and no item is named.
-- Covers the household's local today and yesterday. Run by scripts/reminders-report.sh.

\pset footer off
\pset border 2

-- Each household in a stable order, numbered; each parent (an admin with a linked member) numbered.
-- A read-only session can't create views, so each query starts with these.
\set people 'with hh as (select h.id, h.timezone, ''H'' || row_number() over (order by h.created_at, h.id) as h, ((now() at time zone h.timezone)::date - 1) as since_day from public.household h), par as (select hh.h, hh.id as household_id, hh.timezone, m.id as member_id, m.user_id, hu.role, hh.h || ''.P'' || row_number() over (partition by hh.id order by m.created_at, m.id) as p, (hh.since_day::timestamp at time zone hh.timezone) as since from hh join public.household_user hu on hu.household_id = hh.id join public.member m on m.household_id = hh.id and m.user_id = hu.user_id and m.archived_at is null)'

\echo '## Parents: settings and devices'
:people
select par.p as parent, par.role,
       (rp.member_id is not null) as pref_row, rp.enabled as reminders_on, rp.approval_alerts as approvals_on,
       to_char(rp.approvals_on_at at time zone par.timezone, 'Dy HH24:MI') as approvals_on_since,
       coalesce(to_char(rp.quiet_start, 'HH24:MI') || '-' || to_char(rp.quiet_end, 'HH24:MI'), 'none') as quiet,
       (select count(*) from public.push_subscription s where s.member_id = par.member_id and s.enabled) as devices_on
  from par left join public.reminder_preference rp on rp.member_id = par.member_id
 order by par.p;

\echo '## Approval alerts since yesterday (local time), per parent'
:people
select par.p as parent, r.status, coalesce(r.detail, '') as detail,
       to_char(r.created_at at time zone par.timezone, 'Dy HH24:MI') as planned,
       to_char(r.scheduled_for at time zone par.timezone, 'Dy HH24:MI') as goes,
       to_char(r.waiting_from at time zone par.timezone, 'Dy HH24:MI') as window_from,
       coalesce(to_char(r.waiting_to at time zone par.timezone, 'Dy HH24:MI'), '-') as window_to
  from par join public.reminder_delivery r on r.member_id = par.member_id and r.kind = 'approval'
 where r.created_at >= par.since or r.status = 'held'
 order by par.p, r.created_at;

\echo '## Reminders job runs since yesterday, per household'
:people
select hh.h, count(*) as runs, count(*) filter (where j.status <> 'ok') as not_ok,
       sum((j.stats ->> 'approvals')::int) as approvals_planned, sum((j.stats ->> 'sent')::int) as sent,
       sum((j.stats ->> 'delivered')::int) as delivered, sum((j.stats ->> 'failed')::int) as failed,
       count(*) filter (where not j.stats ? 'approvals') as runs_without_approvals_stat
  from hh join public.job_run j on j.household_id = hh.id and j.job_type = 'reminders'
 where j.started_at >= (hh.since_day::timestamp at time zone hh.timezone)
 group by hh.h, hh.timezone order by hh.h;

\echo '## Check-offs since yesterday that needed a parent, per parent: why each was or was not in an alert'
:people, checkoff as (
  select e.id, e.household_id, e.occurrence_id, e.recorded_at, e.done_by, e.actor_type, e.review_status,
         o.requires_approval_snapshot, e.rewarded, o.status as status_now, c.visibility, c.created_by, c.id as chore_id
    from public.chore_completion_event e
    join public.chore_occurrence o on o.id = e.occurrence_id
    join public.chore c on c.id = o.chore_id
    join hh on hh.id = e.household_id
   where e.event_type = 'complete'
     and e.recorded_at >= (hh.since_day::timestamp at time zone hh.timezone)
     and ((o.requires_approval_snapshot and cardinality(e.rewarded) > 0) or e.review_status = 'flagged')
), judged as (
  select par.p, k.status_now, k.actor_type,
         case
           when par.member_id = any (k.done_by) then 'own check-off'
           when not (k.visibility = 'family' or k.created_by = par.user_id
                     or exists (select from public.chore_assignee ca where ca.chore_id = k.chore_id and ca.member_id = par.member_id))
             then 'private, not theirs'
           when rp.member_id is null or not rp.enabled then 'reminders off'
           when not rp.approval_alerts then 'approvals off'
           when rp.approvals_on_at is not null and k.recorded_at <= rp.approvals_on_at then 'before approvals_on_at'
           when exists (select from public.reminder_delivery r
                         where r.member_id = par.member_id and r.kind = 'approval' and r.status = 'sent'
                           and k.recorded_at > r.waiting_from and k.recorded_at <= r.waiting_to) then 'in a sent alert'
           when exists (select from public.reminder_delivery r
                         where r.member_id = par.member_id and r.kind = 'approval' and r.status = 'skipped'
                           and k.recorded_at > r.waiting_from and k.recorded_at <= r.waiting_to) then 'in a skipped alert'
           when exists (select from public.reminder_delivery r
                         where r.member_id = par.member_id and r.kind = 'approval' and r.status = 'held') then 'alert held'
           else 'in no alert'
         end as outcome,
         (select o.status_changed_at - k.recorded_at from public.chore_occurrence o where o.id = k.occurrence_id) as changed_after_check_off
    from checkoff k
    join par on par.household_id = k.household_id
    left join public.reminder_preference rp on rp.member_id = par.member_id
)
select p as parent, outcome, actor_type, status_now, count(*) as check_offs,
       min(changed_after_check_off) as min_status_lag, max(changed_after_check_off) as max_status_lag
  from judged group by p, outcome, actor_type, status_now order by p, outcome, actor_type, status_now;

\echo '## Check-offs waiting now (any day), per household'
:people
select hh.h, count(*) as waiting,
       to_char(min(o.status_changed_at) at time zone hh.timezone, 'Dy HH24:MI') as oldest_changed,
       to_char(max(o.status_changed_at) at time zone hh.timezone, 'Dy HH24:MI') as newest_changed
  from hh join public.chore_occurrence o on o.household_id = hh.id and o.status = 'pending_approval'
 group by hh.h, hh.timezone order by hh.h;

\echo '## Check-offs since yesterday, per household: what the item asked and where each went'
:people
select hh.h, e.actor_type, c.approval as item_approval, o.requires_approval_snapshot as needs_ok,
       (cardinality(e.rewarded) > 0) as earns, e.review_status, o.status as status_now, count(*) as check_offs
  from hh
  join public.chore_completion_event e on e.household_id = hh.id and e.event_type = 'complete'
  join public.chore_occurrence o on o.id = e.occurrence_id
  join public.chore c on c.id = o.chore_id
 where e.recorded_at >= (hh.since_day::timestamp at time zone hh.timezone)
 group by 1, 2, 3, 4, 5, 6, 7 order by 1, 2, 3, 4, 5, 6, 7;

\echo '## Approvals, rejections and parent check-offs since yesterday, per household: how long after the check-off'
:people
select hh.h, e.event_type, e.actor_type, count(*) as events,
       min(e.recorded_at - k.recorded_at) as min_after_check_off, max(e.recorded_at - k.recorded_at) as max_after_check_off
  from hh
  join public.chore_completion_event e on e.household_id = hh.id and e.event_type in ('approve', 'reject', 'admin_complete')
  left join lateral (select k.recorded_at from public.chore_completion_event k
                      where k.occurrence_id = e.occurrence_id and k.event_type = 'complete' and k.recorded_at <= e.recorded_at
                      order by k.recorded_at desc limit 1) k on true
 where e.recorded_at >= (hh.since_day::timestamp at time zone hh.timezone)
 group by 1, 2, 3 order by 1, 2, 3;

\echo '## Household approval switch'
:people
select hh.h, s.approval_mode from hh join public.household_settings s on s.household_id = hh.id order by hh.h;

\echo '## Each check-off since yesterday that waited or whose item asks for an OK, in local time: which alert, who approved and when'
:people, k as (
  select hh.h, hh.id as household_id, hh.timezone, e.id, e.occurrence_id, e.recorded_at, e.done_by, c.approval,
         o.requires_approval_snapshot as needs_ok, (cardinality(e.rewarded) > 0) as earns, e.review_status
    from hh
    join public.chore_completion_event e on e.household_id = hh.id and e.event_type = 'complete'
    join public.chore_occurrence o on o.id = e.occurrence_id
    join public.chore c on c.id = o.chore_id
   where e.recorded_at >= (hh.since_day::timestamp at time zone hh.timezone)
     and (o.requires_approval_snapshot or c.approval = 'required' or e.review_status = 'flagged')
)
select k.h, to_char(k.recorded_at at time zone k.timezone, 'Dy HH24:MI:SS') as checked_off, k.approval as item_approval,
       k.needs_ok, k.earns,
       coalesce((select string_agg(a.event_type || ' by ' || coalesce(par.p, a.actor_type) || ' +'
                                   || to_char(a.recorded_at - k.recorded_at, 'HH24:MI:SS'), ', ' order by a.recorded_at)
                   from public.chore_completion_event a
                   left join par on par.household_id = k.household_id and par.user_id = a.actor_id
                  where a.occurrence_id = k.occurrence_id and a.recorded_at > k.recorded_at
                    and a.event_type <> 'complete'), '-') as then,
       coalesce((select string_agg(par.p || ' ' || r.status || coalesce(' ' || r.detail, '') || ' '
                                   || to_char(r.scheduled_for at time zone k.timezone, 'HH24:MI'), ', ' order by par.p)
                   from public.reminder_delivery r join par on par.member_id = r.member_id
                  where r.household_id = k.household_id and r.kind = 'approval'
                    and k.recorded_at > r.waiting_from and k.recorded_at <= coalesce(r.waiting_to, now())), 'in no alert') as alert
  from k order by k.h, k.recorded_at;
