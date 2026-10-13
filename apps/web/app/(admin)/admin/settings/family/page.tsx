import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { day } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { searchPlaces } from '@/lib/weather';
import { loadApprovalMode } from '../../chores/data';
import { FamilyView } from './view';

export const metadata: Metadata = { title: 'Family options' };

// [ACC-08][US-110] Family options (WP-57, D-84), read through RLS as this admin: the week's start
// day (a waiting change applied first, once its day has come), check-offs [CHR-05], the weather on
// the boards [BRD-04] (the place found by ?place=), the admins and open invites [ACC-03].
export default async function FamilyOptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; place?: string; weather?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/settings/family');
  let household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  if ((await db!.rpc('apply_week_start', { p_household: household.id })).data === true) {
    household = (await adminHousehold(db!, user.userId)) ?? household;
  }

  const params = await searchParams;
  const [admins, invites, approvalMode, settings, lastRead, found] = await Promise.all([
    db!.rpc('household_admins', { p_household_id: household.id }),
    db!
      .from('invite')
      .select('id, email, expires_at')
      .eq('household_id', household.id)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at'),
    loadApprovalMode(db!, household.id),
    db!
      .from('household_settings')
      .select('weather_place, temperature_unit, week_start_next, week_start_next_on')
      .eq('household_id', household.id)
      .maybeSingle(),
    db!
      .from('weather_reading')
      .select('temperature, high, weather_code, is_day, unit, read_at, failed_at, error')
      .eq('household_id', household.id)
      .maybeSingle(),
    params.place ? searchPlaces(params.place) : Promise.resolve(null),
  ]);
  const s = settings.data;
  const w = lastRead.data;
  const weatherNotice = (['saved', 'cleared', 'unit', 'failed'] as const).find(
    (n) => n === params.weather,
  );

  return (
    <FamilyView
      notice={params.done ?? null}
      facts={{
        name: household.name,
        timezone: household.timezone,
        email: user.email ?? '',
        weekStart: household.weekStart,
        weekStartNext:
          s?.week_start_next != null && s.week_start_next_on
            ? { day: s.week_start_next, on: s.week_start_next_on }
            : null,
        approvalMode,
        admins: ((admins.data ?? []) as { user_id: string; email: string; role: string }[]).map(
          (a) => ({ userId: a.user_id, email: a.email, role: a.role }),
        ),
        invites: (invites.data ?? []).map((i) => ({
          id: i.id,
          email: i.email,
          expires: day(i.expires_at, household.timezone),
        })),
      }}
      weather={{
        place: s?.weather_place ?? null,
        unit: s?.temperature_unit === 'celsius' ? 'celsius' : 'fahrenheit',
        last: w
          ? {
              temperature: Number(w.temperature),
              high: Number(w.high),
              code: w.weather_code,
              isDay: w.is_day,
              unit: w.unit === 'celsius' ? 'celsius' : 'fahrenheit',
              readAt: w.read_at,
              failedAt: w.failed_at,
              error: w.error,
            }
          : null,
        timezone: household.timezone,
        query: params.place ?? null,
        found: found ? (found.ok ? { places: found.places } : { error: found.error }) : null,
        notice: weatherNotice ?? null,
      }}
    />
  );
}
