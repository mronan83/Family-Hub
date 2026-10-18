import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import {
  MISSED_LOOKBACK_DAYS,
  readBoardSleep,
  readSchoolDays,
  type SchoolDays,
} from '@/lib/board-sleep';
import { homeAlerts } from '@/lib/home-alerts';
import { daysToPick, lunchQuickWords, lunchWeekToOpen } from '@/lib/lunch-list';
import { serverClient } from '@/lib/supabase/server';
import { HomeView, type LunchQuick, type SchoolToday } from './home-view';
import { loadGroceries } from './groceries/data';
import { loadLunch } from './meals/data';

export const metadata: Metadata = { title: 'Home' };

const LONG = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

interface YearRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_default: boolean;
}

// [NFR-17][US-109] Home at a glance (WP-57, D-84): the alerts and the quick actions, read as this
// admin through RLS. A waiting change to the week's start day applies here too once its day has come
// [ACC-08]. The household's options are in Settings, Family options.
export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin');
  let household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  if ((await db!.rpc('apply_week_start', { p_household: household.id })).data === true) {
    household = (await adminHousehold(db!, user.userId)) ?? household;
  }
  const h = household;
  const params = await searchParams;
  const today = isoDay(h.timezone);
  const nextWeekStart = addDays(today, 7 - ((dow(today) - h.weekStart + 7) % 7));
  const nextWeekEnd = addDays(nextWeekStart, 6);
  // [MEAL-12] The lunch week the quick action opens: this one Monday to Friday, else the coming one.
  const lunchMonday = lunchWeekToOpen(today);

  const [
    approvals,
    requests,
    boards,
    calendars,
    menus,
    jobs,
    weather,
    years,
    closures,
    invites,
    nextMenus,
    lunchChanges,
    lunchWeek,
    names,
    groceries,
  ] = await Promise.all([
    db!
      .from('chore_occurrence')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', h.id)
      .eq('status', 'pending_approval'),
    db!
      .from('redemption')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', h.id)
      .eq('status', 'requested'),
    db!
      .from('device')
      .select('name, last_seen_at, revoked_at, board_config')
      .eq('household_id', h.id),
    db!.from('calendar_source').select('name, status').eq('household_id', h.id),
    db!.from('menu_source').select('name, adapter, status').eq('household_id', h.id),
    db!.rpc('job_health', { p_household_id: h.id }),
    Promise.all([
      db!.from('household_settings').select('weather_place').eq('household_id', h.id).maybeSingle(),
      db!.from('weather_reading').select('failed_at').eq('household_id', h.id).maybeSingle(),
    ]),
    db!
      .from('school_year')
      .select('id, name, start_date, end_date, is_default')
      .eq('household_id', h.id)
      .is('archived_at', null),
    db!
      .from('school_closure')
      .select('id, name, closure_type, start_date, end_date, school_year_id')
      .eq('household_id', h.id)
      .lte('start_date', today)
      .gte('end_date', today),
    db!
      .from('invite')
      .select('email, expires_at')
      .eq('household_id', h.id)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString()),
    db!
      .from('school_menu_day')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', h.id)
      .gte('menu_date', nextWeekStart)
      .lte('menu_date', nextWeekEnd),
    // [MEAL-09] A child's lunch changes from the board, until their cut-off (WP-49).
    db!
      .from('lunch_request')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', h.id)
      .eq('status', 'waiting')
      .gt('open_until', new Date().toISOString()),
    loadLunch(db!, h.id, lunchMonday),
    db!.from('member').select('id, display_name').eq('household_id', h.id),
    // [MEAL-27] Home's Groceries card (WP-112): the list and what the suggestion learns from.
    loadGroceries(db!, h.id),
  ]);
  for (const r of [approvals, requests, boards, calendars, menus, jobs, years, closures, names]) {
    if (r.error) throw new Error(`home: ${r.error.message}`);
  }

  const live = (years.data ?? []) as YearRow[];
  const byDefault = (a: YearRow, b: YearRow) => Number(b.is_default) - Number(a.is_default);
  const current = live
    .filter((y) => y.start_date <= today && today <= y.end_date)
    .sort(byDefault)[0];
  const upcoming = live
    .filter((y) => y.start_date > today)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0];
  const year = current ?? upcoming ?? null;
  const off = (closures.data ?? []).find((c) => !current || c.school_year_id === current.id);
  const school: SchoolToday = !current
    ? { state: 'none', yearId: upcoming?.id ?? null }
    : off
      ? {
          state: 'off',
          yearId: current.id,
          name: off.name,
          snowDayId:
            off.closure_type === 'snow_day' && off.start_date === today && off.end_date === today
              ? off.id
              : null,
        }
      : dow(today) === 0 || dow(today) === 6
        ? { state: 'weekend', yearId: current.id }
        : { state: 'school', yearId: current.id };

  // [DEV-07] A board missed only while awake counts its hours awake, school nights and weekends
  // (WP-34): the school days over the last 60 days at most, read only when a board needs them.
  const boardRows = (boards.data ?? []) as {
    name: string;
    last_seen_at: string | null;
    revoked_at: string | null;
    board_config: { sleep?: unknown } | null;
  }[];
  let schoolDays: SchoolDays | null = null;
  if (boardRows.some((b) => readBoardSleep(b.board_config?.sleep).missed === 'awake')) {
    const from = addDays(today, -MISSED_LOOKBACK_DAYS);
    const to = addDays(today, 1);
    const days = await db!.rpc('school_days', { p_household_id: h.id, p_from: from, p_to: to });
    if (!days.error) schoolDays = readSchoolDays({ from, to, days: days.data ?? [] });
  }
  const menuRows = (menus.data ?? []) as { name: string; adapter: string; status: string }[];
  const feeds = menuRows.filter((m) => m.adapter === 'nutrislice');
  const alerts = homeAlerts({
    now: new Date().toISOString(),
    today,
    approvals: approvals.count ?? 0,
    requests: requests.count ?? 0,
    lunches: lunchChanges.count ?? 0,
    boards: boardRows.map((b) => ({
      name: b.name,
      lastSeenAt: b.last_seen_at,
      revoked: !!b.revoked_at,
      sleep: readBoardSleep(b.board_config?.sleep),
    })),
    timeZone: h.timezone,
    schoolDays,
    calendars: (calendars.data ?? []) as { name: string; status: string }[],
    menuFeeds: feeds,
    jobsNeedingLook: ((jobs.data ?? []) as { state: string }[]).filter(
      (j) => j.state === 'failing' || j.state === 'stale',
    ).length,
    weather: {
      place: weather[0].data?.weather_place ?? null,
      failedAt: weather[1].data?.failed_at ?? null,
    },
    schoolYear: year
      ? { name: year.name, startDate: year.start_date, endDate: year.end_date }
      : null,
    nextWeek: {
      school: live.some((y) => y.start_date <= nextWeekEnd && nextWeekStart <= y.end_date),
      menuDays: nextMenus.count ?? 0,
    },
    hasMenus: menuRows.length > 0,
    invites: (invites.data ?? []).map((i) => ({ email: i.email, expiresAt: i.expires_at })),
  });

  const nameOf = new Map(
    ((names.data ?? []) as { id: string; display_name: string }[]).map((m) => [
      m.id,
      m.display_name,
    ]),
  );
  const lunch: LunchQuick | null = lunchWeek.length
    ? {
        href: `/admin/meals?week=${lunchMonday}#lunch`,
        words: lunchQuickWords(
          lunchWeek.map((c) => ({
            name: nameOf.get(c.memberId) ?? 'A child',
            toPick: daysToPick(c, today),
          })),
          lunchMonday > today,
        ),
      }
    : null;

  return (
    <HomeView
      name={h.name}
      dateLine={LONG.format(new Date(`${today}T12:00:00Z`))}
      alerts={alerts}
      school={school}
      menuFeeds={feeds.length}
      lunch={lunch}
      groceries={{
        open: groceries.items.filter((i) => i.status === 'open'),
        categories: groceries.categories,
        stores: groceries.stores,
        past: groceries.past,
        learned: groceries.learned,
        preferredStoreId: groceries.preferredStoreId,
      }}
      notice={
        Object.keys(params).find((k) => k === 'welcome' || k === 'joined' || k === 'password') ??
        params.done ??
        null
      }
    />
  );
}
