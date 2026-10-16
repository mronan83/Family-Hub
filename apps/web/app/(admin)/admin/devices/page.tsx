import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { effectiveLayout } from '@/lib/board-layout';
import { addDays, readSchoolDays } from '@/lib/board-sleep';
import { isoDay } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../header';
import { BoardsView } from './view';

export const metadata: Metadata = { title: 'Boards' };

interface DeviceRow {
  id: string;
  name: string;
  status: 'active' | 'revoked';
  last_seen_at: string | null;
  created_at: string;
  revoked_at: string | null;
  board_config: unknown;
}

interface CalendarRow {
  id: string;
  name: string;
  color: string;
  show_on_board: boolean;
}

// [DEV-01][DEV-03][DEV-05] The household's boards: pair a new one, rename, set its theme, see when
// each was last seen, and disconnect one that is lost or retired. Disconnected boards stay listed.
// [DEV-09][D-118] Each board folded to its name and facts (WP-91); the page is BoardsView.
// [CAL-05] Each board's calendars (WP-23): the calendars' own setting until a board's choice is saved.
// [BRD-05][US-1004] The home screen's layout (WP-35, D-67): the household's, and a board's own.
// [BRD-08][US-1007] Each board's text size (WP-47, D-73).
// [DEV-07][US-207] Each board's sleep and wake, and whether it is asleep now (WP-34, D-116).
export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ did?: string; name?: string; error?: string; board?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/devices');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [{ data, error }, cals, choices, settings] = await Promise.all([
    db!
      .from('device')
      .select('id, name, status, last_seen_at, created_at, revoked_at, board_config')
      .eq('household_id', household.id)
      .order('created_at'),
    db!
      .from('calendar_source')
      .select('id, name, color, show_on_board')
      .eq('household_id', household.id)
      .order('created_at'),
    db!
      .from('device_calendar')
      .select('device_id, calendar_source_id, visible')
      .eq('household_id', household.id),
    db!
      .from('household_settings')
      .select('board_layout')
      .eq('household_id', household.id)
      .maybeSingle(),
  ]);
  if (error) throw new Error(`devices: ${error.message}`);
  if (cals.error) throw new Error(`calendars: ${cals.error.message}`);
  if (choices.error) throw new Error(`board calendars: ${choices.error.message}`);
  if (settings.error) throw new Error(`settings: ${settings.error.message}`);
  // [DEV-07] Which nights are school nights, for whether each board is asleep now.
  const today = isoDay(household.timezone);
  const from = addDays(today, -1);
  const to = addDays(today, 7);
  const school = await db!.rpc('school_days', {
    p_household_id: household.id,
    p_from: from,
    p_to: to,
  });
  const schoolDays = school.error ? null : readSchoolDays({ from, to, days: school.data ?? [] });
  const now = new Date().getTime();
  const householdLayout = effectiveLayout(settings.data?.board_layout, null);
  const devices = (data ?? []) as DeviceRow[];
  const calendars = (cals.data ?? []) as CalendarRow[];
  // A board shows its own choice once one is saved, else each calendar's "show on the boards".
  const shownOn = (deviceId: string) => {
    const own = (choices.data ?? []).filter((c) => c.device_id === deviceId);
    return {
      own: own.length > 0,
      shown: new Set(
        own.length > 0
          ? own.filter((c) => c.visible).map((c) => c.calendar_source_id as string)
          : calendars.filter((c) => c.show_on_board).map((c) => c.id),
      ),
    };
  };
  const params = await searchParams;
  return (
    <BoardsView
      header={<AdminHeader current="/admin/devices" />}
      boards={devices
        .filter((d) => d.status === 'active')
        .map((d) => ({
          id: d.id,
          name: d.name,
          lastSeenAt: d.last_seen_at,
          config: d.board_config,
          calendars: shownOn(d.id),
        }))}
      disconnected={devices
        .filter((d) => d.status === 'revoked')
        .map((d) => ({ id: d.id, name: d.name, revokedAt: d.revoked_at }))}
      calendars={calendars}
      householdLayout={householdLayout}
      now={now}
      timeZone={household.timezone}
      school={schoolDays}
      params={params}
    />
  );
}
