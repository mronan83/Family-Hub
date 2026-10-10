import type { SupabaseClient } from '@supabase/supabase-js';
import type { CalendarRow, CalendarStatus, UpcomingEvent } from '@/lib/calendars';
import type { MemberColor } from '@familywise/ui';

/** How many of each calendar's next events the page lists. */
export const UPCOMING = 5;

/** [CAL-01][CAL-06] The household's calendars, oldest first, each with its next events (RLS). */
export async function loadCalendars(
  db: SupabaseClient,
  householdId: string,
  now: Date = new Date(),
): Promise<CalendarRow[]> {
  const { data, error } = await db
    .from('calendar_source')
    .select(
      'id, name, color, member_id, show_on_board, status, last_synced_at, last_success_at, last_error',
    )
    .eq('household_id', householdId)
    .order('created_at');
  if (error) throw new Error(`calendars: ${error.message}`);
  return Promise.all(
    (data ?? []).map(async (c) => {
      const upcoming = await db
        .from('calendar_event_instance')
        .select(
          'id, title, all_day, instance_start, instance_end, local_start_date, local_end_date, changed',
          { count: 'exact' },
        )
        .eq('source_id', c.id)
        .gt('instance_end', now.toISOString())
        .order('instance_start')
        .order('title')
        .limit(UPCOMING);
      if (upcoming.error) throw new Error(`calendar events: ${upcoming.error.message}`);
      return {
        id: c.id as string,
        name: c.name as string,
        color: c.color as MemberColor,
        memberId: (c.member_id as string | null) ?? null,
        showOnBoard: c.show_on_board as boolean,
        status: c.status as CalendarStatus,
        lastSyncedAt: (c.last_synced_at as string | null) ?? null,
        lastSuccessAt: (c.last_success_at as string | null) ?? null,
        lastError: (c.last_error as string | null) ?? null,
        upcomingCount: upcoming.count ?? 0,
        upcoming: (upcoming.data ?? []).map((i): UpcomingEvent => ({
          id: i.id as string,
          title: i.title as string,
          allDay: i.all_day as boolean,
          start: i.instance_start as string,
          end: i.instance_end as string,
          startDate: i.local_start_date as string,
          endDate: i.local_end_date as string,
          changed: i.changed as boolean,
        })),
      };
    }),
  );
}
