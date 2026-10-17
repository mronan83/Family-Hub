import { sql } from './db';

/**
 * [NFR-14-t][D-110] Removes a spec's own items and puts the children's history back (WP-109).
 * Check-offs are append-only (private.prevent_event_change), so an item that was ticked can't be
 * deleted, and its ticks would stay in the child's good and bad runs, which later specs read as the
 * seed left them (insights.spec.ts, wishlist.spec.ts). So each day with a check-off is skipped after
 * it (a skipped routine makes a day neither good nor bad, and posts nothing), the days without one are
 * removed, and the items archived. Call it once the spec's goals are cancelled, so none of them is
 * worked out again from the skips.
 */
export function retireItems(db: string, ids: string[]): void {
  const list = ids
    .filter(Boolean)
    .map((id) => `'${id}'`)
    .join(', ');
  if (!list) return;
  sql(
    db,
    `insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
     select gen_random_uuid(), o.id, 'skip', '{}'::uuid[], now()
       from public.chore_occurrence o
      where o.chore_id in (${list}) and o.status <> 'skipped'
        and exists (select from public.chore_completion_event e where e.occurrence_id = o.id);
     delete from public.chore_occurrence o where o.chore_id in (${list})
       and not exists (select from public.chore_completion_event e where e.occurrence_id = o.id);
     update public.chore set archived_at = now() where id in (${list}) and archived_at is null`,
  );
}

/** [NFR-14-t] A member's stored runs of good and bad days, as text that changes if any run does. */
export function storedRuns(db: string, member: string): string {
  return sql(
    db,
    `select coalesce(string_agg(kind || ' ' || start_date || ' to ' || coalesce(end_date::text, 'now')
                                || ' ' || length_days, ', ' order by start_date), 'none')
       from public.streak_segment where member_id = '${member}'`,
  );
}
