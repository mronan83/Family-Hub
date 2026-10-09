/**
 * [NFR-07][NFR-08] What System Health shows (WP-42, US-904, US-909): job states in plain words, and
 * usage against the Free-plan limits with a warning when one nears its limit.
 */

export type JobState = 'ok' | 'running' | 'stale' | 'failing' | 'never';

export const JOB_STATES: Record<
  JobState,
  { label: string; icon: 'check-circle' | 'clock' | 'hourglass' | 'x-circle' | 'circle' }
> = {
  ok: { label: 'Running fine', icon: 'check-circle' },
  running: { label: 'Running now', icon: 'clock' },
  stale: { label: 'Late', icon: 'hourglass' },
  failing: { label: 'Failing', icon: 'x-circle' },
  never: { label: 'Not run yet', icon: 'circle' },
};

/** "purge_history" → "Purge history". */
export function jobLabel(jobType: string): string {
  const words = jobType.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type Measure = 'count' | 'hours' | 'gb-hours' | 'gb' | 'bytes';

interface Limit {
  source: 'supabase' | 'vercel';
  service: string;
  label: string;
  limit: number;
  measure: Measure;
}

/**
 * The Free-plan limits per month (Supabase Free, Vercel Hobby; `01` §5.6, §9.9). Vercel's apply to
 * the whole account, every project on it together.
 */
export const LIMITS: readonly Limit[] = [
  {
    source: 'supabase',
    service: 'Database size',
    label: 'Database',
    limit: 500 * 1024 ** 2,
    measure: 'bytes',
  },
  {
    source: 'vercel',
    service: 'Function Invocations',
    label: 'Function calls',
    limit: 1_000_000,
    measure: 'count',
  },
  {
    source: 'vercel',
    service: 'Fluid Active CPU',
    label: 'Active CPU',
    limit: 4,
    measure: 'hours',
  },
  {
    source: 'vercel',
    service: 'Fluid Provisioned Memory',
    label: 'Provisioned memory',
    limit: 360,
    measure: 'gb-hours',
  },
  {
    source: 'vercel',
    service: 'Fast Data Transfer',
    label: 'Data transfer',
    limit: 100,
    measure: 'gb',
  },
  {
    source: 'vercel',
    service: 'Fast Origin Transfer',
    label: 'Origin transfer',
    limit: 10,
    measure: 'gb',
  },
  {
    source: 'vercel',
    service: 'CDN Requests',
    label: 'CDN requests',
    limit: 1_000_000,
    measure: 'count',
  },
];

/** A share of a limit at or above this shows a warning. */
export const WARN_AT = 0.8;
/** The daily Vercel reading is late after this long (one missed run, plus slack). */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

/** The factor that turns an API unit into the limit's measure, or null for a unit it does not know. */
export function unitFactor(unit: string, measure: Measure): number | null {
  const u = unit.trim().toLowerCase().replace(/\s+/g, '-');
  const table: Record<Measure, Record<string, number>> = {
    count: { invocations: 1, invocation: 1, requests: 1, request: 1, count: 1, units: 1 },
    hours: {
      hour: 1,
      hours: 1,
      hr: 1,
      hrs: 1,
      h: 1,
      minutes: 1 / 60,
      minute: 1 / 60,
      seconds: 1 / 3600,
      second: 1 / 3600,
      s: 1 / 3600,
      milliseconds: 1 / 3_600_000,
      ms: 1 / 3_600_000,
    },
    'gb-hours': {
      'gb-hour': 1,
      'gb-hours': 1,
      'gb-hr': 1,
      'gb-hrs': 1,
      'gb-h': 1,
      'mb-hour': 1 / 1000,
      'mb-hours': 1 / 1000,
      'gigabyte-hour': 1,
      'gigabyte-hours': 1,
    },
    gb: {
      gb: 1,
      gigabytes: 1,
      gigabyte: 1,
      mb: 1 / 1000,
      megabytes: 1 / 1000,
      kb: 1 / 1e6,
      bytes: 1 / 1e9,
      byte: 1 / 1e9,
      tb: 1000,
    },
    bytes: { bytes: 1, byte: 1 },
  };
  return table[measure][u] ?? null;
}

export interface UsageRow {
  source: string;
  service: string;
  unit: string;
  used: number;
  project_used: number | null;
  taken_at: string;
}

export interface UsageLine {
  label: string;
  /** "12,345 of 1,000,000" or, for a unit this build does not know, the raw value. */
  text: string;
  /** FamilyWise's own share, when the reading is the whole account's. */
  ours: string | null;
  /** 0..1, or null when it cannot be compared with the limit. */
  share: number | null;
  warn: boolean;
}

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function amount(value: number, measure: Measure): string {
  switch (measure) {
    case 'count':
      return number.format(value);
    case 'hours':
      return `${decimal.format(value)} h`;
    case 'gb-hours':
      return `${decimal.format(value)} GB-h`;
    case 'gb':
      return `${decimal.format(value)} GB`;
    case 'bytes':
      return `${number.format(value / 1024 ** 2)} MB`;
  }
}

/** Usage lines in the order of LIMITS (only those with a reading), and how fresh Vercel's is. */
export function usageLines(
  rows: UsageRow[],
  now: Date,
): {
  lines: UsageLine[];
  vercelReadAt: string | null;
  vercelStale: boolean;
} {
  const lines: UsageLine[] = [];
  for (const l of LIMITS) {
    const row = rows.find((r) => r.source === l.source && r.service === l.service);
    if (!row) continue;
    const factor = unitFactor(row.unit, l.measure);
    if (factor === null) {
      lines.push({
        label: l.label,
        text: `${decimal.format(Number(row.used))} ${row.unit}`,
        ours: null,
        share: null,
        warn: false,
      });
      continue;
    }
    const used = Number(row.used) * factor;
    const share = used / l.limit;
    lines.push({
      label: l.label,
      text: `${amount(used, l.measure)} of ${amount(l.limit, l.measure)}`,
      ours: row.project_used === null ? null : amount(Number(row.project_used) * factor, l.measure),
      share,
      warn: share >= WARN_AT,
    });
  }
  const read =
    rows
      .filter((r) => r.source === 'vercel')
      .map((r) => r.taken_at)
      .sort()
      .at(-1) ?? null;
  return {
    lines,
    vercelReadAt: read,
    vercelStale: read === null || now.getTime() - Date.parse(read) > STALE_AFTER_MS,
  };
}
