-- [CHR-06][CHR-08][PTS-01] A parent's day (WP-12, D-52): completes, unchecks, skips, approvals and
-- rejections are completion events recorded through record_completions() as the parent (WP-10). An
-- uncheck of several items shares one batch_id; this puts such a batch back in one step.

-- Puts back what a batch of "Not actually done" unchecked: each occurrence still as the batch left it
-- is done again by whoever had done it, as a parent's completion (approved), so its points are earned
-- again. One changed since (checked off again, skipped, unchecked once more) is left as it is.
-- Security invoker: RLS and the event rules apply, so only a parent of the household can do it. Safe
-- to run twice: each put-back event's id comes from the batch and the occurrence.
create function public.undo_uncheck_batch(p_batch_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_batch    integer;
  v_restored integer;
begin
  select count(*) into v_batch
    from public.chore_completion_event
   where batch_id = p_batch_id and event_type = 'admin_uncomplete';

  with still as (
    -- Unchecked by this batch, and nothing has happened to it since.
    select e.id, e.occurrence_id, e.occurred_at, e.recorded_at
      from public.chore_completion_event e
      join public.chore_occurrence o on o.id = e.occurrence_id and o.status_event_id = e.id
     where e.batch_id = p_batch_id and e.event_type = 'admin_uncomplete'
  ), before as (
    -- Who had done it: the event the uncheck reversed.
    select s.occurrence_id, prior.done_by
      from still s
      cross join lateral (
        select ev.event_type, ev.done_by
          from public.chore_completion_event ev
         where ev.occurrence_id = s.occurrence_id
           and (ev.occurred_at, ev.recorded_at, ev.id) < (s.occurred_at, s.recorded_at, s.id)
         order by ev.occurred_at desc, ev.recorded_at desc, ev.id desc
         limit 1
      ) prior
     where prior.event_type in ('complete', 'approve', 'admin_complete')
  )
  insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
  select md5(p_batch_id::text || ':' || b.occurrence_id::text || ':restore')::uuid,
         b.occurrence_id, 'admin_complete', b.done_by, now()
    from before b
  on conflict (id) do nothing;
  get diagnostics v_restored = row_count;

  return jsonb_build_object('restored', v_restored, 'unchanged', v_batch - v_restored);
end $$;

revoke all on function public.undo_uncheck_batch(uuid) from public, anon;
grant execute on function public.undo_uncheck_batch(uuid) to authenticated;
