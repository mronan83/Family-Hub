import type { Metadata } from 'next';
import { type ErrorRow, HealthView, type JobRow } from '../../(admin)/admin/health/view';
import { usageLines, type UsageRow } from '@/lib/health';

// [NFR-07][NFR-08][NFR-18] System health (WP-94) with made-up jobs, errors and usage and no database,
// for the UI suite and the side-by-side: Calendar sync failing, seven jobs running fine, three server
// errors, the database at 31% of its free plan, on Thursday, Oct 15, 2026 at 2:45 pm. ?state=near for
// active CPU at 88% of its limit; ?state=fine for nothing to look at; ?theme=evening.
export const metadata: Metadata = { title: 'System health', robots: { index: false } };

const NOW = new Date('2026-10-15T18:45:00Z');
const ok = (job_type: string, last: string): JobRow => ({
  job_type,
  state: 'ok',
  last_ok_at: last,
  last_run_at: last,
  message: null,
});
const JOBS: JobRow[] = [
  {
    job_type: 'calendar_sync',
    state: 'failing',
    last_ok_at: '2026-10-14T18:00:00Z',
    last_run_at: '2026-10-15T18:30:00Z',
    message: 'The link answered 404 (Not Found).',
  },
  ok('day_close', '2026-10-15T04:05:00Z'),
  ok('heartbeat', '2026-10-15T18:40:00Z'),
  ok('occurrence_gen', '2026-10-15T04:10:00Z'),
  ok('reminders', '2026-10-15T18:44:00Z'),
  ok('weather', '2026-10-15T18:30:00Z'),
  ok('menu_import', '2026-10-15T10:29:00Z'),
  ok('purge_history', '2026-10-15T07:00:00Z'),
];
const ERRORS: ErrorRow[] = [
  {
    occurred_at: '2026-10-14T22:02:00Z',
    route: '/api/jobs/calendar_sync',
    kind: 'job',
    message: 'Calendar sync: the link returned 404',
  },
  {
    occurred_at: '2026-10-09T13:20:00Z',
    route: '/admin/members',
    kind: 'action',
    message: 'Error: a member could not be saved',
  },
  {
    occurred_at: '2026-10-02T23:41:00Z',
    route: '/api/jobs/weather',
    kind: 'job',
    message: 'Weather: Open-Meteo timed out',
  },
];
const usage = (cpu: number): UsageRow[] => [
  {
    source: 'supabase',
    service: 'Database size',
    unit: 'bytes',
    used: 0.31 * 500 * 1024 ** 2,
    project_used: null,
    taken_at: '2026-10-15T18:00:00Z',
  },
  {
    source: 'vercel',
    service: 'Function Invocations',
    unit: 'invocations',
    used: 120_000,
    project_used: 96_000,
    taken_at: '2026-10-15T06:00:00Z',
  },
  {
    source: 'vercel',
    service: 'Fluid Active CPU',
    unit: 'hours',
    used: cpu,
    project_used: cpu * 0.8,
    taken_at: '2026-10-15T06:00:00Z',
  },
];

export default async function DevHealthPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; state?: string }>;
}) {
  const p = await searchParams;
  const theme = p.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const fine = p.state === 'fine';
  return (
    <div className={`admin ${theme}`}>
      <HealthView
        jobs={fine ? JOBS.slice(1) : JOBS}
        errors={fine ? [] : ERRORS}
        usage={usageLines(usage(p.state === 'near' ? 3.5 : 0.4), NOW)}
        demo={false}
        broken={[]}
        tz="America/New_York"
        waiting={2}
        who={{ name: 'Alex', avatarKey: 'owl', color: 'member-1' }}
      />
    </div>
  );
}
