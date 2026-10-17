import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { usageLines, type UsageRow } from '@/lib/health';
import { serverClient } from '@/lib/supabase/server';
import { ERROR_LIMIT, type ErrorRow, HealthView, type JobRow } from './view';

export const metadata: Metadata = { title: 'System health' };

// [NFR-07][NFR-08] System Health (WP-42, D-42): this household's background jobs and server errors,
// and the deployment's usage against the Free-plan limits. Every read goes through a database
// function that checks the caller is an admin, so a household sees only its own jobs and errors.
export default async function HealthPage() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/health');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');

  const [jobsRes, errorsRes, usageRes, demoRes, calendarsRes] = await Promise.all([
    db!.rpc('job_health', { p_household_id: household.id }),
    db!.rpc('household_errors', { p_household_id: household.id, p_limit: ERROR_LIMIT }),
    db!.rpc('system_usage'),
    db!.from('household').select('is_demo').eq('id', household.id).maybeSingle(),
    // [CAL-06] A calendar whose link fails is its own state, not a failing job (D-63): said here too.
    db!
      .from('calendar_source')
      .select('name')
      .eq('household_id', household.id)
      .eq('status', 'error')
      .order('name'),
  ]);
  for (const r of [jobsRes, errorsRes, usageRes, calendarsRes]) {
    if (r.error) throw new Error(`system health: ${r.error.message}`);
  }
  return (
    <HealthView
      jobs={(jobsRes.data ?? []) as JobRow[]}
      errors={(errorsRes.data ?? []) as ErrorRow[]}
      usage={usageLines((usageRes.data ?? []) as UsageRow[], new Date())}
      // [NFR-07] Production's jobs leave the demo family alone (D-62); previews run as it.
      demo={demoRes.data?.is_demo === true}
      broken={((calendarsRes.data ?? []) as { name: string }[]).map((c) => c.name)}
      tz={household.timezone}
    />
  );
}
